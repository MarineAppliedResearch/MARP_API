/**
 * Records a walkthrough and leaves an mp4 in demo/.
 *
 *   npm run demo                      the default scenario, silent
 *   npm run demo -- delete            a named scenario
 *   npm run demo:narrated -- review   spoken
 *   npm run demo -- all --narrate     every scenario
 *
 * Narration is optional and never fatal. When it is on, each line is spoken first
 * and measured, so the walkthrough can hold each caption for exactly as long as its
 * narration takes — otherwise the next line talks over the last one.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { narrate, synthesize, pickEngine } from './narrate.mjs';
import { scenarios, scenarioIds } from '../tests/walkthrough/scenarios.mjs';

const OUT = 'demo';
const RESULTS = 'test-results';

const args = process.argv.slice(2);
const narrating = args.includes('--narrate');
const named = args.filter((a) => !a.startsWith('--'));
const wanted = named.includes('all') || named.length === 0
  ? (named.includes('all') ? scenarioIds : ['review'])
  : named;

for (const id of wanted) {
  if (!scenarios[id]) {
    console.error(`unknown scenario "${id}" — try: ${scenarioIds.join(', ')}`);
    process.exit(1);
  }
}

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

/** Playwright drops the video under a per-test folder; find it. */
function findVideo(dir) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findVideo(path); if (hit) return hit; }
    else if (entry.name.endsWith('.webm')) return path;
  }
  return null;
}

if (narrating) {
  const engine = pickEngine();
  console.log(engine
    ? `narration: ${engine.name} — ${engine.what}`
    : 'narration: no speech engine found, the videos will be silent');
}

const made = [];

for (const id of wanted) {
  const scenario = scenarios[id];
  console.log(`\n── ${scenario.title} ──`);
  rmSync(RESULTS, { recursive: true, force: true });

  /* Speak the lines first, so the walkthrough knows how long to hold each one.
     Without this the captions advance on a timer and lines overlap. */
  let clips = null;
  if (narrating) {
    clips = synthesize(scenario.scenes.map((s) => s.say), join(OUT, `.audio-${id}`));
    if (clips) {
      writeFileSync(join(OUT, `${id}.holds.json`), JSON.stringify(clips.map((c) => c.ms)));
      console.log(`spoke ${clips.length} lines (${Math.round(clips.reduce((a, c) => a + c.ms, 0) / 1000)}s of audio)`);
    } else {
      console.log('could not synthesise speech — this run will be silent');
      rmSync(join(OUT, `${id}.holds.json`), { force: true });
    }
  } else {
    rmSync(join(OUT, `${id}.holds.json`), { force: true });
  }

  try {
    execFileSync('npx', ['playwright', 'test', '--project=walkthrough', '--reporter=line'], {
      stdio: 'inherit', shell: true, env: { ...process.env, SCENARIO: id }
    });
  } catch {
    console.error(`\n${id}: the walkthrough failed — no video written, because it would be misleading`);
    process.exitCode = 1;
    continue;
  }

  const webm = findVideo(RESULTS);
  if (!webm) { console.error(`${id}: no video was produced`); process.exitCode = 1; continue; }

  const silent = join(OUT, `${id}-${stamp}.mp4`);
  const ff = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', webm,
    '-vf', 'scale=1280:-2:flags=lanczos',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '23',
    '-movflags', '+faststart', silent
  ], { shell: false });

  let video = silent;
  if (ff.status !== 0) {
    video = join(OUT, `${id}-${stamp}.webm`);
    copyFileSync(webm, video);
    console.log(`ffmpeg not available — kept ${video}`);
  }

  if (narrating && clips) {
    const spoken = join(OUT, `${id}-${stamp}-narrated.mp4`);
    const r = narrate({
      video, clips, timeline: join(OUT, `${id}.timeline.json`), out: spoken
    });
    console.log(r.ok
      ? `wrote ${r.out}  (${r.spoken} lines, ${r.engine})`
      : `narration skipped: ${r.reason} — ${video} is unchanged`);
    made.push(r.ok ? r.out : video);
  } else {
    console.log(`wrote ${video}`);
    made.push(video);
  }

  rmSync(join(OUT, `.audio-${id}`), { recursive: true, force: true });
}

rmSync(RESULTS, { recursive: true, force: true });
console.log(`\n${made.length} video${made.length === 1 ? '' : 's'}:`);
made.forEach((m) => console.log(`  ${m}`));
