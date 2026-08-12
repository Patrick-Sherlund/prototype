# Figma Make to Editable Figma Design Handoff POC

## Architecture

```text
Designer
  |
  | edits Figma Make prototype
  | creates named version, for example "SYSCO-1 | Ready for Design"
  v
Figma FILE_VERSION_UPDATE webhook
  |
  v
Local n8n Community Edition
  |  - validate webhook passcode
  |  - accept only FILE_VERSION_UPDATE
  |  - parse SYSCO issue key from version label/description
  |  - enforce idempotency with file_key + version_id
  |  - verify existing Jira issue
  |  - create one Slack parent status message
  |  - post status replies to the same thread
  |  - invoke local Claude Code worker
  v
Local Claude Code worker on Windows host
  |
  | Claude Code + Figma MCP
  |  - access Figma Make context/resources
  |  - render/access current Make prototype
  |  - run generate_figma_design / Code to Canvas
  |  - create or update editable Figma Design
  |  - return structured JSON
  v
n8n completion callback
  |  - persist Jira -> Figma Design mapping
  |  - update Jira
  |  - retry Jira without regenerating design if Jira fails
  |  - post final result in original Slack thread
  v
Jira + Slack
```

## Source of Truth

Figma Make is authoritative. The generated Figma Design file is a downstream handoff artifact. Jira and Slack provide traceability and visibility only.

Claude Code is not responsible for Jira, Slack, GitHub, commits, PRs, or source-code changes during runtime handoffs. It is used only because it is the supported execution agent for Figma MCP and `generate_figma_design`.

## Repository

- GitHub repository: `Patrick-Sherlund/prototype`
- Primary branch: `main`
- Feature branch for this replacement: `feature/figma-make-design-handoff`
- n8n workflow export: `automation/n8n/figma-make-design-handoff.json`
- Local worker: `automation/local-worker/worker.mjs`
- Claude/Figma prompt + JSON helpers: `automation/claude/figma-handoff.mjs`

The old Slack-triggered code-generation flow, GitHub dispatch flow, PR creation, and preview deployment are not part of this workflow.

## Required Configuration

Copy `.env.example` to `.env` and fill in local values. Do not commit `.env`.

| Name | Sensitive | Purpose |
| --- | --- | --- |
| `N8N_WEBHOOK_URL` | No | Public HTTPS base URL for Figma webhook and worker callback |
| `N8N_ENCRYPTION_KEY` | Yes | Stable n8n credential encryption key |
| `FIGMA_ACCESS_TOKEN` | Yes | Used by `npm run figma:webhook:register` |
| `FIGMA_ACCESS_TOKEN_TYPE` | No | `oauth` for Authorization bearer token, `personal` for X-Figma-Token |
| `FIGMA_WEBHOOK_PASSCODE` | Yes | Shared passcode validated from Figma webhook payload |
| `FIGMA_MAKE_FILE_KEY` | No | Figma Make file key used by webhook registration helper |
| `FIGMA_MAKE_URL` | No | Optional full Make URL passed to Claude Code |
| `FIGMA_MAKE_PUBLISHED_URL` | No | Optional browser-renderable Make URL |
| `FIGMA_DESTINATION_FILE_KEY` | No | Optional default Design destination |
| `FIGMA_DESTINATION_FILE_URL` | No | Optional default Design destination URL |
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

Generate local shared secrets:

```powershell
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

Generate a Jira auth header after creating a Jira API token:

```powershell
$pair = "patricksherlund@gmail.com:<jira-api-token>"
"Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
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
```

Open `http://localhost:5678`, review, and activate:

```text
Figma Make Version to Design Handoff
```

Stop:

```powershell
docker compose down
```

Reset n8n data:

```powershell
docker compose down -v
```

Resetting n8n data removes workflow static data, including idempotency and Jira -> Figma Design mappings.

## Tunnel

Figma must reach local n8n over HTTPS. Start the included Cloudflare quick tunnel:

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

Figma webhook URL:

```text
<N8N_WEBHOOK_URL>/webhook/poc/figma/version-update
```

Worker callback URL:

```text
<N8N_WEBHOOK_URL>/webhook/poc/figma/handoff/completion
```

## Figma Webhook

Figma webhook registration uses:

```json
{
  "event_type": "FILE_VERSION_UPDATE",
  "context": "file",
  "context_id": "<Figma Make file key>",
  "endpoint": "<N8N_WEBHOOK_URL>/webhook/poc/figma/version-update",
  "passcode": "<FIGMA_WEBHOOK_PASSCODE>"
}
```

Register:

```powershell
npm run figma:webhook:register
```

Override values when needed:

```powershell
npm run figma:webhook:register -- --file-key <file-key> --endpoint https://example.com/webhook/poc/figma/version-update
```

Figma sends a `PING` event after webhook creation. The workflow validates the passcode and returns `200 OK`.

Named versions are the deliberate handoff action. The automation does not assume every Figma Make AI edit produces `FILE_VERSION_UPDATE`.

## Figma Version Format

Supported label or description:

```text
SYSCO-1 | Ready for Design
```

The workflow searches both version label and description with the configured Jira project key. For this repo that is equivalent to:

```regex
\bSYSCO-\d+\b
```

If no Jira key is found, n8n does not invoke Claude Code and does not update Jira. If Slack is configured, it posts a safe failure notification.

## Slack Setup

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

Slack failure alone does not invalidate a successful Figma/Jira handoff. n8n logs Slack errors and continues when safe.

## Jira Setup

Jira site:

```text
https://patricksherlund.atlassian.net
```

Project key:

```text
SYSCO
```

The workflow only verifies and updates existing issues. It does not create replacement issues.

After Figma generation succeeds, n8n adds a Jira comment containing:

```text
Design handoff generated automatically from Figma Make.
Source: <version label>
Editable Figma Design: <url>
Correlation ID: <id>
```

It also inspects available transitions and applies a review-like transition when one is available. Transition IDs are discovered from Jira at runtime, not hard-coded.

## Claude Code and Figma MCP

Confirm the local Claude Pro session:

```powershell
claude auth status
```

Configure the Figma MCP server for Claude Code. Preferred Figma plugin setup:

```powershell
claude plugin install figma@claude-plugins-official
```

Manual remote MCP setup:

```powershell
claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp
```

Then start Claude Code interactively once, open `/mcp`, authenticate the Figma server, and confirm:

```powershell
claude mcp list
```

The local worker currently fails explicitly at `figma_mcp_auth` if `claude mcp list` does not show Figma.

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

The worker strips `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` from the Claude child process so the local `claude.ai` Pro session is used instead of metered API credentials.

The worker invokes Claude Code with a constrained prompt and allowed tools for Figma MCP. It does not run git, create branches, commit, push, open PRs, publish previews, update Jira, or send Slack messages.

## Persistence

n8n workflow static data stores:

```json
{
  "figmaHandoffs": {
    "<file_key>:<version_id>": {
      "status": "processing | figma_succeeded | completed | jira_failed | failed",
      "jiraIssueKey": "SYSCO-1",
      "design": {
        "url": "https://www.figma.com/design/...",
        "fileKey": "...",
        "nodeId": "..."
      },
      "slack": {
        "channel": "C0BP62TK3PD",
        "threadTs": "..."
      }
    }
  },
  "figmaDesignMappings": {
    "SYSCO-1": {
      "figmaDesignFileKey": "...",
      "figmaDesignUrl": "https://www.figma.com/design/..."
    }
  }
}
```

Idempotency key:

```text
file_key + version_id
```

Completed duplicate events are ignored. In-progress duplicates are ignored. If Figma succeeded but Jira failed, a duplicate event retries Jira using the preserved Figma Design URL instead of invoking Claude again.

## Status Messages

Expected Slack thread:

```text
Parent:
Figma design handoff started for SYSCO-1

Replies:
Jira issue SYSCO-1 verified.
Figma Make source resolved.
Accessing the latest Figma Make prototype.
Converting the current prototype into editable Figma Design layers.
Editable Figma Design created successfully.
Updating SYSCO-1 with the new Figma Design.
Design handoff complete for SYSCO-1
```

Failure replies are posted in the same thread when a thread exists. Errors are redacted and do not include tokens, passcodes, or authorization headers.

## Tests

Mocked deterministic validation:

```powershell
npm run validate:workflows
npm run test:figma
```

The mocked tests cover:

- Jira key parsing from Figma version metadata
- webhook passcode validation
- event filtering
- Slack parent/thread timestamp propagation
- Slack reply formatting
- Claude JSON parsing
- Figma destination mapping
- idempotency
- Jira retry behavior
- error handling

Synthetic webhook test against n8n:

```powershell
npm run figma:webhook:test -- --issue SYSCO-1
```

Direct local worker boundary test:

```powershell
npm run figma:worker:invoke -- --issue SYSCO-1 --file-key <Figma Make file key>
```

Mocked tests do not prove real Figma MCP end-to-end success.

## Real Demo Procedure

Prerequisites:

- Existing Jira issue `SYSCO-1`
- Slack app in channel `C0BP62TK3PD`
- Figma Make project shared with the authenticated Figma/Claude user
- Claude Code authenticated
- Figma MCP configured and connected in `claude mcp list`
- n8n active with current tunnel URL
- local worker running

Procedure:

1. Start tunnel and n8n.
2. Import and activate the n8n workflow.
3. Start the local worker.
4. Register the Figma webhook if not already registered.
5. In Figma Make, update the prototype.
6. Create a named version:

```text
SYSCO-1 | Ready for Design
```

Expected:

1. Figma sends `FILE_VERSION_UPDATE`.
2. n8n validates passcode and event type.
3. n8n verifies Jira issue `SYSCO-1`.
4. n8n creates one Slack parent message.
5. n8n posts progress replies in that thread.
6. n8n invokes the local Claude worker.
7. Claude Code connects to Figma MCP.
8. Claude Code accesses Figma Make context/resources.
9. Claude Code renders/accesses the current Make prototype.
10. `generate_figma_design` creates editable Figma Design layers.
11. Worker returns Figma Design JSON to n8n.
12. n8n persists the Jira -> Figma Design mapping.
13. n8n updates Jira.
14. n8n posts final Slack completion in the same thread.

Acceptance after a real run:

1. Open Slack channel `C0BP62TK3PD`.
2. Confirm exactly one parent workflow message exists for this handoff.
3. Confirm progress events are replies in the same thread.
4. Open Jira issue `SYSCO-1`.
5. Confirm the issue was updated with the Figma Design URL and source version.
6. Open the Figma Design link.
7. Confirm editable Figma layers exist.
8. Confirm the design matches the ready Figma Make state.
9. Change the prototype again in Figma Make.
10. Create a second named version for `SYSCO-1`.
11. Confirm a new Slack thread is created for the new version.
12. Confirm the Jira-specific Design file is reused where supported.
13. Confirm the new Design capture reflects the updated Make state.

## Failure Stages

The workflow logs these stages without secrets:

```text
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

- Invalid Figma secret: confirm `FIGMA_WEBHOOK_PASSCODE` matches the webhook registration.
- Wrong event type: only `FILE_VERSION_UPDATE` is accepted for handoff.
- Missing Jira key: put `SYSCO-<number>` in the version label or description.
- Invalid Jira issue: confirm the issue exists in project `SYSCO`.
- Slack parent failure: confirm `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, and channel membership.
- `figma_mcp_auth`: run `claude mcp list`; install/authenticate the Figma MCP server.
- `figma_make_context`: confirm Claude/Figma user can access the Make project.
- `figma_render`: provide `FIGMA_MAKE_URL` or `FIGMA_MAKE_PUBLISHED_URL` if the worker cannot render from file key alone.
- `generate_figma_design`: confirm remote Figma MCP supports Code to Canvas for Claude Code and the destination file is editable.
- `JIRA_COMPLETED`: Jira failed after Figma succeeded; rerun the same version event to retry Jira without regenerating design.
- Missing final Slack reply: Slack failures are logged but do not roll back successful Jira/Figma work.

## References

- Figma webhooks overview and retry behavior: `https://developers.figma.com/docs/rest-api/webhooks/`
- Figma webhook endpoints: `https://developers.figma.com/docs/rest-api/webhooks-endpoints/`
- Figma `FILE_VERSION_UPDATE` payload: `https://developers.figma.com/docs/rest-api/webhooks-events/`
- Figma MCP server guide: `https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server`
- Claude Code Figma MCP setup: `https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server`
- Figma MCP Code to Canvas / `generate_figma_design`: `https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/`
