import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(resolve(repoRoot, '.env'));

const args = parseArgs(process.argv.slice(2));
const workerBase = args.worker || `http://127.0.0.1:${process.env.LOCAL_WORKER_PORT || '8787'}`;
const callbackBase = args.callback || process.env.N8N_WEBHOOK_URL;

for (const [name, value] of [
  ['LOCAL_WORKER_SECRET', process.env.LOCAL_WORKER_SECRET],
  ['local worker URL', workerBase],
  ['N8N_WEBHOOK_URL or --callback', callbackBase],
  ['FIGMA_MAKE_FILE_KEY or --file-key', args['file-key'] || process.env.FIGMA_MAKE_FILE_KEY],
]) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const issue = args.issue || 'SYSCO-1';
const fileKey = args['file-key'] || process.env.FIGMA_MAKE_FILE_KEY;
const versionId = args['version-id'] || `manual-${Date.now()}`;
const handoffId = `${fileKey}:${versionId}`;

const payload = {
  jira_key: issue,
  jira_summary: args.summary || 'Manual Figma handoff test',
  jira_description: args.description || '',
  jira_url: `${(process.env.JIRA_BASE_URL || '').replace(/\/$/, '')}/browse/${issue}`,
  correlation_id: `${issue}-${versionId}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-'),
  handoff_id: handoffId,
  n8n_callback_url: `${callbackBase.replace(/\/$/, '')}/webhook/poc/figma/handoff/completion`,
  slack_channel_id: process.env.SLACK_CHANNEL_ID || '',
  slack_thread_ts: args['thread-ts'] || '',
  source: {
    figma_make_file_key: fileKey,
    figma_file_name: args['file-name'] || '',
    figma_version_id: versionId,
    figma_version_label: args.label || `${issue} | Ready for Design`,
    figma_version_description: args['version-description'] || '',
    figma_version_created_at: new Date().toISOString(),
    figma_make_url: args['make-url'] || process.env.FIGMA_MAKE_URL || '',
    figma_make_published_url: args['published-url'] || process.env.FIGMA_MAKE_PUBLISHED_URL || '',
  },
  destination: {
    figma_design_file_key: args['destination-file-key'] || process.env.FIGMA_DESTINATION_FILE_KEY || '',
    figma_design_url: args['destination-url'] || process.env.FIGMA_DESTINATION_FILE_URL || '',
  },
};

const response = await fetch(`${workerBase.replace(/\/$/, '')}/poc/figma/handoff/start`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-poc-worker-secret': process.env.LOCAL_WORKER_SECRET,
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(
  JSON.stringify(
    {
      ok: response.ok,
      status: response.status,
      worker: workerBase,
      handoff_id: handoffId,
      response: parseJson(text),
    },
    null,
    2,
  ),
);

if (!response.ok) process.exit(1);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
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
