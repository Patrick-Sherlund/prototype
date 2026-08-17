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

function parseBody(item, rawBody) {
  if (typeof item.json.body === 'object' && item.json.body !== null) return item.json.body;
  const text = String(item.json.body || rawBody || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
}

function clean(value, max = 1000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function slug(value, max = 120) {
  return clean(value, max)
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
}

function makeFileKeyFromUrl(url) {
  const match = String(url || '').match(/figma\.com\/make\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function requestTextFromBody(body) {
  const explicit = clean(body.request || body.requestText || body.design_request || body.description || body.text, 3000);
  return explicit.replace(/^\s*[A-Z][A-Z0-9]+-\d+\b\s*/i, '').trim();
}

function failBeforeClaude(base, failureStage, errorMessage) {
  return [
    {
      json: {
        ...base,
        shouldProcess: false,
        requestFailed: true,
        failureStage,
        errorMessage: clean(errorMessage, 900),
        slackNotificationAllowed: Boolean(env('SLACK_BOT_TOKEN') && env('SLACK_CHANNEL_ID')),
      },
    },
  ];
}

function pruneHandoffs(handoffs, now) {
  const ttlMs = 30 * 24 * 60 * 60 * 1000;
  for (const [key, record] of Object.entries(handoffs)) {
    const updatedAt = Date.parse(record.updatedAt || record.createdAt || '');
    if (Number.isFinite(updatedAt) && now - updatedAt > ttlMs) delete handoffs[key];
  }
}

const item = $input.first();
const rawBody = rawBodyFrom(item);
let body;
try {
  body = parseBody(item, rawBody);
} catch {
  return [{ json: { ackStatusCode: 400, ackText: 'invalid request', shouldProcess: false, requestFailed: false, ignored: true } }];
}

const requestSecret = env('FIGMA_HANDOFF_REQUEST_SECRET');
if (requestSecret) {
  const provided = header(item.json.headers || {}, 'x-poc-request-secret') || body.secret || body.token;
  if (!safeCompare(requestSecret, provided)) {
    return [{ json: { ackStatusCode: 403, ackText: 'forbidden', shouldProcess: false, requestFailed: false, ignored: true } }];
  }
}

const jiraProjectKey = env('JIRA_PROJECT_KEY') || 'SYSCO';
const issuePattern = new RegExp(`\\b${jiraProjectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\b`, 'i');
const requestText = requestTextFromBody(body);
const issueMatch = clean(body.jiraKey || body.jira_key || body.issue || body.issueKey || body.issue_key || body.text, 1000).match(issuePattern);
const jiraIssueKey = issueMatch ? issueMatch[0].toUpperCase() : '';
const figmaMakeUrl = clean(body.figmaMakeUrl || body.figma_make_url || env('FIGMA_MAKE_URL'), 2000);
const figmaMakeFileKey = clean(body.figmaMakeFileKey || body.figma_make_file_key || body.fileKey || body.file_key || env('FIGMA_MAKE_FILE_KEY') || makeFileKeyFromUrl(figmaMakeUrl), 200);
const requestId = clean(body.requestId || body.request_id || body.correlationId || body.correlation_id || `manual-${Date.now()}`, 200);
const sourceVersionId = clean(body.versionId || body.version_id || requestId, 200);
const handoffId = `${figmaMakeFileKey}:request:${sourceVersionId}`;
const correlationId = slug(`${jiraIssueKey || jiraProjectKey}-${figmaMakeFileKey || 'FIGMA'}-${sourceVersionId}`, 160);
const now = Date.now();
const nowIso = new Date(now).toISOString();
const slackChannelId = clean(body.channel_id || body.slackChannelId || body.slack_channel_id || env('SLACK_CHANNEL_ID'), 100);
const slackThreadTs = clean(body.thread_ts || body.slackThreadTs || body.slack_thread_ts, 100);

const base = {
  ackStatusCode: 200,
  ackText: jiraIssueKey ? `Starting Figma MCP handoff for ${jiraIssueKey}.` : 'Starting Figma MCP handoff.',
  triggerSource: clean(body.triggerSource || body.trigger_source || (body.command ? 'slack' : 'manual'), 80),
  handoffMode: 'mcp_request',
  requestId,
  requestText,
  jiraIssueKey,
  handoffId,
  correlationId,
  figmaMakeFileKey,
  figmaFileName: clean(body.figmaFileName || body.figma_file_name || 'Figma Make MCP source', 500),
  figmaVersionId: sourceVersionId,
  figmaVersionLabel: clean(body.label || body.versionLabel || body.version_label || `${jiraIssueKey || jiraProjectKey} | MCP design request`, 500),
  figmaVersionDescription: clean(body.versionDescription || body.version_description || requestText, 2000),
  figmaVersionCreatedAt: nowIso,
  figmaMakeUrl,
  figmaMakePublishedUrl: clean(body.figmaMakePublishedUrl || body.figma_make_published_url || env('FIGMA_MAKE_PUBLISHED_URL'), 2000),
  slackChannelId,
  slackThreadTs,
};

if (!jiraIssueKey) return failBeforeClaude(base, 'JIRA_KEY_PARSE', `No ${jiraProjectKey}-<number> Jira issue key was found in the request.`);
if (!figmaMakeFileKey) return failBeforeClaude(base, 'FIGMA_SOURCE_RESOLVED', 'No Figma Make file key or Make URL was supplied or configured.');
if (!requestText) return failBeforeClaude(base, 'FIGMA_REQUEST_VALIDATE', 'No design request text was supplied.');

const staticData = $getWorkflowStaticData('global');
staticData.figmaHandoffs = staticData.figmaHandoffs || {};
staticData.figmaDesignMappings = staticData.figmaDesignMappings || {};
pruneHandoffs(staticData.figmaHandoffs, now);

const existing = staticData.figmaHandoffs[handoffId];
if (existing?.status === 'completed') {
  return [
    {
      json: {
        ...base,
        shouldProcess: false,
        requestFailed: false,
        ignored: true,
        ignoreReason: 'duplicate_completed_handoff',
        duplicate: true,
      },
    },
  ];
}

const processingStatuses = new Set(['processing', 'figma_source_resolved', 'claude_started', 'figma_processing']);
if (processingStatuses.has(existing?.status)) {
  const updatedAt = Date.parse(existing.updatedAt || existing.createdAt || '');
  if (Number.isFinite(updatedAt) && now - updatedAt < 4 * 60 * 60 * 1000) {
    return [
      {
        json: {
          ...base,
          shouldProcess: false,
          requestFailed: false,
          ignored: true,
          ignoreReason: 'duplicate_processing_handoff',
          duplicate: true,
        },
      },
    ];
  }
}

if (existing?.status === 'jira_failed' && existing.design?.url) {
  return [
    {
      json: {
        ...base,
        correlationId: existing.correlationId || correlationId,
        shouldProcess: true,
        retryJiraOnly: true,
        requestFailed: false,
        slackChannelId: existing.slack?.channel || base.slackChannelId,
        slackThreadTs: existing.slack?.threadTs || base.slackThreadTs,
        figmaReady: true,
        claudeSuccess: true,
        design: existing.design,
        figmaDesignUrl: existing.design.url,
        figmaDesignFileKey: existing.design.fileKey || '',
        figmaDesignNodeId: existing.design.nodeId || '',
      },
    },
  ];
}

staticData.figmaHandoffs[handoffId] = {
  status: 'processing',
  createdAt: existing?.createdAt || nowIso,
  updatedAt: nowIso,
  correlationId,
  jiraIssueKey,
  requestText,
  triggerSource: base.triggerSource,
  source: {
    figmaMakeFileKey,
    figmaVersionId: sourceVersionId,
    figmaVersionLabel: base.figmaVersionLabel,
    figmaVersionDescription: base.figmaVersionDescription,
  },
};

console.log(JSON.stringify({ stage: 'REQUEST_ACCEPTED', handoffId, correlationId, jiraIssueKey }));

return [{ json: { ...base, shouldProcess: true, retryJiraOnly: false, requestFailed: false, ignored: false } }];
