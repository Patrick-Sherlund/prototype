export function buildClaudeFigmaPrompt(job) {
  const source = job.source;
  const destination = job.destination || {};
  const destinationLines = destination.figma_design_url || destination.figma_design_file_key
    ? [
        `Existing destination Figma Design URL: ${destination.figma_design_url || '(not provided)'}`,
        `Existing destination Figma Design file key: ${destination.figma_design_file_key || '(not provided)'}`,
      ]
    : ['No existing Jira-specific Figma Design destination was supplied. Create a Jira-specific Figma Design file when supported.'];

  return [
    'You are performing a Figma design-handoff operation.',
    '',
    'The supplied Figma Make project is the authoritative prototype source.',
    'Claude Code is acting only as the Figma MCP execution agent for this handoff.',
    '',
    'Inputs:',
    `Jira issue key: ${job.jira_key}`,
    `Jira summary: ${job.jira_summary || '(not provided)'}`,
    `Jira URL: ${job.jira_url || '(not provided)'}`,
    `Correlation ID: ${job.correlation_id}`,
    `Handoff ID: ${job.handoff_id}`,
    '',
    'Figma Make source:',
    `File key: ${source.figma_make_file_key}`,
    `File name: ${source.figma_file_name || '(not provided)'}`,
    `Version ID: ${source.figma_version_id}`,
    `Version label: ${source.figma_version_label || '(not provided)'}`,
    `Version description: ${source.figma_version_description || '(not provided)'}`,
    `Version created at: ${source.figma_version_created_at || '(not provided)'}`,
    `Make URL: ${source.figma_make_url || '(not provided)'}`,
    `Published Make URL: ${source.figma_make_published_url || '(not provided)'}`,
    '',
    'Figma Design destination:',
    ...destinationLines,
    '',
    'Task:',
    '1. Connect to the configured Figma MCP server.',
    '2. Use Figma MCP whoami or an equivalent tool when available to confirm Figma MCP authentication.',
    '3. Inspect the Figma MCP tool list and use only supported Figma MCP tools.',
    '4. Access the Figma Make project identified by the supplied file information.',
    '5. Use available Make resources/context to confirm the correct project is being processed.',
    '6. Access or render the current Figma Make prototype. Prefer the supplied Make or published URL when browser rendering is required.',
    '7. Use the current rendered Make interface as the visual source.',
    '8. Use Figma MCP Code to Canvas / generate_figma_design to convert the current interface into editable Figma Design layers.',
    '9. Send the resulting editable layers to the configured Jira-specific Figma Design file when supplied.',
    '10. If no destination exists, create an appropriate Jira-specific Figma Design file when supported.',
    '11. Associate the handoff with the Jira issue key, Make file, Make version, version label, and capture timestamp.',
    '12. Return strict machine-readable JSON only.',
    '',
    'Stop condition:',
    '- If the available Figma MCP tools cannot access Figma Make, cannot render the Make prototype, or do not expose Code to Canvas / generate_figma_design, stop immediately and return the failure JSON.',
    '- Do not keep retrying equivalent tool calls after one clear unsupported, unauthorized, or unavailable result.',
    '- Do not spend turns researching alternatives outside Figma MCP and the supplied Make URL.',
    '',
    'Do not:',
    '- Modify repository source code.',
    '- Create commits, branches, pull requests, previews, or GitHub Actions runs.',
    '- Update Jira.',
    '- Send Slack messages.',
    '- Modify the Figma Make source.',
    '- Invent UI that is not present in the current Figma Make prototype.',
    '- Create a screenshot-only handoff.',
    '- Reconstruct the UI from repository code.',
    '',
    'Success JSON schema:',
    '{',
    '  "success": true,',
    `  "jiraKey": "${job.jira_key}",`,
    '  "source": {',
    `    "figmaMakeFileKey": "${source.figma_make_file_key}",`,
    `    "figmaVersionId": "${source.figma_version_id}",`,
    `    "figmaVersionLabel": ${JSON.stringify(source.figma_version_label || '')}`,
    '  },',
    '  "design": {',
    '    "url": "https://www.figma.com/design/...",',
    '    "fileKey": "...",',
    '    "nodeId": "..."',
    '  }',
    '}',
    '',
    'Failure JSON schema:',
    '{',
    '  "success": false,',
    `  "jiraKey": "${job.jira_key}",`,
    '  "stage": "figma_mcp_auth | figma_make_context | figma_render | generate_figma_design | figma_capture",',
    '  "error": "safe actionable error without secrets"',
    '}',
    '',
    'Return no Markdown, no prose, and no code fences outside the JSON object.',
  ].join('\n');
}

export function extractClaudeResultText(result) {
  const stdout = String(result.stdout || '').trim();
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === 'string') return parsed.result;
    if (typeof parsed.message === 'string') return parsed.message;
    return JSON.stringify(parsed);
  } catch {
    return stdout;
  }
}

export function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    for (const candidate of balancedJsonCandidates(withoutFence)) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep looking for a later balanced object. Claude sometimes wraps
        // diagnostics around the object even when instructed not to.
      }
    }
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new Error(`Claude did not return valid JSON: ${withoutFence.slice(0, 500)}`);
  }
}

export function normalizeClaudeFigmaResult(text, job) {
  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch (error) {
    return {
      success: false,
      jiraKey: String(job.jira_key || '').toUpperCase(),
      stage: inferFailureStage(text),
      error: safeError(`Claude Code did not return valid handoff JSON. Output: ${String(text || error.message || '').slice(0, 900)}`),
    };
  }

  const jiraKey = String(parsed.jiraKey || parsed.jira_key || job.jira_key || '').toUpperCase();
  if (parsed.success === false) {
    return {
      success: false,
      jiraKey,
      stage: normalizeStage(parsed.stage || 'figma_capture'),
      error: safeError(parsed.error || parsed.error_message || 'Claude Code reported a Figma handoff failure.'),
    };
  }

  const design = parsed.design || {};
  const url = String(design.url || parsed.figmaDesignUrl || parsed.figma_design_url || '').trim();
  if (parsed.success !== true || !url) {
    return {
      success: false,
      jiraKey,
      stage: 'figma_capture',
      error: 'Claude Code did not return success=true with a Figma Design URL.',
    };
  }

  const source = parsed.source || {};
  return {
    success: true,
    jiraKey,
    source: {
      figmaMakeFileKey: String(source.figmaMakeFileKey || source.figma_make_file_key || job.source.figma_make_file_key || ''),
      figmaVersionId: String(source.figmaVersionId || source.figma_version_id || job.source.figma_version_id || ''),
      figmaVersionLabel: String(source.figmaVersionLabel || source.figma_version_label || job.source.figma_version_label || ''),
    },
    design: {
      url,
      fileKey: String(design.fileKey || design.file_key || parsed.figmaDesignFileKey || parsed.figma_design_file_key || ''),
      nodeId: String(design.nodeId || design.node_id || parsed.figmaDesignNodeId || parsed.figma_design_node_id || ''),
    },
  };
}

export function balancedJsonCandidates(text) {
  const value = String(text || '');
  const candidates = [];
  for (let start = value.indexOf('{'); start >= 0; start = value.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

export function normalizeStage(stage) {
  const normalized = String(stage || '').trim();
  const allowed = new Set(['figma_mcp_auth', 'figma_make_context', 'figma_render', 'generate_figma_design', 'figma_capture']);
  return allowed.has(normalized) ? normalized : 'figma_capture';
}

export function inferFailureStage(output) {
  const text = String(output || '');
  if (/mcp|figma.*auth|authentication|authorize|oauth|whoami|connected/i.test(text)) return 'figma_mcp_auth';
  if (/make.*context|resource|file.*not.*found|permission|access/i.test(text)) return 'figma_make_context';
  if (/browser|playwright|render|published|url|page/i.test(text)) return 'figma_render';
  if (/generate_figma_design|code to canvas|editable|canvas|design/i.test(text)) return 'generate_figma_design';
  return 'figma_capture';
}

export function safeError(value) {
  return String(value || 'Unknown error')
    .replace(/sk-ant-[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .slice(0, 1200);
}
