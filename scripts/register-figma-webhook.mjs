import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(resolve(repoRoot, '.env'));

const args = parseArgs(process.argv.slice(2));
const enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.FIGMA_WEBHOOK_ENABLED || 'false').toLowerCase());
if (!enabled && !args.force) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: 'FIGMA_WEBHOOK_ENABLED is not true; webhook registration is optional for the MCP-only POC.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const fileKey = args['file-key'] || process.env.FIGMA_MAKE_FILE_KEY;
const endpoint =
  args.endpoint ||
  (process.env.N8N_WEBHOOK_URL ? `${process.env.N8N_WEBHOOK_URL.replace(/\/$/, '')}/webhook/poc/figma/version-update` : '');

for (const [name, value] of [
  ['FIGMA_ACCESS_TOKEN', process.env.FIGMA_ACCESS_TOKEN],
  ['FIGMA_WEBHOOK_PASSCODE', process.env.FIGMA_WEBHOOK_PASSCODE],
  ['FIGMA_MAKE_FILE_KEY or --file-key', fileKey],
  ['N8N_WEBHOOK_URL or --endpoint', endpoint],
]) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const body = {
  event_type: 'FILE_VERSION_UPDATE',
  context: 'file',
  context_id: fileKey,
  endpoint,
  passcode: process.env.FIGMA_WEBHOOK_PASSCODE,
  description: args.description || 'n8n Figma Make design handoff',
};

const response = await fetch('https://api.figma.com/v2/webhooks', {
  method: 'POST',
  headers: figmaHeaders(),
  body: JSON.stringify(body),
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
  console.error(`Figma webhook registration failed (${response.status}): ${text.slice(0, 1000)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      webhook_id: data.id || data.webhook?.id || data.webhook_id || '',
      event_type: data.event_type || body.event_type,
      context: data.context || body.context,
      context_id: data.context_id || body.context_id,
      endpoint,
      status: data.status || '',
    },
    null,
    2,
  ),
);

function figmaHeaders() {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  const mode = (process.env.FIGMA_ACCESS_TOKEN_TYPE || 'oauth').toLowerCase();
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(mode === 'personal' ? { 'X-Figma-Token': token } : { Authorization: `Bearer ${token}` }),
  };
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
