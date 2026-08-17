# Figma MCP Design Handoff POC

## Supported Now

```text
Slack / Jira design request
  |
  v
n8n request webhook
  |  - parse SYSCO Jira key
  |  - verify existing Jira issue
  |  - create one Slack parent status message
  |  - post progress replies in the same thread
  |  - invoke local Claude Code worker
  v
Local Claude Code worker
  |
  | authenticated Figma MCP
  |  - read the existing Figma Make project resources/context
  |  - use Make context as the design source/context
  |  - create or update editable Figma Design artifact
  |  - return structured JSON with the resulting Figma Design link
  v
n8n completion callback
  |  - persist Jira -> Figma Design mapping
  |  - update Jira
  |  - post final Slack thread reply
  v
Jira + Slack
```

The free-tier POC does not depend on Figma REST webhooks and does not depend on a browser being signed into the Figma Make editor.

## Capability Boundary

Figma Make is the source/context artifact. Claude reads available Make resources through authenticated Figma MCP.

Figma Design is the writable handoff artifact. Claude creates or updates editable native design content using the currently supported Figma MCP write tools. Do not claim that the workflow mutates the original Figma Make project unless the current Figma MCP tool surface explicitly supports that operation.

`generate_figma_design` is the preferred Code-to-Canvas path when the current MCP/runtime can use it without authenticated Figma Make browser state. If `generate_figma_design` is only applicable to live UI capture in the current tool surface, the worker prompt allows another supported Figma MCP write-to-canvas tool, such as `use_figma`, to create the editable Design artifact. The actual creation tool is returned in structured output when available.

## Optional / Plan-Dependent

Figma REST webhook support is preserved but disabled by default:

```text
Professional+ Figma plan/context
  -> FILE_VERSION_UPDATE webhook
  -> n8n
  -> same Jira / Slack / Claude / Figma MCP path
```

Enable only when the Figma plan/context supports webhook registration:

```env
FIGMA_WEBHOOK_ENABLED=true
FIGMA_ACCESS_TOKEN=<optional-figma-token>
FIGMA_WEBHOOK_PASSCODE=<optional-webhook-secret>
```

Then register:

```powershell
npm run figma:webhook:register
```

When `FIGMA_WEBHOOK_ENABLED=false`, registration and synthetic webhook tests skip cleanly unless `--force` is passed.

## Not Required

Authenticated browser automation of the Figma Make editor is not required for the core POC. Playwright MCP is disabled by default and should be treated as optional diagnostics or as a helper for non-authenticated/published/local pages.

```env
FIGMA_PLAYWRIGHT_ENABLED=false
FIGMA_CLAUDE_ALLOWED_TOOLS=mcp__figma__*,Read,LS
```

## Repository

- Workflow export: `automation/n8n/figma-make-design-handoff.json`
- Workflow builder: `automation/n8n/build-workflows.mjs`
- Local worker: `automation/local-worker/worker.mjs`
- Claude/Figma prompt and JSON helpers: `automation/claude/figma-handoff.mjs`
- Primary request test helper: `scripts/test-figma-request.mjs`
- Optional webhook helpers: `scripts/register-figma-webhook.mjs`, `scripts/test-webhook.mjs`

The old Slack-triggered code-generation flow, GitHub dispatch flow, PR creation, and preview deployment are not part of this workflow.

## Required Configuration

Copy `.env.example` to `.env` and fill in local values. Do not commit `.env`.

| Name | Sensitive | Purpose |
| --- | --- | --- |
| `N8N_WEBHOOK_URL` | No | Public HTTPS base URL for request and worker callback webhooks |
| `N8N_ENCRYPTION_KEY` | Yes | Stable n8n credential encryption key |
| `FIGMA_MAKE_FILE_KEY` | No | Figma Make file key used as source/context |
| `FIGMA_MAKE_URL` | No | Full Figma Make URL passed to Claude Code |
| `FIGMA_DESTINATION_FILE_KEY` | No | Optional default Design destination |
| `FIGMA_DESTINATION_FILE_URL` | No | Optional default Design destination URL |
| `FIGMA_HANDOFF_REQUEST_SECRET` | Yes | Optional shared secret for the request webhook |
| `SLACK_CHANNEL_ID` | No | Status channel, currently `C0BP62TK3PD` |
| `SLACK_BOT_TOKEN` | Yes | Posts parent message and thread replies |
| `JIRA_BASE_URL` | No | `https://patricksherlund.atlassian.net` |
| `JIRA_PROJECT_KEY` | No | `SYSCO` |
| `JIRA_AUTH_HEADER` | Yes | Jira Basic auth header |
| `N8N_CALLBACK_SECRET` | Yes | Worker -> n8n callback authentication |
| `LOCAL_WORKER_URL` | No | n8n -> local worker URL, usually `http://host.docker.internal:8787` |
| `LOCAL_WORKER_SECRET` | Yes | n8n -> worker authentication |
| `FIGMA_CLAUDE_MAX_TURNS` | No | Claude turn budget for the handoff |
| `FIGMA_HANDOFF_TIMEOUT_MS` | No | Worker timeout for the Claude/Figma operation |
| `FIGMA_CLAUDE_ALLOWED_TOOLS` | No | Claude tools allowed for Figma MCP handoff |
| `FIGMA_WEBHOOK_ENABLED` | No | Optional webhook support flag, default `false` |
| `FIGMA_PLAYWRIGHT_ENABLED` | No | Optional browser diagnostic flag, default `false` |

Generate local shared secrets:

```powershell
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

## Docker and n8n

Start n8n:

```powershell
docker compose up -d
docker compose ps
Invoke-WebRequest http://localhost:5678/healthz
```

Build, import, and publish the workflow:

```powershell
npm run build:workflows
.\automation\scripts\import-n8n-workflows.ps1
docker compose restart n8n
```

Open `http://localhost:5678` and confirm the active workflow:

```text
Figma MCP Request to Design Handoff
```

## Tunnel

n8n request and callback webhooks need a public HTTPS base URL for external services. Start the included Cloudflare quick tunnel:

```powershell
docker compose --profile tunnel up -d cloudflared
docker compose logs -f cloudflared
```

Use the printed `https://...trycloudflare.com` origin as:

```text
N8N_WEBHOOK_URL=https://...trycloudflare.com
```

Then recreate n8n so it sees the current value:

```powershell
docker compose up -d --force-recreate n8n
```

## Primary Request POC

Run:

```powershell
npm run figma:request:test -- --issue SYSCO-20
```

Default test request:

```text
Using the existing Figma Make SAR Questionnaire prototype as context, create or update the corresponding Figma Design screen so the intro/start questionnaire area includes a compact 'Estimated time: 8 min' badge near the primary start action. Do not redesign unrelated areas.
```

Override:

```powershell
npm run figma:request:test -- --issue SYSCO-20 --request "Create a compact delivery ETA badge on recent order cards."
```

Expected:

1. n8n accepts the request.
2. n8n verifies the Jira issue.
3. n8n creates one Slack parent message.
4. n8n posts progress replies in that thread.
5. n8n invokes the local Claude worker.
6. Claude connects to Figma MCP.
7. Claude reads the Figma Make project context/resources.
8. Claude creates or updates an editable Figma Design artifact.
9. Worker returns a Figma Design link to n8n.
10. n8n comments on Jira.
11. n8n posts the final Slack completion reply.

## Slack

Reuse the existing Slack app in workspace `Sysco-Demo`.

Required bot scope:

```text
chat:write
```

Invite the app to channel:

```text
C0BP62TK3PD
```

The workflow creates exactly one parent channel message for each accepted handoff, then stores the returned Slack `ts` as `slackThreadTs`. Every progress and final message uses:

```json
{
  "channel": "C0BP62TK3PD",
  "thread_ts": "<parent message ts>"
}
```

Slack failure alone does not invalidate a successful Figma/Jira handoff.

## Jira

Jira site:

```text
https://patricksherlund.atlassian.net
```

Project key:

```text
SYSCO
```

The workflow verifies and updates existing issues. It does not create replacement issues.

After Figma generation succeeds, n8n adds a Jira comment containing:

```text
Design handoff generated automatically from Figma Make.
Request: <request text>
Source: <Figma Make link/context>
Editable Figma Design: <url>
Correlation ID: <id>
```

## Claude Code and Figma MCP

Confirm the local Claude session:

```powershell
claude auth status
```

Confirm Figma MCP:

```powershell
claude mcp list
```

The local worker fails explicitly at `figma_mcp_auth` if `claude mcp list` does not show Figma connected.

The worker strips `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` from the Claude child process so the local `claude.ai` session is used instead of metered API credentials.

## Local Worker

Start:

```powershell
npm run worker:start
```

Health:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/healthz
```

Stop:

```powershell
npm run worker:stop
```

n8n reaches the worker from Docker through:

```text
LOCAL_WORKER_URL=http://host.docker.internal:8787
```

The worker invokes Claude Code with a constrained Figma-MCP-only prompt by default. It does not run git, create branches, commit, push, open PRs, publish previews, update Jira, send Slack messages, or write to the Figma Make source.

## Persistence

n8n workflow static data stores:

```json
{
  "figmaHandoffs": {
    "<file_key>:request:<request_id>": {
      "status": "processing | figma_succeeded | completed | jira_failed | failed",
      "jiraIssueKey": "SYSCO-20",
      "requestText": "Create a compact delivery ETA badge...",
      "design": {
        "url": "https://www.figma.com/design/...",
        "fileKey": "...",
        "nodeId": "...",
        "creationTool": "generate_figma_design | use_figma | ..."
      },
      "slack": {
        "channel": "C0BP62TK3PD",
        "threadTs": "..."
      }
    }
  },
  "figmaDesignMappings": {
    "SYSCO-20": {
      "figmaDesignFileKey": "...",
      "figmaDesignUrl": "https://www.figma.com/design/..."
    }
  }
}
```

Completed duplicate request IDs are ignored. If Figma succeeds but Jira fails, rerunning the same request ID retries Jira using the preserved Figma Design URL instead of regenerating the design.

## Tests

Mocked deterministic validation:

```powershell
npm run validate:workflows
npm run test:figma
```

The mocked tests cover:

- request-driven Jira key parsing
- optional webhook disabling
- webhook passcode validation when enabled
- event filtering
- Slack parent/thread timestamp propagation
- Slack reply formatting
- Claude JSON parsing
- Figma destination mapping
- idempotency
- duplicate completion callback guarding
- Jira retry behavior
- error handling

Real MCP validation:

```powershell
npm run figma:request:test -- --issue SYSCO-20
```

Mocked tests do not prove real Figma MCP end-to-end success.

## Failure Stages

The workflow logs these stages without secrets:

```text
REQUEST_ACCEPTED
FIGMA_WEBHOOK_RECEIVED
FIGMA_WEBHOOK_REJECTED
VERSION_ACCEPTED
FIGMA_VERSION_DUPLICATE
JIRA_VALIDATED
SLACK_PARENT_CREATED
FIGMA_SOURCE_RESOLVED
CLAUDE_STARTED
figma_mcp_auth
figma_make_context
figma_render
generate_figma_design
figma_capture
figma_design_created
CALLBACK_RECEIVED
JIRA_COMPLETED
SLACK_COMPLETED
```

Troubleshooting:

- Missing Jira key: include `SYSCO-<number>` in the request.
- Invalid Jira issue: confirm the issue exists in project `SYSCO`.
- Slack parent failure: confirm `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, and channel membership.
- `figma_mcp_auth`: run `claude mcp list`; install/authenticate the Figma MCP server.
- `figma_make_context`: confirm the authenticated Figma/Claude user can access the Make project.
- `generate_figma_design` / `figma_capture`: confirm current Figma MCP exposes a write path for editable Figma Design artifacts.
- `JIRA_COMPLETED`: Jira failed after Figma succeeded; rerun the same request ID to retry Jira without regenerating design.
- Missing final Slack reply: Slack failures are logged but do not roll back successful Jira/Figma work.

## References

- Figma MCP server guide: `https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server`
- Claude Code and Figma MCP setup: `https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server`
- Figma MCP Code to Canvas / `generate_figma_design`: `https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/`
- Figma MCP write to canvas / `use_figma`: `https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/`
- Figma webhooks, optional upgraded path: `https://developers.figma.com/docs/rest-api/webhooks/`
