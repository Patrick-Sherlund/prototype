import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const pidPath = join(repoRoot, '.automation', 'local-worker.pid');

if (!existsSync(pidPath)) {
  console.log('No local worker pid file found.');
  process.exit(0);
}

const pid = Number(readFileSync(pidPath, 'utf8').trim());
if (!Number.isInteger(pid) || pid <= 0) {
  rmSync(pidPath, { force: true });
  console.log('Removed invalid local worker pid file.');
  process.exit(0);
}

try {
  process.kill(pid);
  console.log(`Stopped local worker pid=${pid}`);
} catch (error) {
  console.log(`Local worker pid=${pid} was not running: ${error.message}`);
}

rmSync(pidPath, { force: true });
