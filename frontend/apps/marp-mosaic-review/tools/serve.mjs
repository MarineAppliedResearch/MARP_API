/**
 * A static server for the app, with no dependencies.
 *
 * It serves `frontend/` rather than the app folder, because the app links MARP's
 * shared design tokens at ../../shared/assets/css/tokens.css. That is the one
 * coupling to resolve if this application is ever extracted from MARP_API — either
 * vendor the tokens or take them as a package.
 *
 *   node tools/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = normalize(join(HERE, '..', '..', '..'));      // frontend/
const PORT = Number(process.argv[2] || process.env.PORT || 8123);
const APP = '/apps/marp-mosaic-review/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';

    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

    const info = await stat(file);
    if (info.isDirectory()) { res.writeHead(404).end('not found'); return; }

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store'          // tests must never see a stale build
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT}`);
  console.log(`  app   http://localhost:${PORT}${APP}`);
  console.log(`  tests http://localhost:${PORT}${APP}tests.html`);
});
