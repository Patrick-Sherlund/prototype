import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const require = createRequire(import.meta.url);

function code(name) {
  return readFileSync(join(root, 'automation', 'n8n', 'code', name), 'utf8');
}

function inputOf(json) {
  return { first: () => ({ json }) };
}

async function runCode(name, json, env = {}) {
  const fn = new AsyncFunction('$input', '$getWorkflowStaticData', '$env', 'fetch', 'console', 'require', code(name));
  return await fn(inputOf(json), () => ({}), env, fetch, console, require);
}

function signedSlackItem(body, secret = 'test-signing-secret') {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return {
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body: rawBody,
  };
}

async function testSlackParser() {
  const env = {
    SLACK_SIGNING_SECRET: 'test-signing-secret',
    SLACK_CHANNEL_ID: 'C0BP62TK3PD',
    JIRA_PROJECT_KEY: 'SYSCO',
  };
  const parser = new AsyncFunction('$input', '$getWorkflowStaticData', '$env', 'fetch', 'console', 'require', code('slack-parse-and-verify.js'));

  const botEvent = signedSlackItem({
    type: 'event_callback',
    event_id: 'EVBOT',
    event: {
      type: 'message',
      channel: 'C0BP62TK3PD',
      ts: '1.000001',
      bot_id: 'B123',
      text: 'STANDUP\nSYSCO-6 is done.',
    },
  });
  const botResult = await parser(inputOf(botEvent), () => ({}), env, fetch, console, require);
  assert.equal(botResult[0].json.ignoreReason, 'bot_message', 'bot Slack message ignored');

  const noKeyStandup = signedSlackItem({
    type: 'event_callback',
    event_id: 'EVSTANDUP',
    event: {
      type: 'message',
      channel: 'C0BP62TK3PD',
      ts: '2.000001',
      user: 'U123',
      text: 'STANDUP DRY RUN\nPatrick:\nNo Jira key in this transcript.',
    },
  });
  const standupResult = await parser(inputOf(noKeyStandup), () => ({}), env, fetch, console, require);
  assert.equal(standupResult[0].json.standupShouldProcess, true, 'standup transcript without Jira keys is routed');
  assert.equal(standupResult[0].json.shouldProcess, false, 'standup transcript does not enter prototype workflow');
  assert.equal(standupResult[0].json.standupDryRun, true, 'dry-run flag parsed');

  const teamsStandup = signedSlackItem({
    type: 'event_callback',
    event_id: 'EVTEAMSSTANDUP',
    event: {
      type: 'message',
      channel: 'C0BP62TK3PD',
      ts: '3.000001',
      user: 'U123',
      text: 'MS Teams Standup\nPatrick:\nSYSCO-6 is ready for review.',
    },
  });
  const teamsResult = await parser(inputOf(teamsStandup), () => ({}), env, fetch, console, require);
  assert.equal(teamsResult[0].json.standupShouldProcess, true, 'MS Teams Standup header is routed');
  assert.equal(teamsResult[0].json.shouldProcess, false, 'MS Teams Standup does not enter prototype workflow');
  assert.equal(teamsResult[0].json.standupDryRun, false, 'MS Teams Standup defaults to live mode');
}

async function testValidateOutput() {
  const base = {
    authorized: true,
    dryRun: true,
    correlationId: 'STANDUP-TEST',
    analysis: {
      issues: [
        { issueKey: 'SYSCO-1', evidence: 'done', summary: 'Explicit Done', desiredState: 'done', addComment: true, confidence: 'high' },
        { issueKey: 'SYSCO-2', evidence: 'ready for review', summary: 'Ready for Review', desiredState: 'review', addComment: true, confidence: 'high' },
        { issueKey: 'SYSCO-3', evidence: 'started today', summary: 'In Progress', desiredState: 'in_progress', addComment: true, confidence: 'high' },
        { issueKey: 'SYSCO-4', evidence: 'blocked waiting on API', summary: 'Blocked', desiredState: 'blocked', addComment: true, confidence: 'high' },
        { issueKey: 'SYSCO-5', evidence: 'needs another day', summary: 'Continuing', desiredState: 'no_change', addComment: true, confidence: 'medium' },
        { issueKey: 'SYSCO-6', evidence: 'should be done tomorrow', summary: 'Ambiguous completion', desiredState: 'done', addComment: true, confidence: 'low' },
        { issueKey: 'SYSCO-999', evidence: 'missing', summary: 'Invalid Jira issue will be handled later', desiredState: 'done', addComment: true, confidence: 'high' },
        { issueKey: 'NOTJIRA-1', evidence: 'invalid', summary: 'Invalid issue key', desiredState: 'done', addComment: true, confidence: 'high' },
      ],
    },
  };

  const result = await runCode('standup-validate-output.js', base);
  const plan = result[0].json.actionPlan;
  assert.equal(plan.length, 7, 'invalid non-SYSCO key removed');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-1').desiredState, 'done', 'explicit Done supported');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-2').desiredState, 'review', 'ready for review supported');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-3').desiredState, 'in_progress', 'started supported');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-4').desiredState, 'blocked', 'blocked supported');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-5').desiredState, 'no_change', 'continuing work no transition supported');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-6').confidence, 'low', 'ambiguous completion remains low confidence');
  assert.equal(plan.find((issue) => issue.issueKey === 'SYSCO-6').addComment, false, 'low confidence does not mutate Jira');
}

async function testSummaryCases() {
  const summaryInput = {
    authorized: true,
    dryRun: true,
    correlationId: 'STANDUP-TEST',
    jiraResults: [
      {
        issueKey: 'SYSCO-1',
        issueUrl: 'https://example.atlassian.net/browse/SYSCO-1',
        currentStatus: 'In Progress',
        proposedStatus: 'Done',
        action: 'would_transition',
        result: 'dry_run',
        evidence: 'SYSCO-1 is done.',
      },
      {
        issueKey: 'SYSCO-999',
        action: 'none',
        result: 'not_found',
        reason: 'Issue not found in Jira; no changes made.',
      },
      {
        issueKey: 'SYSCO-10',
        action: 'none',
        result: 'failed',
        reason: 'Synthetic one-issue failure.',
      },
      {
        issueKey: 'SYSCO-11',
        issueUrl: 'https://example.atlassian.net/browse/SYSCO-11',
        currentStatus: 'In Progress',
        proposedStatus: '',
        action: 'no_matching_transition',
        result: 'dry_run',
        reason: 'No available Jira transition matched semantic state review.',
        evidence: 'SYSCO-11 is ready for review.',
      },
    ],
  };

  const dryRunSummary = await runCode('standup-build-summary.js', summaryInput);
  const text = dryRunSummary[0].json.summaryText;
  assert.match(text, /Standup dry run complete/, 'dry-run summary generated');
  assert.match(text, /No Jira changes were made/, 'dry-run reports no mutation');
  assert.match(text, /SYSCO-999  Not found/, 'invalid Jira issue reported');
  assert.match(text, /SYSCO-10  Failed/, 'one issue failing is reported');
  assert.match(text, /SYSCO-11  No matching transition/, 'missing Jira transition reported');
  assert.match(text, /No available Jira transition matched semantic state review/, 'missing transition reason included');

  const noIssueSummary = await runCode('standup-build-summary.js', {
    authorized: true,
    dryRun: true,
    correlationId: 'STANDUP-NO-ISSUES',
    jiraResults: [],
  });
  assert.match(noIssueSummary[0].json.summaryText, /No Jira issue keys were found/, 'transcript with no Jira issue keys handled');
}

await testSlackParser();
await testValidateOutput();
await testSummaryCases();

console.log('standup synthetic tests passed');
