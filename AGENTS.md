# AGENTS.md

## Mission

Build a working rapid prototype of this automation:

Slack → n8n → Jira → GitHub Actions → Claude Code → prototype code change → preview deployment → Jira → Slack

The goal is a real end-to-end demo, not production-grade infrastructure.

Optimize for:

* Speed
* Simplicity
* Free-tier services
* Easy local setup
* Real working integrations
* Clear debugging

Do not over-engineer.

---

## Definition of Done

The project is complete only when a real Slack message:

1. Reaches n8n.
2. References a real Jira issue.
3. Updates that Jira issue.
4. Triggers GitHub Actions.
5. Invokes Claude Code.
6. Causes Claude to modify the prototype.
7. Builds successfully.
8. Creates a branch and PR.
9. Produces a working preview URL.
10. Sends completion back to n8n.
11. Updates Jira with the result.
12. Replies to the original Slack conversation with the preview and PR links.

Do not call the project complete based only on configuration files or mocked tests.

---

## Architecture

Use:

* Slack Free — request/notification interface
* n8n Community Edition — orchestration
* Jira Cloud Free — work tracking/source of truth
* GitHub Free — source control
* GitHub Actions — automation runner
* Claude Code — implementation agent
* Free preview hosting — changed prototype preview

Prefer existing accounts and infrastructure.

Do not introduce paid services without explicit approval.

---

## Ask for Missing Information

Never invent:

* credentials
* account IDs
* URLs
* Jira project keys
* Slack channel IDs
* GitHub repository information
* API tokens
* Claude authentication
* webhook URLs

If something is required from the user, ask for it.

When browser configuration is required, provide exact instructions.

Ask for missing requirements in one concise checklist whenever possible.

If information can be discovered from the repository, CLI, configuration, or APIs, discover it instead of asking.

---

## Secrets

Never commit secrets.

Use:

* `.env`
* n8n Credentials
* GitHub Actions Secrets

Commit only `.env.example`.

Ensure `.gitignore` protects secrets.

Use least-privilege credentials.

---

## n8n

Run n8n locally with Docker Compose.

Maintain reproducible workflow exports in the repository.

Prefer:

`automation/n8n/slack-request.json`

`automation/n8n/github-completion.json`

Implement two main workflows.

### Request Workflow

Slack message → n8n

Must:

* receive Slack event
* ignore bot/self messages
* restrict to configured channel
* extract Jira issue key
* extract requested change
* preserve Slack channel/thread metadata
* generate correlation ID
* retrieve Jira issue
* comment/update Jira
* transition to active status when available
* trigger GitHub Actions
* report failures

### Completion Workflow

GitHub → n8n

Must:

* receive authenticated callback
* correlate with original request
* update Jira
* transition to review state when available
* reply to original Slack thread
* include preview URL and PR URL
* report failures clearly

---

## Slack

Use one custom Slack app.

Use minimum required scopes.

Expected request format:

```text
INTRAC-42
Make Receiving Officer required and add a confirmation before transfer.
```

The issue key is required for the prototype.

Reply to the originating Slack message/thread.

Prevent obvious duplicate processing.

---

## Jira

Jira is the system of record.

Use Jira APIs to:

* retrieve issue
* add request comment
* inspect available transitions
* transition issue
* add implementation result
* store PR link
* store preview link

Never hard-code transition IDs without discovering them from Jira.

---

## GitHub

Use GitHub Actions.

n8n should trigger the workflow using an official GitHub API mechanism.

Claude changes must occur on an issue-specific branch such as:

`prototype/INTRAC-42`

Never push generated prototype changes directly to `main`.

Create or update a Pull Request.

Capture:

* branch
* commit SHA
* PR URL
* GitHub Action result
* preview URL

---

## Claude Code

Use the official Claude Code/GitHub integration where practical.

Do not assume the user's Claude subscription provides API credits.

Verify authentication before relying on it.

If paid API access would be required, stop and tell the user before enabling it.

Claude receives:

* Jira issue key
* Jira summary/context
* Slack request
* repository instructions
* existing prototype context

Claude should:

1. Inspect the existing implementation.
2. Make the smallest coherent requested change.
3. Preserve existing design and behavior.
4. Avoid unrelated refactors.
5. Run lint/tests if available.
6. Run production build.
7. Fix implementation-caused failures when practical.
8. Commit changes.
9. Push branch.
10. Create/update PR.

---

## Prototype

Treat the existing application as a living rapid prototype.

Preserve:

* existing visual language
* mobile/responsive behavior
* existing components
* existing navigation
* existing working functionality

Do not redesign unrelated areas.

---

## Preview

The URL returned to Slack must show the NEW Claude-generated change.

It must not simply link to unchanged `main`.

Use the simplest free preview strategy available.

If an external hosting service would be required, explain why before adding one.

---

## Error Handling

No silent failures.

Identify failures by stage:

* SLACK_RECEIVED
* JIRA_VALIDATED
* JIRA_UPDATED
* GITHUB_DISPATCHED
* CLAUDE_STARTED
* CODE_CHANGED
* BUILD_PASSED
* PR_CREATED
* PREVIEW_DEPLOYED
* CALLBACK_RECEIVED
* JIRA_COMPLETED
* SLACK_COMPLETED

Include a correlation ID where useful.

A failed automation must report useful information to Slack and/or Jira.

---

## Development Approach

Work incrementally.

Verify each boundary before moving forward:

Slack → n8n
n8n → Jira
n8n → GitHub
GitHub → Claude
Claude → code
code → build
build → preview
GitHub → n8n
n8n → Jira
n8n → Slack

Fix failures instead of bypassing them manually.

---

## Documentation

Maintain:

`docs/poc-workflow.md`

Document only the final working implementation.

Include:

* architecture
* setup
* required secrets
* Docker commands
* Slack configuration
* Jira configuration
* GitHub configuration
* Claude configuration
* starting/stopping n8n
* tunnel setup
* test procedure
* troubleshooting
* demo procedure

---

## Priorities

When tradeoffs exist, prioritize in this order:

1. Working end-to-end workflow
2. Simple implementation
3. Easy debugging
4. Free-tier compatibility
5. Security of credentials
6. Maintainability
7. Production hardening

This is a rapid prototype.

Prove the workflow first.
