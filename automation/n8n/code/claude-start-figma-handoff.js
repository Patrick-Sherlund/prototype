const env = (name) => $env[name];
const https = require('https');
const http = require('http');

function requiredEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
}

function clean(value, max = 6000) {
  return String(value || '').trim().slice(0, max);
}

function markHandoff(input, patch) {
  if (!input.handoffId) return;
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  staticData.figmaHandoffs[input.handoffId] = {
    ...(staticData.figmaHandoffs[input.handoffId] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

async function postWorker(url, payload) {
  const response = await httpRequest(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-poc-worker-secret': env('LOCAL_WORKER_SECRET'),
    },
    body: JSON.stringify(payload),
  });
  const text = response.bodyText;
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 600) };
    }
  }
  if (response.status !== 202) {
    throw new Error(`Local Claude worker start failed (${response.status}): ${text.slice(0, 700)}`);
  }
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

const input = $input.first().json;
if (input.requestFailed || (!input.shouldProcess && !input.retryJiraOnly)) return [{ json: input }];

if (input.retryJiraOnly) {
  return [
    {
      json: {
        ...input,
        figmaReady: true,
        claudeSuccess: true,
        figmaDesignUrl: input.figmaDesignUrl || input.design?.url || '',
        figmaDesignFileKey: input.figmaDesignFileKey || input.design?.fileKey || '',
        figmaDesignNodeId: input.figmaDesignNodeId || input.design?.nodeId || '',
      },
    },
  ];
}

try {
  requiredEnv(['LOCAL_WORKER_URL', 'LOCAL_WORKER_SECRET', 'N8N_WEBHOOK_URL']);
  const callbackBase = env('N8N_WEBHOOK_URL').replace(/\/$/, '');
  const callbackUrl = `${callbackBase}/webhook/poc/figma/handoff/completion`;
  const workerUrl = `${env('LOCAL_WORKER_URL').replace(/\/$/, '')}/poc/figma/handoff/start`;

  const payload = {
    jira_key: input.jiraIssueKey,
    jira_summary: clean(input.jiraSummary, 1000),
    jira_description: clean(input.jiraDescriptionText, 6000),
    request_text: clean(input.requestText || input.figmaVersionDescription || '', 3000),
    trigger_source: clean(input.triggerSource || input.handoffMode || '', 100),
    jira_url: input.jiraIssueUrl,
    correlation_id: input.correlationId,
    handoff_id: input.handoffId,
    n8n_callback_url: callbackUrl,
    slack_channel_id: input.slackChannelId || env('SLACK_CHANNEL_ID') || '',
    slack_thread_ts: input.slackThreadTs || '',
    source: {
      figma_make_file_key: input.figmaMakeFileKey,
      figma_file_name: input.figmaFileName,
      figma_version_id: input.figmaVersionId,
      figma_version_label: input.figmaVersionLabel,
      figma_version_description: input.figmaVersionDescription,
      figma_version_created_at: input.figmaVersionCreatedAt,
      figma_make_url: input.figmaMakeUrl || '',
      figma_make_published_url: input.figmaMakePublishedUrl || '',
    },
    destination: {
      figma_design_file_key: input.figmaDestinationFileKey || '',
      figma_design_url: input.figmaDestinationUrl || '',
    },
  };

  const worker = await postWorker(workerUrl, payload);
  markHandoff(input, {
    status: 'claude_started',
    worker,
    slack: {
      channel: payload.slack_channel_id,
      threadTs: payload.slack_thread_ts,
    },
  });

  console.log(JSON.stringify({ stage: 'CLAUDE_STARTED', correlationId: input.correlationId, handoffId: input.handoffId }));

  return [{ json: { ...input, workerStarted: true, worker } }];
} catch (error) {
  const errorMessage = String(error.message || error).slice(0, 900);
  markHandoff(input, {
    status: 'failed',
    failureStage: 'CLAUDE_STARTED',
    errorMessage,
  });
  return [
    {
      json: {
        ...input,
        requestFailed: true,
        failureStage: 'CLAUDE_STARTED',
        errorMessage,
      },
    },
  ];
}
