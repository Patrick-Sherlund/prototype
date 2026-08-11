const env = (name) => $env[name];
const https = require('https');
const http = require('http');

async function postSlack(channel, threadTs, text) {
  const response = await httpRequest('https://slack.com/api/chat.postMessage', {
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
  const data = response.bodyText ? JSON.parse(response.bodyText) : {};
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error || 'unknown_error'}`);
  return data;
}

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

const input = $input.first().json;
if (!input.requestFailed || !input.slackChannelId || !input.slackThreadTs) return [{ json: input }];

if (!env('SLACK_BOT_TOKEN')) {
  throw new Error('Failure reporting needs SLACK_BOT_TOKEN, but it is not configured');
}

const jiraLine = input.jiraIssueUrl ? `\nJira: ${input.jiraIssueUrl}` : '';
const text = `${input.jiraIssueKey || 'SYSCO request'} prototype automation failed\n\nStage: ${input.failureStage}\nCorrelation: ${input.correlationId || 'unknown'}${jiraLine}\nError: ${input.errorMessage || 'Unknown error'}`;

await postSlack(input.slackChannelId, input.slackThreadTs, text);
console.log(JSON.stringify({ stage: 'SLACK_COMPLETED', outcome: 'request_failure_reported', correlationId: input.correlationId }));

return [{ json: { ...input, slackFailureReported: true } }];
