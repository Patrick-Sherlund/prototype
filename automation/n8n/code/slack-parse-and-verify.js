const crypto = require('crypto');
const env = (name) => $env[name];

function header(headers, name) {
  const match = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return Array.isArray(match?.[1]) ? match[1][0] : match?.[1];
}

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

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function makeCorrelation(issueKey, eventId, ts) {
  const source = `${issueKey}-${eventId || ts || Date.now()}`;
  return source.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function makeStandupCorrelation(eventId, ts) {
  const date = new Date();
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return makeCorrelation(`STANDUP-${stamp}`, eventId, ts);
}

const item = $input.first();
const headers = item.json.headers || {};
const rawBody = rawBodyFrom(item);
const signingSecret = env('SLACK_SIGNING_SECRET');

if (!signingSecret) {
  throw new Error('SLACK_RECEIVED failed: SLACK_SIGNING_SECRET is not configured');
}

const timestamp = header(headers, 'x-slack-request-timestamp');
const signature = header(headers, 'x-slack-signature');
if (!timestamp || !signature) {
  throw new Error('SLACK_RECEIVED failed: missing Slack signature headers');
}

const requestAgeSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
if (!Number.isFinite(requestAgeSeconds) || requestAgeSeconds > 60 * 5) {
  throw new Error('SLACK_RECEIVED failed: stale Slack request timestamp');
}

const expectedSignature =
  'v0=' + crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
if (!safeCompare(expectedSignature, signature)) {
  throw new Error('SLACK_RECEIVED failed: invalid Slack request signature');
}

const body = typeof item.json.body === 'object' && item.json.body !== null ? item.json.body : JSON.parse(rawBody);

if (body.type === 'url_verification') {
  console.log(JSON.stringify({ stage: 'SLACK_RECEIVED', event: 'url_verification' }));
  return [
    {
      json: {
        ackStatusCode: 200,
        ackText: body.challenge,
        shouldProcess: false,
        ignored: true,
        ignoreReason: 'url_verification',
      },
    },
  ];
}

const event = body.event || {};
const retryNum = header(headers, 'x-slack-retry-num');
const configuredChannelId = env('SLACK_CHANNEL_ID');
const text = normalizeText(event.text);
const issueMatch = text.match(/\bSYSCO-\d+\b/i);
const slackThreadTs = event.thread_ts || event.ts;

const base = {
  ackStatusCode: 200,
  ackText: 'ok',
  slackEventId: body.event_id,
  slackChannelId: event.channel,
  slackMessageTs: event.ts,
  slackThreadTs,
  requesterIdentity: event.user || event.username || '',
};

if (retryNum) {
  console.log(JSON.stringify({ stage: 'SLACK_RECEIVED', ignored: true, reason: 'slack_retry', eventId: body.event_id }));
  return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'slack_retry' } }];
}

if (body.type !== 'event_callback' || event.type !== 'message') {
  return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'not_message_event' } }];
}

if (event.bot_id || event.subtype === 'bot_message') {
  return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'bot_message' } }];
}

if (!configuredChannelId || event.channel !== configuredChannelId) {
  return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'wrong_channel' } }];
}

if (!text) {
  return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'empty_message' } }];
}

const standupMatch = text.match(/^(?:STANDUP|(?:MS\s+Teams|Teams|Daily|Sprint)\s+Standup)(?:\s+DRY\s+RUN)?\b/i);
if (standupMatch) {
  const dryRun = /\bDRY\s+RUN\b/i.test(standupMatch[0]);
  const transcript = normalizeText(text.slice(standupMatch[0].length));
  if (!transcript) {
    return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'empty_standup_transcript' } }];
  }

  const correlationId = makeStandupCorrelation(body.event_id, event.ts);
  console.log(
    JSON.stringify({
      stage: 'STANDUP_RECEIVED',
      correlationId,
      dryRun,
      slackChannelId: event.channel,
    }),
  );

  return [
    {
      json: {
        ...base,
        shouldProcess: false,
        standupShouldProcess: true,
        ignored: false,
        standupDryRun: dryRun,
        standupTranscript: transcript,
        correlationId,
      },
    },
  ];
}

const staticData = $getWorkflowStaticData('global');
staticData.seenSlackEvents = staticData.seenSlackEvents || {};
const now = Date.now();
for (const [eventId, seenAt] of Object.entries(staticData.seenSlackEvents)) {
  if (now - Number(seenAt) > 24 * 60 * 60 * 1000) delete staticData.seenSlackEvents[eventId];
}
if (body.event_id && staticData.seenSlackEvents[body.event_id]) {
  return [{ json: { ...base, shouldProcess: false, ignored: true, ignoreReason: 'duplicate_event' } }];
}
if (body.event_id) staticData.seenSlackEvents[body.event_id] = now;

const jiraIssueKey = issueMatch ? issueMatch[0].toUpperCase() : '';
const requestedChange = issueMatch ? normalizeText(text.replace(issueMatch[0], '')).replace(/^[-:\s]+/, '') : text;
const jiraIssueKeyProvided = Boolean(jiraIssueKey);
const preliminaryKey = jiraIssueKey || `${env('JIRA_PROJECT_KEY') || 'SYSCO'}-NEW`;
const correlationId = makeCorrelation(preliminaryKey, body.event_id, event.ts);

console.log(JSON.stringify({ stage: 'SLACK_RECEIVED', correlationId, jiraIssueKey, jiraIssueKeyProvided, slackChannelId: event.channel }));

return [
  {
    json: {
      ...base,
      shouldProcess: true,
      ignored: false,
      jiraIssueKey,
      requestedJiraIssueKey: jiraIssueKey,
      originalJiraIssueKey: jiraIssueKey,
      jiraIssueKeyProvided,
      requestedChange,
      correlationId,
    },
  },
];
