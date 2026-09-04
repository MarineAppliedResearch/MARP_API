/**
 * Records a walkthrough of the app and leaves an mp4 in demo/.
 *
 * Playwright does the driving and the recording; this only runs it and converts the
 * .webm it produces. Replaces driving a browser by hand to make a video.
 *
 *   npm run demo
 *
 * ffmpeg is optional: without it the .webm is kept, which most things play.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'demo';
const RESULTS = 'test-results';

console.log('running the walkthrough…');
try {
  execFileSync('npx', ['playwright', 'test', '--project=walkthrough', '--reporter=line'],
    { stdio: 'inherit', shell: true });
} catch {
  console.error('\nthe walkthrough failed — no video written, because it would be misleading');
  process.exit(1);
}

/** Playwright drops the video under a per-test folder; find the newest one. */
function findVideo(dir) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findVideo(path); if (hit) return hit; }
    else if (entry.name.endsWith('.webm')) return path;
  }
  return null;
}

const webm = findVideo(RESULTS);
if (!webm) { console.error('no video was produced'); process.exit(1); }

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const target = join(OUT, `mosaic-review-${stamp}.mp4`);

const ff = spawnSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-i', webm,
  '-vf', 'scale=1280:-2:flags=lanczos',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '23',
  '-movflags', '+faststart', target
], { shell: true });

if (ff.status === 0) {
  console.log(`\nwrote ${target}`);
} else {
  const fallback = join(OUT, `mosaic-review-${stamp}.webm`);
  copyFileSync(webm, fallback);
  console.log(`\nffmpeg not available — kept ${fallback}`);
}
rmSync(RESULTS, { recursive: true, force: true });
