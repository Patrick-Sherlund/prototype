const crypto = require('crypto');

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
const expectedSecret = process.env.N8N_CALLBACK_SECRET;
const providedSecret = header(item.json.headers, 'x-poc-callback-secret');

if (!expectedSecret) {
  throw new Error('CALLBACK_RECEIVED failed: N8N_CALLBACK_SECRET is not configured');
}

if (!safeCompare(expectedSecret, providedSecret)) {
  console.log(JSON.stringify({ stage: 'CALLBACK_RECEIVED', authorized: false }));
  return [
    {
      json: {
        authorized: false,
        ackStatusCode: 403,
        ackText: 'forbidden',
      },
    },
  ];
}

const payload = item.json.body || {};
console.log(
  JSON.stringify({
    stage: 'CALLBACK_RECEIVED',
    authorized: true,
    correlationId: payload.correlation_id,
    jiraIssueKey: payload.jira_issue_key,
    status: payload.status,
  }),
);

return [
  {
    json: {
      authorized: true,
      ackStatusCode: 202,
      ackText: 'accepted',
      ...payload,
    },
  },
];
