import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

if (!dist.startsWith(root)) {
  throw new Error(`Refusing to write outside workspace: ${dist}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'src'), { recursive: true });
await copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });

console.log(`Built static prototype in ${path.relative(root, dist)}`);
