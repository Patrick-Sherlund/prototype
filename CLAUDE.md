# Claude Code Instructions

Follow the repository rules in `AGENTS.md`.

This repository contains a small foodservice purchasing and order-management prototype used to demonstrate a Slack -> n8n -> Jira -> GitHub Actions -> Claude Code automation loop.

## Prototype Scope

- Keep the app intentionally small and demo-friendly.
- Preserve the current FoodPro/Sysco-inspired visual language: blue navigation, green primary actions, white operational panels, dense catalog/order-management layout, and Arial/Helvetica-style typography.
- Make the smallest coherent change requested by the Jira/Slack context.
- Do not redesign unrelated screens.
- Do not create unrelated operational workflows outside foodservice purchasing.

## Validation

Use the repository npm scripts:

```bash
npm ci
npm run build
```

There is no separate lint or test command unless one is added later.

## Git

Automated prototype changes must happen on an issue branch named `prototype/<SYSCO-issue-key>`.

Never push prototype implementation changes directly to `main`. Commit the focused change, push the issue branch, and create or update a Pull Request to `main`.
