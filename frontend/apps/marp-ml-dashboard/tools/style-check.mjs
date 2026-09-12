/**
 * Makes two of DESIGN.md's rules enforced rather than requested.
 *
 * 1. No raw hex colour in a stylesheet. The palette lives in the shared tokens
 *    file, and the Mosaic Reviewer already paid for breaking this: its palette
 *    was hand-copied into the video player and the copy referenced an
 *    --amber-300 that had never been declared anywhere. A declaration that
 *    genuinely needs a literal carries `token-exempt` and a reason.
 *
 * 2. No state outside the vocabulary. Eight tabs drawn by different people
 *    otherwise grow a ninth state that only one screen knows how to colour, and
 *    it renders grey with no indication that anything is wrong.
 *
 * Runs in well under a second, so it belongs in the working loop next to the
 * parse check.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'test-results', 'demo', 'shots', '.git', 'fixtures']);

/* The vocabulary. DESIGN.md, "State". Adding one here is the deliberate act
   that adding one in a tab is not. */
const STATES = new Set([
  'running', 'queued', 'done', 'succeeded', 'issues', 'failed', 'cancelled',
  'cancelling', 'paused', 'online', 'idle', 'busy', 'offline', 'draining',
  /* a model's own lifecycle: usable, being evaluated, artifact unusable */
  'ready', 'testing', 'error',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(m?js|css|html)$/.test(entry)) out.push(path);
  }
  return out;
}

/* Comments are blanked rather than removed, so the line numbers reported still
   match the file. Without this, every `MARP_API#104` in a comment reads as a
   three-digit hex colour -- which is exactly what happened first time. */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const problems = [];
/* A hex only counts inside a declaration value: after the colon, before the
   semicolon or the closing brace. */
const HEX_DECL = /:[^;{}]*#[0-9a-fA-F]{3,8}\b/;
/* Only a literal state is checkable here. A computed one (dataState: job.state)
   is covered by the fixture test, which asserts every row's state is in the
   enum. */
const STATE_LIT = /(?:data-state=|dataState:\s*)['"]([a-z-]+)['"]/g;

for (const file of walk(root)) {
  const raw = readFileSync(file, 'utf8');
  const isCss = file.endsWith('.css');
  const text = isCss ? blankComments(raw) : raw;
  const rawLines = raw.split(/\r?\n/);

  text.split(/\r?\n/).forEach((line, i) => {
    const where = `${relative(root, file)}:${i + 1}`;
    if (isCss && HEX_DECL.test(line) && !rawLines[i].includes('token-exempt')) {
      problems.push(`${where}  raw hex colour: ${line.trim().slice(0, 90)}`);
    }
    for (const m of line.matchAll(STATE_LIT)) {
      if (!STATES.has(m[1])) {
        problems.push(`${where}  state "${m[1]}" is not in the vocabulary (DESIGN.md, State)`);
      }
    }
  });
}

if (problems.length) {
  for (const p of problems) console.error('[x] ' + p);
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  console.error('A literal that genuinely has to be there carries `token-exempt` and a reason.');
  process.exit(1);
}

console.log('ok  no raw colours, no states outside the vocabulary');
