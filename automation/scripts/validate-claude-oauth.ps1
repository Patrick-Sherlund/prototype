param(
  [string] $EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

function Get-DotEnvValue {
  param(
    [string] $Path,
    [string] $Name
  )

  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  return $line.Substring($Name.Length + 1).Trim()
}

function Invoke-ClaudeSafely {
  param(
    [string] $Label,
    [bool] $IsolateHome,
    [string] $Token
  )

  $names = @(
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME"
  )

  $old = @{}
  foreach ($name in $names) {
    $old[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  }

  $tempRoot = $null
  try {
    [Environment]::SetEnvironmentVariable("CLAUDE_CODE_OAUTH_TOKEN", $Token, "Process")
    [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $null, "Process")
    [Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $null, "Process")

    if ($IsolateHome) {
      $tempRoot = Join-Path $env:TEMP ("claude-token-isolated-" + [Guid]::NewGuid().ToString("N"))
      $homePath = Join-Path $tempRoot "home"
      $appdata = Join-Path $tempRoot "appdata"
      $localappdata = Join-Path $tempRoot "localappdata"
      $xdg = Join-Path $tempRoot "xdg"
      New-Item -ItemType Directory -Force -Path $homePath, $appdata, $localappdata, $xdg | Out-Null

      [Environment]::SetEnvironmentVariable("HOME", $homePath, "Process")
      [Environment]::SetEnvironmentVariable("USERPROFILE", $homePath, "Process")
      [Environment]::SetEnvironmentVariable("APPDATA", $appdata, "Process")
      [Environment]::SetEnvironmentVariable("LOCALAPPDATA", $localappdata, "Process")
      [Environment]::SetEnvironmentVariable("XDG_CONFIG_HOME", $xdg, "Process")
    }

    $output = & claude -p "Reply with OK only." --max-turns 1 2>&1
    $code = $LASTEXITCODE
    $text = ($output | Out-String).Trim()
    $text = $text.Replace($Token, "[redacted-token]")
    $text = $text -replace "sk-ant-[A-Za-z0-9._-]+", "[redacted-token]"
    $text = $text -replace "([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})", "[redacted-email]"
    if ($text.Length -gt 1200) {
      $text = $text.Substring(0, 1200) + "...[truncated]"
    }

    [pscustomobject]@{
      label = $Label
      isolated_home = $IsolateHome
      exit_code = $code
      output = $text
    }
  }
  finally {
    foreach ($entry in $old.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }

    if ($tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$token = Get-DotEnvValue -Path $EnvPath -Name "CLAUDE_CODE_OAUTH_TOKEN"
if (-not $token) {
  throw "CLAUDE_CODE_OAUTH_TOKEN is not present in $EnvPath"
}

$results = @(
  (Invoke-ClaudeSafely -Label "oauth-token-isolated-config" -IsolateHome $true -Token $token),
  (Invoke-ClaudeSafely -Label "oauth-token-normal-config" -IsolateHome $false -Token $token)
)

$results | ConvertTo-Json -Depth 4
