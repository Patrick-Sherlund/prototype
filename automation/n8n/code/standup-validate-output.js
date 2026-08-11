const input = $input.first().json;
if (!input.authorized || input.standupFailed) return [{ json: input }];

function normalizeState(value) {
  const state = String(value || 'clarification').toLowerCase().replace(/[\s-]+/g, '_');
  if (['in_progress', 'review', 'done', 'blocked', 'no_change', 'clarification'].includes(state)) return state;
  return 'clarification';
}

function normalizeConfidence(value) {
  const confidence = String(value || 'low').toLowerCase();
  if (['high', 'medium', 'low'].includes(confidence)) return confidence;
  return 'low';
}

try {
  const issues = input.analysis?.issues;
  if (!Array.isArray(issues)) throw new Error('Claude analysis did not contain an issues array');

  const seen = new Set();
  const actionPlan = [];
  for (const issue of issues.slice(0, 50)) {
    const issueKey = String(issue.issueKey || '').toUpperCase().trim();
    if (!/^SYSCO-\d+$/.test(issueKey) || seen.has(issueKey)) continue;
    seen.add(issueKey);

    const confidence = normalizeConfidence(issue.confidence);
    const desiredState = normalizeState(issue.desiredState);
    actionPlan.push({
      issueKey,
      evidence: String(issue.evidence || '').slice(0, 500),
      summary: String(issue.summary || '').slice(0, 500),
      desiredState,
      addComment: Boolean(issue.addComment) && confidence !== 'low',
      comment: String(issue.comment || issue.summary || '').slice(0, 800),
      confidence,
    });
  }

  console.log(JSON.stringify({ stage: 'ACTION_PLAN_CREATED', correlationId: input.correlationId, issueCount: actionPlan.length }));
  return [{ json: { ...input, actionPlan } }];
} catch (error) {
  return [
    {
      json: {
        ...input,
        standupFailed: true,
        failureStage: 'ACTION_PLAN_CREATED',
        errorMessage: String(error.message || error).slice(0, 1200),
      },
    },
  ];
}
