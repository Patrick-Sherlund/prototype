const env = (name) => $env[name];

async function postSlack(channel, threadTs, text) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
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
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error || 'unknown_error'}`);
  return data;
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
