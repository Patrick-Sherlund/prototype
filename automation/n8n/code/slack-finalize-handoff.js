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

function stageLabel(stage) {
  const labels = {
    JIRA_KEY_PARSE: 'Jira key parsing',
    FIGMA_WEBHOOK_VALIDATE: 'Figma webhook validation',
    FIGMA_REQUEST_VALIDATE: 'Figma request validation',
    FIGMA_SOURCE_RESOLVED: 'Figma Make source',
    JIRA_VALIDATED: 'Jira issue validation',
    CLAUDE_STARTED: 'Claude Code handoff start',
    figma_mcp_auth: 'Figma MCP authentication',
    figma_make_context: 'Figma Make context',
    figma_render: 'Figma Make render',
    figma_capture: 'Figma Design capture',
    generate_figma_design: 'Editable Figma Design generation',
    JIRA_COMPLETED: 'Jira update',
  };
  return labels[stage] || stage || 'Unknown';
}

function finalText(input) {
  const issueKey = input.jiraIssueKey || 'Figma version';
  const jiraUrl = input.jiraIssueUrl || `${env('JIRA_BASE_URL')?.replace(/\/$/, '') || ''}/browse/${issueKey}`;
  const figmaUrl = input.figmaDesignUrl || input.design?.url || '';
  const versionLabel = input.figmaVersionLabel || `${input.figmaMakeFileKey || 'Figma Make'} ${input.figmaVersionId || ''}`.trim();
  const requestText = input.requestText || input.figmaVersionDescription || '';
  const makeUrl = input.figmaMakeUrl || '';

  if (input.requestFailed) {
    if (input.failureStage === 'JIRA_COMPLETED' && figmaUrl) {
      return [
        `Design handoff failed for ${issueKey}`,
        '',
        'Failed stage:',
        stageLabel(input.failureStage),
        '',
        'Jira update failed.',
        '',
        'Figma Design:',
        figmaUrl,
        '',
        'The generated design has been preserved. Retry the same Figma version to update Jira without regenerating the design.',
      ].join('\n');
    }

    return [
      `Design handoff failed for ${issueKey}`,
      '',
      'Failed stage:',
      stageLabel(input.failureStage),
      '',
      input.figmaReady ? 'The generated Figma Design has been preserved.' : 'Jira was not modified.',
      '',
      'Check the workflow execution for details.',
    ].join('\n');
  }

  if (input.figmaReady && input.jiraUpdated) {
    return [
      `Design handoff complete for ${issueKey}`,
      '',
      'Request:',
      requestText,
      '',
      'Source prototype:',
      makeUrl || versionLabel,
      '',
      'Figma Make version:',
      versionLabel,
      '',
      'Editable Figma Design:',
      figmaUrl,
      '',
      'Jira:',
      jiraUrl,
    ].join('\n');
  }

  return '';
}

function markFinalPosted(input) {
  if (!input.handoffId) return;
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  const existing = staticData.figmaHandoffs[input.handoffId] || {};
  staticData.figmaHandoffs[input.handoffId] = {
    ...existing,
    slack: {
      ...(existing.slack || {}),
      channel: input.slackChannelId || env('SLACK_CHANNEL_ID') || '',
      threadTs: input.slackThreadTs || '',
      finalPostedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

const input = $input.first().json;
if (input.failureAlreadyPosted || input.finalAlreadyPosted) return [{ json: input }];
if (input.workerStarted && !input.requestFailed && !input.figmaReady) return [{ json: input }];

const text = finalText(input);
if (!text) return [{ json: input }];

const channel = input.slackChannelId || env('SLACK_CHANNEL_ID');
const threadTs = input.slackThreadTs;
if (!env('SLACK_BOT_TOKEN') || !channel || !threadTs) {
  console.log(JSON.stringify({ stage: 'SLACK_COMPLETED_SKIPPED', correlationId: input.correlationId, reason: 'missing_thread_or_config' }));
  return [{ json: { ...input, slackFinalOk: false, slackFinalSkipped: true } }];
}

try {
  await postSlack(channel, threadTs, text);
  markFinalPosted(input);
  console.log(JSON.stringify({ stage: 'SLACK_COMPLETED', correlationId: input.correlationId, status: input.requestFailed ? 'failure' : 'success' }));
  return [{ json: { ...input, slackFinalOk: true } }];
} catch (error) {
  const errorMessage = String(error.message || error).slice(0, 700);
  console.log(JSON.stringify({ stage: 'SLACK_COMPLETED_FAILED', correlationId: input.correlationId, error: errorMessage }));
  return [{ json: { ...input, slackFinalOk: false, slackFinalError: errorMessage } }];
}
