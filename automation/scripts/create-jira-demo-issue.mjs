const required = ['JIRA_BASE_URL', 'JIRA_PROJECT_KEY', 'JIRA_AUTH_HEADER'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const baseUrl = process.env.JIRA_BASE_URL.replace(/\/$/, '');

async function jira(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: process.env.JIRA_AUTH_HEADER,
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
      data = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`Jira ${options.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 800)}`);
  }
  return data;
}

const project = await jira(`/rest/api/3/project/${encodeURIComponent(process.env.JIRA_PROJECT_KEY)}`);
const issueTypes = project.issueTypes || [];
const issueType =
  issueTypes.find((type) => /story/i.test(type.name)) ||
  issueTypes.find((type) => /task/i.test(type.name)) ||
  issueTypes.find((type) => !type.subtask) ||
  issueTypes[0];

if (!issueType?.id) {
  throw new Error(`No usable issue type found for project ${process.env.JIRA_PROJECT_KEY}`);
}

const issue = await jira('/rest/api/3/issue', {
  method: 'POST',
  body: JSON.stringify({
    fields: {
      project: { key: process.env.JIRA_PROJECT_KEY },
      issuetype: { id: issueType.id },
      summary: 'Improve reorder experience in order history',
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text:
                  'Demo issue for the prototype automation. A Slack request should ask Claude to adjust the order history reorder interaction in the foodservice purchasing prototype.',
              },
            ],
          },
        ],
      },
    },
  }),
});

console.log(JSON.stringify({ key: issue.key, url: `${baseUrl}/browse/${issue.key}` }, null, 2));
