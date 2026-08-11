const env = (name) => $env[name];
const https = require('https');
const http = require('http');

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

function makeCorrelation(issueKey, eventId, ts) {
  const source = `${issueKey}-${eventId || ts || Date.now()}`;
  return source.toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function summaryFromRequest(requestedChange) {
  const normalized = String(requestedChange || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Prototype request from Slack';
  const summary = normalized.replace(/[.?!]+$/g, '');
  if (summary.length <= 120) return summary;
  return `${summary.slice(0, 117).replace(/\s+\S*$/g, '')}...`;
}

function chooseIssueType(issueTypes) {
  const standard = (issueTypes || []).filter((type) => !type.subtask);
  return (
    standard.find((type) => /^story$/i.test(type.name)) ||
    standard.find((type) => /^task$/i.test(type.name)) ||
    standard.find((type) => /feature/i.test(type.name)) ||
    standard[0] ||
    (issueTypes || [])[0]
  );
}

async function jiraFetch(path, options = {}) {
  const baseUrl = env('JIRA_BASE_URL').replace(/\/$/, '');
  const response = await httpRequest(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: env('JIRA_AUTH_HEADER'),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = response.bodyText;
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
    error.path = path;
    error.method = options.method || 'GET';
    error.bodyText = text;
    error.data = data;
    throw error;
  }
  return data;
}

async function createIssueFromSlackRequest(input, requestedJiraIssueKey) {
  const projectKey = env('JIRA_PROJECT_KEY');
  const project = await jiraFetch(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
  const issueType = chooseIssueType(project.issueTypes);
  if (!issueType?.id) {
    throw new Error(`No usable issue type found for project ${projectKey}`);
  }

  const slackRequestText = `${requestedJiraIssueKey}\n${input.requestedChange || ''}`.trim();
  const created = await jiraFetch('/rest/api/3/issue', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        issuetype: { id: issueType.id },
        summary: summaryFromRequest(input.requestedChange),
        description: docParagraphs([
          `Created by the Slack prototype automation because requested key ${requestedJiraIssueKey} did not exist.`,
          `Slack channel: ${input.slackChannelId}`,
          `Slack message ts: ${input.slackMessageTs}`,
          `Slack thread ts: ${input.slackThreadTs}`,
          `Requester: ${input.requesterIdentity || 'unknown'}`,
          '',
          'Full Slack request:',
          slackRequestText,
        ]),
      },
    }),
  });

  return {
    key: created.key,
    issueTypeName: issueType.name,
  };
}

async function httpRequest(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body || '';
  const headers = { ...(options.headers || {}) };
  if (body && !headers['Content-Length']) headers['Content-Length'] = Buffer.byteLength(body);
  const client = url.startsWith('https:') ? https : http;

  return await new Promise((resolve, reject) => {
    const request = client.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const status = response.statusCode || 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: response.headers,
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error(`HTTP ${method} ${url} timed out`)));
    if (body) request.write(body);
    request.end();
  });
}

const input = $input.first().json;
if (!input.shouldProcess) return [{ json: input }];

let failureStage = 'JIRA_LOOKUP';
try {
  requiredEnv(['JIRA_BASE_URL', 'JIRA_PROJECT_KEY', 'JIRA_AUTH_HEADER']);
  if (!input.jiraIssueKey.startsWith(`${env('JIRA_PROJECT_KEY')}-`)) {
    throw new Error(`Issue ${input.jiraIssueKey} is outside configured project ${env('JIRA_PROJECT_KEY')}`);
  }

  const requestedJiraIssueKey = (input.requestedJiraIssueKey || input.originalJiraIssueKey || input.jiraIssueKey).toUpperCase();
  const originalCorrelationId = input.correlationId;
  let canonicalIssueKey = input.jiraIssueKey;
  let jiraIssueCreated = false;
  let createdIssueType = '';
  let issue;

  console.log(JSON.stringify({ stage: 'JIRA_LOOKUP', correlationId: input.correlationId, requestedJiraIssueKey }));

  try {
    issue = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(canonicalIssueKey)}?fields=summary,description,status,issuetype,priority`,
    );
  } catch (error) {
    if (error.status !== 404) throw error;

    failureStage = 'JIRA_CREATED';
    const created = await createIssueFromSlackRequest(input, requestedJiraIssueKey);
    canonicalIssueKey = created.key;
    createdIssueType = created.issueTypeName;
    jiraIssueCreated = true;
    const canonicalCorrelationId = makeCorrelation(canonicalIssueKey, input.slackEventId, input.slackMessageTs);

    console.log(
      JSON.stringify({
        stage: 'JIRA_CREATED',
        originalCorrelationId,
        correlationId: canonicalCorrelationId,
        requestedJiraIssueKey,
        jiraIssueKey: canonicalIssueKey,
        issueType: createdIssueType,
      }),
    );

    input.correlationId = canonicalCorrelationId;
    issue = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(canonicalIssueKey)}?fields=summary,description,status,issuetype,priority`,
    );
  }

  const jiraDescriptionText = adfToText(issue.fields?.description).slice(0, 6000);
  const jiraSummary = issue.fields?.summary || canonicalIssueKey;
  const jiraIssueUrl = `${env('JIRA_BASE_URL').replace(/\/$/, '')}/browse/${canonicalIssueKey}`;

  failureStage = 'JIRA_VALIDATED';
  console.log(
    JSON.stringify({
      stage: 'JIRA_VALIDATED',
      correlationId: input.correlationId,
      jiraIssueKey: canonicalIssueKey,
      requestedJiraIssueKey,
      jiraIssueCreated,
    }),
  );

  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(canonicalIssueKey)}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: docParagraphs([
        `SLACK_RECEIVED prototype request`,
        `Correlation ID: ${input.correlationId}`,
        ...(jiraIssueCreated
          ? [
              `Requested key ${requestedJiraIssueKey} did not exist.`,
              `Created Jira issue ${canonicalIssueKey} and continued the automation.`,
            ]
          : [`Requested Jira key: ${requestedJiraIssueKey}`]),
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

  const transitions = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(canonicalIssueKey)}/transitions`);
  const activeTransition = chooseActiveTransition(transitions.transitions);
  let transitionApplied = '';
  if (activeTransition?.id) {
    await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(canonicalIssueKey)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: activeTransition.id } }),
    });
    transitionApplied = activeTransition.name || activeTransition.to?.name || activeTransition.id;
  }

  console.log(
    JSON.stringify({
      stage: 'JIRA_UPDATED',
      correlationId: input.correlationId,
      jiraIssueKey: canonicalIssueKey,
      requestedJiraIssueKey,
      jiraIssueCreated,
      transitionApplied,
    }),
  );

  return [
    {
      json: {
        ...input,
        jiraOk: true,
        jiraIssueKey: canonicalIssueKey,
        requestedJiraIssueKey,
        originalJiraIssueKey: requestedJiraIssueKey,
        originalCorrelationId,
        jiraIssueCreated,
        createdIssueType,
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
        failureStage,
        errorMessage: String(error.message || error).slice(0, 900),
        jiraIssueUrl: `${env('JIRA_BASE_URL')?.replace(/\/$/, '') || ''}/browse/${input.jiraIssueKey}`,
      },
    },
  ];
}
