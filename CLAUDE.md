# Claude Code Instructions

This repository contains a rapid prototype automation for autonomous Figma Make to editable Figma Design handoff.

Runtime handoff responsibility:

- Use Claude Code as the Figma MCP execution agent.
- Treat Figma Make as the authoritative prototype source.
- Access Figma Make context/resources and the current rendered Make prototype state.
- Use Figma MCP Code to Canvas / `generate_figma_design` to create or update editable Figma Design layers.
- Return strict JSON to the local worker.

Do not modify repository source code during runtime Figma handoffs.
Do not create commits, branches, PRs, GitHub Actions runs, or preview deployments.
Do not update Jira or Slack; n8n owns those integrations.
Do not modify the Figma Make source.
Do not create screenshot-only handoff artifacts.

Useful local validation:

```powershell
npm run validate:workflows
npm run test:figma
claude auth status
claude mcp list
```
