const env = (name) => $env[name];
const https = require('https');
const http = require('http');

async function httpRequest(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body || '';
  const headers = { ...(options.headers || {}) };
  if (body && !headers['Content-Length']) headers['Content-Length'] = Buffer.byteLength(body);
  const client = url.startsWith('https:') ? https : http;

  return await new Promise((resolve, reject) => {
    const request = client.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const status = response.statusCode || 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: response.headers,
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error(`HTTP ${method} ${url} timed out`)));
    if (body) request.write(body);
    request.end();
  });
}

async function postSlack(channel, threadTs, text) {
  if (!env('SLACK_BOT_TOKEN')) return;
  await httpRequest('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('SLACK_BOT_TOKEN')}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
      text,
    }),
  });
}

const input = $input.first().json;
if (!input.standupShouldProcess) return [{ json: input }];

try {
  const secret = env('STANDUP_INTERNAL_SECRET') || env('LOCAL_WORKER_SECRET');
  if (!secret) throw new Error('Missing STANDUP_INTERNAL_SECRET or LOCAL_WORKER_SECRET');

  const workflowUrl = env('STANDUP_WORKFLOW_URL') || 'http://127.0.0.1:5678/webhook/poc/standup/jira';
  const response = await httpRequest(workflowUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-poc-standup-secret': secret,
    },
    body: JSON.stringify({
      correlation_id: input.correlationId,
      dry_run: Boolean(input.standupDryRun),
      transcript: input.standupTranscript,
      slack_channel_id: input.slackChannelId,
      slack_message_ts: input.slackMessageTs,
      slack_thread_ts: input.slackThreadTs,
      requester_identity: input.requesterIdentity || '',
      slack_event_id: input.slackEventId || '',
    }),
  });

  if (!response.ok) {
    throw new Error(`Standup workflow dispatch failed (${response.status}): ${response.bodyText.slice(0, 600)}`);
  }

  console.log(JSON.stringify({ stage: 'STANDUP_RECEIVED', outcome: 'dispatched', correlationId: input.correlationId }));
  return [{ json: { ...input, standupDispatched: true } }];
} catch (error) {
  const message = String(error.message || error).slice(0, 900);
  await postSlack(
    input.slackChannelId,
    input.slackThreadTs,
    `Standup Jira automation failed before analysis.\n\nStage: STANDUP_RECEIVED\nCorrelation: ${input.correlationId}\nError: ${message}`,
  ).catch(() => {});
  return [{ json: { ...input, standupDispatched: false, standupDispatchError: message } }];
}
