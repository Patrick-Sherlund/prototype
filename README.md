# Foodservice Prototype Automation POC

This repo contains a small Sysco-themed foodservice ordering prototype and the automation scaffolding for:

```text
Slack -> n8n -> Jira -> local Claude Code worker -> GitHub branch/PR/preview -> Jira -> Slack
```

Slack requests may reference an existing `SYSCO-<number>` Jira issue. If Jira returns 404 for that key, the n8n workflow creates a new issue in the configured project and uses Jira's generated key for the branch, PR, preview, completion update, and Slack reply.

## Prototype

```powershell
npm ci
npm run dev
npm run build
npm run preview
npm run worker
npm run worker:start
npm run worker:stop
```

Local preview defaults to `http://127.0.0.1:5173/`.

## n8n

```powershell
Copy-Item .env.example .env
# Fill .env with local secrets and tunnel URL.
npm run build:workflows
docker compose up -d
.\automation\scripts\import-n8n-workflows.ps1
npm run worker:start
```

Health:

```powershell
Invoke-WebRequest http://localhost:5678/healthz
```

Start a free HTTPS tunnel for Slack/GitHub callbacks:

```powershell
docker compose --profile tunnel up -d cloudflared
docker compose logs -f cloudflared
```

Stop:

```powershell
docker compose down
```

## Documentation

Full setup and demo procedure:

[docs/poc-workflow.md](docs/poc-workflow.md)
