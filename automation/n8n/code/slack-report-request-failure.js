async function postSlack(channel, threadTs, text) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
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
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack chat.postMessage failed: ${data.error || 'unknown_error'}`);
  return data;
}

const input = $input.first().json;
if (!input.requestFailed || !input.slackChannelId || !input.slackThreadTs) return [{ json: input }];

if (!process.env.SLACK_BOT_TOKEN) {
  throw new Error('Failure reporting needs SLACK_BOT_TOKEN, but it is not configured');
}

const jiraLine = input.jiraIssueUrl ? `\nJira: ${input.jiraIssueUrl}` : '';
const text = `${input.jiraIssueKey || 'SYSCO request'} prototype automation failed\n\nStage: ${input.failureStage}\nCorrelation: ${input.correlationId || 'unknown'}${jiraLine}\nError: ${input.errorMessage || 'Unknown error'}`;

await postSlack(input.slackChannelId, input.slackThreadTs, text);
console.log(JSON.stringify({ stage: 'SLACK_COMPLETED', outcome: 'request_failure_reported', correlationId: input.correlationId }));

return [{ json: { ...input, slackFailureReported: true } }];
