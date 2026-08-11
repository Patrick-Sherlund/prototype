# Slack to Claude Prototype POC

## Architecture

```text
Slack channel C0BP62TK3PD
  |
  | Slack Events API
  v
Local n8n Community Edition
  |  A. Slack Request Workflow
  |  - verify Slack signature
  |  - parse SYSCO issue key and request
  |  - validate/update Jira
  |  - start local Claude worker
  |
  v
Jira Cloud SYSCO project <-----------------------------+
  |                                                    |
  v                                                    |
Local Claude Code worker on Windows host              |
  |                                                    |
  v                                                    |
Claude Code using local claude.ai Pro session          |
  |                                                    |
  | prototype/SYSCO-123 branch, commit, PR             |
  v                                                    |
GitHub Pages gh-pages branch preview                  |
  |                                                    |
  | B. signed callback                                 |
  v                                                    |
Local n8n Completion Workflow ------------------------+
  |
  | Jira completion comment + Slack thread reply
  v
Slack original thread

Second independent Jira-management path:

Slack STANDUP message
  |
  v
Local n8n Standup Workflow
  |  - route away from prototype automation
  |  - analyze transcript with local Claude
  |  - validate structured action plan
  |  - retrieve Jira issues/transitions
  |  - apply Jira comments/status changes or dry-run
  v
Slack original standup thread
```

## Repository

- GitHub repository: `Patrick-Sherlund/prototype`
- Main branch: `main`
- Automated implementation branches: `prototype/<SYSCO-issue-key>`
- Prototype preview path: `https://patrick-sherlund.github.io/prototype/previews/<SYSCO-issue-key>/<correlation-id>/`
- Latest issue preview alias: `https://patrick-sherlund.github.io/prototype/previews/<SYSCO-issue-key>/latest/`

## Local Prototype

```powershell
npm ci
npm run dev
npm run build
npm run preview
```

The app is intentionally small and dependency-free because the local Windows sandbox blocked Vite/esbuild native process execution. The npm interface remains the same for local Claude Code automation.

## Required Secrets

Put local n8n secrets in `.env`, copied from `.env.example`. Do not commit `.env`.

| Name | Destination | Sensitive | Purpose |
| --- | --- | --- | --- |
| `N8N_ENCRYPTION_KEY` | `.env` | Yes | Stable n8n credential encryption key |
| `N8N_WEBHOOK_URL` | `.env` | No | Public tunnel base URL for n8n production webhooks |
| `SLACK_SIGNING_SECRET` | `.env` | Yes | Verify Slack Events API signatures |
| `SLACK_BOT_TOKEN` | `.env` | Yes | Reply to Slack threads |
| `JIRA_AUTH_HEADER` | `.env` | Yes | Jira Basic auth header for REST API |
| `GITHUB_DISPATCH_TOKEN` | `.env` | Yes | Fine-grained GitHub token used by the local worker to create/update PRs |
| `N8N_CALLBACK_SECRET` | `.env` | Yes | Shared secret for worker -> n8n callback |
| `LOCAL_WORKER_SECRET` | `.env` | Yes | Shared secret for n8n -> local worker requests |
| `LOCAL_WORKER_URL` | `.env` | No | URL n8n uses to reach the Windows host worker |
| `STANDUP_INTERNAL_SECRET` | `.env` | Yes | Optional internal n8n routing secret; falls back to `LOCAL_WORKER_SECRET` |

Generate `N8N_CALLBACK_SECRET` locally:

```powershell
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

Generate a Jira auth header after creating a Jira API token:

```powershell
$pair = "patricksherlund@gmail.com:<jira-api-token>"
"Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
```

## n8n

Start:

```powershell
Copy-Item .env.example .env
# Fill .env with real local values.
docker compose up -d
docker compose ps
```

Health check:

```powershell
Invoke-WebRequest http://localhost:5678/healthz
```

Import workflows:

```powershell
npm run build:workflows
.\automation\scripts\import-n8n-workflows.ps1
```

Open `http://localhost:5678`, review the workflows, and activate:

- `POC A - Slack Request to Claude Prototype`
- `POC B - GitHub Completion to Jira and Slack`
- `POC C - Standup Transcript to Jira Summary`

Stop:

```powershell
docker compose down
```

Reset n8n data:

```powershell
docker compose down -v
```

## Tunnel

Slack must reach local n8n. Use a free tunnel and put its HTTPS origin in `.env` as `N8N_WEBHOOK_URL`.

Preferred:

```powershell
docker compose --profile tunnel up -d cloudflared
docker compose logs -f cloudflared
```

Use the printed `https://...trycloudflare.com` value as:

```text
N8N_WEBHOOK_URL=https://...trycloudflare.com
```

Then recreate n8n so workflow callbacks use the current public URL:

```powershell
docker compose up -d --force-recreate n8n
```

Stop the tunnel:

```powershell
docker compose stop cloudflared
```

Slack request URL:

```text
https://...trycloudflare.com/webhook/poc/slack/request
```

GitHub callback URL sent by n8n:

```text
https://...trycloudflare.com/webhook/poc/github/completion
```

## Local Claude Worker

The GitHub Actions OAuth-token path is not used because `claude setup-token` produced tokens that were rejected with `401 OAuth access token is invalid`. The POC therefore runs Claude Code locally on this Windows machine, where `claude auth status` confirms the interactive Claude Pro session works.

Start the worker from the repository root:

```powershell
npm run worker:start
```

Health check:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/healthz
```

Stop the worker:

```powershell
npm run worker:stop
```

n8n reaches the worker from Docker through:

```text
LOCAL_WORKER_URL=http://host.docker.internal:8787
```

The worker strips `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` from the Claude child process so local Claude uses the existing authenticated `claude.ai` Pro session.

The same worker also exposes a standup analysis endpoint. That endpoint only asks Claude to return structured JSON for a transcript; it does not run git, create branches, modify prototype files, open PRs, publish previews, or run builds.

## Slack Setup

Create a Slack app in the `Sysco-Demo` workspace.

1. Go to `https://api.slack.com/apps`.
2. Click `Create New App`.
3. Choose `From scratch`.
4. Name it, for example `Prototype Automation`.
5. Select workspace `Sysco-Demo`.
6. Go to `OAuth & Permissions`.
7. Add bot token scopes:
   - `chat:write`
   - `channels:history`
8. Install the app to the workspace.
9. Copy the bot token into `.env` as `SLACK_BOT_TOKEN`.
10. Go to `Basic Information`.
11. Copy `Signing Secret` into `.env` as `SLACK_SIGNING_SECRET`.
12. Invite the app to channel `C0BP62TK3PD`.
13. Go to `Event Subscriptions`.
14. Enable events.
15. Enter the n8n request URL: `<N8N_WEBHOOK_URL>/webhook/poc/slack/request`.
16. Subscribe to bot event: `message.channels`.
17. Save changes and reinstall the app if Slack prompts for reinstall.

The workflow ignores bot messages, Slack retries, messages outside `C0BP62TK3PD`, and empty messages. A human message may include a `SYSCO-<number>` key or omit the key entirely. If no key is supplied, n8n creates a new Jira issue and uses Jira's generated key as the canonical work item.

## Jira Setup

Jira site:

```text
https://patricksherlund.atlassian.net
```

Project key:

```text
SYSCO
```

Create an API token:

1. Go to `https://id.atlassian.com/manage-profile/security/api-tokens`.
2. Click `Create API token`.
3. Label it `n8n SYSCO prototype POC`.
4. Copy the token once.
5. Create `JIRA_AUTH_HEADER` with the PowerShell command above.
6. Store only the final auth header in `.env`.

Create a demo issue after `.env` is configured:

```powershell
$env:JIRA_BASE_URL="https://patricksherlund.atlassian.net"
$env:JIRA_PROJECT_KEY="SYSCO"
$env:JIRA_AUTH_HEADER="Basic <base64-email-colon-api-token>"
npm run create:jira-demo
```

Use an existing Jira issue key in Slack, for example:

```text
SYSCO-1
Change the "Reorder" button on the order history screen to "Buy Again" and make it more visually prominent.
```

If the Slack message omits a Jira key, n8n creates a new issue in the configured `SYSCO` project. If the Slack message references a `SYSCO-<number>` key that Jira returns as missing, n8n also creates a new issue. The workflow selects an available non-subtask issue type from the project, preferring `Story`, then `Task`, then `Feature`. Jira assigns the real key; the workflow preserves the Slack-requested key when one was provided, then uses the Jira-generated key as the canonical identifier for the correlation ID, worker branch, commit, PR, preview path, Jira completion comment, and Slack completion reply.

## Standup Jira Automation

The standup workflow is separate from prototype implementation. It performs Jira management only:

```text
Slack STANDUP transcript -> n8n -> local Claude transcript analysis -> Jira comments/transitions -> Slack summary
```

It never invokes the prototype coding path and never creates branches, PRs, builds, or previews.

Dry-run format:

```text
STANDUP DRY RUN

Patrick:
SYSCO-6 is ready for review.

Shelby:
SYSCO-8 is completely done.

Patrick:
SYSCO-10 is blocked waiting on backend API access.
```

Live format:

```text
STANDUP

Patrick:
SYSCO-6 is ready for review.

Shelby:
SYSCO-8 is completely done.
```

Supported semantic states:

- `in_progress`: started, working on, in progress.
- `review`: ready for review, needs review, finished implementation.
- `done`: done, completed, finished and accepted, close this.
- `blocked`: blocked, waiting on, cannot continue until.
- `no_change`: continuing work, needs another day, still in progress.
- `clarification`: ambiguous or low-confidence updates.

Safety rules:

- Jira transition IDs are never hard-coded.
- Each issue is retrieved independently.
- Available transitions are inspected per issue before mapping semantic intent to Jira workflow states.
- High-confidence actions may transition Jira.
- Medium-confidence actions may add a comment but avoid status transitions.
- Low-confidence actions do not mutate Jira and are reported as needing clarification.
- Unknown issues mentioned in a standup are not created; they are reported as not found.
- One issue failure does not prevent other issue updates.
- The full transcript is not pasted into every ticket; comments use ticket-specific evidence and a correlation ID.

Dry-run mode retrieves Jira issues and transitions, builds a proposed action plan, and replies in Slack without mutating Jira.

Limitations:

- Assignee, priority, and description updates are intentionally not implemented yet; the workflow only comments and transitions statuses.
- Claude output is accepted only as validated structured JSON.

## GitHub Setup

Create a fine-grained personal access token for the local worker:

1. Go to GitHub `Settings` -> `Developer settings` -> `Personal access tokens` -> `Fine-grained tokens`.
2. Click `Generate new token`.
3. Repository access: only `Patrick-Sherlund/prototype`.
4. Repository permissions:
   - `Contents`: Read and write
   - `Pull requests`: Read and write
5. Store it in `.env` as `GITHUB_DISPATCH_TOKEN`.

GitHub Pages:

1. Go to repository `Settings` -> `Pages`.
2. Set source to `Deploy from a branch`.
3. Select branch `gh-pages`.
4. Select folder `/ (root)`.
5. Save.

The worker publishes preview builds to that branch.

## Claude Setup

Confirm the local Claude Pro session works:

```powershell
claude auth status
claude -p "Reply with OK only." --max-turns 1
```

Do not use `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` for this POC path.

## Demo Procedure

1. Start the tunnel.
2. Update `.env` `N8N_WEBHOOK_URL` if the tunnel URL changed.
3. Start n8n with `docker compose up -d`.
4. Import and activate workflows.
5. Start the local worker with `npm run worker:start`.
6. Confirm the Slack app request URL is verified.
7. Use existing Jira issue `SYSCO-6`, create a Jira demo issue with `npm run create:jira-demo`, post a missing key, or post a request without any key to validate Jira issue creation.
8. Post in Slack channel `C0BP62TK3PD`:

```text
SYSCO-1
Change the "Reorder" button on the order history screen to "Buy Again" and make it more visually prominent.
```

Expected result:

- Jira receives a Slack request comment and moves active if a valid transition exists.
- If no Jira key was supplied, Jira receives a newly created issue and the Slack reply states the Jira-generated key.
- If the requested Jira key was missing, Jira receives a newly created issue and the Slack reply states the requested key and the Jira-generated key.
- n8n starts the local Claude worker.
- Claude updates the app on `prototype/<real-Jira-issue-key>`.
- A PR opens against `main`.
- A preview publishes under `/previews/<real-Jira-issue-key>/<run-id>/`.
- n8n receives the callback.
- Jira receives completion details.
- Slack receives a thread reply with preview, PR, Jira URL, and build status.

## Troubleshooting

- `SLACK_RECEIVED failed`: check Slack signing secret, webhook URL, tunnel, and system clock.
- Slack URL verification fails: confirm workflow is active and `N8N_WEBHOOK_URL` points to the tunnel origin.
- `JIRA_LOOKUP failed`: check Jira auth header, project key, and permissions.
- `JIRA_CREATED failed`: Jira returned 404 for the requested issue but n8n could not create a replacement issue. Check project issue types and create permissions.
- `JIRA_VALIDATED failed`: Jira found or created the issue, but a follow-up comment or transition failed.
- `LOCAL_WORKER_STARTED failed`: check `npm run worker`, `LOCAL_WORKER_URL`, and `LOCAL_WORKER_SECRET`.
- `CLAUDE_STARTED failed`: check `claude auth status` and confirm no metered API env vars are being used.
- `PREVIEW_DEPLOYED` URL 404: confirm Pages is configured to branch `gh-pages` root and wait for Pages propagation.
- `N8N_CALLBACK_SENT failed`: confirm tunnel is still running and `N8N_CALLBACK_SECRET` matches in `.env`.
- `TRANSCRIPT_PARSED failed`: check local worker health and local `claude auth status`.
- `ACTION_PLAN_CREATED failed`: Claude did not return valid structured JSON.
- `JIRA_UPDATES_STARTED failed`: check Jira auth and project permissions.
- Standup Slack reply missing: check `SLACK_BOT_TOKEN`, channel membership, and the original thread timestamp.

## Observability

Major stages are logged without secrets:

```text
SLACK_RECEIVED
STANDUP_RECEIVED
TRANSCRIPT_PARSED
JIRA_ISSUES_RESOLVED
ACTION_PLAN_CREATED
JIRA_UPDATES_STARTED
JIRA_UPDATES_COMPLETED
SLACK_SUMMARY_SENT
JIRA_LOOKUP
JIRA_CREATED
JIRA_VALIDATED
JIRA_UPDATED
LOCAL_WORKER_STARTED
CLAUDE_STARTED
CODE_CHANGED
BUILD_PASSED
PR_CREATED
PREVIEW_DEPLOYED
N8N_CALLBACK_SENT
CALLBACK_RECEIVED
JIRA_COMPLETED
SLACK_COMPLETED
```

Use the correlation ID shown in Slack, Jira comments, n8n execution logs, local worker logs, and PR metadata to follow one request end to end.
