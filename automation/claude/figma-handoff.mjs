export function buildClaudeFigmaPrompt(job) {
  const source = job.source;
  const destination = job.destination || {};
  const syncMode = destination.sync_mode || 'BOOTSTRAP';
  const viewMappings = destination.view_mappings || {};
  const archivedMappings = destination.archived_view_mappings || {};
  const destinationLines = [
    `Sync mode: ${syncMode}`,
    `Canonical Figma Design URL: ${destination.figma_design_url || '(not established)'}`,
    `Canonical Figma Design file key: ${destination.figma_design_file_key || '(not established)'}`,
    `Canonical configured by environment: ${destination.canonical_configured ? 'yes' : 'no'}`,
    `Bootstrap creation allowed: ${destination.bootstrap_allowed ? 'yes' : 'no'}`,
    `Sync page name: ${destination.sync_page_name || 'Figma Make Screens'}`,
    `Archive removed views: ${destination.archive_removed_views === false ? 'no' : 'yes'}`,
    `Existing view mapping JSON: ${JSON.stringify(viewMappings)}`,
    `Archived view mapping JSON: ${JSON.stringify(archivedMappings)}`,
  ];

  return [
    'You are performing a full Figma Make to Figma Design synchronization.',
    '',
    'The supplied Figma Make project is the authoritative prototype source.',
    'Claude Code is acting only as the Figma MCP execution agent for this handoff.',
    'The output must be one canonical editable Figma Design file containing every discovered user-facing Make view.',
    '',
    'Inputs:',
    `Jira issue key: ${job.jira_key}`,
    `Jira summary: ${job.jira_summary || '(not provided)'}`,
    `Design request: ${job.request_text || '(not provided)'}`,
    `Trigger source: ${job.trigger_source || '(not provided)'}`,
    `Jira URL: ${job.jira_url || '(not provided)'}`,
    `Correlation ID: ${job.correlation_id}`,
    `Handoff ID: ${job.handoff_id}`,
    '',
    'Figma Make source:',
    `File key: ${source.figma_make_file_key}`,
    `File name: ${source.figma_file_name || '(not provided)'}`,
    `Version ID: ${source.figma_version_id}`,
    `Version label: ${source.figma_version_label || '(not provided)'}`,
    `Version description: ${source.figma_version_description || '(not provided)'}`,
    `Version created at: ${source.figma_version_created_at || '(not provided)'}`,
    `Make URL: ${source.figma_make_url || '(not provided)'}`,
    `Published Make URL: ${source.figma_make_published_url || '(not provided)'}`,
    '',
    'Figma Design destination:',
    ...destinationLines,
    `Browser rendering allowed: ${job.browser_rendering_allowed ? 'yes' : 'no'}`,
    '',
    'Primary task:',
    '1. Connect to the configured Figma MCP server.',
    '2. Use Figma MCP whoami or an equivalent tool when available to confirm Figma MCP authentication.',
    '3. Inspect the Figma MCP tool list and use only supported Figma MCP tools.',
    '4. Access the full Figma Make project identified by the supplied file information and Make URL.',
    '5. Enumerate and fetch all available Figma Make resources/context, including source/router/navigation code when exposed.',
    '6. Build a deterministic view manifest before making any Figma Design changes.',
    '7. The manifest must include every implemented user-facing route, page, screen, tab, modal/dialog, drawer/sheet, multi-step flow state, success state, empty state, and explicitly implemented error state that is reachable in the Make prototype.',
    '8. Do not infer screens that are not actually implemented.',
    '9. Use the published/runnable Make URL for deterministic navigation and live rendered capture when it is supplied.',
    '10. If a published/runnable URL is not supplied, use only an official Figma MCP capability that can render/navigate the Make prototype state. Do not fabricate captures from source context alone.',
    '11. For each manifest view, start from a deterministic state, navigate to the view, wait for render stability, verify the expected view is visible, and capture the whole view.',
    '12. Use Figma MCP generate_figma_design for each rendered view when available. Target the canonical Figma Design file URL/key and the mapped nodeId for that view when present.',
    '13. If generate_figma_design cannot replace/reorganize existing frames cleanly, use the authenticated Figma MCP use_figma capability only for file maintenance: finding frames, renaming frames, moving frames, deleting duplicate prior captures, archiving removed views, and maintaining mappings.',
    '14. Do not use use_figma to invent UI. The captured Make UI remains the source for screen visuals.',
    '15. Store all captured views in one page named the configured Sync page name, preferably "Figma Make Screens".',
    '16. Use stable semantic frame names derived from the manifest, such as "Dashboard" or "SAR Questionnaire - Review". Avoid names such as "Frame 123", "Capture 1", or timestamped copies.',
    '17. For existing mapped views, update or replace the existing canonical frame instead of appending duplicates. Preserve semantic names and intended positions where practical.',
    '18. For views removed from the current manifest but present in prior mappings, archive them by moving/renaming them into a clearly labeled removed/archived section unless archive_removed_views is false.',
    '19. If sync mode is SYNC and a canonical Figma Design URL/key is supplied, you must target that file. Never silently create another file. Fail clearly if it cannot be edited.',
    '20. If sync mode is BOOTSTRAP and no canonical file exists, create exactly one Figma Design file, then place all captured views in that same file and return its URL/key so n8n can persist it.',
    '21. After the full synchronization pass, return strict machine-readable JSON only.',
    '',
    'Stop condition:',
    '- If the available Figma MCP tools cannot access Figma Make context, cannot create/update an editable Figma Design artifact, or expose no supported Figma Design write capability, stop immediately and return the failure JSON.',
    '- If no runnable/published URL is supplied and the available Figma MCP tools cannot render and navigate every manifest view, stop immediately and return failure JSON with the discovered manifest and concrete unsupported capability.',
    '- If any discovered view cannot be captured, mark that view FAILED or SKIPPED with a concrete reason. success=true is allowed only when Failed is 0 and every manifest view is CAPTURED, UPDATED, CREATED, or SKIPPED.',
    '- Do not keep retrying equivalent tool calls after one clear unsupported, unauthorized, or unavailable result.',
    '- Do not spend turns trying to log a browser into the Figma Make editor.',
    '',
    'Do not:',
    '- Modify repository source code.',
    '- Create commits, branches, pull requests, previews, or GitHub Actions runs.',
    '- Update Jira.',
    '- Send Slack messages.',
    '- Modify the Figma Make source.',
    '- Invent UI that is not present in the current Figma Make prototype.',
    '- Create a screenshot-only handoff.',
    '- Reconstruct the UI from repository code.',
    '- Depend on authenticated browser session state for the Figma Make editor.',
    '- Create a fresh Figma Design file when a canonical destination URL/key is supplied.',
    '- Create one file per screen, one file per Jira issue, or one file per workflow execution after bootstrap.',
    '- Leave duplicate canonical frames such as "Dashboard copy" or "Dashboard new".',
    '',
    'Success JSON schema:',
    '{',
    '  "success": true,',
    `  "jiraKey": "${job.jira_key}",`,
    '  "source": {',
    `    "figmaMakeFileKey": "${source.figma_make_file_key}",`,
    `    "figmaVersionId": "${source.figma_version_id}",`,
    `    "figmaVersionLabel": ${JSON.stringify(source.figma_version_label || '')}`,
    '  },',
    '  "design": {',
    '    "url": "https://www.figma.com/design/...",',
    '    "fileKey": "...",',
    '    "nodeId": "...",',
    '    "creationTool": "generate_figma_design | use_figma | other-supported-figma-mcp-write-tool"',
    '  },',
    '  "sync": {',
    `    "mode": "${syncMode}",`,
    '    "pageName": "Figma Make Screens",',
    '    "manifest": {',
    '      "views": [',
    '        {',
    '          "id": "stable-view-id",',
    '          "name": "Human Readable View Name",',
    '          "route": "/route-or-empty",',
    '          "navigation": [{"action":"click","target":"Start Questionnaire"}],',
    '          "captureType": "route | state | modal | drawer | tab | step",',
    '          "expectedVisibleText": "text or landmark used to verify the view"',
    '        }',
    '      ]',
    '    },',
    '    "coverage": {',
    '      "discovered": 0,',
    '      "captured": 0,',
    '      "updated": 0,',
    '      "created": 0,',
    '      "skipped": 0,',
    '      "archived": 0,',
    '      "failed": 0',
    '    },',
    '    "views": [',
    '      {',
    '        "id": "stable-view-id",',
    '        "name": "Human Readable View Name",',
    '        "route": "/route-or-empty",',
    '        "captureType": "route | state | modal | drawer | tab | step",',
    '        "status": "CREATED | UPDATED | CAPTURED | SKIPPED | FAILED",',
    '        "nodeId": "123:456",',
    '        "captureTool": "generate_figma_design | use_figma | other",',
    '        "reason": ""',
    '      }',
    '    ],',
    '    "viewMappings": {',
    '      "stable-view-id": {',
    '        "nodeId": "123:456",',
    '        "name": "Human Readable View Name",',
    '        "route": "/route-or-empty",',
    '        "pageName": "Figma Make Screens"',
    '      }',
    '    },',
    '    "archived": [],',
    '    "failures": []',
    '  }',
    '}',
    '',
    'Failure JSON schema:',
    '{',
    '  "success": false,',
    `  "jiraKey": "${job.jira_key}",`,
    '  "stage": "figma_mcp_auth | figma_make_context | figma_view_discovery | figma_render | generate_figma_design | figma_capture | figma_canonical_file",',
    '  "error": "safe actionable error without secrets",',
    '  "sync": {',
    '    "manifest": {"views": []},',
    '    "coverage": {"discovered":0,"captured":0,"updated":0,"created":0,"skipped":0,"archived":0,"failed":1},',
    '    "views": [],',
    '    "failures": []',
    '  }',
    '}',
    '',
    'Return no Markdown, no prose, and no code fences outside the JSON object.',
  ].join('\n');
}

export function extractClaudeResultText(result) {
  const stdout = String(result.stdout || '').trim();
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === 'string') return parsed.result;
    if (typeof parsed.message === 'string') return parsed.message;
    return JSON.stringify(parsed);
  } catch {
    return stdout;
  }
}

export function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    for (const candidate of balancedJsonCandidates(withoutFence)) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep looking for a later balanced object. Claude sometimes wraps
        // diagnostics around the object even when instructed not to.
      }
    }
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new Error(`Claude did not return valid JSON: ${withoutFence.slice(0, 500)}`);
  }
}

export function normalizeClaudeFigmaResult(text, job) {
  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch (error) {
    return {
      success: false,
      jiraKey: String(job.jira_key || '').toUpperCase(),
      stage: inferFailureStage(text),
      error: safeError(`Claude Code did not return valid handoff JSON. Output: ${String(text || error.message || '').slice(0, 900)}`),
      sync: emptySync(job.destination?.sync_mode || ''),
    };
  }

  const jiraKey = String(parsed.jiraKey || parsed.jira_key || job.jira_key || '').toUpperCase();
  const sync = normalizeSync(parsed.sync, job);
  if (parsed.success === false) {
    return {
      success: false,
      jiraKey,
      stage: normalizeStage(parsed.stage || 'figma_capture'),
      error: safeError(parsed.error || parsed.error_message || 'Claude Code reported a Figma handoff failure.'),
      sync,
      design: normalizeDesign(parsed.design || {}, parsed),
    };
  }

  const design = parsed.design || {};
  const url = String(design.url || parsed.figmaDesignUrl || parsed.figma_design_url || '').trim();
  if (parsed.success !== true || !url) {
    return {
      success: false,
      jiraKey,
      stage: 'figma_capture',
      error: 'Claude Code did not return success=true with a Figma Design URL.',
      sync,
    };
  }

  if (sync.coverage.failed > 0) {
    return {
      success: false,
      jiraKey,
      stage: 'figma_capture',
      error: `Figma full sync reported ${sync.coverage.failed} failed view(s).`,
      sync,
      design: normalizeDesign(design, parsed),
    };
  }

  if (sync.coverage.discovered > 0 && sync.coverage.captured + sync.coverage.skipped < sync.coverage.discovered) {
    return {
      success: false,
      jiraKey,
      stage: 'figma_capture',
      error: `Figma full sync coverage is incomplete: discovered ${sync.coverage.discovered}, captured ${sync.coverage.captured}, skipped ${sync.coverage.skipped}.`,
      sync,
      design: normalizeDesign(design, parsed),
    };
  }

  const source = parsed.source || {};
  return {
    success: true,
    jiraKey,
    source: {
      figmaMakeFileKey: String(source.figmaMakeFileKey || source.figma_make_file_key || job.source.figma_make_file_key || ''),
      figmaVersionId: String(source.figmaVersionId || source.figma_version_id || job.source.figma_version_id || ''),
      figmaVersionLabel: String(source.figmaVersionLabel || source.figma_version_label || job.source.figma_version_label || ''),
    },
    design: normalizeDesign(design, parsed),
    sync,
  };
}

export function balancedJsonCandidates(text) {
  const value = String(text || '');
  const candidates = [];
  for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

export function normalizeStage(stage) {
  const normalized = String(stage || '').trim();
  const allowed = new Set([
    'figma_mcp_auth',
    'figma_make_context',
    'figma_view_discovery',
    'figma_render',
    'generate_figma_design',
    'figma_capture',
    'figma_canonical_file',
  ]);
  return allowed.has(normalized) ? normalized : 'figma_capture';
}

export function inferFailureStage(output) {
  const text = String(output || '');
  if (/mcp|figma.*auth|authentication|authorize|oauth|whoami|connected/i.test(text)) return 'figma_mcp_auth';
  if (/make.*context|resource|file.*not.*found|permission|access/i.test(text)) return 'figma_make_context';
  if (/manifest|route|view|screen|navigation|inventory/i.test(text)) return 'figma_view_discovery';
  if (/canonical|wrong.*file|design.*file.*edit|configured.*file/i.test(text)) return 'figma_canonical_file';
  if (/browser|playwright|render|published|url|page/i.test(text)) return 'figma_render';
  if (/generate_figma_design|code to canvas|editable|canvas|design/i.test(text)) return 'generate_figma_design';
  return 'figma_capture';
}

export function safeError(value) {
  return String(value || 'Unknown error')
    .replace(/sk-ant-[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .slice(0, 1200);
}

export function normalizeDesign(design = {}, parsed = {}) {
  return {
    url: String(design.url || parsed.figmaDesignUrl || parsed.figma_design_url || '').trim(),
    fileKey: String(design.fileKey || design.file_key || parsed.figmaDesignFileKey || parsed.figma_design_file_key || ''),
    nodeId: String(design.nodeId || design.node_id || parsed.figmaDesignNodeId || parsed.figma_design_node_id || ''),
    creationTool: String(design.creationTool || design.creation_tool || parsed.creationTool || parsed.creation_tool || ''),
  };
}

export function normalizeSync(sync = {}, job = {}) {
  const manifest = normalizeManifest(sync.manifest || {});
  const views = normalizeViewResults(sync.views || []);
  const coverage = normalizeCoverage(sync.coverage || {}, manifest.views, views);
  return {
    mode: String(sync.mode || job.destination?.sync_mode || '').toUpperCase() || 'BOOTSTRAP',
    pageName: String(sync.pageName || sync.page_name || job.destination?.sync_page_name || 'Figma Make Screens').slice(0, 200),
    manifest,
    coverage,
    views,
    viewMappings: normalizeViewMappings(sync.viewMappings || sync.view_mappings || {}),
    archived: Array.isArray(sync.archived) ? sync.archived.map((item) => normalizeArchive(item)).filter(Boolean) : [],
    failures: Array.isArray(sync.failures) ? sync.failures.map((item) => normalizeFailure(item)).filter(Boolean) : [],
  };
}

export function emptySync(mode = '') {
  return {
    mode: String(mode || '').toUpperCase() || 'BOOTSTRAP',
    pageName: 'Figma Make Screens',
    manifest: { views: [] },
    coverage: { discovered: 0, captured: 0, updated: 0, created: 0, skipped: 0, archived: 0, failed: 0 },
    views: [],
    viewMappings: {},
    archived: [],
    failures: [],
  };
}

function normalizeManifest(manifest = {}) {
  const views = Array.isArray(manifest.views) ? manifest.views : [];
  const seen = new Set();
  return {
    views: views.map((view, index) => normalizeManifestView(view, index)).filter((view) => {
      if (!view.id || seen.has(view.id)) return false;
      seen.add(view.id);
      return true;
    }),
  };
}

function normalizeManifestView(view = {}, index = 0) {
  const id = stableViewId(view.id || view.name || `view-${index + 1}`);
  return {
    id,
    name: String(view.name || view.title || id).trim().slice(0, 200),
    route: String(view.route || '').trim().slice(0, 500),
    navigation: Array.isArray(view.navigation) ? view.navigation.map((step) => normalizeNavigation(step)).filter(Boolean) : [],
    captureType: String(view.captureType || view.capture_type || 'route').trim().slice(0, 80),
    expectedVisibleText: String(view.expectedVisibleText || view.expected_visible_text || '').trim().slice(0, 500),
  };
}

function normalizeNavigation(step = {}) {
  if (typeof step === 'string') return { action: step.slice(0, 200), target: '' };
  const action = String(step.action || '').trim().slice(0, 120);
  const target = String(step.target || '').trim().slice(0, 300);
  return action || target ? { action, target } : null;
}

function normalizeViewResults(views = []) {
  return views.map((view, index) => {
    const id = stableViewId(view.id || view.name || `view-${index + 1}`);
    const status = String(view.status || '').trim().toUpperCase();
    const allowed = new Set(['CREATED', 'UPDATED', 'CAPTURED', 'SKIPPED', 'FAILED', 'ARCHIVED']);
    return {
      id,
      name: String(view.name || id).trim().slice(0, 200),
      route: String(view.route || '').trim().slice(0, 500),
      captureType: String(view.captureType || view.capture_type || 'route').trim().slice(0, 80),
      status: allowed.has(status) ? status : 'FAILED',
      nodeId: String(view.nodeId || view.node_id || '').trim().slice(0, 200),
      captureTool: String(view.captureTool || view.capture_tool || '').trim().slice(0, 120),
      reason: String(view.reason || '').trim().slice(0, 900),
    };
  });
}

function normalizeCoverage(coverage = {}, manifestViews = [], viewResults = []) {
  const counted = {
    discovered: numberOr(coverage.discovered, manifestViews.length),
    captured: numberOr(
      coverage.captured,
      viewResults.filter((view) => ['CREATED', 'UPDATED', 'CAPTURED'].includes(view.status)).length,
    ),
    updated: numberOr(coverage.updated, viewResults.filter((view) => view.status === 'UPDATED').length),
    created: numberOr(coverage.created, viewResults.filter((view) => view.status === 'CREATED').length),
    skipped: numberOr(coverage.skipped, viewResults.filter((view) => view.status === 'SKIPPED').length),
    archived: numberOr(coverage.archived, viewResults.filter((view) => view.status === 'ARCHIVED').length),
    failed: numberOr(coverage.failed, viewResults.filter((view) => view.status === 'FAILED').length),
  };
  return counted;
}

function normalizeViewMappings(mappings = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(mappings || {})) {
    const id = stableViewId(key || value?.id || value?.name);
    if (!id) continue;
    normalized[id] = {
      nodeId: String(value?.nodeId || value?.node_id || '').trim().slice(0, 200),
      name: String(value?.name || id).trim().slice(0, 200),
      route: String(value?.route || '').trim().slice(0, 500),
      pageName: String(value?.pageName || value?.page_name || 'Figma Make Screens').trim().slice(0, 200),
      status: String(value?.status || 'active').trim().slice(0, 80),
    };
  }
  return normalized;
}

function normalizeArchive(item = {}) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: stableViewId(item.id || item.name || ''),
    name: String(item.name || item.id || '').trim().slice(0, 200),
    nodeId: String(item.nodeId || item.node_id || '').trim().slice(0, 200),
    reason: String(item.reason || '').trim().slice(0, 900),
  };
}

function normalizeFailure(item = {}) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: stableViewId(item.id || item.name || ''),
    name: String(item.name || item.id || '').trim().slice(0, 200),
    stage: normalizeStage(item.stage || 'figma_capture'),
    error: safeError(item.error || item.reason || 'View capture failed.'),
  };
}

function stableViewId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
