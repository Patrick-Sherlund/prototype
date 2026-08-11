const env = (name) => $env[name];
const https = require('https');
const http = require('http');

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

async function jiraFetch(path, options = {}) {
  const response = await httpRequest(`${env('JIRA_BASE_URL').replace(/\/$/, '')}${path}`, {
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
    const error = new Error(`Jira ${options.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 700)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function transitionPatterns(desiredState) {
  if (desiredState === 'in_progress') return [/in progress/i, /start/i, /doing/i, /active/i, /selected for development/i];
  if (desiredState === 'review') return [/review/i, /ready/i, /qa/i, /validate/i];
  if (desiredState === 'done') return [/done/i, /closed/i, /complete/i, /completed/i, /resolved/i];
  if (desiredState === 'blocked') return [/blocked/i, /impediment/i, /on hold/i, /waiting/i];
  return [];
}

function statusMatches(status, desiredState) {
  const text = String(status || '');
  return transitionPatterns(desiredState).some((pattern) => pattern.test(text));
}

function chooseTransition(transitions, desiredState) {
  const patterns = transitionPatterns(desiredState);
  if (!patterns.length) return null;
  return (transitions || []).find((transition) => {
    const label = `${transition.name || ''} ${transition.to?.name || ''}`;
    return patterns.some((pattern) => pattern.test(label));
  });
}

function commentLines(item, targetLabel) {
  const lines = [
    'Standup update:',
    item.comment || item.summary || item.evidence || 'Ticket discussed in standup.',
    '',
    `Source: automated standup reconciliation`,
    `Correlation: ${item.correlationId}`,
  ];
  if (targetLabel) lines.splice(2, 0, `Status intent: ${targetLabel}`);
  if (item.evidence) lines.splice(2, 0, `Evidence: ${item.evidence}`);
  return lines;
}

const input = $input.first().json;
if (!input.authorized) return [{ json: input }];
if (input.standupFailed) return [{ json: input }];

try {
  if (!env('JIRA_BASE_URL') || !env('JIRA_AUTH_HEADER')) throw new Error('Missing JIRA_BASE_URL or JIRA_AUTH_HEADER');

  const actionPlan = input.actionPlan || [];
  const results = [];
  console.log(JSON.stringify({ stage: 'JIRA_ISSUES_RESOLVED', correlationId: input.correlationId, issueCount: actionPlan.length }));
  console.log(JSON.stringify({ stage: 'JIRA_UPDATES_STARTED', correlationId: input.correlationId, dryRun: input.dryRun }));

  for (const item of actionPlan) {
    const result = {
      issueKey: item.issueKey,
      issueUrl: `${env('JIRA_BASE_URL').replace(/\/$/, '')}/browse/${item.issueKey}`,
      currentStatus: '',
      proposedStatus: '',
      actualStatus: '',
      action: 'none',
      result: 'skipped',
      reason: '',
      commentAdded: false,
      transitionApplied: false,
      confidence: item.confidence,
      desiredState: item.desiredState,
      evidence: item.evidence,
      summary: item.summary,
    };

    try {
      const issue = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(item.issueKey)}?fields=summary,status`);
      result.currentStatus = issue.fields?.status?.name || '';
      result.actualStatus = result.currentStatus;

      if (item.confidence === 'low') {
        result.action = 'clarification';
        result.result = 'skipped';
        result.reason = item.summary || 'Low-confidence interpretation; needs clarification.';
        results.push(result);
        continue;
      }

      const transitions = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(item.issueKey)}/transitions`);
      const transition = item.confidence === 'high' ? chooseTransition(transitions.transitions, item.desiredState) : null;
      const canTransition = Boolean(transition?.id) && !['no_change', 'clarification'].includes(item.desiredState);
      const alreadyInTarget = statusMatches(result.currentStatus, item.desiredState);
      result.proposedStatus = canTransition ? transition.to?.name || transition.name || '' : alreadyInTarget ? result.currentStatus : '';

      if (input.dryRun) {
        if (canTransition && !alreadyInTarget) {
          result.action = 'would_transition';
        } else if (!alreadyInTarget && !transition && !['no_change', 'clarification'].includes(item.desiredState) && item.confidence === 'high') {
          result.action = 'no_matching_transition';
        } else {
          result.action = item.addComment ? 'would_comment' : 'no_status_change';
        }
        result.result = 'dry_run';
        result.reason =
          result.action === 'no_matching_transition'
            ? `No available Jira transition matched semantic state ${item.desiredState}.`
            : item.confidence !== 'high' && !['no_change', 'clarification'].includes(item.desiredState)
              ? 'Medium confidence: comment only; no status transition proposed.'
              : item.summary || item.evidence || 'Proposed from standup transcript.';
        results.push(result);
        continue;
      }

      if (item.addComment || item.desiredState === 'blocked' || item.desiredState === 'no_change') {
        await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(item.issueKey)}/comment`, {
          method: 'POST',
          body: JSON.stringify({
            body: docParagraphs(commentLines({ ...item, correlationId: input.correlationId }, result.proposedStatus)),
          }),
        });
        result.commentAdded = true;
      }

      if (canTransition && !alreadyInTarget) {
        await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(item.issueKey)}/transitions`, {
          method: 'POST',
          body: JSON.stringify({ transition: { id: transition.id } }),
        });
        result.transitionApplied = true;
        result.action = 'transitioned';
        result.actualStatus = transition.to?.name || result.proposedStatus || result.currentStatus;
      } else if (alreadyInTarget) {
        result.action = result.commentAdded ? 'commented' : 'no_status_change';
        result.reason = 'Issue was already in the target status.';
      } else if (item.confidence !== 'high' && !['no_change', 'clarification'].includes(item.desiredState)) {
        result.action = result.commentAdded ? 'commented' : 'no_status_change';
        result.reason = 'Medium confidence: added comment but skipped status transition.';
      } else if (!transition && !['no_change', 'clarification'].includes(item.desiredState)) {
        result.action = result.commentAdded ? 'commented' : 'no_matching_transition';
        result.reason = `No available Jira transition matched semantic state ${item.desiredState}.`;
      } else {
        result.action = result.commentAdded ? 'commented' : 'no_status_change';
        result.reason = item.summary || 'No status change requested.';
      }

      result.result = result.transitionApplied || result.commentAdded ? 'updated' : 'skipped';
      results.push(result);
    } catch (error) {
      result.result = error.status === 404 ? 'not_found' : 'failed';
      result.reason = error.status === 404 ? 'Issue not found in Jira; no changes made.' : String(error.message || error).slice(0, 700);
      results.push(result);
    }
  }

  console.log(JSON.stringify({ stage: 'JIRA_UPDATES_COMPLETED', correlationId: input.correlationId, results }));
  return [{ json: { ...input, jiraResults: results } }];
} catch (error) {
  return [
    {
      json: {
        ...input,
        standupFailed: true,
        failureStage: 'JIRA_UPDATES_STARTED',
        errorMessage: String(error.message || error).slice(0, 1200),
      },
    },
  ];
}
