const env = (name) => $env[name];

function requiredEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
}

function docParagraphs(lines) {
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

async function jiraComment(issueKey, lines) {
  if (!env('JIRA_BASE_URL') || !env('JIRA_AUTH_HEADER')) return;
  await fetch(`${env('JIRA_BASE_URL').replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    headers: {
      Authorization: env('JIRA_AUTH_HEADER'),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: docParagraphs(lines) }),
  });
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 20)}\n...[truncated]` : text;
}

const input = $input.first().json;
if (!input.shouldProcess || input.requestFailed) return [{ json: input }];

try {
  requiredEnv(['GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_WORKFLOW_FILE', 'GITHUB_DISPATCH_TOKEN', 'N8N_WEBHOOK_URL']);

  const callbackBase = env('N8N_WEBHOOK_URL').replace(/\/$/, '');
  const callbackUrl = `${callbackBase}/webhook/poc/github/completion`;
  const workflowUrl = `https://github.com/${env('GITHUB_OWNER')}/${env('GITHUB_REPO')}/actions/workflows/${env('GITHUB_WORKFLOW_FILE')}`;
  const apiUrl = `https://api.github.com/repos/${env('GITHUB_OWNER')}/${env('GITHUB_REPO')}/actions/workflows/${env('GITHUB_WORKFLOW_FILE')}/dispatches`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('GITHUB_DISPATCH_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        jira_issue_key: input.jiraIssueKey,
        jira_summary: truncate(input.jiraSummary, 900),
        jira_description: truncate(input.jiraDescriptionText, 6000),
        requested_change: truncate(input.requestedChange, 6000),
        slack_channel_id: input.slackChannelId,
        slack_message_ts: input.slackMessageTs,
        slack_thread_ts: input.slackThreadTs,
        requester_identity: input.requesterIdentity || '',
        correlation_id: input.correlationId,
        n8n_callback_url: callbackUrl,
      },
    }),
  });

  const responseText = await response.text();
  if (response.status !== 204) {
    throw new Error(`GitHub workflow_dispatch failed (${response.status}): ${responseText.slice(0, 600)}`);
  }

  await jiraComment(input.jiraIssueKey, [
    'GITHUB_DISPATCHED Claude prototype implementation workflow.',
    `Correlation ID: ${input.correlationId}`,
    `Workflow: ${workflowUrl}`,
    'The GitHub Action will callback to n8n with PR, preview, commit, and build details.',
  ]);

  console.log(JSON.stringify({ stage: 'GITHUB_DISPATCHED', correlationId: input.correlationId, workflowUrl }));

  return [{ json: { ...input, githubDispatched: true, githubWorkflowUrl: workflowUrl } }];
} catch (error) {
  const errorMessage = String(error.message || error).slice(0, 900);
  if (input.jiraIssueKey) {
    await jiraComment(input.jiraIssueKey, [
      'GITHUB_DISPATCHED failed before Claude could start.',
      `Correlation ID: ${input.correlationId}`,
      `Error: ${errorMessage}`,
    ]).catch(() => {});
  }
  return [{ json: { ...input, requestFailed: true, failureStage: 'GITHUB_DISPATCHED', errorMessage } }];
}
