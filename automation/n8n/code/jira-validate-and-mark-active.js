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

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).filter(Boolean).join('\n');
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(adfToText).filter(Boolean).join(node.type === 'paragraph' ? ' ' : '\n');
  return '';
}

function chooseActiveTransition(transitions) {
  const candidates = transitions || [];
  const preferred = [/in progress/i, /start/i, /doing/i, /active/i, /selected for development/i];
  return candidates.find((transition) => {
    const label = `${transition.name || ''} ${transition.to?.name || ''}`;
    return preferred.some((pattern) => pattern.test(label));
  });
}

async function jiraFetch(path, options = {}) {
  const baseUrl = env('JIRA_BASE_URL').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: env('JIRA_AUTH_HEADER'),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
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
    throw new Error(`Jira ${options.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 600)}`);
  }
  return data;
}

const input = $input.first().json;
if (!input.shouldProcess) return [{ json: input }];

try {
  requiredEnv(['JIRA_BASE_URL', 'JIRA_PROJECT_KEY', 'JIRA_AUTH_HEADER']);
  if (!input.jiraIssueKey.startsWith(`${env('JIRA_PROJECT_KEY')}-`)) {
    throw new Error(`Issue ${input.jiraIssueKey} is outside configured project ${env('JIRA_PROJECT_KEY')}`);
  }

  const issue = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(input.jiraIssueKey)}?fields=summary,description,status,issuetype,priority`,
  );
  const jiraDescriptionText = adfToText(issue.fields?.description).slice(0, 6000);
  const jiraSummary = issue.fields?.summary || input.jiraIssueKey;
  const jiraIssueUrl = `${env('JIRA_BASE_URL').replace(/\/$/, '')}/browse/${input.jiraIssueKey}`;

  console.log(JSON.stringify({ stage: 'JIRA_VALIDATED', correlationId: input.correlationId, jiraIssueKey: input.jiraIssueKey }));

  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(input.jiraIssueKey)}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: docParagraphs([
        `SLACK_RECEIVED prototype request`,
        `Correlation ID: ${input.correlationId}`,
        `Slack channel: ${input.slackChannelId}`,
        `Slack message ts: ${input.slackMessageTs}`,
        `Slack thread ts: ${input.slackThreadTs}`,
        `Requester: ${input.requesterIdentity || 'unknown'}`,
        '',
        'Requested change:',
        input.requestedChange,
      ]),
    }),
  });

  const transitions = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(input.jiraIssueKey)}/transitions`);
  const activeTransition = chooseActiveTransition(transitions.transitions);
  let transitionApplied = '';
  if (activeTransition?.id) {
    await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(input.jiraIssueKey)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: activeTransition.id } }),
    });
    transitionApplied = activeTransition.name || activeTransition.to?.name || activeTransition.id;
  }

  console.log(
    JSON.stringify({
      stage: 'JIRA_UPDATED',
      correlationId: input.correlationId,
      jiraIssueKey: input.jiraIssueKey,
      transitionApplied,
    }),
  );

  return [
    {
      json: {
        ...input,
        jiraOk: true,
        jiraIssueUrl,
        jiraSummary,
        jiraDescriptionText,
        jiraStatus: issue.fields?.status?.name || '',
        jiraTransitionApplied: transitionApplied,
      },
    },
  ];
} catch (error) {
  return [
    {
      json: {
        ...input,
        requestFailed: true,
        failureStage: 'JIRA_VALIDATED',
        errorMessage: String(error.message || error).slice(0, 900),
        jiraIssueUrl: `${env('JIRA_BASE_URL')?.replace(/\/$/, '') || ''}/browse/${input.jiraIssueKey}`,
      },
    },
  ];
}
