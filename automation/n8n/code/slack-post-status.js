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
  if (typeof fetch === 'function') {
    const response = await fetch(url, options);
    return {
      status: response.status,
      ok: response.ok,
      bodyText: await response.text(),
    };
  }

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

function conditionMatches(condition, input) {
  if (input.requestFailed && !['failure'].includes(condition)) return false;
  if (condition === 'jiraVerified') return Boolean(input.jiraOk && !input.retryJiraOnly);
  if (condition === 'figmaResolved') return Boolean(input.figmaSourceResolved && !input.retryJiraOnly);
  if (condition === 'processing') return Boolean(input.figmaSourceResolved && !input.retryJiraOnly && !input.workerStarted);
  if (condition === 'figmaReady') return Boolean(input.figmaReady && input.claudeSuccess);
  if (condition === 'jiraUpdating') return Boolean(input.figmaReady && input.claudeSuccess);
  if (condition === 'retryJiraOnly') return Boolean(input.retryJiraOnly && input.figmaReady);
  return false;
}

function replacementMap(input) {
  return {
    jiraIssueKey: input.jiraIssueKey || '',
    jiraIssueUrl: input.jiraIssueUrl || '',
    figmaDesignUrl: input.figmaDesignUrl || input.design?.url || '',
    figmaVersionLabel: input.figmaVersionLabel || '',
    figmaMakeFileKey: input.figmaMakeFileKey || '',
    figmaVersionId: input.figmaVersionId || '',
    failureStage: input.failureStage || input.stage || '',
    errorMessage: input.errorMessage || '',
    correlationId: input.correlationId || '',
  };
}

function render(template, input) {
  const map = replacementMap(input);
  return String(template || '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key) => map[key] || '');
}

const input = $input.first().json;
const status = typeof STATUS === 'object' && STATUS ? STATUS : input.slackStatus || {};
if (!conditionMatches(status.condition, input)) return [{ json: input }];

const channel = input.slackChannelId || env('SLACK_CHANNEL_ID');
const threadTs = input.slackThreadTs;
if (!env('SLACK_BOT_TOKEN') || !channel || !threadTs) {
  console.log(JSON.stringify({ stage: 'SLACK_STATUS_SKIPPED', correlationId: input.correlationId, condition: status.condition }));
  return [{ json: { ...input, slackStatusSkipped: true } }];
}

const messages = Array.isArray(status.messages) ? status.messages : [status.message].filter(Boolean);
const posted = [];
for (const template of messages) {
  const text = render(template, input).trim();
  if (!text) continue;
  try {
    const message = await postSlack(channel, threadTs, text);
    posted.push({ ts: message.ts || '', text });
  } catch (error) {
    const errorMessage = String(error.message || error).slice(0, 700);
    console.log(JSON.stringify({ stage: 'SLACK_STATUS_FAILED', correlationId: input.correlationId, condition: status.condition, error: errorMessage }));
    return [{ json: { ...input, slackStatusOk: false, slackStatusError: errorMessage } }];
  }
}

if (posted.length) {
  console.log(JSON.stringify({ stage: 'SLACK_STATUS_POSTED', correlationId: input.correlationId, condition: status.condition, count: posted.length }));
}

return [{ json: { ...input, slackStatusOk: true, slackStatusPosted: [...(input.slackStatusPosted || []), ...posted] } }];
