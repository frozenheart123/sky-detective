// Local development server: static files from public/ plus the same api/*.js handlers Vercel runs.
// Usage: npm run dev   (then open http://127.0.0.1:8766)
// AI-assisted: written with Claude Code (Anthropic).
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8766;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const apiName = /^\/api\/([a-z]+)$/.exec(url.pathname);
    if (apiName) {
      const mod = await import(pathToFileURL(path.join(ROOT, 'api', apiName[1] + '.js')).href);
      return await mod.default(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    const missing = e && (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ERR_MODULE_NOT_FOUND');
    if (!res.headersSent) res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing ? 'Not found' : 'Server error: ' + ((e && e.message) || e));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Sky Detective dev server: http://127.0.0.1:${PORT}`));
