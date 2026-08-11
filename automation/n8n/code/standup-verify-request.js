const crypto = require('crypto');
const env = (name) => $env[name];

function header(headers, name) {
  const match = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return Array.isArray(match?.[1]) ? match[1][0] : match?.[1];
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const item = $input.first();
const expectedSecret = env('STANDUP_INTERNAL_SECRET') || env('LOCAL_WORKER_SECRET');
const providedSecret = header(item.json.headers, 'x-poc-standup-secret');

if (!expectedSecret) {
  throw new Error('STANDUP_RECEIVED failed: STANDUP_INTERNAL_SECRET or LOCAL_WORKER_SECRET is not configured');
}

if (!safeCompare(expectedSecret, providedSecret)) {
  console.log(JSON.stringify({ stage: 'STANDUP_RECEIVED', authorized: false }));
  return [{ json: { authorized: false, ackStatusCode: 403, ackText: 'forbidden' } }];
}

const payload = item.json.body || {};
console.log(
  JSON.stringify({
    stage: 'STANDUP_RECEIVED',
    authorized: true,
    correlationId: payload.correlation_id,
    dryRun: Boolean(payload.dry_run),
  }),
);

return [
  {
    json: {
      authorized: true,
      ackStatusCode: 202,
      ackText: 'accepted',
      correlationId: String(payload.correlation_id || ''),
      dryRun: Boolean(payload.dry_run),
      transcript: String(payload.transcript || ''),
      slackChannelId: String(payload.slack_channel_id || ''),
      slackMessageTs: String(payload.slack_message_ts || ''),
      slackThreadTs: String(payload.slack_thread_ts || ''),
      requesterIdentity: String(payload.requester_identity || ''),
      slackEventId: String(payload.slack_event_id || ''),
    },
  },
];
