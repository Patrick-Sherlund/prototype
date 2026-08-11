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
if (!input.authorized) return [{ json: input }];
if (!process.env.SLACK_BOT_TOKEN) throw new Error('SLACK_COMPLETED failed: SLACK_BOT_TOKEN is not configured');

const success = input.status === 'success';
const jiraUrl = input.jira_issue_url || `${process.env.JIRA_BASE_URL?.replace(/\/$/, '') || ''}/browse/${input.jira_issue_key}`;
const text = success
  ? `${input.jira_issue_key} prototype update ready\n\nPrototype: ${input.preview_url}\nPull Request: ${input.pr_url}\nJira: ${jiraUrl}\n\nBuild: ${input.build_result === 'success' ? 'Passed' : input.build_result}\nCorrelation: ${input.correlation_id}`
  : `${input.jira_issue_key} prototype automation failed\n\nStage: ${input.stage || 'unknown'}\nRun: ${input.run_url || 'unknown'}\nJira: ${jiraUrl}\nBuild: ${input.build_result || 'failed'}\nCorrelation: ${input.correlation_id}\nError: ${input.error_message || 'Unknown error'}`;

await postSlack(input.slack_channel_id, input.slack_thread_ts || input.slack_message_ts, text);
console.log(JSON.stringify({ stage: 'SLACK_COMPLETED', correlationId: input.correlation_id, status: input.status }));

return [{ json: { ...input, slackReplyOk: true } }];
