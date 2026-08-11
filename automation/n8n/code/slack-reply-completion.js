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
if (!input.authorized) return [{ json: input }];
if (!env('SLACK_BOT_TOKEN')) throw new Error('SLACK_COMPLETED failed: SLACK_BOT_TOKEN is not configured');

const success = input.status === 'success';
const jiraUrl = input.jira_issue_url || `${env('JIRA_BASE_URL')?.replace(/\/$/, '') || ''}/browse/${input.jira_issue_key}`;
const createdIssueNotice =
  input.jira_issue_was_created && input.original_requested_jira_issue_key && input.original_requested_jira_issue_key !== input.jira_issue_key
    ? `Requested key ${input.original_requested_jira_issue_key} did not exist.\nCreated Jira issue ${input.jira_issue_key} and continued the automation.\n\n`
    : '';
const text = success
  ? `${input.jira_issue_key} prototype update ready\n\n${createdIssueNotice}Prototype: ${input.preview_url}\nPull Request: ${input.pr_url}\nJira: ${jiraUrl}\n\nBuild: ${input.build_result === 'success' ? 'Passed' : input.build_result}\nCorrelation: ${input.correlation_id}`
  : `${input.jira_issue_key} prototype automation failed\n\n${createdIssueNotice}Stage: ${input.stage || 'unknown'}\nRun: ${input.run_url || 'unknown'}\nJira: ${jiraUrl}\nBuild: ${input.build_result || 'failed'}\nCorrelation: ${input.correlation_id}\nError: ${input.error_message || 'Unknown error'}`;

await postSlack(input.slack_channel_id, input.slack_thread_ts || input.slack_message_ts, text);
console.log(JSON.stringify({ stage: 'SLACK_COMPLETED', correlationId: input.correlation_id, status: input.status }));

return [{ json: { ...input, slackReplyOk: true } }];
