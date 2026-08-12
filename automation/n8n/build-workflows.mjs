import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const code = (name) => readFileSync(join(here, 'code', name), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const codeFiles = [
  'figma-validate-webhook.js',
  'jira-verify-handoff-issue.js',
  'slack-create-handoff-thread.js',
  'slack-post-status.js',
  'figma-resolve-source.js',
  'claude-start-figma-handoff.js',
  'figma-callback-verify.js',
  'jira-record-figma-handoff.js',
  'slack-finalize-handoff.js',
];

function webhookNode(id, name, path, position) {
  return {
    parameters: {
      httpMethod: 'POST',
      path,
      responseMode: 'responseNode',
      options: {
        rawBody: true,
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position,
    webhookId: id,
  };
}

function codeNode(id, name, jsCode, position) {
  return {
    parameters: { jsCode },
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
  };
}

function respondNode(id, name, position) {
  return {
    parameters: {
      respondWith: 'text',
      responseBody: '={{ $json.ackText || "ok" }}',
      options: {
        responseCode: '={{ $json.ackStatusCode || 200 }}',
        responseHeaders: {
          entries: [
            {
              name: 'Content-Type',
              value: 'text/plain; charset=utf-8',
            },
          ],
        },
      },
    },
    id,
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position,
  };
}

function slackStatusNode(id, name, status, position) {
  return codeNode(
    id,
    name,
    `const STATUS = ${JSON.stringify(status, null, 2)};\n${code('slack-post-status.js')}`,
    position,
  );
}

function connectPairs(pairs) {
  const connections = {};
  for (const [from, to] of pairs) {
    connections[from] = connections[from] || { main: [[]] };
    connections[from].main[0].push({ node: to, type: 'main', index: 0 });
  }
  return connections;
}

const figmaMakeDesignHandoff = {
  id: 'figmaMakeDesignHandoff',
  name: 'Figma Make Version to Design Handoff',
  nodes: [
    webhookNode('figma-version-webhook', 'Figma Version Webhook', 'poc/figma/version-update', [0, 0]),
    codeNode('figma-validate-webhook', 'Figma - Validate Webhook', code('figma-validate-webhook.js'), [260, 0]),
    respondNode('respond-to-figma', 'Respond to Figma', [520, 0]),
    codeNode('jira-verify-issue', 'Jira - Verify Handoff Issue', code('jira-verify-handoff-issue.js'), [780, 0]),
    codeNode('slack-create-thread', 'Slack - Create Handoff Thread', code('slack-create-handoff-thread.js'), [1040, 0]),
    slackStatusNode(
      'slack-status-jira-verified',
      'Slack - Jira Verified',
      {
        condition: 'jiraVerified',
        messages: ['\\u2705 Jira issue {{jiraIssueKey}} verified.'],
      },
      [1300, 0],
    ),
    codeNode('figma-resolve-source', 'Figma - Resolve Source', code('figma-resolve-source.js'), [1560, 0]),
    slackStatusNode(
      'slack-status-figma-source',
      'Slack - Figma Source Resolved',
      {
        condition: 'figmaResolved',
        messages: ['\\u2705 Figma Make source resolved.'],
      },
      [1820, 0],
    ),
    slackStatusNode(
      'slack-status-claude-processing',
      'Slack - Claude Figma Processing',
      {
        condition: 'processing',
        messages: [
          '\\u{1F504} Accessing the latest Figma Make prototype.',
          '\\u{1F504} Converting the current prototype into editable Figma Design layers.',
        ],
      },
      [2080, 0],
    ),
    codeNode('local-worker-start-figma', 'Local Worker - Start Figma Handoff', code('claude-start-figma-handoff.js'), [2340, 0]),
    slackStatusNode(
      'slack-status-retry-jira',
      'Slack - Retry Jira Only',
      {
        condition: 'retryJiraOnly',
        messages: [
          '\\u26A0\\uFE0F Figma Design was created successfully, but the Jira update failed.',
          'Retrying Jira without regenerating the design.',
        ],
      },
      [2600, 0],
    ),
    webhookNode('figma-completion-webhook', 'Figma Handoff Completion Webhook', 'poc/figma/handoff/completion', [0, 520]),
    codeNode('figma-verify-callback', 'Figma - Verify Completion Callback', code('figma-callback-verify.js'), [260, 520]),
    respondNode('respond-to-worker', 'Respond to Worker', [520, 520]),
    slackStatusNode(
      'slack-status-figma-created',
      'Slack - Figma Design Created',
      {
        condition: 'figmaReady',
        messages: ['\\u2705 Editable Figma Design created successfully.\\n\\n{{figmaDesignUrl}}'],
      },
      [780, 520],
    ),
    slackStatusNode(
      'slack-status-jira-updating',
      'Slack - Jira Updating',
      {
        condition: 'jiraUpdating',
        messages: ['\\u{1F504} Updating {{jiraIssueKey}} with the new Figma Design.'],
      },
      [1040, 520],
    ),
    codeNode('jira-record-handoff', 'Jira - Record Figma Handoff', code('jira-record-figma-handoff.js'), [1300, 520]),
    codeNode('slack-finalize-handoff', 'Slack - Finalize Handoff', code('slack-finalize-handoff.js'), [1560, 520]),
  ],
  connections: connectPairs([
    ['Figma Version Webhook', 'Figma - Validate Webhook'],
    ['Figma - Validate Webhook', 'Respond to Figma'],
    ['Respond to Figma', 'Jira - Verify Handoff Issue'],
    ['Jira - Verify Handoff Issue', 'Slack - Create Handoff Thread'],
    ['Slack - Create Handoff Thread', 'Slack - Jira Verified'],
    ['Slack - Jira Verified', 'Figma - Resolve Source'],
    ['Figma - Resolve Source', 'Slack - Figma Source Resolved'],
    ['Slack - Figma Source Resolved', 'Slack - Claude Figma Processing'],
    ['Slack - Claude Figma Processing', 'Local Worker - Start Figma Handoff'],
    ['Local Worker - Start Figma Handoff', 'Slack - Retry Jira Only'],
    ['Slack - Retry Jira Only', 'Jira - Record Figma Handoff'],
    ['Figma Handoff Completion Webhook', 'Figma - Verify Completion Callback'],
    ['Figma - Verify Completion Callback', 'Respond to Worker'],
    ['Respond to Worker', 'Slack - Figma Design Created'],
    ['Slack - Figma Design Created', 'Slack - Jira Updating'],
    ['Slack - Jira Updating', 'Jira - Record Figma Handoff'],
    ['Jira - Record Figma Handoff', 'Slack - Finalize Handoff'],
  ]),
  settings: {
    executionOrder: 'v1',
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
  },
  active: false,
  versionId: 'figma-make-design-handoff-v1',
  meta: {
    templateCredsSetupCompleted: true,
  },
};

const outputs = [['figma-make-design-handoff.json', figmaMakeDesignHandoff]];

if (process.argv.includes('--check')) {
  for (const name of codeFiles) {
    new AsyncFunction('$input', '$getWorkflowStaticData', '$env', 'fetch', 'console', 'require', code(name));
    console.log(`Validated code/${name}`);
  }
  for (const [name, workflow] of outputs) {
    JSON.parse(JSON.stringify(workflow));
    console.log(`Validated ${name}`);
  }
} else {
  for (const [name, workflow] of outputs) {
    writeFileSync(join(here, name), `${JSON.stringify(workflow, null, 2)}\n`);
    console.log(`Wrote ${name}`);
  }
}
