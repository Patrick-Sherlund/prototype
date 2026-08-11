import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(process.env.LOCAL_WORKER_REPO_ROOT || join(here, '..', '..'));
loadDotEnv(join(repoRoot, '.env'));

const env = (name, fallback = '') => process.env[name] || fallback;
const bindHost = env('LOCAL_WORKER_BIND', '0.0.0.0');
const port = Number(env('LOCAL_WORKER_PORT', '8787'));
const workerSecret = requiredEnv('LOCAL_WORKER_SECRET');
const callbackSecret = requiredEnv('N8N_CALLBACK_SECRET');
const githubOwner = requiredEnv('GITHUB_OWNER');
const githubRepo = requiredEnv('GITHUB_REPO');
const githubToken = requiredEnv('GITHUB_DISPATCH_TOKEN');
const claudeCommand = resolveClaudeCommand();
const npmCommand = resolveNpmCommand();
const claudeMaxTurns = env('CLAUDE_MAX_TURNS', '24');

let activeJob = null;

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      return sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        busy: Boolean(activeJob),
        activeCorrelationId: activeJob?.correlation_id || '',
      });
    }

    if (request.method !== 'POST' || request.url !== '/poc/worker/start') {
      return sendJson(response, 404, { ok: false, error: 'not_found' });
    }

    if (!safeCompare(workerSecret, request.headers['x-poc-worker-secret'])) {
      return sendJson(response, 403, { ok: false, error: 'forbidden' });
    }

    if (activeJob) {
      return sendJson(response, 409, { ok: false, error: 'worker_busy', activeCorrelationId: activeJob.correlation_id });
    }

    const body = await readBody(request);
    const job = normalizeJob(JSON.parse(body || '{}'));
    activeJob = job;
    sendJson(response, 202, { ok: true, correlation_id: job.correlation_id, branch: branchName(job.jira_issue_key) });

    runJob(job)
      .catch((error) => console.error(redact(`Local worker uncaught failure: ${error.stack || error.message || error}`)))
      .finally(() => {
        activeJob = null;
      });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: redact(error.message || String(error)) });
  }
});

server.listen(port, bindHost, () => {
  console.log(`Local Claude worker listening on http://${bindHost}:${port}`);
});

async function runJob(job) {
  const state = {
    stage: 'LOCAL_WORKER_STARTED',
    issueKey: job.jira_issue_key,
    branch: branchName(job.jira_issue_key),
    runId: safeSlug(job.correlation_id),
    runUrl: `local-worker:${job.correlation_id}`,
    commitSha: '',
    prUrl: '',
    previewUrl: previewUrl(job.jira_issue_key, safeSlug(job.correlation_id)),
    claudeResult: 'not_started',
    buildResult: 'not_run',
  };

  const runDir = join(repoRoot, '.automation', 'runs', state.runId);
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, 'worker.log');
  const log = (message) => appendFileSync(logPath, `${new Date().toISOString()} ${redact(message)}\n`);

  try {
    log(`LOCAL_WORKER_STARTED issue=${state.issueKey} correlation=${job.correlation_id}`);
    await prepareBranch(state, log);

    state.stage = 'CLAUDE_STARTED';
    const promptPath = join(runDir, 'claude-prompt.md');
    writeFileSync(promptPath, buildClaudePrompt(job), 'utf8');
    const claude = await runCommand(
      claudeCommand,
      [
        '-p',
        '--max-turns',
        claudeMaxTurns,
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        'Read,Edit,MultiEdit,Write,Glob,Grep,LS,Bash(npm:*)',
        '--output-format',
        'json',
        '--no-session-persistence',
      ],
      {
        cwd: repoRoot,
        stdin: readFileSync(promptPath, 'utf8'),
        shell: process.platform === 'win32',
        timeoutMs: 15 * 60 * 1000,
        stripClaudeTokenEnv: true,
        log,
      },
    );
    state.claudeResult = claude.code === 0 ? 'success' : 'failure';
    if (claude.code !== 0) {
      const changed = await hasPrototypeChanges(log);
      if (claudeHitMaxTurns(claude) && changed) {
        state.claudeResult = 'max_turns_with_changes';
        log('CLAUDE_STARTED reached max turns after producing prototype changes; continuing to worker validation.');
      } else {
        throw new Error(`Claude Code failed (${claude.code}): ${summarizeOutput(claude)}`);
      }
    }

    state.stage = 'CODE_CHANGED';
    await ensurePrototypeChanged(log);

    state.stage = 'BUILD_PASSED';
    const build = await runCommand(npmCommand, ['run', 'build'], {
      cwd: repoRoot,
      shell: process.platform === 'win32',
      timeoutMs: 2 * 60 * 1000,
      log,
    });
    state.buildResult = build.code === 0 ? 'success' : 'failed';
    if (build.code !== 0) {
      throw new Error(`Production build failed (${build.code}): ${summarizeOutput(build)}`);
    }

    await commitAndPushBranch(state, log);

    state.stage = 'PR_CREATED';
    state.prUrl = await createOrUpdatePullRequest(job, state, log);

    state.stage = 'PREVIEW_DEPLOYED';
    await publishPreview(state, log);

    state.stage = 'N8N_CALLBACK_SENT';
    await sendCallback(job, state, 'success', '', log);
    log(`N8N_CALLBACK_SENT status=success issue=${state.issueKey}`);
  } catch (error) {
    log(`FAILED stage=${state.stage} error=${error.message || error}`);
    await sendCallback(job, state, 'failure', String(error.message || error).slice(0, 1200), log).catch((callbackError) => {
      log(`N8N_CALLBACK_SENT failed error=${callbackError.message || callbackError}`);
    });
  }
}

async function prepareBranch(state, log) {
  await runRequired('git', ['config', 'user.name', 'Prototype Automation'], { cwd: repoRoot, log });
  await runRequired('git', ['config', 'user.email', 'prototype-automation@example.invalid'], { cwd: repoRoot, log });
  await runRequired('git', ['fetch', 'origin', 'main'], { cwd: repoRoot, log });

  const dirtyBefore = await runRequired('git', ['status', '--porcelain'], { cwd: repoRoot, log });
  if (dirtyBefore.stdout.trim()) {
    throw new Error(`Working tree is not clean before automation starts: ${dirtyBefore.stdout.trim().split('\n')[0]}`);
  }

  const current = (await runRequired('git', ['branch', '--show-current'], { cwd: repoRoot, log })).stdout.trim();
  if (current !== 'main') {
    await runRequired('git', ['switch', 'main'], { cwd: repoRoot, log });
  }
  await runRequired('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: repoRoot, log });

  const remoteExists = (await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', state.branch], { cwd: repoRoot, log })).code === 0;
  const localExists = (await runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${state.branch}`], { cwd: repoRoot, log })).code === 0;

  if (remoteExists) {
    await runRequired('git', ['fetch', 'origin', `${state.branch}:refs/remotes/origin/${state.branch}`], { cwd: repoRoot, log });
    if (localExists) {
      await runRequired('git', ['switch', state.branch], { cwd: repoRoot, log });
      await runRequired('git', ['pull', '--ff-only', 'origin', state.branch], { cwd: repoRoot, log });
    } else {
      await runRequired('git', ['switch', '-c', state.branch, `origin/${state.branch}`], { cwd: repoRoot, log });
    }
    const merge = await runCommand('git', ['merge', '--no-edit', 'origin/main'], { cwd: repoRoot, log });
    if (merge.code !== 0) {
      throw new Error(`Could not merge origin/main into ${state.branch}: ${summarizeOutput(merge)}`);
    }
  } else if (localExists) {
    await runRequired('git', ['switch', state.branch], { cwd: repoRoot, log });
    const merge = await runCommand('git', ['merge', '--no-edit', 'origin/main'], { cwd: repoRoot, log });
    if (merge.code !== 0) {
      throw new Error(`Could not merge origin/main into existing local ${state.branch}: ${summarizeOutput(merge)}`);
    }
  } else {
    await runRequired('git', ['switch', '-c', state.branch, 'origin/main'], { cwd: repoRoot, log });
  }

  const dirtyAfter = await runRequired('git', ['status', '--porcelain'], { cwd: repoRoot, log });
  if (dirtyAfter.stdout.trim()) {
    throw new Error(`Working tree is not clean after branch checkout: ${dirtyAfter.stdout.trim().split('\n')[0]}`);
  }
}

async function ensurePrototypeChanged(log) {
  const changed = await hasPrototypeChanges(log);
  if (!changed) {
    throw new Error('Claude completed, but no prototype application changes were detected.');
  }
}

async function hasPrototypeChanges(log) {
  const diff = await runRequired('git', ['diff', '--', 'index.html', 'src', 'scripts', 'package.json', 'package-lock.json'], {
    cwd: repoRoot,
    log,
  });
  const staged = await runRequired('git', ['diff', '--cached', '--', 'index.html', 'src', 'scripts', 'package.json', 'package-lock.json'], {
    cwd: repoRoot,
    log,
  });
  return Boolean(diff.stdout.trim() || staged.stdout.trim());
}

async function commitAndPushBranch(state, log) {
  await runRequired('git', ['add', 'index.html', 'src', 'scripts', 'package.json', 'package-lock.json'], { cwd: repoRoot, log });
  const staged = await runRequired('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot, log, allowExitCodes: [0, 1] });
  if (staged.code === 1) {
    await runRequired('git', ['commit', '-m', `${state.issueKey}: implement prototype request`], { cwd: repoRoot, log });
  }

  const diffAgainstMain = await runRequired('git', ['diff', '--quiet', 'origin/main...HEAD'], {
    cwd: repoRoot,
    log,
    allowExitCodes: [0, 1],
  });
  if (diffAgainstMain.code === 0) {
    throw new Error('No committed prototype differences exist against origin/main.');
  }

  await runRequired('git', ['push', '--set-upstream', 'origin', state.branch], { cwd: repoRoot, log });
  state.commitSha = (await runRequired('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, log })).stdout.trim();
}

async function createOrUpdatePullRequest(job, state, log) {
  const repo = `${githubOwner}/${githubRepo}`;
  const body = [
    `Automated prototype update for ${state.issueKey}.`,
    '',
    `Correlation ID: ${job.correlation_id}`,
    `Slack channel: ${job.slack_channel_id}`,
    `Slack thread: ${job.slack_thread_ts}`,
    '',
    'Requested change:',
    job.requested_change,
    '',
    `Preview: ${state.previewUrl}`,
  ].join('\n');

  const params = new URLSearchParams({ state: 'open', base: 'main', head: `${githubOwner}:${state.branch}` });
  const existing = await githubApi(`/repos/${repo}/pulls?${params}`, { method: 'GET' });
  if (existing[0]?.number) {
    const updated = await githubApi(`/repos/${repo}/pulls/${existing[0].number}`, {
      method: 'PATCH',
      body: { title: `${state.issueKey} prototype update`, body },
    });
    log(`PR_CREATED updated=${updated.html_url}`);
    return updated.html_url;
  }

  const created = await githubApi(`/repos/${repo}/pulls`, {
    method: 'POST',
    body: {
      title: `${state.issueKey} prototype update`,
      head: state.branch,
      base: 'main',
      body,
    },
  });
  log(`PR_CREATED created=${created.html_url}`);
  return created.html_url;
}

async function publishPreview(state, log) {
  const pagesDir = join(repoRoot, '.automation', `gh-pages-${state.runId}`);
  await runCommand('git', ['worktree', 'remove', '--force', pagesDir], { cwd: repoRoot, log });
  rmSync(pagesDir, { recursive: true, force: true });

  const ghPagesExists = (await runCommand('git', ['ls-remote', '--exit-code', '--heads', 'origin', 'gh-pages'], { cwd: repoRoot, log })).code === 0;
  if (!ghPagesExists) {
    throw new Error('gh-pages branch does not exist. Configure GitHub Pages for gh-pages root before publishing previews.');
  }

  await runRequired('git', ['fetch', 'origin', 'gh-pages'], { cwd: repoRoot, log });
  await runRequired('git', ['worktree', 'add', '--force', '-B', 'gh-pages', pagesDir, 'origin/gh-pages'], { cwd: repoRoot, log });

  const previewPath = join(pagesDir, 'previews', state.issueKey, state.runId);
  const latestPath = join(pagesDir, 'previews', state.issueKey, 'latest');
  rmSync(previewPath, { recursive: true, force: true });
  rmSync(latestPath, { recursive: true, force: true });
  mkdirSync(dirname(previewPath), { recursive: true });
  mkdirSync(dirname(latestPath), { recursive: true });
  cpSync(join(repoRoot, 'dist'), previewPath, { recursive: true });
  cpSync(join(repoRoot, 'dist'), latestPath, { recursive: true });

  await runRequired('git', ['add', '--all'], { cwd: pagesDir, log });
  const changed = await runRequired('git', ['diff', '--cached', '--quiet'], { cwd: pagesDir, log, allowExitCodes: [0, 1] });
  if (changed.code === 1) {
    await runRequired('git', ['commit', '-m', `Publish preview for ${state.issueKey} ${state.runId}`], { cwd: pagesDir, log });
    await runRequired('git', ['push', 'origin', 'HEAD:gh-pages'], { cwd: pagesDir, log });
  }

  await runCommand('git', ['worktree', 'remove', '--force', pagesDir], { cwd: repoRoot, log });
  log(`PREVIEW_DEPLOYED ${state.previewUrl}`);
}

async function sendCallback(job, state, status, errorMessage, log) {
  const payload = {
    status,
    stage: state.stage,
    jira_issue_key: state.issueKey,
    correlation_id: job.correlation_id,
    slack_channel_id: job.slack_channel_id,
    slack_message_ts: job.slack_message_ts,
    slack_thread_ts: job.slack_thread_ts,
    requested_change: job.requested_change,
    branch: state.branch,
    commit_sha: state.commitSha,
    pr_url: state.prUrl,
    preview_url: state.previewUrl,
    build_result: status === 'success' ? 'success' : state.buildResult || 'failed',
    claude_result: state.claudeResult,
    run_url: state.prUrl || `https://github.com/${githubOwner}/${githubRepo}/tree/${state.branch}`,
    error_message: errorMessage,
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
  log(`N8N_CALLBACK_SENT status=${status} response=${response.status}`);
}

async function githubApi(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'local-claude-worker',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
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
    throw new Error(`GitHub API ${options.method || 'GET'} ${path} failed (${response.status}): ${text.slice(0, 700)}`);
  }

  return data;
}

async function runRequired(command, args, options = {}) {
  const result = await runCommand(command, args, options);
  const allowed = options.allowExitCodes || [0];
  if (!allowed.includes(result.code)) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.code}): ${summarizeOutput(result)}`);
  }
  return result;
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
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd || repoRoot,
        env: childEnv,
        windowsHide: true,
        shell: Boolean(options.shell),
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

    if (options.stdin) {
      child.stdin.end(options.stdin);
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr = append(stderr, `\nTimed out after ${options.timeoutMs}ms`);
    }, options.timeoutMs || 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - started;
      options.log?.(`${command} ${redactArgs(args).join(' ')} exit=${code} durationMs=${duration}`);
      resolve({ code: code ?? 1, stdout: redact(stdout), stderr: redact(stderr) });
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      options.log?.(`${command} failed to start: ${error.message}`);
      resolve({ code: 1, stdout, stderr: redact(error.message) });
    });
  });
}

function normalizeJob(input) {
  const required = [
    'jira_issue_key',
    'jira_summary',
    'requested_change',
    'slack_channel_id',
    'slack_message_ts',
    'slack_thread_ts',
    'correlation_id',
    'n8n_callback_url',
  ];
  for (const key of required) {
    if (!input[key]) throw new Error(`Missing ${key}`);
  }
  const issue = String(input.jira_issue_key).toUpperCase();
  if (!/^SYSCO-\d+$/.test(issue)) throw new Error(`Invalid SYSCO issue key: ${input.jira_issue_key}`);
  return {
    jira_issue_key: issue,
    jira_summary: String(input.jira_summary || '').slice(0, 1000),
    jira_description: String(input.jira_description || '').slice(0, 6000),
    requested_change: String(input.requested_change || '').slice(0, 6000),
    slack_channel_id: String(input.slack_channel_id || ''),
    slack_message_ts: String(input.slack_message_ts || ''),
    slack_thread_ts: String(input.slack_thread_ts || ''),
    requester_identity: String(input.requester_identity || ''),
    correlation_id: String(input.correlation_id || ''),
    n8n_callback_url: String(input.n8n_callback_url || ''),
  };
}

function buildClaudePrompt(job) {
  return [
    'You are Claude Code running as a local implementation worker for a rapid prototype.',
    '',
    `Jira issue: ${job.jira_issue_key}`,
    `Jira summary: ${job.jira_summary}`,
    '',
    'Jira context:',
    job.jira_description || '(No Jira description provided.)',
    '',
    'Slack-requested prototype change:',
    job.requested_change,
    '',
    'Repository constraints:',
    '- This is a small Sysco-themed foodservice ordering prototype.',
    '- Do not create an InTrac or custody-transfer prototype.',
    '- Preserve the existing visual language, colors, typography, layout density, and UX patterns.',
    '- Modify only relevant prototype application files such as index.html, src/, scripts/, package.json, or package-lock.json.',
    '- Do not edit automation, n8n workflow, GitHub Actions, Docker, documentation, secret, or environment files.',
    '- Do not redesign unrelated screens.',
    '- Keep the implementation intentionally small and obvious for a demo.',
    '- Run npm validation/build if practical; an outer worker will run npm run build after you finish.',
    '- Do not commit, push, create pull requests, or publish previews; the outer worker handles GitHub operations.',
    '',
    'Report briefly what you changed and any validation you ran.',
  ].join('\n');
}

function branchName(issueKey) {
  return `prototype/${issueKey}`;
}

function previewUrl(issueKey, runId) {
  return `https://${githubOwner.toLowerCase()}.github.io/${githubRepo}/previews/${issueKey}/${runId}/`;
}

function safeSlug(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function summarizeOutput(result) {
  return redact(`${result.stderr || ''}\n${result.stdout || ''}`.trim()).slice(0, 1200);
}

function claudeHitMaxTurns(result) {
  return /error_max_turns/.test(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function redactArgs(args) {
  return args.map((arg, index) => {
    if (index > 0 && args[index - 1] === '-p' && String(arg).length > 200) return '[prompt]';
    return redact(arg);
  });
}

function redact(value) {
  let text = String(value || '');
  for (const secret of [workerSecret, callbackSecret, githubToken, process.env.JIRA_AUTH_HEADER, process.env.SLACK_BOT_TOKEN]) {
    if (secret) text = text.split(secret).join('[redacted-secret]');
  }
  text = text.replace(/sk-ant-[A-Za-z0-9._-]+/g, '[redacted-token]');
  text = text.replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-token]');
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

function resolveNpmCommand() {
  if (env('NPM_COMMAND')) return env('NPM_COMMAND');
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'npm.cmd'),
      'npm.cmd',
    ];
    for (const candidate of candidates) {
      if (candidate === 'npm.cmd' || existsSync(candidate)) return candidate;
    }
  }
  return 'npm';
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
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}
