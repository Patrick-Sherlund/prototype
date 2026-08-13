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
const handoffId = clean(payload.handoffId || payload.handoff_id || `${source.figmaMakeFileKey || source.figma_make_file_key || ''}:${source.figmaVersionId || source.figma_version_id || ''}`, 500);
const correlationId = clean(payload.correlationId || payload.correlation_id || '', 200);
const slackChannelId = clean(payload.slackChannel || payload.slack_channel_id || env('SLACK_CHANNEL_ID') || '', 100);
const slackThreadTs = clean(payload.slackThreadTs || payload.slack_thread_ts || '', 100);
const success = payload.success === true || payload.status === 'success';
const existing = getHandoff(handoffId);
const finalAlreadyPosted = Boolean(existing.slack?.finalPostedAt);

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
  figmaMakeFileKey: clean(source.figmaMakeFileKey || source.figma_make_file_key, 200),
  figmaVersionId: clean(source.figmaVersionId || source.figma_version_id, 200),
  figmaVersionLabel: clean(source.figmaVersionLabel || source.figma_version_label, 500),
  figmaVersionDescription: clean(source.figmaVersionDescription || source.figma_version_description, 2000),
};

if (!success) {
  const failureStage = clean(payload.stage || 'figma_capture', 100);
  const errorMessage = clean(payload.error || payload.error_message || 'Claude Code did not complete the Figma handoff.', 1200);
  markHandoff(handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
    slack: { channel: slackChannelId, threadTs: slackThreadTs },
  });
  console.log(JSON.stringify({ stage: 'CALLBACK_RECEIVED', correlationId, handoffId, status: 'failure', failureStage }));
  return [{ json: { ...common, requestFailed: true, failureStage, errorMessage, figmaReady: false, claudeSuccess: false, finalAlreadyPosted } }];
}

const figmaDesignUrl = clean(design.url || payload.figmaDesignUrl || payload.figma_design_url, 2000);
if (!figmaDesignUrl) {
  const failureStage = 'figma_capture';
  const errorMessage = 'Claude Code reported success but did not return a Figma Design URL.';
  markHandoff(handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
    slack: { channel: slackChannelId, threadTs: slackThreadTs },
  });
  return [{ json: { ...common, requestFailed: true, failureStage, errorMessage, figmaReady: false, claudeSuccess: false, finalAlreadyPosted } }];
}

const normalizedDesign = {
  url: figmaDesignUrl,
  fileKey: clean(design.fileKey || design.file_key || payload.figmaDesignFileKey || payload.figma_design_file_key, 200),
  nodeId: clean(design.nodeId || design.node_id || payload.figmaDesignNodeId || payload.figma_design_node_id, 200),
};

markHandoff(handoffId, {
  status: 'figma_succeeded',
  jiraIssueKey,
  correlationId,
  source: {
    figmaMakeFileKey: common.figmaMakeFileKey,
    figmaVersionId: common.figmaVersionId,
    figmaVersionLabel: common.figmaVersionLabel,
    figmaVersionDescription: common.figmaVersionDescription,
  },
  design: normalizedDesign,
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
      figmaDesignUrl: normalizedDesign.url,
      figmaDesignFileKey: normalizedDesign.fileKey,
      figmaDesignNodeId: normalizedDesign.nodeId,
    },
  },
];
