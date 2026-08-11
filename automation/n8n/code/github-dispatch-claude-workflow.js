const env = (name) => $env[name];
const https = require('https');
const http = require('http');

function requiredEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
}

function docParagraphs(lines) {
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

async function jiraComment(issueKey, lines) {
  if (!env('JIRA_BASE_URL') || !env('JIRA_AUTH_HEADER')) return;
  await httpRequest(`${env('JIRA_BASE_URL').replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    headers: {
      Authorization: env('JIRA_AUTH_HEADER'),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: docParagraphs(lines) }),
  });
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

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 20)}\n...[truncated]` : text;
}

const input = $input.first().json;
if (!input.shouldProcess || input.requestFailed) return [{ json: input }];

try {
  requiredEnv(['LOCAL_WORKER_URL', 'LOCAL_WORKER_SECRET', 'N8N_WEBHOOK_URL']);

  const callbackBase = env('N8N_WEBHOOK_URL').replace(/\/$/, '');
  const callbackUrl = `${callbackBase}/webhook/poc/github/completion`;
  const workerUrl = `${env('LOCAL_WORKER_URL').replace(/\/$/, '')}/poc/worker/start`;

  const response = await httpRequest(workerUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-poc-worker-secret': env('LOCAL_WORKER_SECRET'),
    },
    body: JSON.stringify({
      jira_issue_key: input.jiraIssueKey,
      original_requested_jira_issue_key: input.originalJiraIssueKey || input.requestedJiraIssueKey || input.jiraIssueKey,
      jira_issue_was_created: Boolean(input.jiraIssueCreated),
      jira_summary: truncate(input.jiraSummary, 900),
      jira_description: truncate(input.jiraDescriptionText, 6000),
      requested_change: truncate(input.requestedChange, 6000),
      slack_channel_id: input.slackChannelId,
      slack_message_ts: input.slackMessageTs,
      slack_thread_ts: input.slackThreadTs,
      requester_identity: input.requesterIdentity || '',
      correlation_id: input.correlationId,
      n8n_callback_url: callbackUrl,
    }),
  });

  const responseText = response.bodyText;
  if (response.status !== 202) {
    throw new Error(`Local Claude worker start failed (${response.status}): ${responseText.slice(0, 600)}`);
  }

  await jiraComment(input.jiraIssueKey, [
    'LOCAL_WORKER_STARTED Claude prototype implementation worker.',
    `Correlation ID: ${input.correlationId}`,
    ...(input.jiraIssueCreated && input.originalJiraIssueKey !== input.jiraIssueKey
      ? [`Original Slack-requested key: ${input.originalJiraIssueKey}`]
      : []),
    `Worker URL: ${env('LOCAL_WORKER_URL')}`,
    'The local worker will callback to n8n with PR, preview, commit, and build details.',
  ]);

  console.log(JSON.stringify({ stage: 'LOCAL_WORKER_STARTED', correlationId: input.correlationId }));

  return [{ json: { ...input, localWorkerStarted: true } }];
} catch (error) {
  const errorMessage = String(error.message || error).slice(0, 900);
  if (input.jiraIssueKey) {
    await jiraComment(input.jiraIssueKey, [
      'LOCAL_WORKER_STARTED failed before Claude could start.',
      `Correlation ID: ${input.correlationId}`,
      `Error: ${errorMessage}`,
    ]).catch(() => {});
  }
  return [{ json: { ...input, requestFailed: true, failureStage: 'LOCAL_WORKER_STARTED', errorMessage } }];
}
