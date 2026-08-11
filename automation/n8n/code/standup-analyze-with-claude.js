const env = (name) => $env[name];
const https = require('https');
const http = require('http');

function requiredEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
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
    request.setTimeout(Number(env('STANDUP_ANALYSIS_HTTP_TIMEOUT_MS') || 240000), () =>
      request.destroy(new Error(`HTTP ${method} ${url} timed out`)),
    );
    if (body) request.write(body);
    request.end();
  });
}

const input = $input.first().json;
if (!input.authorized) return [{ json: input }];

try {
  requiredEnv(['LOCAL_WORKER_URL', 'LOCAL_WORKER_SECRET']);
  if (!input.transcript.trim()) throw new Error('Transcript is empty');

  const workerUrl = `${env('LOCAL_WORKER_URL').replace(/\/$/, '')}/poc/standup/analyze`;
  const response = await httpRequest(workerUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-poc-worker-secret': env('LOCAL_WORKER_SECRET'),
    },
    body: JSON.stringify({
      correlation_id: input.correlationId,
      dry_run: input.dryRun,
      transcript: input.transcript,
      slack_channel_id: input.slackChannelId,
      slack_message_ts: input.slackMessageTs,
      slack_thread_ts: input.slackThreadTs,
      requester_identity: input.requesterIdentity,
    }),
  });

  if (!response.ok) {
    throw new Error(`Local standup analyzer failed (${response.status}): ${response.bodyText.slice(0, 900)}`);
  }

  const analysis = response.bodyText ? JSON.parse(response.bodyText) : {};
  console.log(
    JSON.stringify({
      stage: 'TRANSCRIPT_PARSED',
      correlationId: input.correlationId,
      issueCount: Array.isArray(analysis.issues) ? analysis.issues.length : 0,
    }),
  );

  return [{ json: { ...input, analysis } }];
} catch (error) {
  return [
    {
      json: {
        ...input,
        standupFailed: true,
        failureStage: 'TRANSCRIPT_PARSED',
        errorMessage: String(error.message || error).slice(0, 1200),
      },
    },
  ];
}
