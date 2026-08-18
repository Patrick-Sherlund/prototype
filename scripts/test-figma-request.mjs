import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(resolve(repoRoot, '.env'));

const args = parseArgs(process.argv.slice(2));
const endpoint =
  args.endpoint ||
  (process.env.N8N_WEBHOOK_URL ? `${process.env.N8N_WEBHOOK_URL.replace(/\/$/, '')}/webhook/poc/figma/handoff/request` : '');
const issue = args.issue || 'SYSCO-20';
const request =
  args.request ||
  'Run a full Figma Make to Figma Design synchronization. Discover every meaningful SAR Questionnaire view/state, capture every reachable view, and update the canonical Figma Design file without creating duplicate screen frames.';
const makeUrl = args['make-url'] || process.env.FIGMA_MAKE_URL || '';
const fileKey = args['file-key'] || process.env.FIGMA_MAKE_FILE_KEY || fileKeyFromMakeUrl(makeUrl);
const requestId = args['request-id'] || `mcp-request-${Date.now()}`;

if (!endpoint) {
  console.error('Missing N8N_WEBHOOK_URL or --endpoint');
  process.exit(1);
}

const payload = {
  jiraKey: issue,
  request,
  requestId,
  triggerSource: 'manual-test',
  figmaMakeUrl: makeUrl,
  figmaMakeFileKey: fileKey,
  label: `${issue} | MCP Design Request`,
  figmaMakePublishedUrl: args['published-url'] || process.env.FIGMA_MAKE_PUBLISHED_URL || '',
};

const headers = { 'Content-Type': 'application/json' };
if (process.env.FIGMA_HANDOFF_REQUEST_SECRET) headers['x-poc-request-secret'] = process.env.FIGMA_HANDOFF_REQUEST_SECRET;

const response = await fetch(endpoint, {
  method: 'POST',
  headers,
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
      requestId,
      fileKey,
      response: text.slice(0, 500),
    },
    null,
    2,
  ),
);

if (!response.ok) process.exit(1);

function fileKeyFromMakeUrl(url) {
  const match = String(url || '').match(/figma\.com\/make\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
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
