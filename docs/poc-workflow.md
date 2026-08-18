# Figma Make Design Full Sync POC

## Current Workflow

```text
Figma Make named version or manual request
  -> n8n
  -> Jira issue validation
  -> one Slack parent message
  -> threaded Slack progress replies
  -> local Claude Code worker
  -> authenticated Figma MCP
  -> Make project discovery
  -> rendered view capture
  -> generate_figma_design into one canonical Figma Design file
  -> Jira comment
  -> final Slack thread reply
```

The old Slack-triggered repository code-generation workflow is not product behavior.

## Source and Artifact Boundary

Figma Make is the authoritative prototype source/context. The workflow reads Make resources and routing/navigation context through Figma MCP.

Figma Design is the writable downstream artifact. The workflow synchronizes screens into one canonical Design file. Do not claim the workflow edits the Figma Make project unless the current official MCP tool surface explicitly supports and executes that operation.

## Full Sync Behavior

Claude must discover the entire Make project before capture and return a deterministic manifest:

```json
{
  "views": [
    {
      "id": "intro",
      "name": "Intro",
      "route": "/",
      "navigation": [],
      "captureType": "route"
    },
    {
      "id": "questionnaire-review",
      "name": "SAR Questionnaire - Review",
      "route": "/questionnaire",
      "navigation": [
        { "action": "click", "target": "Start Questionnaire" },
        { "action": "complete-required-fields" },
        { "action": "click", "target": "Review" }
      ],
      "captureType": "state"
    }
  ]
}
```

Manifest entries should cover implemented user-facing routes, pages, tabs, modals, drawers, multi-step states, success states, empty states, and explicit error states. Screens that are not implemented must not be invented.

The sync succeeds only when every manifest view is captured or explicitly skipped with a concrete reason. `Failed > 0` is a failed synchronization and Jira is not updated as successful.

## Canonical Design File

Primary configuration:

```env
FIGMA_DESIGN_FILE_URL=
FIGMA_DESIGN_FILE_KEY=
FIGMA_SYNC_PAGE_NAME=Figma Make Screens
FIGMA_DESIGN_BOOTSTRAP_ALLOWED=true
FIGMA_ARCHIVE_REMOVED_VIEWS=true
```

If `FIGMA_DESIGN_FILE_URL` or `FIGMA_DESIGN_FILE_KEY` is configured:

- always use that existing Figma Design file,
- never call a new-file path,
- fail clearly if the file cannot be edited,
- never silently fall back to a new file.

If no canonical file exists, BOOTSTRAP mode may create exactly one Design file. n8n persists the resulting URL/key in workflow static data. Subsequent runs are SYNC mode and must reuse the same file.

Older `FIGMA_DESTINATION_FILE_URL` and `FIGMA_DESTINATION_FILE_KEY` are retained only as compatibility aliases.

## View Mapping and Updates

n8n static data stores canonical sync state:

```json
{
  "figmaCanonicalDesign": {
    "figmaDesignFileKey": "...",
    "figmaDesignUrl": "https://www.figma.com/design/...",
    "pageName": "Figma Make Screens"
  },
  "figmaViewMappings": {
    "intro": {
      "nodeId": "123:456",
      "name": "Intro",
      "route": "/",
      "pageName": "Figma Make Screens"
    }
  },
  "figmaArchivedViewMappings": {}
}
```

For each view, Claude targets the existing mapped frame/node when possible. It updates or replaces the canonical representation instead of appending duplicates like `Dashboard copy` or timestamped captures.

Removed views are archived by default rather than deleted. Archived views must be clearly marked as no longer present in the current Make manifest.

## Rendered Navigation

Use Figma MCP Make resources for discovery and route/state understanding.

Use a runnable or published prototype URL for deterministic navigation and rendered capture:

```env
FIGMA_MAKE_PUBLISHED_URL=https://...
```

Browser automation is allowed for the runnable/published application experience, not for editing the authenticated Figma Make editor. If no runnable URL exists and Figma MCP cannot render/navigate all states directly, the workflow must stop with a `figma_render` failure and report the unsupported capability.

## Slack Status

Each accepted sync creates exactly one Slack parent message. Replies use the same `thread_ts`.

Expected thread content:

```text
🎨 Figma Make sync started for SYSCO-20
✅ Jira issue SYSCO-20 verified.
✅ Figma Make source resolved.
🔄 Inspecting the full Figma Make project and building the view manifest.
🔄 Synchronizing discovered views into the canonical Figma Design file.
✅ Figma Make sync capture complete.

Discovered: 7
Captured: 7
Updated: 7
Created: 0
Skipped: 0
Archived: 0
Failed: 0

Design: https://www.figma.com/design/...
Figma sync complete for SYSCO-20
```

Slack failures are logged but do not roll back successful Figma/Jira work.

## Jira Result

On successful full sync, n8n adds a concise Jira comment:

```text
Figma Make synchronization complete.

Source Make:
<Make URL>

Canonical Design:
<same persistent Design URL>

Views discovered: X
Views updated: Y
Views created: Z
Views skipped: N
Views archived: M
Failures: 0
Correlation ID: <id>
```

Jira is updated only after Claude returns successful structured JSON with a canonical Figma Design URL and no failed views.

## Webhooks

Figma `FILE_VERSION_UPDATE` webhook handling remains implemented for named-version automation:

```env
FIGMA_WEBHOOK_ENABLED=true
FIGMA_WEBHOOK_PASSCODE=<secret>
```

In the current free-tier POC, webhooks can remain disabled:

```env
FIGMA_WEBHOOK_ENABLED=false
```

The request-driven endpoint remains useful for local validation:

```powershell
npm run figma:request:test -- --issue SYSCO-20
```

## Testing

Mocked deterministic validation:

```powershell
npm run validate:workflows
npm run test:figma
```

Mocked tests cover webhook validation, request validation, idempotency, Slack thread propagation, Claude JSON parsing, canonical Design mapping, view mapping persistence, Jira retry, and error handling.

Real validation requires:

1. A Make project accessible through authenticated Figma MCP.
2. A runnable/published URL or official MCP render/navigation capability.
3. A canonical Design file with edit permission, or one bootstrap creation.
4. One full sync.
5. A second full sync that reuses the same Design file and updates/reconciles mapped frames.
6. Figma file inspection confirming meaningful frame names and no unnecessary duplicates.

## Failure Stages

```text
figma_mcp_auth
figma_make_context
figma_view_discovery
figma_render
generate_figma_design
figma_capture
figma_canonical_file
JIRA_COMPLETED
```

Common blockers:

- `figma_render`: no published/runnable URL and MCP cannot render/navigate Make states directly.
- `figma_canonical_file`: configured Design file cannot be edited or Claude returned a different file.
- `generate_figma_design`: current MCP/client cannot capture rendered UI into editable Design layers.
- `JIRA_COMPLETED`: Figma sync succeeded but Jira failed; rerun the same handoff ID to retry Jira without regenerating the design.

## References

- Figma MCP tools and prompts: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/
- Figma Code to Canvas / `generate_figma_design`: https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/
- Figma write to canvas / `use_figma`: https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/
- Figma webhooks: https://developers.figma.com/docs/rest-api/webhooks/
