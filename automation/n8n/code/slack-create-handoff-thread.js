const env = (name) => $env[name];

async function postSlack(payload) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
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
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error || 'unknown_error'}`);
  return data;
}

function safeText(value, fallback = '') {
  const text = String(value || fallback || '').trim();
  return text || fallback;
}

function stageLabel(stage) {
  const labels = {
    JIRA_KEY_PARSE: 'Jira key parsing',
    FIGMA_WEBHOOK_VALIDATE: 'Figma webhook validation',
    JIRA_VALIDATED: 'Jira issue validation',
    CLAUDE_STARTED: 'Claude Code handoff start',
    figma_capture: 'Figma Design capture',
    figma_render: 'Figma Make render',
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
      `\u{1F3A8} Figma design handoff started for ${input.jiraIssueKey}`,
      '',
      'Source:',
      sourceLabel,
      '',
      'The automation is converting the latest Figma Make prototype into an editable Figma Design and linking it to Jira.',
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
