param(
  [string]$ComposeProject = "n8n-sample"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

docker compose -p $ComposeProject ps n8n | Out-Host
docker compose -p $ComposeProject exec -T n8n n8n import:workflow --input=/workflows/slack-request-workflow.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose -p $ComposeProject exec -T n8n n8n import:workflow --input=/workflows/github-completion-workflow.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose -p $ComposeProject exec -T n8n n8n publish:workflow --id=pocSlackRequest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose -p $ComposeProject exec -T n8n n8n publish:workflow --id=pocGithubCompletion
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose -p $ComposeProject exec -T n8n n8n list:workflow | Out-Host

Write-Host "Imported and published n8n workflows."
