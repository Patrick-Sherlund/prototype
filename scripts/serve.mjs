import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const host = '127.0.0.1';
let port = Number(process.env.PORT || 5173);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function fileForUrl(url) {
  const parsed = new URL(url, `http://${host}:${port}`);
  const relative = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
  const file = path.normalize(path.join(root, relative));
  if (!file.startsWith(root)) return null;
  return file;
}

function makeServer() {
  return createServer((request, response) => {
    const file = fileForUrl(request.url || '/');
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const ext = path.extname(file);
    response.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
}

function listen() {
  const server = makeServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      port += 1;
      listen();
      return;
    }
    throw error;
  });
  server.listen(port, host, () => {
    console.log(`Serving ${root} at http://${host}:${port}/`);
  });
}

listen();
