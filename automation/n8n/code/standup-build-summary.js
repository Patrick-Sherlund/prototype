const input = $input.first().json;
if (!input.authorized) return [{ json: input }];

function labelForResult(result) {
  if (result.result === 'not_found') return 'Not found';
  if (result.result === 'failed') return 'Failed';
  if (result.action === 'transitioned') return result.actualStatus || result.proposedStatus || 'Updated';
  if (result.action === 'would_transition') return `Proposed: ${result.proposedStatus || result.desiredState}`;
  if (result.action === 'would_comment') return 'Proposed comment';
  if (result.action === 'commented') return 'Comment added';
  if (result.action === 'no_matching_transition') return 'No matching transition';
  if (result.action === 'clarification') return 'Needs clarification';
  if (result.action === 'no_status_change') return 'No status change';
  return result.result || 'No change';
}

function detailForResult(result) {
  if (result.result === 'dry_run') {
    const current = result.currentStatus ? `Current: ${result.currentStatus}` : 'Current: unknown';
    const proposed = result.proposedStatus ? `Proposed: ${result.proposedStatus}` : 'Proposed: no status change';
    const detail = `${current}; ${proposed}`;
    return result.action === 'no_matching_transition' && result.reason ? `${detail}; ${result.reason}` : detail;
  }
  if (result.result === 'not_found') return 'No changes made.';
  if (result.result === 'failed') return result.reason || 'No changes made.';
  if (result.transitionApplied && result.commentAdded) return 'Transitioned and added standup update.';
  if (result.transitionApplied) return 'Transitioned from standup update.';
  if (result.commentAdded) return result.reason || 'Added standup update.';
  return result.reason || result.summary || 'No changes made.';
}

const results = input.jiraResults || [];
let summaryText;

if (input.standupFailed) {
  summaryText = `Standup Jira automation failed\n\nStage: ${input.failureStage || 'unknown'}\nError: ${input.errorMessage || 'Unknown error'}\n\nCorrelation: ${input.correlationId}`;
} else if (!results.length) {
  summaryText = `${input.dryRun ? 'Standup dry run complete' : 'Standup Jira update complete'}\n\nNo Jira issue keys were found in the transcript. No Jira changes were made.\n\nCorrelation: ${input.correlationId}`;
} else {
  const lines = [input.dryRun ? 'Standup dry run complete' : 'Standup Jira update complete', ''];
  for (const result of results) {
    const link = result.issueUrl && result.result !== 'not_found' ? ` (${result.issueUrl})` : '';
    lines.push(`${result.issueKey}  ${labelForResult(result)}${link}`);
    lines.push(detailForResult(result));
    if (result.evidence) lines.push(`Reason: "${result.evidence}"`);
    lines.push('');
  }

  const updated = results.filter((result) => result.result === 'updated').length;
  const skipped = results.filter((result) => result.result !== 'updated').length;
  if (input.dryRun) {
    lines.push('No Jira changes were made.');
    lines.push(`${results.length} tickets analyzed`);
  } else {
    lines.push(`${updated} tickets updated`);
    lines.push(`${skipped} tickets skipped`);
  }
  lines.push('');
  lines.push(`Correlation: ${input.correlationId}`);
  summaryText = lines.join('\n').slice(0, 3500);
}

return [{ json: { ...input, summaryText } }];
