import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeClaudeFigmaResult, parseJsonObject } from '../claude/figma-handoff.mjs';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function code(name) {
  return readFileSync(join(root, 'automation', 'n8n', 'code', name), 'utf8');
}

function response(status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data || {});
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body;
    },
    async json() {
      return typeof data === 'string' ? JSON.parse(data) : data || {};
    },
  };
}

async function runSource(source, inputJson, options = {}) {
  const fn = new AsyncFunction('$input', '$getWorkflowStaticData', '$env', 'fetch', 'console', 'require', source);
  const item = { json: inputJson };
  const input = { first: () => item };
  const staticData = options.staticData || {};
  const env = {
    FIGMA_WEBHOOK_PASSCODE: 'figma-secret',
    JIRA_PROJECT_KEY: 'SYSCO',
    JIRA_BASE_URL: 'https://jira.example.test',
    JIRA_AUTH_HEADER: 'Basic test',
    SLACK_CHANNEL_ID: 'C0BP62TK3PD',
    SLACK_BOT_TOKEN: 'xoxb-test',
    LOCAL_WORKER_URL: 'http://worker.test',
    LOCAL_WORKER_SECRET: 'worker-secret',
    N8N_WEBHOOK_URL: 'https://n8n.example.test',
    N8N_CALLBACK_SECRET: 'callback-secret',
    ...(options.env || {}),
  };
  const fetchMock = options.fetch || (async () => response(200, { ok: true }));
  return await fn(input, () => staticData, env, fetchMock, console, require);
}

async function runCode(name, inputJson, options = {}) {
  return await runSource(code(name), inputJson, options);
}

async function testWebhookValidation() {
  const staticData = {};
  const body = {
    event_type: 'FILE_VERSION_UPDATE',
    file_key: 'MAKE123',
    file_name: 'Receiving prototype',
    version_id: 'v14',
    label: 'SYSCO-14 | Ready for Design',
    description: '',
    created_at: '2026-08-12T18:00:00Z',
    passcode: 'figma-secret',
  };

  const result = await runCode('figma-validate-webhook.js', { body }, { staticData });
  assert.equal(result[0].json.shouldProcess, true);
  assert.equal(result[0].json.jiraIssueKey, 'SYSCO-14');
  assert.equal(result[0].json.handoffId, 'MAKE123:v14');
  assert.equal(staticData.figmaHandoffs['MAKE123:v14'].status, 'processing');

  const descriptionKey = await runCode(
    'figma-validate-webhook.js',
    { body: { ...body, version_id: 'v42', label: 'Ready for Design', description: 'handoff for sysco-42', passcode: 'figma-secret' } },
    { staticData: {} },
  );
  assert.equal(descriptionKey[0].json.jiraIssueKey, 'SYSCO-42');

  const badSecret = await runCode('figma-validate-webhook.js', { body: { ...body, passcode: 'wrong' } }, { staticData: {} });
  assert.equal(badSecret[0].json.ackStatusCode, 403);
  assert.equal(badSecret[0].json.shouldProcess, false);

  const wrongEvent = await runCode('figma-validate-webhook.js', { body: { ...body, event_type: 'FILE_UPDATE' } }, { staticData: {} });
  assert.equal(wrongEvent[0].json.ignored, true);
  assert.equal(wrongEvent[0].json.ignoreReason, 'wrong_event_type');

  const noKey = await runCode('figma-validate-webhook.js', { body: { ...body, label: 'Ready', description: '' } }, { staticData: {} });
  assert.equal(noKey[0].json.requestFailed, true);
  assert.equal(noKey[0].json.failureStage, 'JIRA_KEY_PARSE');
}

async function testIdempotencyAndRetry() {
  const completedData = {
    figmaHandoffs: {
      'MAKE123:v1': {
        status: 'completed',
        updatedAt: new Date().toISOString(),
      },
    },
  };
  const duplicate = await runCode(
    'figma-validate-webhook.js',
    {
      body: {
        event_type: 'FILE_VERSION_UPDATE',
        file_key: 'MAKE123',
        version_id: 'v1',
        label: 'SYSCO-1 | Ready for Design',
        passcode: 'figma-secret',
      },
    },
    { staticData: completedData },
  );
  assert.equal(duplicate[0].json.shouldProcess, false);
  assert.equal(duplicate[0].json.ignoreReason, 'duplicate_completed_handoff');

  const retryData = {
    figmaHandoffs: {
      'MAKE123:v2': {
        status: 'jira_failed',
        correlationId: 'SYSCO-1-MAKE123-V2',
        updatedAt: new Date().toISOString(),
        design: { url: 'https://www.figma.com/design/DESIGN1', fileKey: 'DESIGN1', nodeId: '1:2' },
        slack: { channel: 'C0BP62TK3PD', threadTs: '1710000000.000100' },
      },
    },
  };
  const retry = await runCode(
    'figma-validate-webhook.js',
    {
      body: {
        event_type: 'FILE_VERSION_UPDATE',
        file_key: 'MAKE123',
        version_id: 'v2',
        label: 'SYSCO-1 | Ready for Design',
        passcode: 'figma-secret',
      },
    },
    { staticData: retryData },
  );
  assert.equal(retry[0].json.retryJiraOnly, true);
  assert.equal(retry[0].json.figmaReady, true);
  assert.equal(retry[0].json.slackThreadTs, '1710000000.000100');
}

async function testSlackThreadPropagation() {
  const calls = [];
  const fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return response(200, { ok: true, ts: calls.length === 1 ? '1710000000.000001' : `1710000000.00000${calls.length}` });
  };

  const parent = await runCode(
    'slack-create-handoff-thread.js',
    {
      shouldProcess: true,
      jiraOk: true,
      jiraIssueKey: 'SYSCO-14',
      figmaVersionLabel: 'SYSCO-14 | Ready for Design',
      slackChannelId: 'C0BP62TK3PD',
      correlationId: 'SYSCO-14-MAKE-V1',
      handoffId: 'MAKE:v1',
    },
    { staticData: {}, fetch },
  );
  assert.equal(parent[0].json.slackThreadTs, '1710000000.000001');
  assert.equal(calls[0].channel, 'C0BP62TK3PD');
  assert.equal(calls[0].thread_ts, undefined);
  assert.match(calls[0].text, /Figma design handoff started for SYSCO-14/);

  const statusSource =
    'const STATUS = {"condition":"jiraVerified","messages":["Jira issue {{jiraIssueKey}} verified."]};\n' +
    code('slack-post-status.js');
  await runSource(
    statusSource,
    {
      ...parent[0].json,
      jiraOk: true,
    },
    { fetch },
  );
  assert.equal(calls[1].thread_ts, '1710000000.000001');
  assert.equal(calls[1].text, 'Jira issue SYSCO-14 verified.');
}

async function testCallbackAndDestinationMapping() {
  const callback = await runCode('figma-callback-verify.js', {
    headers: { 'x-poc-callback-secret': 'callback-secret' },
    body: {
      success: true,
      jiraKey: 'SYSCO-14',
      correlationId: 'SYSCO-14-MAKE-V1',
      handoffId: 'MAKE:v1',
      slack_channel_id: 'C0BP62TK3PD',
      slack_thread_ts: '1710000000.000001',
      source: {
        figmaMakeFileKey: 'MAKE',
        figmaVersionId: 'v1',
        figmaVersionLabel: 'SYSCO-14 | Ready for Design',
      },
      design: {
        url: 'https://www.figma.com/design/DESIGN14',
        fileKey: 'DESIGN14',
        nodeId: '10:20',
      },
    },
  });
  assert.equal(callback[0].json.figmaReady, true);
  assert.equal(callback[0].json.figmaDesignUrl, 'https://www.figma.com/design/DESIGN14');

  const staticData = {
    figmaDesignMappings: {
      'SYSCO-14': {
        figmaDesignFileKey: 'DESIGN14',
        figmaDesignUrl: 'https://www.figma.com/design/DESIGN14',
      },
    },
  };
  const resolved = await runCode(
    'figma-resolve-source.js',
    {
      shouldProcess: true,
      jiraIssueKey: 'SYSCO-14',
      handoffId: 'MAKE:v2',
      figmaMakeFileKey: 'MAKE',
      figmaVersionId: 'v2',
    },
    { staticData },
  );
  assert.equal(resolved[0].json.figmaDestinationFromMapping, true);
  assert.equal(resolved[0].json.figmaDestinationFileKey, 'DESIGN14');
}

async function testClaudeJsonParsing() {
  const parsed = parseJsonObject('```json\n{"success":true,"design":{"url":"https://www.figma.com/design/ABC"}}\n```');
  assert.equal(parsed.success, true);

  const normalized = normalizeClaudeFigmaResult(
    '{"success":true,"jiraKey":"SYSCO-14","source":{"figmaMakeFileKey":"MAKE","figmaVersionId":"v1","figmaVersionLabel":"SYSCO-14 | Ready for Design"},"design":{"url":"https://www.figma.com/design/DESIGN14","fileKey":"DESIGN14","nodeId":"1:2"}}',
    {
      jira_key: 'SYSCO-14',
      source: {
        figma_make_file_key: 'MAKE',
        figma_version_id: 'v1',
        figma_version_label: 'SYSCO-14 | Ready for Design',
      },
    },
  );
  assert.equal(normalized.success, true);
  assert.equal(normalized.design.fileKey, 'DESIGN14');

  const failure = normalizeClaudeFigmaResult('{"success":false,"jiraKey":"SYSCO-14","stage":"figma_render","error":"Browser failed"}', {
    jira_key: 'SYSCO-14',
    source: { figma_make_file_key: 'MAKE', figma_version_id: 'v1', figma_version_label: '' },
  });
  assert.equal(failure.stage, 'figma_render');
}

async function testJiraRetryAndPersistence() {
  const staticData = {};
  let commentAttempts = 0;
  const fetch = async (url, options = {}) => {
    if (url.includes('/comment')) {
      commentAttempts += 1;
      if (commentAttempts < 3) return response(500, { error: 'temporary jira failure' });
      return response(201, { id: 'comment-1' });
    }
    if (url.endsWith('/transitions') && (!options.method || options.method === 'GET')) {
      return response(200, { transitions: [{ id: '31', name: 'Ready for Review', to: { name: 'Review' } }] });
    }
    if (url.endsWith('/transitions') && options.method === 'POST') {
      return response(204, '');
    }
    return response(200, {});
  };

  const result = await runCode(
    'jira-record-figma-handoff.js',
    {
      figmaReady: true,
      claudeSuccess: true,
      jiraIssueKey: 'SYSCO-14',
      jiraIssueUrl: 'https://jira.example.test/browse/SYSCO-14',
      handoffId: 'MAKE:v1',
      correlationId: 'SYSCO-14-MAKE-V1',
      figmaMakeFileKey: 'MAKE',
      figmaVersionId: 'v1',
      figmaVersionLabel: 'SYSCO-14 | Ready for Design',
      figmaDesignUrl: 'https://www.figma.com/design/DESIGN14',
      figmaDesignFileKey: 'DESIGN14',
      slackChannelId: 'C0BP62TK3PD',
      slackThreadTs: '1710000000.000001',
    },
    { staticData, fetch },
  );

  assert.equal(commentAttempts, 3);
  assert.equal(result[0].json.jiraUpdated, true);
  assert.equal(staticData.figmaDesignMappings['SYSCO-14'].figmaDesignFileKey, 'DESIGN14');
  assert.equal(staticData.figmaHandoffs['MAKE:v1'].status, 'completed');
}

await testWebhookValidation();
await testIdempotencyAndRetry();
await testSlackThreadPropagation();
await testCallbackAndDestinationMapping();
await testClaudeJsonParsing();
await testJiraRetryAndPersistence();

console.log('figma handoff tests passed');
