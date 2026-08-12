const env = (name) => $env[name];

function requiredEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
}

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).filter(Boolean).join('\n');
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(adfToText).filter(Boolean).join(node.type === 'paragraph' ? ' ' : '\n');
  return '';
}

async function jiraFetch(path, options = {}) {
  const baseUrl = env('JIRA_BASE_URL').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: env('JIRA_AUTH_HEADER'),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 600) };
    }
  }

  if (!response.ok) {
    const error = new Error(`Jira ${options.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 600)}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function markHandoff(handoffId, patch) {
  if (!handoffId) return;
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  staticData.figmaHandoffs[handoffId] = {
    ...(staticData.figmaHandoffs[handoffId] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

const input = $input.first().json;
if ((!input.shouldProcess && !input.retryJiraOnly) || input.requestFailed) return [{ json: input }];

let failureStage = 'JIRA_VALIDATED';
try {
  requiredEnv(['JIRA_BASE_URL', 'JIRA_PROJECT_KEY', 'JIRA_AUTH_HEADER']);
  const projectKey = env('JIRA_PROJECT_KEY');
  const issueKey = String(input.jiraIssueKey || '').toUpperCase();
  if (!new RegExp(`^${projectKey}-\\d+$`, 'i').test(issueKey)) {
    throw new Error(`Issue ${issueKey || '(missing)'} is outside configured project ${projectKey}.`);
  }

  const issue = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description,status,issuetype,priority`);
  const jiraIssueUrl = `${env('JIRA_BASE_URL').replace(/\/$/, '')}/browse/${issueKey}`;
  const jiraSummary = issue.fields?.summary || issueKey;
  const jiraDescriptionText = adfToText(issue.fields?.description).slice(0, 6000);

  markHandoff(input.handoffId, {
    status: input.retryJiraOnly ? 'jira_retrying' : 'jira_verified',
    jiraIssueKey: issueKey,
    jiraIssueUrl,
  });

  console.log(JSON.stringify({ stage: 'JIRA_VALIDATED', correlationId: input.correlationId, jiraIssueKey: issueKey }));

  return [
    {
      json: {
        ...input,
        jiraOk: true,
        jiraIssueKey: issueKey,
        jiraIssueUrl,
        jiraSummary,
        jiraDescriptionText,
        jiraStatus: issue.fields?.status?.name || '',
      },
    },
  ];
} catch (error) {
  const errorMessage = String(error.message || error).slice(0, 900);
  markHandoff(input.handoffId, {
    status: 'failed',
    failureStage,
    errorMessage,
  });
  return [
    {
      json: {
        ...input,
        shouldProcess: false,
        requestFailed: true,
        failureStage,
        errorMessage,
        jiraIssueUrl: input.jiraIssueKey ? `${env('JIRA_BASE_URL')?.replace(/\/$/, '') || ''}/browse/${input.jiraIssueKey}` : '',
        slackNotificationAllowed: Boolean(env('SLACK_BOT_TOKEN') && env('SLACK_CHANNEL_ID')),
      },
    },
  ];
}
