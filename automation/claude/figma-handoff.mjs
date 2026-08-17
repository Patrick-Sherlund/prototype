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
    `Design request: ${job.request_text || '(not provided)'}`,
    `Trigger source: ${job.trigger_source || '(not provided)'}`,
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
    `Browser rendering allowed: ${job.browser_rendering_allowed ? 'yes' : 'no'}`,
    '',
    'Task:',
    '1. Connect to the configured Figma MCP server.',
    '2. Use Figma MCP whoami or an equivalent tool when available to confirm Figma MCP authentication.',
    '3. Inspect the Figma MCP tool list and use only supported Figma MCP tools.',
    '4. Access the Figma Make project identified by the supplied file information and Make URL.',
    '5. Enumerate and fetch the available Figma Make resources/context. Use that context to identify the relevant current prototype area for the design request.',
    '6. For this POC, do not require browser automation of the authenticated Figma Make editor. Browser rendering is optional and only allowed when explicitly enabled above.',
    '7. Do not mutate the Figma Make project unless the current official Figma MCP tool surface explicitly supports that operation. Treat Make as source/context only.',
    '8. Create or update an editable Figma Design artifact. Prefer the Jira-specific destination when supplied; otherwise create a Jira-specific Design file when supported.',
    '9. Use supported Figma MCP write capabilities. Prefer generate_figma_design when it is available and applicable without authenticated Make-editor browser state. If generate_figma_design is only applicable to live browser capture, use the current Figma MCP write-to-canvas tool such as use_figma to create editable native Figma layers in the Design artifact.',
    '10. Apply the requested small change only. For this POC request, add a compact delivery ETA badge to the recent order cards or the closest equivalent order-card area found in the Make context.',
    '11. Associate the handoff with the Jira issue key, Make file, Make version/request id, request text, and capture timestamp.',
    '12. Return strict machine-readable JSON only.',
    '',
    'Stop condition:',
    '- If the available Figma MCP tools cannot access Figma Make context, cannot create/update an editable Figma Design artifact, or expose no supported Figma Design write capability, stop immediately and return the failure JSON.',
    '- Do not keep retrying equivalent tool calls after one clear unsupported, unauthorized, or unavailable result.',
    '- Do not spend turns trying to log a browser into the Figma Make editor.',
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
    '- Depend on authenticated browser session state for the Figma Make editor.',
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
    '    "nodeId": "...",',
    '    "creationTool": "generate_figma_design | use_figma | other-supported-figma-mcp-write-tool"',
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
      creationTool: String(design.creationTool || design.creation_tool || parsed.creationTool || parsed.creation_tool || ''),
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
