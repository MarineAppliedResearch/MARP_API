/**
 * Parses every JavaScript file in the app and fails on the first one that will not.
 *
 * There is no build step here, which is a feature — but it means nothing reads the
 * source before a browser does. A stray quote in `tests/requirements.js` took the
 * whole contract page down with `SyntaxError: missing ) after argument list`, and the
 * only symptom was a suite that hung for sixty seconds waiting for results that were
 * never going to arrive. This runs in about a second and says which file and line.
 *
 * Deliberately not a linter. It answers one question: will this parse?
 */
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'test-results', 'demo', '.git', 'fixtures']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(m?js)$/.test(entry)) out.push(path);
  }
  return out;
}

const files = walk(root);
const broken = [];

for (const file of files) {
  /* --check parses without executing, so a module with side effects is safe to test. */
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) broken.push({ file, why: (res.stderr || '').trim() });
}

if (broken.length) {
  for (const { file, why } of broken) {
    console.error(`\n✗ ${relative(root, file)}\n${why}\n`);
  }
  console.error(`${broken.length} file${broken.length === 1 ? '' : 's'} will not parse.`);
  process.exit(1);
}

console.log(`✓ ${files.length} files parse`);
