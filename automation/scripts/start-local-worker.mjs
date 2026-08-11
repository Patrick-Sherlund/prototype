import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
loadDotEnv(join(repoRoot, '.env'));

const port = Number(process.env.LOCAL_WORKER_PORT || '8787');
const healthUrl = `http://127.0.0.1:${port}/healthz`;
const automationDir = join(repoRoot, '.automation');
mkdirSync(automationDir, { recursive: true });

const existing = await health();
if (existing.ok) {
  console.log(`Local worker already healthy at ${healthUrl}`);
  process.exit(0);
}

const stdout = createWriteStream(join(automationDir, 'worker.stdout.log'), { flags: 'a' });
const stderr = createWriteStream(join(automationDir, 'worker.stderr.log'), { flags: 'a' });
const child = spawn(process.execPath, ['automation/local-worker/worker.mjs'], {
  cwd: repoRoot,
  detached: true,
  stdio: ['ignore', stdout, stderr],
  windowsHide: true,
});

writeFileSync(join(automationDir, 'local-worker.pid'), String(child.pid));
child.unref();
stdout.unref();
stderr.unref();

for (let attempt = 1; attempt <= 20; attempt += 1) {
  await delay(500);
  const result = await health();
  if (result.ok) {
    console.log(`Local worker started pid=${child.pid} health=${healthUrl}`);
    process.exit(0);
  }
}

console.error(`Local worker did not become healthy. Check .automation/worker.stderr.log`);
process.exit(1);

async function health() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
