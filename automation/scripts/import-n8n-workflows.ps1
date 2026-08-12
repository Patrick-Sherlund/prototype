param(
  [string]$ComposeProject = "n8n-sample"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

docker compose -p $ComposeProject ps n8n | Out-Host
docker compose -p $ComposeProject exec -T n8n n8n import:workflow --input=/workflows/figma-make-design-handoff.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
foreach ($oldWorkflowId in @("pocSlackRequest", "pocGithubCompletion", "pocStandupJira")) {
  docker compose -p $ComposeProject exec -T n8n n8n unpublish:workflow --id=$oldWorkflowId
}
docker compose -p $ComposeProject exec -T n8n n8n publish:workflow --id=figmaMakeDesignHandoff
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose -p $ComposeProject exec -T n8n n8n list:workflow | Out-Host

Write-Host "Imported and published the Figma Make design handoff workflow. Stale prototype workflows were unpublished if present."
