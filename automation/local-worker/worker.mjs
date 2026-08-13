import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClaudeFigmaPrompt,
  extractClaudeResultText,
  inferFailureStage,
  normalizeClaudeFigmaResult,
  safeError,
} from '../claude/figma-handoff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(process.env.LOCAL_WORKER_REPO_ROOT || join(here, '..', '..'));
loadDotEnv(join(repoRoot, '.env'));

const env = (name, fallback = '') => process.env[name] || fallback;
const bindHost = env('LOCAL_WORKER_BIND', '0.0.0.0');
const port = Number(env('LOCAL_WORKER_PORT', '8787'));
const workerSecret = requiredEnv('LOCAL_WORKER_SECRET');
const callbackSecret = requiredEnv('N8N_CALLBACK_SECRET');
const claudeCommand = resolveClaudeCommand();
const claudeMaxTurns = env('FIGMA_CLAUDE_MAX_TURNS', env('CLAUDE_MAX_TURNS', '16'));
const figmaAllowedTools = env(
  'FIGMA_CLAUDE_ALLOWED_TOOLS',
  'mcp__figma__*,mcp__playwright__*,Read,LS,Bash(npx playwright:*),Bash(npm exec playwright:*)',
);
const figmaTimeoutMs = Number(env('FIGMA_HANDOFF_TIMEOUT_MS', '1200000'));
const playwrightMcpConfig = buildPlaywrightMcpConfig();
const timedOutProcesses = new Set();

let activeJob = null;

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      return sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        busy: Boolean(activeJob),
        activeCorrelationId: activeJob?.correlation_id || '',
        claudeCommand,
      });
    }

    if (request.method !== 'POST' || request.url !== '/poc/figma/handoff/start') {
      return sendJson(response, 404, { ok: false, error: 'not_found' });
    }

    if (!safeCompare(workerSecret, request.headers['x-poc-worker-secret'])) {
      return sendJson(response, 403, { ok: false, error: 'forbidden' });
    }

    if (activeJob) {
      return sendJson(response, 409, {
        ok: false,
        error: 'worker_busy',
        activeCorrelationId: activeJob.correlation_id || '',
      });
    }

    const body = await readBody(request);
    const job = normalizeFigmaJob(JSON.parse(body || '{}'));
    activeJob = job;
    sendJson(response, 202, {
      ok: true,
      correlation_id: job.correlation_id,
      handoff_id: job.handoff_id,
      jira_key: job.jira_key,
    });

    runFigmaHandoffJob(job)
      .catch((error) => console.error(redact(`Local worker uncaught failure: ${error.stack || error.message || error}`)))
      .finally(() => {
        activeJob = null;
      });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: redact(error.message || String(error)) });
  }
});

server.listen(port, bindHost, () => {
  console.log(`Local Claude Figma handoff worker listening on http://${bindHost}:${port}`);
});

async function runFigmaHandoffJob(job) {
  const state = {
    stage: 'CLAUDE_STARTED',
    claudeResult: 'not_started',
    figmaDesignUrl: '',
    figmaDesignFileKey: '',
    figmaDesignNodeId: '',
  };

  const runDir = join(repoRoot, '.automation', 'figma-handoffs', safeSlug(job.correlation_id));
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, 'worker.log');
  const log = (message) => appendFileSync(logPath, `${new Date().toISOString()} ${redact(message)}\n`);

  try {
    writeFileSync(join(runDir, 'handoff-input.json'), redact(JSON.stringify(job, null, 2)), 'utf8');
    log(`CLAUDE_STARTED jira=${job.jira_key} correlation=${job.correlation_id} handoff=${job.handoff_id}`);

    state.stage = 'figma_mcp_auth';
    await verifyFigmaMcpConfigured(log);

    state.stage = 'figma_capture';
    const promptPath = join(runDir, 'claude-figma-handoff-prompt.md');
    const mcpConfigPath = join(runDir, 'claude-mcp-config.json');
    writeFileSync(promptPath, buildClaudeFigmaPrompt(job), 'utf8');
    writeFileSync(mcpConfigPath, playwrightMcpConfig, 'utf8');

    const claude = await runCommand(
      claudeCommand,
      [
        '-p',
        '--max-turns',
        claudeMaxTurns,
        '--mcp-config',
        mcpConfigPath,
        '--allowedTools',
        figmaAllowedTools,
        '--output-format',
        'json',
        '--no-session-persistence',
      ],
      {
        cwd: repoRoot,
        stdin: readFileSync(promptPath, 'utf8'),
        windowsCmd: process.platform === 'win32',
        timeoutMs: figmaTimeoutMs,
        stripClaudeTokenEnv: true,
        log,
      },
    );
    writeFileSync(join(runDir, 'claude-stdout.json'), redact(claude.stdout || ''), 'utf8');
    writeFileSync(join(runDir, 'claude-stderr.txt'), redact(claude.stderr || ''), 'utf8');

    state.claudeResult = claude.code === 0 ? 'success' : 'failure';
    if (claude.code !== 0) {
      const summary = summarizeOutput(claude);
      throw stageError(inferFailureStage(summary), `Claude Code failed (${claude.code}): ${summary}`);
    }

    const resultText = extractClaudeResultText(claude);
    writeFileSync(join(runDir, 'claude-result.txt'), redact(resultText), 'utf8');
    const result = normalizeClaudeFigmaResult(resultText, job);
    if (!result.success) {
      throw stageError(result.stage, result.error);
    }

    state.stage = 'figma_design_created';
    state.figmaDesignUrl = result.design.url;
    state.figmaDesignFileKey = result.design.fileKey;
    state.figmaDesignNodeId = result.design.nodeId;
    log(`FIGMA_DESIGN_CREATED url=${state.figmaDesignUrl}`);

    await sendCallback(job, state, {
      success: true,
      jiraKey: job.jira_key,
      source: result.source,
      design: result.design,
    }, log);
    log(`N8N_CALLBACK_SENT status=success jira=${job.jira_key}`);
  } catch (error) {
    const stage = error.stage || state.stage || 'figma_capture';
    const message = safeError(error.message || error);
    log(`FAILED stage=${stage} error=${message}`);
    await sendCallback(
      job,
      { ...state, stage },
      {
        success: false,
        jiraKey: job.jira_key,
        stage,
        error: message,
      },
      log,
    ).catch((callbackError) => {
      log(`N8N_CALLBACK_SENT failed error=${callbackError.message || callbackError}`);
    });
  }
}

async function verifyFigmaMcpConfigured(log) {
  const result = await runCommand(claudeCommand, ['mcp', 'list'], {
    cwd: repoRoot,
    windowsCmd: process.platform === 'win32',
    timeoutMs: 30_000,
    stripClaudeTokenEnv: true,
    log,
  });

  if (result.code !== 0) {
    throw stageError('figma_mcp_auth', `Claude MCP list failed (${result.code}): ${summarizeOutput(result)}`);
  }

  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (!/\bfigma\b/i.test(combined)) {
    throw stageError(
      'figma_mcp_auth',
      'Figma MCP is not configured or not visible to Claude Code. Install the Figma Claude Code plugin or add the Figma remote MCP server, then authenticate it.',
    );
  }

  if (!/figma[\s\S]*(Connected|✔)/i.test(combined)) {
    log('Figma MCP entry found, but connected status was not explicit. Continuing so Claude can perform the authoritative MCP check.');
  }
}

async function sendCallback(job, state, result, log) {
  const payload = {
    status: result.success ? 'success' : 'failure',
    success: Boolean(result.success),
    stage: result.success ? state.stage : result.stage || state.stage,
    jiraKey: job.jira_key,
    jira_key: job.jira_key,
    correlationId: job.correlation_id,
    correlation_id: job.correlation_id,
    handoffId: job.handoff_id,
    handoff_id: job.handoff_id,
    slack_channel_id: job.slack_channel_id,
    slack_thread_ts: job.slack_thread_ts,
    source: {
      figmaMakeFileKey: result.source?.figmaMakeFileKey || job.source.figma_make_file_key,
      figmaVersionId: result.source?.figmaVersionId || job.source.figma_version_id,
      figmaVersionLabel: result.source?.figmaVersionLabel || job.source.figma_version_label,
      figmaVersionDescription: job.source.figma_version_description,
    },
    design: result.design || {
      url: state.figmaDesignUrl,
      fileKey: state.figmaDesignFileKey,
      nodeId: state.figmaDesignNodeId,
    },
    error: result.error || '',
  };

  const response = await fetch(job.n8n_callback_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-poc-callback-secret': callbackSecret,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`n8n callback failed (${response.status}): ${text.slice(0, 500)}`);
  }
  log(`N8N_CALLBACK_SENT status=${payload.status} response=${response.status}`);
}

function normalizeFigmaJob(input) {
  const source = input.source || {};
  const destination = input.destination || {};
  const required = [
    ['jira_key', input.jira_key],
    ['correlation_id', input.correlation_id],
    ['handoff_id', input.handoff_id],
    ['n8n_callback_url', input.n8n_callback_url],
    ['source.figma_make_file_key', source.figma_make_file_key],
    ['source.figma_version_id', source.figma_version_id],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}`);

  const projectKey = env('JIRA_PROJECT_KEY', 'SYSCO');
  const issue = String(input.jira_key || '').toUpperCase();
  if (!new RegExp(`^${projectKey}-\\d+$`, 'i').test(issue)) throw new Error(`Invalid Jira issue key: ${input.jira_key}`);

  return {
    jira_key: issue,
    jira_summary: String(input.jira_summary || '').slice(0, 1000),
    jira_description: String(input.jira_description || '').slice(0, 6000),
    jira_url: String(input.jira_url || ''),
    correlation_id: String(input.correlation_id || ''),
    handoff_id: String(input.handoff_id || ''),
    n8n_callback_url: String(input.n8n_callback_url || ''),
    slack_channel_id: String(input.slack_channel_id || ''),
    slack_thread_ts: String(input.slack_thread_ts || ''),
    source: {
      figma_make_file_key: String(source.figma_make_file_key || ''),
      figma_file_name: String(source.figma_file_name || ''),
      figma_version_id: String(source.figma_version_id || ''),
      figma_version_label: String(source.figma_version_label || ''),
      figma_version_description: String(source.figma_version_description || ''),
      figma_version_created_at: String(source.figma_version_created_at || ''),
      figma_make_url: String(source.figma_make_url || ''),
      figma_make_published_url: String(source.figma_make_published_url || ''),
    },
    destination: {
      figma_design_file_key: String(destination.figma_design_file_key || ''),
      figma_design_url: String(destination.figma_design_url || ''),
    },
  };
}

function runCommand(command, args, options = {}) {
  const childEnv = { ...process.env, ...(options.env || {}) };
  if (options.stripClaudeTokenEnv) {
    delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const wrapped = wrapWindowsCommand(command, args, options);
    let child;
    try {
      child = spawn(wrapped.command, wrapped.args, {
        cwd: options.cwd || repoRoot,
        env: childEnv,
        windowsHide: true,
        windowsVerbatimArguments: Boolean(wrapped.windowsVerbatimArguments),
        stdio: options.stdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      options.log?.(`${command} failed to start: ${error.message}`);
      resolve({ code: 1, stdout: '', stderr: redact(error.message) });
      return;
    }

    let stdout = '';
    let stderr = '';
    const limit = 200_000;
    const append = (target, chunk) => {
      const next = target + chunk.toString('utf8');
      return next.length > limit ? next.slice(next.length - limit) : next;
    };

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });

    if (options.stdin) child.stdin.end(options.stdin);

    const timer = setTimeout(() => {
      timedOutProcesses.add(child.pid);
      killProcessTree(child.pid, options.log);
      stderr = append(stderr, `\nTimed out after ${options.timeoutMs}ms`);
    }, options.timeoutMs || 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - started;
      options.log?.(`${command} ${redactArgs(args).join(' ')} exit=${code} durationMs=${duration}`);
      const finalCode = timedOutProcesses.has(child.pid) ? 124 : (code ?? 1);
      timedOutProcesses.delete(child.pid);
      resolve({ code: finalCode, stdout: redact(stdout), stderr: redact(stderr) });
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      options.log?.(`${command} failed to start: ${error.message}`);
      resolve({ code: 1, stdout, stderr: redact(error.message) });
    });
  });
}

function killProcessTree(pid, log) {
  if (!pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', (error) => log?.(`taskkill failed for pid=${pid}: ${error.message}`));
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    log?.(`process kill failed for pid=${pid}: ${error.message}`);
  }
}

function wrapWindowsCommand(command, args, options) {
  if (process.platform === 'win32' && options.windowsCmd) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['call', quoteCmd(command), ...args.map(quoteCmd)].join(' ')],
      windowsVerbatimArguments: true,
    };
  }
  return { command, args };
}

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function summarizeOutput(result) {
  return safeError(`${result.stderr || ''}\n${result.stdout || ''}`.trim()).slice(0, 1200);
}

function stageError(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  return error;
}

function safeSlug(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function redactArgs(args) {
  return args.map((arg, index) => {
    if (index > 0 && args[index - 1] === '-p' && String(arg).length > 200) return '[prompt]';
    return redact(arg);
  });
}

function redact(value) {
  let text = String(value || '')
    .replace(/sk-ant-[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]');
  for (const secret of [
    workerSecret,
    callbackSecret,
    process.env.JIRA_AUTH_HEADER,
    process.env.SLACK_BOT_TOKEN,
    process.env.FIGMA_ACCESS_TOKEN,
    process.env.FIGMA_WEBHOOK_PASSCODE,
    process.env.LOCAL_WORKER_SECRET,
    process.env.N8N_CALLBACK_SECRET,
  ]) {
    if (secret) text = text.split(secret).join('[redacted-secret]');
  }
  return text;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error('Request body too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function resolveClaudeCommand() {
  if (env('CLAUDE_COMMAND')) return env('CLAUDE_COMMAND');
  if (process.platform === 'win32') {
    const candidates = [
      process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'claude.cmd') : '',
      process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'claude.cmd') : '',
      'claude.cmd',
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (candidate === 'claude.cmd' || existsSync(candidate)) return candidate;
    }
  }
  return 'claude';
}

function buildPlaywrightMcpConfig() {
  const config = {
    mcpServers: {
      playwright: {
        type: 'stdio',
        command: env('PLAYWRIGHT_MCP_COMMAND', 'npx'),
        args: [
          '-y',
          env('PLAYWRIGHT_MCP_PACKAGE', '@playwright/mcp@latest'),
          '--headless',
          '--browser',
          env('PLAYWRIGHT_MCP_BROWSER', 'chrome'),
          '--output-dir',
          env('PLAYWRIGHT_MCP_OUTPUT_DIR', '.automation/playwright-mcp'),
          '--timeout-navigation',
          env('PLAYWRIGHT_MCP_TIMEOUT_NAVIGATION', '90000'),
          '--timeout-action',
          env('PLAYWRIGHT_MCP_TIMEOUT_ACTION', '10000'),
        ],
      },
    },
  };
  return env('PLAYWRIGHT_MCP_CONFIG_JSON', JSON.stringify(config));
}

function safeCompare(expected, provided) {
  const left = Buffer.from(String(expected || ''));
  const right = Buffer.from(String(provided || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    if (process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
