import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const code = (name) => readFileSync(join(here, 'code', name), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const codeFiles = [
  'slack-parse-and-verify.js',
  'jira-validate-and-mark-active.js',
  'github-dispatch-claude-workflow.js',
  'slack-report-request-failure.js',
  'github-callback-verify.js',
  'jira-record-completion.js',
  'slack-reply-completion.js',
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

function connect(names) {
  const connections = {};
  for (let index = 0; index < names.length - 1; index += 1) {
    connections[names[index]] = {
      main: [[{ node: names[index + 1], type: 'main', index: 0 }]],
    };
  }
  return connections;
}

const slackRequest = {
  name: 'POC A - Slack Request to Claude Prototype',
  nodes: [
    webhookNode('slack-event-webhook', 'Slack Event Webhook', 'poc/slack/request', [0, 0]),
    codeNode('slack-parse-verify', 'Slack - Parse and Verify', code('slack-parse-and-verify.js'), [260, 0]),
    respondNode('respond-to-slack', 'Respond to Slack', [520, 0]),
    codeNode('jira-validate-active', 'Jira - Validate and Mark Active', code('jira-validate-and-mark-active.js'), [780, 0]),
    codeNode('github-dispatch-claude', 'GitHub - Dispatch Claude Workflow', code('github-dispatch-claude-workflow.js'), [1040, 0]),
    codeNode('slack-report-request-failure', 'Slack - Report Request Failure', code('slack-report-request-failure.js'), [1300, 0]),
  ],
  connections: connect([
    'Slack Event Webhook',
    'Slack - Parse and Verify',
    'Respond to Slack',
    'Jira - Validate and Mark Active',
    'GitHub - Dispatch Claude Workflow',
    'Slack - Report Request Failure',
  ]),
  settings: {
    executionOrder: 'v1',
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
  },
  active: false,
  versionId: 'slack-request-workflow-v1',
  meta: {
    templateCredsSetupCompleted: true,
  },
};

const githubCompletion = {
  name: 'POC B - GitHub Completion to Jira and Slack',
  nodes: [
    webhookNode('github-completion-webhook', 'GitHub Completion Webhook', 'poc/github/completion', [0, 0]),
    codeNode('github-verify-callback', 'GitHub - Verify Callback', code('github-callback-verify.js'), [260, 0]),
    respondNode('respond-to-github', 'Respond to GitHub', [520, 0]),
    codeNode('jira-record-completion', 'Jira - Record Completion', code('jira-record-completion.js'), [780, 0]),
    codeNode('slack-reply-completion', 'Slack - Reply Completion', code('slack-reply-completion.js'), [1040, 0]),
  ],
  connections: connect([
    'GitHub Completion Webhook',
    'GitHub - Verify Callback',
    'Respond to GitHub',
    'Jira - Record Completion',
    'Slack - Reply Completion',
  ]),
  settings: {
    executionOrder: 'v1',
    saveDataSuccessExecution: 'all',
    saveDataErrorExecution: 'all',
  },
  active: false,
  versionId: 'github-completion-workflow-v1',
  meta: {
    templateCredsSetupCompleted: true,
  },
};

const outputs = [
  ['slack-request-workflow.json', slackRequest],
  ['github-completion-workflow.json', githubCompletion],
];

if (process.argv.includes('--check')) {
  for (const name of codeFiles) {
    new AsyncFunction('$input', '$getWorkflowStaticData', 'fetch', 'console', 'process', 'require', code(name));
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
