const env = (name) => $env[name];
const https = require('https');
const http = require('http');

async function postSlack(payload) {
  const response = await httpRequest('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('SLACK_BOT_TOKEN')}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      unfurl_links: false,
      unfurl_media: false,
      ...payload,
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

function safeText(value, fallback = '') {
  const text = String(value || fallback || '').trim();
  return text || fallback;
}

function stageLabel(stage) {
  const labels = {
    JIRA_KEY_PARSE: 'Jira key parsing',
    FIGMA_WEBHOOK_VALIDATE: 'Figma webhook validation',
    FIGMA_REQUEST_VALIDATE: 'Figma request validation',
    FIGMA_SOURCE_RESOLVED: 'Figma Make source',
    JIRA_VALIDATED: 'Jira issue validation',
    CLAUDE_STARTED: 'Claude Code handoff start',
    figma_capture: 'Figma Design capture',
    figma_render: 'Figma Make render',
    figma_view_discovery: 'Figma Make view discovery',
    figma_canonical_file: 'Canonical Figma Design file',
    generate_figma_design: 'Editable Figma Design generation',
    JIRA_COMPLETED: 'Jira update',
  };
  return labels[stage] || stage || 'Unknown';
}

function markSlack(input, patch) {
  if (!input.handoffId) return;
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  staticData.figmaHandoffs[input.handoffId] = {
    ...(staticData.figmaHandoffs[input.handoffId] || {}),
    slack: {
      ...(staticData.figmaHandoffs[input.handoffId]?.slack || {}),
      ...patch,
    },
    updatedAt: new Date().toISOString(),
  };
}

const input = $input.first().json;
if ((!input.shouldProcess && !input.requestFailed && !input.retryJiraOnly) || input.ignored) return [{ json: input }];

const channel = input.slackChannelId || env('SLACK_CHANNEL_ID');
if (!env('SLACK_BOT_TOKEN') || !channel) {
  console.log(JSON.stringify({ stage: 'SLACK_PARENT_SKIPPED', correlationId: input.correlationId, reason: 'missing_slack_config' }));
  return [{ json: { ...input, slackParentOk: false, slackError: 'Slack bot token or channel is not configured.' } }];
}

if (input.slackThreadTs) {
  markSlack(input, { channel, threadTs: input.slackThreadTs });
  return [{ json: { ...input, slackChannelId: channel, slackParentOk: true } }];
}

const sourceLabel = safeText(input.figmaVersionLabel, `${input.jiraIssueKey || 'Figma'} version`);
const requestText = safeText(input.requestText, '');
const sourceUrl = safeText(input.figmaMakeUrl, '');
const text = input.requestFailed
  ? [
      `Design handoff failed for ${input.jiraIssueKey || 'Figma version'}`,
      '',
      'Failed stage:',
      stageLabel(input.failureStage),
      '',
      input.figmaReady ? 'The generated Figma Design has been preserved.' : 'Jira was not modified.',
      '',
      'Check the workflow execution for details.',
    ].join('\n')
  : [
      `\u{1F3A8} Figma Make sync started for ${input.jiraIssueKey}`,
      '',
      requestText ? 'Request:' : '',
      requestText,
      requestText ? '' : '',
      'Source:',
      sourceLabel,
      sourceUrl,
      '',
      'The automation is using Figma MCP to discover the full Make prototype and synchronize its user-facing views into one canonical editable Figma Design file.',
    ].join('\n');

try {
  const message = await postSlack({ channel, text });
  const threadTs = message.ts || '';
  markSlack(input, { channel, threadTs });
  console.log(JSON.stringify({ stage: 'SLACK_PARENT_CREATED', correlationId: input.correlationId, channel, hasThreadTs: Boolean(threadTs) }));
  return [
    {
      json: {
        ...input,
        slackChannelId: channel,
        slackThreadTs: threadTs,
        slackParentOk: true,
        failureAlreadyPosted: Boolean(input.requestFailed),
      },
    },
  ];
} catch (error) {
  const errorMessage = String(error.message || error).slice(0, 700);
  console.log(JSON.stringify({ stage: 'SLACK_PARENT_FAILED', correlationId: input.correlationId, error: errorMessage }));
  return [{ json: { ...input, slackChannelId: channel, slackParentOk: false, slackError: errorMessage } }];
}
