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
  |  - dispatch GitHub Actions
  |
  v
Jira Cloud SYSCO project <-----------------------------+
  |                                                    |
  v                                                    |
GitHub Actions workflow_dispatch                      |
  |                                                    |
  v                                                    |
Claude Code GitHub Action                             |
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
```

## Repository

- GitHub repository: `Patrick-Sherlund/prototype`
- Main branch: `main`
- Automated implementation branches: `prototype/<SYSCO-issue-key>`
- Prototype preview path: `https://patrick-sherlund.github.io/prototype/previews/<SYSCO-issue-key>/<github-run-id>/`
- Latest issue preview alias: `https://patrick-sherlund.github.io/prototype/previews/<SYSCO-issue-key>/latest/`

## Local Prototype

```powershell
npm ci
npm run dev
npm run build
npm run preview
```

The app is intentionally small and dependency-free because the local Windows sandbox blocked Vite/esbuild native process execution. The npm interface remains the same for GitHub Actions and Claude Code.

## Required Secrets

Put local n8n secrets in `.env`, copied from `.env.example`. Do not commit `.env`.

| Name | Destination | Sensitive | Purpose |
| --- | --- | --- | --- |
| `N8N_ENCRYPTION_KEY` | `.env` | Yes | Stable n8n credential encryption key |
| `N8N_WEBHOOK_URL` | `.env` | No | Public tunnel base URL for n8n production webhooks |
| `SLACK_SIGNING_SECRET` | `.env` | Yes | Verify Slack Events API signatures |
| `SLACK_BOT_TOKEN` | `.env` | Yes | Reply to Slack threads |
| `JIRA_AUTH_HEADER` | `.env` | Yes | Jira Basic auth header for REST API |
| `GITHUB_DISPATCH_TOKEN` | `.env` | Yes | Fine-grained GitHub token used by n8n to dispatch Actions |
| `N8N_CALLBACK_SECRET` | `.env` and GitHub Actions secret | Yes | Shared secret for GitHub -> n8n callback |
| `CLAUDE_CODE_OAUTH_TOKEN` | GitHub Actions secret | Yes | Claude Code CI authentication using Claude subscription OAuth |

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

Open `http://localhost:5678`, review both workflows, and activate:

- `POC A - Slack Request to Claude Prototype`
- `POC B - GitHub Completion to Jira and Slack`

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
cloudflared tunnel --url http://localhost:5678
```

Use the printed `https://...trycloudflare.com` value as:

```text
N8N_WEBHOOK_URL=https://...trycloudflare.com
```

Slack request URL:

```text
https://...trycloudflare.com/webhook/poc/slack/request
```

GitHub callback URL sent by n8n:

```text
https://...trycloudflare.com/webhook/poc/github/completion
```

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

The workflow ignores bot messages, Slack retries, messages outside `C0BP62TK3PD`, and messages without a `SYSCO-<number>` key.

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

Use the returned Jira issue key in Slack, for example:

```text
SYSCO-1
Change the "Reorder" button on the order history screen to "Buy Again" and make it more visually prominent.
```

## GitHub Setup

Create a fine-grained personal access token for n8n dispatch:

1. Go to GitHub `Settings` -> `Developer settings` -> `Personal access tokens` -> `Fine-grained tokens`.
2. Click `Generate new token`.
3. Repository access: only `Patrick-Sherlund/prototype`.
4. Repository permissions:
   - `Actions`: Read and write
   - `Contents`: Read-only
5. Store it in `.env` as `GITHUB_DISPATCH_TOKEN`.

GitHub Actions secrets:

1. Go to repository `Settings` -> `Secrets and variables` -> `Actions`.
2. Add `CLAUDE_CODE_OAUTH_TOKEN`.
3. Add `N8N_CALLBACK_SECRET` with the same value used in `.env`.

GitHub Pages:

1. Go to repository `Settings` -> `Pages`.
2. Set source to `Deploy from a branch`.
3. Select branch `gh-pages`.
4. Select folder `/ (root)`.
5. Save.

The workflows publish the main app and preview builds to that branch.

## Claude Setup

Create a Claude Code OAuth token locally:

```powershell
claude setup-token
```

Store the printed token as GitHub Actions secret `CLAUDE_CODE_OAUTH_TOKEN`.

This uses Claude Code OAuth for CI. Do not substitute `ANTHROPIC_API_KEY` unless explicitly choosing API billing.

## Demo Procedure

1. Start the tunnel.
2. Update `.env` `N8N_WEBHOOK_URL` if the tunnel URL changed.
3. Start n8n with `docker compose up -d`.
4. Import and activate workflows.
5. Confirm GitHub Actions secrets and Pages settings.
6. Confirm the Slack app request URL is verified.
7. Create a Jira demo issue with `npm run create:jira-demo`.
8. Post in Slack channel `C0BP62TK3PD`:

```text
SYSCO-1
Change the "Reorder" button on the order history screen to "Buy Again" and make it more visually prominent.
```

Expected result:

- Jira receives a Slack request comment and moves active if a valid transition exists.
- GitHub Actions starts `Prototype Change via Claude`.
- Claude updates the app on `prototype/SYSCO-1`.
- A PR opens against `main`.
- A preview publishes under `/previews/SYSCO-1/<run-id>/`.
- n8n receives the callback.
- Jira receives completion details.
- Slack receives a thread reply with preview, PR, Jira URL, and build status.

## Troubleshooting

- `SLACK_RECEIVED failed`: check Slack signing secret, webhook URL, tunnel, and system clock.
- Slack URL verification fails: confirm workflow is active and `N8N_WEBHOOK_URL` points to the tunnel origin.
- `JIRA_VALIDATED failed`: check Jira auth header, issue key, and project permissions.
- `GITHUB_DISPATCHED failed`: check fine-grained token repository and `Actions: Read and write`.
- `CLAUDE_STARTED failed`: check `CLAUDE_CODE_OAUTH_TOKEN` GitHub Actions secret.
- `PREVIEW_DEPLOYED` URL 404: confirm Pages is configured to branch `gh-pages` root and wait for Pages propagation.
- `N8N_CALLBACK_SENT failed`: confirm tunnel is still running and `N8N_CALLBACK_SECRET` matches in `.env` and GitHub Actions secrets.

## Observability

Major stages are logged without secrets:

```text
SLACK_RECEIVED
JIRA_VALIDATED
JIRA_UPDATED
GITHUB_DISPATCHED
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

Use the correlation ID shown in Slack, Jira comments, n8n execution logs, and GitHub Action logs to follow one request end to end.
