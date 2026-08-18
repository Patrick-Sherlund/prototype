const crypto = require('crypto');
const env = (name) => $env[name];

function rawBodyFrom(item) {
  const encoded = item.binary?.data?.data;
  if (encoded) return Buffer.from(encoded, 'base64').toString('utf8');
  const body = item.json.body;
  return typeof body === 'string' ? body : JSON.stringify(body || {});
}

function header(headers, name) {
  const match = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return Array.isArray(match?.[1]) ? match[1][0] : match?.[1];
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function clean(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function designKeyFromUrl(url) {
  const match = String(url || '').match(/figma\.com\/design\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeSync(sync) {
  const value = sync && typeof sync === 'object' ? sync : {};
  const manifest = value.manifest && typeof value.manifest === 'object' ? value.manifest : { views: [] };
  const views = Array.isArray(value.views) ? value.views : [];
  const coverage = value.coverage && typeof value.coverage === 'object' ? value.coverage : {};
  const normalizedCoverage = {
    discovered: numberOr(coverage.discovered, Array.isArray(manifest.views) ? manifest.views.length : 0),
    captured: numberOr(coverage.captured, views.filter((view) => ['CREATED', 'UPDATED', 'CAPTURED'].includes(String(view.status || '').toUpperCase())).length),
    updated: numberOr(coverage.updated, views.filter((view) => String(view.status || '').toUpperCase() === 'UPDATED').length),
    created: numberOr(coverage.created, views.filter((view) => String(view.status || '').toUpperCase() === 'CREATED').length),
    skipped: numberOr(coverage.skipped, views.filter((view) => String(view.status || '').toUpperCase() === 'SKIPPED').length),
    archived: numberOr(coverage.archived, Array.isArray(value.archived) ? value.archived.length : 0),
    failed: numberOr(coverage.failed, views.filter((view) => String(view.status || '').toUpperCase() === 'FAILED').length),
  };
  return {
    mode: clean(value.mode || '', 40).toUpperCase(),
    pageName: clean(value.pageName || value.page_name || 'Figma Make Screens', 200),
    manifest: {
      views: Array.isArray(manifest.views) ? manifest.views : [],
    },
    coverage: normalizedCoverage,
    views,
    viewMappings: value.viewMappings || value.view_mappings || {},
    archived: Array.isArray(value.archived) ? value.archived : [],
    failures: Array.isArray(value.failures) ? value.failures : [],
  };
}

function parseBody(item, rawBody) {
  if (typeof item.json.body === 'object' && item.json.body !== null) return item.json.body;
  return JSON.parse(rawBody || '{}');
}

function markHandoff(handoffId, patch) {
  if (!handoffId) return;
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  staticData.figmaHandoffs[handoffId] = {
    ...(staticData.figmaHandoffs[handoffId] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function canonicalFromState() {
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaCanonicalDesign = staticData.figmaCanonicalDesign || {};
  const configuredUrl = clean(env('FIGMA_DESIGN_FILE_URL') || env('FIGMA_DESTINATION_FILE_URL'), 2000);
  const configuredKey = clean(env('FIGMA_DESIGN_FILE_KEY') || env('FIGMA_DESTINATION_FILE_KEY') || designKeyFromUrl(configuredUrl), 200);
  const configured = Boolean(configuredUrl || configuredKey);
  return {
    configured,
    url: configured ? configuredUrl : clean(staticData.figmaCanonicalDesign.figmaDesignUrl || '', 2000),
    key: configured ? configuredKey : clean(staticData.figmaCanonicalDesign.figmaDesignFileKey || designKeyFromUrl(staticData.figmaCanonicalDesign.figmaDesignUrl), 200),
  };
}

function persistCanonical(design, sync, source) {
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaCanonicalDesign = staticData.figmaCanonicalDesign || {};
  staticData.figmaViewMappings = staticData.figmaViewMappings || {};
  staticData.figmaArchivedViewMappings = staticData.figmaArchivedViewMappings || {};

  if (design.url || design.fileKey) {
    staticData.figmaCanonicalDesign = {
      ...staticData.figmaCanonicalDesign,
      figmaDesignUrl: design.url || staticData.figmaCanonicalDesign.figmaDesignUrl || '',
      figmaDesignFileKey: design.fileKey || staticData.figmaCanonicalDesign.figmaDesignFileKey || designKeyFromUrl(design.url),
      pageName: sync.pageName || staticData.figmaCanonicalDesign.pageName || 'Figma Make Screens',
      sourceMakeFileKey: source.figmaMakeFileKey || '',
      updatedAt: new Date().toISOString(),
    };
  }

  if (sync.viewMappings && typeof sync.viewMappings === 'object') {
    staticData.figmaViewMappings = {
      ...staticData.figmaViewMappings,
      ...sync.viewMappings,
    };
  }

  for (const archived of sync.archived || []) {
    const id = clean(archived.id || archived.name, 120);
    if (!id) continue;
    staticData.figmaArchivedViewMappings[id] = {
      ...archived,
      archivedAt: new Date().toISOString(),
    };
    delete staticData.figmaViewMappings[id];
  }
}

function getHandoff(handoffId) {
  if (!handoffId) return {};
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  return staticData.figmaHandoffs[handoffId] || {};
}

const item = $input.first();
const headers = item.json.headers || {};
const rawBody = rawBodyFrom(item);
let payload;
try {
  payload = parseBody(item, rawBody);
} catch {
  return [{ json: { ackStatusCode: 400, ackText: 'invalid json', authorized: false } }];
}

if (!env('N8N_CALLBACK_SECRET')) {
  return [{ json: { ackStatusCode: 500, ackText: 'callback secret is not configured', authorized: false } }];
}

if (!safeCompare(env('N8N_CALLBACK_SECRET'), header(headers, 'x-poc-callback-secret'))) {
  return [{ json: { ackStatusCode: 403, ackText: 'forbidden', authorized: false } }];
}

const jiraIssueKey = clean(payload.jiraKey || payload.jira_key || payload.jira_issue_key, 80).toUpperCase();
const source = payload.source || {};
const design = payload.design || {};
const sync = normalizeSync(payload.sync);
const handoffId = clean(payload.handoffId || payload.handoff_id || `${source.figmaMakeFileKey || source.figma_make_file_key || ''}:${source.figmaVersionId || source.figma_version_id || ''}`, 500);
const correlationId = clean(payload.correlationId || payload.correlation_id || '', 200);
const slackChannelId = clean(payload.slackChannel || payload.slack_channel_id || env('SLACK_CHANNEL_ID') || '', 100);
const slackThreadTs = clean(payload.slackThreadTs || payload.slack_thread_ts || '', 100);
const success = payload.success === true || payload.status === 'success';
const existing = getHandoff(handoffId);
const finalAlreadyPosted = Boolean(existing.slack?.finalPostedAt);
const requestText = clean(payload.requestText || payload.request_text || existing.requestText || '', 3000);

const common = {
  ackStatusCode: 200,
  ackText: 'ok',
  authorized: true,
  shouldProcess: true,
  jiraIssueKey,
  handoffId,
  correlationId,
  slackChannelId,
  slackThreadTs,
  requestText,
  triggerSource: clean(payload.triggerSource || payload.trigger_source || existing.triggerSource || '', 100),
  figmaMakeFileKey: clean(source.figmaMakeFileKey || source.figma_make_file_key, 200),
  figmaVersionId: clean(source.figmaVersionId || source.figma_version_id, 200),
  figmaVersionLabel: clean(source.figmaVersionLabel || source.figma_version_label, 500),
  figmaVersionDescription: clean(source.figmaVersionDescription || source.figma_version_description, 2000),
  figmaMakeUrl: clean(source.figmaMakeUrl || source.figma_make_url, 2000),
  figmaMakePublishedUrl: clean(source.figmaMakePublishedUrl || source.figma_make_published_url, 2000),
};

if (!success) {
  const failureStage = clean(payload.stage || 'figma_capture', 100);
  const errorMessage = clean(payload.error || payload.error_message || 'Claude Code did not complete the Figma handoff.', 1200);
  markHandoff(handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
    requestText,
    slack: { channel: slackChannelId, threadTs: slackThreadTs },
    sync,
  });
  console.log(JSON.stringify({ stage: 'CALLBACK_RECEIVED', correlationId, handoffId, status: 'failure', failureStage }));
  return [{ json: { ...common, requestFailed: true, failureStage, errorMessage, figmaReady: false, claudeSuccess: false, finalAlreadyPosted, sync } }];
}

const figmaDesignUrl = clean(design.url || payload.figmaDesignUrl || payload.figma_design_url, 2000);
if (!figmaDesignUrl) {
  const failureStage = 'figma_capture';
  const errorMessage = 'Claude Code reported success but did not return a Figma Design URL.';
  markHandoff(handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
    requestText,
    sync,
    slack: { channel: slackChannelId, threadTs: slackThreadTs },
  });
  return [{ json: { ...common, requestFailed: true, failureStage, errorMessage, figmaReady: false, claudeSuccess: false, finalAlreadyPosted, sync } }];
}

const normalizedDesign = {
  url: figmaDesignUrl,
  fileKey: clean(design.fileKey || design.file_key || payload.figmaDesignFileKey || payload.figma_design_file_key, 200),
  nodeId: clean(design.nodeId || design.node_id || payload.figmaDesignNodeId || payload.figma_design_node_id, 200),
  creationTool: clean(design.creationTool || design.creation_tool || payload.figmaDesignCreationTool || payload.figma_design_creation_tool, 100),
};
if (!normalizedDesign.fileKey) normalizedDesign.fileKey = designKeyFromUrl(normalizedDesign.url);

const canonical = canonicalFromState();
const returnedKey = normalizedDesign.fileKey || designKeyFromUrl(normalizedDesign.url);
if (canonical.key && returnedKey && canonical.key !== returnedKey) {
  const failureStage = 'figma_canonical_file';
  const errorMessage = 'Claude returned a Figma Design file that does not match the configured or persisted canonical Design file.';
  markHandoff(handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
    requestText,
    design: normalizedDesign,
    sync,
    slack: { channel: slackChannelId, threadTs: slackThreadTs },
  });
  return [{ json: { ...common, requestFailed: true, failureStage, errorMessage, figmaReady: false, claudeSuccess: false, finalAlreadyPosted, design: normalizedDesign, sync } }];
}

if (sync.coverage.failed > 0) {
  const failureStage = 'figma_capture';
  const errorMessage = `Figma full sync reported ${sync.coverage.failed} failed view(s).`;
  markHandoff(handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
    requestText,
    design: normalizedDesign,
    sync,
    slack: { channel: slackChannelId, threadTs: slackThreadTs },
  });
  return [{ json: { ...common, requestFailed: true, failureStage, errorMessage, figmaReady: false, claudeSuccess: false, finalAlreadyPosted, design: normalizedDesign, sync } }];
}

persistCanonical(normalizedDesign, sync, common);

markHandoff(handoffId, {
  status: 'figma_succeeded',
  jiraIssueKey,
  correlationId,
  requestText,
  source: {
    figmaMakeFileKey: common.figmaMakeFileKey,
    figmaVersionId: common.figmaVersionId,
    figmaVersionLabel: common.figmaVersionLabel,
    figmaVersionDescription: common.figmaVersionDescription,
    figmaMakeUrl: common.figmaMakeUrl,
    figmaMakePublishedUrl: common.figmaMakePublishedUrl,
  },
  design: normalizedDesign,
  sync,
  slack: { channel: slackChannelId, threadTs: slackThreadTs },
});

console.log(JSON.stringify({ stage: 'CALLBACK_RECEIVED', correlationId, handoffId, status: 'success' }));

return [
  {
    json: {
      ...common,
      requestFailed: false,
      figmaReady: true,
      claudeSuccess: true,
      design: normalizedDesign,
      sync,
      syncMode: sync.mode,
      syncPageName: sync.pageName,
      syncManifest: sync.manifest,
      syncViews: sync.views,
      syncCoverage: sync.coverage,
      syncViewMappings: sync.viewMappings,
      syncArchived: sync.archived,
      syncFailures: sync.failures,
      figmaDesignUrl: normalizedDesign.url,
      figmaDesignFileKey: normalizedDesign.fileKey,
      figmaDesignNodeId: normalizedDesign.nodeId,
      figmaDesignCreationTool: normalizedDesign.creationTool,
    },
  },
];
