# AGENTS.md

## Mission

Build and maintain a rapid prototype automation for:

```text
Figma Make named version
  -> Figma FILE_VERSION_UPDATE webhook
  -> n8n
  -> threaded Slack status updates
  -> Claude Code
  -> Figma MCP
  -> generate_figma_design
  -> editable Figma Design
  -> Jira update
  -> final Slack thread reply
```

Optimize for speed, simplicity, free-tier compatibility, easy local setup, real integrations, and clear debugging.

Do not preserve the old Slack-triggered Jira-to-Claude repository code-generation workflow as product behavior.

## Source of Truth

Figma Make is the authoritative prototype source. Figma Design is a downstream editable handoff artifact. Jira tracks work and traceability. Slack provides workflow visibility only.

Claude Code is the Figma MCP execution agent. It should not modify repository source code, create commits, push branches, open PRs, publish previews, update Jira, or send Slack messages during runtime handoffs.

## Required Behavior

- n8n receives Figma `FILE_VERSION_UPDATE` webhooks for named versions.
- Validate the Figma webhook passcode from configuration.
- Parse a Jira key such as `SYSCO-1` from the version label or description.
- Verify the Jira issue exists; do not create replacement issues.
- Create exactly one Slack parent message per accepted handoff.
- Save and reuse the Slack parent `ts` as `thread_ts` for all progress and final replies.
- Invoke the existing local Claude Code worker.
- Claude Code uses Figma MCP and `generate_figma_design` to create editable Figma Design layers from the current Figma Make prototype state.
- n8n updates Jira only after Claude returns successful structured JSON with a Figma Design URL.
- Persist Jira issue -> Figma Design mapping and handoff idempotency state.
- Use `file_key + version_id` as the handoff idempotency key.
- Retry Jira without regenerating the design when Figma succeeds but Jira fails.
- Never commit secrets.

## Secrets

Use `.env`, n8n credentials, or platform secret stores. Commit only `.env.example`.

Never hard-code or expose:

- Figma access tokens
- Figma webhook passcodes
- Slack bot tokens
- Jira auth headers
- Claude authentication
- n8n callback or worker secrets

## Documentation

Maintain `README.md` and `docs/poc-workflow.md` around the current Figma Make handoff workflow only. Clearly distinguish mocked tests from real Figma Make -> Claude Code -> Figma MCP -> editable Figma Design validation.
