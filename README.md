# Figma Make Design Handoff Automation

Rapid prototype automation for:

```text
Figma Make named version
  -> Figma FILE_VERSION_UPDATE webhook
  -> n8n
  -> one threaded Slack status conversation
  -> local Claude Code worker
  -> Figma MCP generate_figma_design
     + runtime Playwright MCP browser rendering when needed
  -> editable Figma Design
  -> Jira update
  -> final Slack thread reply
```

## Responsibilities

- Figma Make: source of truth for the prototype.
- n8n: deterministic orchestration, idempotency, Jira, and Slack.
- Claude Code: Figma MCP execution agent only.
- Figma Design: downstream editable handoff artifact.
- Jira: work tracking and traceability.
- Slack: workflow visibility in one status thread per handoff.

Slack is not the trigger. GitHub Actions, repository code generation, PR creation, and preview deployment are no longer part of the product workflow.

## Quick Start

```powershell
Copy-Item .env.example .env
# Fill .env with Figma, Jira, Slack, n8n, and local worker values.
npm run build:workflows
npm run test:figma
docker compose up -d
.\automation\scripts\import-n8n-workflows.ps1
npm run worker:start
```

Start a public tunnel for Figma webhooks:

```powershell
docker compose --profile tunnel up -d cloudflared
docker compose logs -f cloudflared
```

Register the Figma webhook after `N8N_WEBHOOK_URL`, `FIGMA_ACCESS_TOKEN`, `FIGMA_WEBHOOK_PASSCODE`, and `FIGMA_MAKE_FILE_KEY` are configured:

```powershell
npm run figma:webhook:register
```

## Endpoints

- Figma webhook: `<N8N_WEBHOOK_URL>/webhook/poc/figma/version-update`
- Worker callback: `<N8N_WEBHOOK_URL>/webhook/poc/figma/handoff/completion`
- Local worker health: `http://127.0.0.1:8787/healthz`

## Validation

```powershell
npm run validate:workflows
npm run test:figma
npm run figma:webhook:test -- --issue SYSCO-1
claude auth status
claude mcp list
npx -y @playwright/mcp@latest --help
```

The mocked tests validate orchestration logic only. Real acceptance requires a real Figma Make named version, Claude Code authenticated to Figma MCP, editable layers in the resulting Figma Design, Jira updated, and one Slack parent thread with replies.

Detailed setup and demo procedure:

[docs/poc-workflow.md](docs/poc-workflow.md)
