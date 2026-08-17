# Figma MCP Design Handoff Automation

Rapid prototype automation for the free-tier POC:

```text
Slack / Jira design request
  -> n8n request webhook
  -> one threaded Slack status conversation
  -> local Claude Code worker
  -> authenticated Figma MCP
  -> read Figma Make resources/context
  -> create or update editable Figma Design artifact
  -> Jira update
  -> final Slack thread reply
```

## Responsibilities

- Figma Make: source/context artifact for the prototype.
- n8n: deterministic orchestration, idempotency, Jira, and Slack.
- Claude Code: Figma MCP execution agent only.
- Figma Design: writable downstream handoff artifact.
- Jira: work tracking and traceability.
- Slack: request/status visibility in one thread per handoff.

Figma REST webhooks and authenticated browser automation of the Figma Make editor are optional upgrade paths. GitHub Actions, repository code generation, PR creation, and preview deployment are not part of this product workflow.

## Quick Start

```powershell
Copy-Item .env.example .env
# Fill .env with Jira, Slack, n8n, Claude worker, and Figma Make values.
npm run build:workflows
npm run test:figma
docker compose up -d
.\automation\scripts\import-n8n-workflows.ps1
npm run worker:start
```

Run the MCP-only POC request:

```powershell
npm run figma:request:test -- --issue SYSCO-20
```

## Endpoints

- Primary MCP request: `<N8N_WEBHOOK_URL>/webhook/poc/figma/handoff/request`
- Worker callback: `<N8N_WEBHOOK_URL>/webhook/poc/figma/handoff/completion`
- Optional Figma webhook: `<N8N_WEBHOOK_URL>/webhook/poc/figma/version-update`
- Local worker health: `http://127.0.0.1:8787/healthz`

## Validation

```powershell
npm run validate:workflows
npm run test:figma
npm run figma:request:test -- --issue SYSCO-20
claude auth status
claude mcp list
```

Mocked tests validate orchestration logic only. Real acceptance requires Claude Code authenticated to Figma MCP, Make context read through MCP, an editable Figma Design artifact created or updated, Jira updated, and one Slack parent thread with replies.

Detailed setup and demo procedure:

[docs/poc-workflow.md](docs/poc-workflow.md)
