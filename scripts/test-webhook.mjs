import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(resolve(repoRoot, '.env'));

const args = parseArgs(process.argv.slice(2));
const endpoint =
  args.endpoint ||
  (process.env.N8N_WEBHOOK_URL ? `${process.env.N8N_WEBHOOK_URL.replace(/\/$/, '')}/webhook/poc/figma/version-update` : '');
const issue = args.issue || 'SYSCO-1';
const fileKey = args['file-key'] || process.env.FIGMA_MAKE_FILE_KEY || 'synthetic-make-file';
const versionId = args['version-id'] || `synthetic-${Date.now()}`;
const label = args.label || `${issue} | Ready for Design`;

if (!endpoint) {
  console.error('Missing N8N_WEBHOOK_URL or --endpoint');
  process.exit(1);
}
if (!process.env.FIGMA_WEBHOOK_PASSCODE && !args.passcode) {
  console.error('Missing FIGMA_WEBHOOK_PASSCODE or --passcode');
  process.exit(1);
}

const payload = {
  event_type: args['event-type'] || 'FILE_VERSION_UPDATE',
  file_key: fileKey,
  file_name: args['file-name'] || 'Synthetic Figma Make Project',
  version_id: versionId,
  label,
  description: args.description || '',
  created_at: new Date().toISOString(),
  timestamp: new Date().toISOString(),
  triggered_by: {
    id: 'synthetic',
    handle: 'Synthetic Tester',
  },
  passcode: args.passcode || process.env.FIGMA_WEBHOOK_PASSCODE,
  webhook_id: 'synthetic',
};

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(
  JSON.stringify(
    {
      ok: response.ok,
      status: response.status,
      endpoint,
      issue,
      file_key: fileKey,
      version_id: versionId,
      response: text.slice(0, 500),
    },
    null,
    2,
  ),
);

if (!response.ok) process.exit(1);

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
