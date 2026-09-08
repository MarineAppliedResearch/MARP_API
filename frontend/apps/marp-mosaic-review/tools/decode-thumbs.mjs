/**
 * Turn base64 text files in `fixtures/thumbs/` back into images.
 *
 * This exists because of a specific limitation. The imagery for #80 is produced by an
 * agent whose GitHub connector can create branches, commits and **text** files, but has
 * no binary upload — so it can describe a JPEG perfectly and cannot commit one. Base64 is
 * text, so the bytes can travel as `bat-star-01.jpg.b64` and be turned back into
 * `bat-star-01.jpg` here.
 *
 * The `.b64` files are a transport, not an artefact: they are decoded and deleted in the
 * same run, so what lands in the tree is the image. Nothing else in the app knows this
 * step exists.
 *
 *   node tools/decode-thumbs.mjs            decode, verify, delete the .b64 files
 *   node tools/decode-thumbs.mjs --keep     leave the .b64 files in place
 *
 * A `SHA256SUMS` file in the same folder, if present, is checked: a base64 blob that
 * survived a copy-paste with a character missing still decodes to *something*, and a
 * silently corrupt JPEG is far worse than a loud failure.
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THUMBS = join(HERE, '..', 'fixtures', 'thumbs');
const KEEP = process.argv.includes('--keep');

/** Expected hashes, if whoever produced the files published them. */
function expectedSums() {
  const file = join(THUMBS, 'SHA256SUMS');
  if (!existsSync(file)) return null;
  const out = new Map();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (m) out.set(basename(m[2]), m[1].toLowerCase());
  }
  return out.size ? out : null;
}

const sums = expectedSums();
const files = readdirSync(THUMBS).filter((f) => f.toLowerCase().endsWith('.b64')).sort();

if (!files.length) {
  console.log('No .b64 files in fixtures/thumbs — nothing to decode.');
  process.exit(0);
}

let ok = 0;
const problems = [];

for (const f of files) {
  const target = f.replace(/\.b64$/i, '');
  const raw = readFileSync(join(THUMBS, f), 'utf8');

  /* Tolerate what a text round trip does to base64: wrapped lines, whitespace, and a
     `data:image/jpeg;base64,` prefix if it came from somewhere that adds one. */
  const cleaned = raw.replace(/^\s*data:[^,]*,/, '').replace(/\s+/g, '');
  if (!cleaned) { problems.push(`${f}: empty`); continue; }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    problems.push(`${f}: not base64 — it contains characters base64 never uses`);
    continue;
  }

  const bytes = Buffer.from(cleaned, 'base64');
  if (bytes.length < 1024) {
    problems.push(`${f}: decoded to ${bytes.length} bytes, which is not an image`);
    continue;
  }

  /* Check the magic number rather than trusting the extension: a JPEG starts FF D8 FF and
     a PNG with the 8-byte signature. Something that decodes but is not an image would
     otherwise sit in the fixture looking fine until a tile drew nothing. */
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isPng = bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  const isWebp = bytes.slice(0, 4).toString('ascii') === 'RIFF'
    && bytes.slice(8, 12).toString('ascii') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    problems.push(`${f}: decoded ${bytes.length} bytes, but they are not a JPEG, PNG or WebP`);
    continue;
  }

  if (sums && sums.has(target)) {
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== sums.get(target)) {
      problems.push(`${f}: SHA-256 mismatch\n      expected ${sums.get(target)}\n      got      ${got}`);
      continue;
    }
  }

  writeFileSync(join(THUMBS, target), bytes);
  if (!KEEP) unlinkSync(join(THUMBS, f));
  const kb = (bytes.length / 1024).toFixed(0);
  const checked = sums && sums.has(target) ? ' (hash verified)' : '';
  console.log(`  ${target}  ${kb} KB${checked}`);
  ok++;
}

console.log(`\ndecoded ${ok} of ${files.length}`);
if (problems.length) {
  console.error('\nFailed:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Now run: node tools/make-fixture.mjs');
