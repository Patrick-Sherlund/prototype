const crypto = require('crypto');
const env = (name) => $env[name];

function rawBodyFrom(item) {
  const encoded = item.binary?.data?.data;
  if (encoded) return Buffer.from(encoded, 'base64').toString('utf8');
  const body = item.json.body;
  return typeof body === 'string' ? body : JSON.stringify(body || {});
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseBody(item, rawBody) {
  if (typeof item.json.body === 'object' && item.json.body !== null) return item.json.body;
  return JSON.parse(rawBody || '{}');
}

function clean(value, max = 1000) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

function makeCorrelation(jiraKey, fileKey, versionId) {
  const source = `${jiraKey}-${fileKey}-${versionId}`;
  return source.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 160);
}

function pruneHandoffs(handoffs, now) {
  const ttlMs = 30 * 24 * 60 * 60 * 1000;
  for (const [key, record] of Object.entries(handoffs)) {
    const updatedAt = Date.parse(record.updatedAt || record.createdAt || '');
    if (Number.isFinite(updatedAt) && now - updatedAt > ttlMs) delete handoffs[key];
  }
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

const item = $input.first();
const rawBody = rawBodyFrom(item);
let body;
try {
  body = parseBody(item, rawBody);
} catch (error) {
  return [
    {
      json: {
        ackStatusCode: 400,
        ackText: 'invalid json',
        shouldProcess: false,
        requestFailed: false,
        ignored: true,
        ignoreReason: 'invalid_json',
      },
    },
  ];
}

const configuredPasscode = env('FIGMA_WEBHOOK_PASSCODE');
if (!configuredPasscode) {
  return [
    {
      json: {
        ackStatusCode: 500,
        ackText: 'figma webhook passcode is not configured',
        shouldProcess: false,
        requestFailed: false,
        ignored: true,
        ignoreReason: 'missing_figma_webhook_passcode',
      },
    },
  ];
}

if (!safeCompare(configuredPasscode, body.passcode)) {
  console.log(JSON.stringify({ stage: 'FIGMA_WEBHOOK_REJECTED', reason: 'invalid_passcode' }));
  return [
    {
      json: {
        ackStatusCode: 403,
        ackText: 'forbidden',
        shouldProcess: false,
        requestFailed: false,
        ignored: true,
        ignoreReason: 'invalid_passcode',
      },
    },
  ];
}

if (body.event_type === 'PING') {
  console.log(JSON.stringify({ stage: 'FIGMA_WEBHOOK_RECEIVED', eventType: 'PING', accepted: false }));
  return [
    {
      json: {
        ackStatusCode: 200,
        ackText: 'ok',
        shouldProcess: false,
        requestFailed: false,
        ignored: true,
        ignoreReason: 'ping',
      },
    },
  ];
}

const base = {
  ackStatusCode: 200,
  ackText: 'ok',
  eventType: clean(body.event_type, 80),
  figmaMakeFileKey: clean(body.file_key, 200),
  figmaFileName: clean(body.file_name, 500),
  figmaVersionId: clean(body.version_id, 200),
  figmaVersionLabel: clean(body.label, 500),
  figmaVersionDescription: clean(body.description, 2000),
  figmaVersionCreatedAt: clean(body.created_at || body.timestamp, 100),
  figmaWebhookTimestamp: clean(body.timestamp, 100),
  figmaWebhookId: clean(body.webhook_id, 100),
  figmaTriggeredBy: body.triggered_by || null,
  slackChannelId: env('SLACK_CHANNEL_ID') || '',
};

console.log(
  JSON.stringify({
    stage: 'FIGMA_WEBHOOK_RECEIVED',
    eventType: base.eventType,
    fileKey: base.figmaMakeFileKey,
    versionId: base.figmaVersionId,
  }),
);

if (base.eventType !== 'FILE_VERSION_UPDATE') {
  return [{ json: { ...base, shouldProcess: false, requestFailed: false, ignored: true, ignoreReason: 'wrong_event_type' } }];
}

if (!base.figmaMakeFileKey || !base.figmaVersionId) {
  return failBeforeClaude(base, 'FIGMA_WEBHOOK_VALIDATE', 'Figma FILE_VERSION_UPDATE payload is missing file_key or version_id.');
}

const jiraProjectKey = env('JIRA_PROJECT_KEY') || 'SYSCO';
const issuePattern = new RegExp(`\\b${jiraProjectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\b`, 'i');
const versionText = `${base.figmaVersionLabel}\n${base.figmaVersionDescription}`;
const issueMatch = versionText.match(issuePattern);
if (!issueMatch) {
  return failBeforeClaude(
    base,
    'JIRA_KEY_PARSE',
    `No ${jiraProjectKey}-<number> Jira issue key was found in the Figma version label or description.`,
  );
}

const jiraIssueKey = issueMatch[0].toUpperCase();
const handoffId = `${base.figmaMakeFileKey}:${base.figmaVersionId}`;
const correlationId = makeCorrelation(jiraIssueKey, base.figmaMakeFileKey, base.figmaVersionId);
const now = Date.now();
const nowIso = new Date(now).toISOString();
const staticData = $getWorkflowStaticData('global');
staticData.figmaHandoffs = staticData.figmaHandoffs || {};
staticData.figmaDesignMappings = staticData.figmaDesignMappings || {};
pruneHandoffs(staticData.figmaHandoffs, now);

const existing = staticData.figmaHandoffs[handoffId];
if (existing?.status === 'completed') {
  console.log(JSON.stringify({ stage: 'FIGMA_VERSION_DUPLICATE', handoffId, status: existing.status, correlationId }));
  return [
    {
      json: {
        ...base,
        jiraIssueKey,
        handoffId,
        correlationId,
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
    console.log(JSON.stringify({ stage: 'FIGMA_VERSION_DUPLICATE', handoffId, status: existing.status, correlationId }));
    return [
      {
        json: {
          ...base,
          jiraIssueKey,
          handoffId,
          correlationId,
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
  console.log(JSON.stringify({ stage: 'FIGMA_VERSION_RETRY_JIRA', handoffId, correlationId }));
  return [
    {
      json: {
        ...base,
        jiraIssueKey,
        handoffId,
        correlationId: existing.correlationId || correlationId,
        shouldProcess: true,
        retryJiraOnly: true,
        requestFailed: false,
        slackChannelId: existing.slack?.channel || base.slackChannelId,
        slackThreadTs: existing.slack?.threadTs || '',
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
  source: {
    figmaMakeFileKey: base.figmaMakeFileKey,
    figmaVersionId: base.figmaVersionId,
    figmaVersionLabel: base.figmaVersionLabel,
    figmaVersionDescription: base.figmaVersionDescription,
  },
};

console.log(JSON.stringify({ stage: 'VERSION_ACCEPTED', handoffId, correlationId, jiraIssueKey }));

return [
  {
    json: {
      ...base,
      jiraIssueKey,
      handoffId,
      correlationId,
      shouldProcess: true,
      retryJiraOnly: false,
      requestFailed: false,
      ignored: false,
    },
  },
];
