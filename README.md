# Figma Make Full Design Sync Automation

Rapid prototype automation for synchronizing a Figma Make prototype into one canonical editable Figma Design file:

```text
Figma Make named version or manual POC request
  -> n8n
  -> one threaded Slack status conversation
  -> local Claude Code worker
  -> authenticated Figma MCP
  -> discover Make views
  -> generate_figma_design into one canonical Figma Design file
  -> Jira update
  -> final Slack thread reply
```

## Responsibilities

- Figma Make: authoritative source/context for the prototype.
- Runnable/published Make URL: rendered UI used for full-view capture when required.
- n8n: orchestration, idempotency, Slack, Jira, and persistent sync state.
- Claude Code: Figma MCP execution agent only.
- Figma Design: one canonical downstream editable sync artifact.
- Jira: work tracking and traceability.
- Slack: status visibility in one thread per accepted sync.

Claude must not modify repository source code, update Jira, send Slack messages, create PRs, or edit the Figma Make source during runtime handoffs.

## Quick Start

```powershell
Copy-Item .env.example .env
# Fill .env with Jira, Slack, n8n, Claude worker, Figma Make, and canonical Design values.
npm run build:workflows
npm run test:figma
docker compose up -d
.\automation\scripts\import-n8n-workflows.ps1
npm run worker:start
```

Run the request-driven POC:

```powershell
npm run figma:request:test -- --issue SYSCO-20
```

## Canonical Design File

Set these when the canonical Design file exists:

```env
FIGMA_DESIGN_FILE_URL=https://www.figma.com/design/...
FIGMA_DESIGN_FILE_KEY=...
FIGMA_SYNC_PAGE_NAME=Figma Make Screens
```

When `FIGMA_DESIGN_FILE_URL` or `FIGMA_DESIGN_FILE_KEY` is configured, the workflow must target that file and must fail if Claude/Figma MCP cannot edit it. It must not silently create another file.

If no canonical file exists, `FIGMA_DESIGN_BOOTSTRAP_ALLOWED=true` allows one bootstrap creation. n8n then persists the returned URL/key in workflow static data and subsequent runs use SYNC mode.

## Rendered Capture

Full sync requires a renderable Make experience for every discovered view:

```env
FIGMA_MAKE_URL=https://www.figma.com/make/...
FIGMA_MAKE_PUBLISHED_URL=https://...
```

Figma MCP Make resources are used to discover routes, screens, tabs, steps, dialogs, and states. The runnable/published URL is used for deterministic navigation and `generate_figma_design` capture. If no runnable URL exists and Figma MCP cannot render/navigate the Make prototype directly, the sync fails with a concrete `figma_render` blocker.

## Validation

```powershell
npm run validate:workflows
npm run test:figma
claude auth status
claude mcp list
```

Mocked tests validate orchestration and JSON handling only. Real acceptance requires:

- full Make project inspected,
- view manifest generated,
- every reachable view captured or explicitly skipped,
- all captures in one canonical Design file,
- second sync reuses the same file and reconciles mapped frames,
- Jira and Slack report the same canonical Design URL and coverage counts.

Detailed setup and demo procedure:

[docs/poc-workflow.md](docs/poc-workflow.md)
