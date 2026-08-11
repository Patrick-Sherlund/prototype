const env = (name) => $env[name];

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

function chooseReviewTransition(transitions) {
  const preferred = [/review/i, /ready/i, /qa/i, /done/i, /complete/i];
  return (transitions || []).find((transition) => {
    const label = `${transition.name || ''} ${transition.to?.name || ''}`;
    return preferred.some((pattern) => pattern.test(label));
  });
}

async function jiraFetch(path, options = {}) {
  const response = await fetch(`${env('JIRA_BASE_URL').replace(/\/$/, '')}${path}`, {
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
  if (!response.ok) throw new Error(`Jira ${options.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 600)}`);
  return data;
}

const input = $input.first().json;
if (!input.authorized) return [{ json: input }];

try {
  if (!env('JIRA_BASE_URL') || !env('JIRA_AUTH_HEADER')) {
    throw new Error('Missing JIRA_BASE_URL or JIRA_AUTH_HEADER');
  }
  const issueKey = input.jira_issue_key;
  const jiraIssueUrl = `${env('JIRA_BASE_URL').replace(/\/$/, '')}/browse/${issueKey}`;
  const success = input.status === 'success';
  const lines = success
    ? [
        'Prototype implementation completed.',
        `Correlation ID: ${input.correlation_id}`,
        `Branch: ${input.branch}`,
        `Commit: ${input.commit_sha}`,
        `Build: ${input.build_result || 'unknown'}`,
        `Pull Request: ${input.pr_url}`,
        `Preview: ${input.preview_url}`,
        `Run: ${input.run_url}`,
      ]
    : [
        'Prototype implementation failed.',
        `Correlation ID: ${input.correlation_id}`,
        `Stage: ${input.stage || 'unknown'}`,
        `Build: ${input.build_result || 'failed'}`,
        `Run: ${input.run_url || 'unknown'}`,
        `Error: ${input.error_message || 'Unknown error'}`,
      ];

  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body: docParagraphs(lines) }),
  });

  let reviewTransitionApplied = '';
  if (success) {
    const transitions = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
    const reviewTransition = chooseReviewTransition(transitions.transitions);
    if (reviewTransition?.id) {
      await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: reviewTransition.id } }),
      });
      reviewTransitionApplied = reviewTransition.name || reviewTransition.to?.name || reviewTransition.id;
    }
  }

  console.log(
    JSON.stringify({
      stage: 'JIRA_COMPLETED',
      correlationId: input.correlation_id,
      jiraIssueKey: issueKey,
      reviewTransitionApplied,
    }),
  );

  return [{ json: { ...input, jiraUpdateOk: true, jira_issue_url: jiraIssueUrl, review_transition_applied: reviewTransitionApplied } }];
} catch (error) {
  return [{ json: { ...input, jiraUpdateOk: false, jiraError: String(error.message || error).slice(0, 900) } }];
}
