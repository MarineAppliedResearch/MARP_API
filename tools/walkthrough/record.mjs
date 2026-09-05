/**
 * Records walkthroughs and leaves mp4s in the output directory. Shared by every
 * application; extracted from marp-mosaic-review (ADR-0007).
 *
 * Narration is optional and never fatal. When it is on, each line is spoken first and
 * measured, so the walkthrough can hold each caption for exactly as long as its narration
 * takes — otherwise the next line talks over the last one.
 *
 * **This is development tooling.** Nothing in an application or the API may depend on it,
 * and it must never be the reason a build fails. With no speech engine, no ffmpeg, or no
 * network it says why and leaves the silent video alone.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { narrate, synthesize, pickEngine } from './narrate.mjs';

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

/**
 * @param {object} options
 * @param {object} options.scenarios    every scenario, keyed by id
 * @param {string[]} [options.argv]     command line, default process.argv.slice(2)
 * @param {string} [options.outDir]     where videos land. Default `demo`.
 * @param {string} [options.results]    Playwright's output directory. Default `test-results`.
 * @param {string} [options.project]    Playwright project name. Default `walkthrough`.
 * @param {string} [options.defaultId]  what runs with no argument. Default: the first scenario.
 */
export async function recordWalkthroughs({
  scenarios,
  argv = process.argv.slice(2),
  outDir = 'demo',
  results = 'test-results',
  project = 'walkthrough',
  defaultId,
} = {}) {
  const ids = Object.keys(scenarios);
  const narrating = argv.includes('--narrate');
  const named = argv.filter((a) => !a.startsWith('--'));

  const wanted = named.includes('all') ? ids
    : named.length ? named
    : [defaultId || ids[0]];

  for (const id of wanted) {
    if (!scenarios[id]) {
      console.error(`unknown scenario "${id}" — try: ${ids.join(', ')}`);
      process.exit(1);
    }
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

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
    rmSync(results, { recursive: true, force: true });

    /* Speak the lines first, so the walkthrough knows how long to hold each one.
       Without this the captions advance on a timer and lines overlap. */
    let clips = null;
    const holdsPath = join(outDir, `${id}.holds.json`);
    if (narrating) {
      clips = synthesize(scenario.scenes.map((s) => s.say), join(outDir, `.audio-${id}`));
      if (clips) {
        writeFileSync(holdsPath, JSON.stringify(clips.map((c) => c.ms)));
        console.log(`spoke ${clips.length} lines (${Math.round(clips.reduce((a, c) => a + c.ms, 0) / 1000)}s of audio)`);
      } else {
        console.log('could not synthesise speech — this run will be silent');
        rmSync(holdsPath, { force: true });
      }
    } else {
      rmSync(holdsPath, { force: true });
    }

    try {
      execFileSync('npx', ['playwright', 'test', `--project=${project}`, '--reporter=line'], {
        stdio: 'inherit', shell: true, env: { ...process.env, SCENARIO: id }
      });
    } catch {
      console.error(`\n${id}: the walkthrough failed — no video written, because it would be misleading`);
      process.exitCode = 1;
      continue;
    }

    const webm = findVideo(results);
    if (!webm) { console.error(`${id}: no video was produced`); process.exitCode = 1; continue; }

    const silent = join(outDir, `${id}-${stamp}.mp4`);
    const ff = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', webm,
      '-vf', 'scale=1280:-2:flags=lanczos',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '23',
      '-movflags', '+faststart', silent
    ], { shell: false });

    let video = silent;
    if (ff.status !== 0) {
      video = join(outDir, `${id}-${stamp}.webm`);
      copyFileSync(webm, video);
      console.log(`ffmpeg not available — kept ${video}`);
    }

    if (narrating && clips) {
      const spoken = join(outDir, `${id}-${stamp}-narrated.mp4`);
      const r = narrate({
        video, clips, timeline: join(outDir, `${id}.timeline.json`), out: spoken
      });
      console.log(r.ok
        ? `wrote ${r.out}  (${r.spoken} lines, ${r.engine})`
        : `narration skipped: ${r.reason} — ${video} is unchanged`);
      made.push(r.ok ? r.out : video);
    } else {
      console.log(`wrote ${video}`);
      made.push(video);
    }

    rmSync(join(outDir, `.audio-${id}`), { recursive: true, force: true });
  }

  rmSync(results, { recursive: true, force: true });
  console.log(`\n${made.length} video${made.length === 1 ? '' : 's'}:`);
  made.forEach((m) => console.log(`  ${m}`));
  return made;
}
