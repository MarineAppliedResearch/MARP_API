/**
 * A static server for the two public pages, with no dependencies.
 *
 * It serves `frontend/` rather than the app folder, because both pages link
 * `/assets/css/landing.css` and `/assets/js/landing.js` out of `shared/`. On top
 * of that it reproduces the two routes `app.js` gives these pages: `/` and
 * `/how-it-works` are handlers there, not files on disk, so a plain file server
 * answers 404 for both.
 *
 * **Reproducing them is the compromise this file is.** A run against this server
 * cannot tell you that `app.js` still routes `/how-it-works` -- it answers that
 * question itself. `tests/landing-copy.test.js` asserts the route instead, which
 * is why that assertion is in the fast tier rather than here. Set
 * `MARP_API_BASE` to run the same specs against a real API and remove the doubt.
 *
 *   node tools/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = normalize(join(HERE, '..', '..', '..'));      // frontend/
const PORT = Number(process.argv[2] || process.env.PORT || 8124);

/** The routes `app.js` serves by hand, and the file each one sends. */
const ROUTES = {
  '/': 'apps/entry/index.html',
  '/how-it-works': 'apps/entry/how-it-works.html'
};

/**
 * `app.js` mounts `/assets` on `frontend/shared/assets`, and both pages link the
 * stylesheet, the script and every image through it. Without the same alias here
 * the pages load with no CSS and no JS, which looks like a broken page rather
 * than a broken server.
 */
function resolve(path) {
  if (path in ROUTES) return ROUTES[path];
  if (path.startsWith('/assets/')) return `shared${path}`;

  return path;
}

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
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, resolve(path)));

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
  console.log(`  landing      http://localhost:${PORT}/`);
  console.log(`  how it works http://localhost:${PORT}/how-it-works`);
});
