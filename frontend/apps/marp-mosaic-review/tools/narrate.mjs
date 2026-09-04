/**
 * Speaks a walkthrough's captions over its video.
 *
 * Development tooling only — nothing here is part of the application or the API,
 * and nothing depends on it. Narration is a nicety: if no speech engine is present,
 * or ffmpeg is missing, or the network is down, this reports why and leaves the
 * silent video alone. It must never be the reason a demo fails.
 *
 * Engines are tried in order of quality:
 *
 *   edge-tts   neural, free, no key — but it calls a Microsoft endpoint, so the
 *              caption text leaves the machine and it needs internet
 *   sapi       the Windows built-in voices: local and offline, but robotic
 *
 * Swapping in a paid API, or a local neural engine such as Piper, means adding one
 * entry to ENGINES.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* shell:false — quoting an inline python import through a shell mangles it, which
   silently made edge-tts look unavailable and fell back to the robotic voice. */
const has = (cmd, args = ['--version']) =>
  spawnSync(cmd, args, { shell: false, stdio: 'ignore' }).status === 0;

const ENGINES = [
  {
    name: 'edge-tts',
    what: 'neural voices, free, sends text to a Microsoft endpoint',
    voice: process.env.NARRATE_VOICE || 'en-GB-RyanNeural',
    available: () => has('python', ['-c', 'import edge_tts']),
    speak(text, out) {
      return spawnSync('python', ['-m', 'edge_tts',
        '--voice', this.voice, '--text', text, '--write-media', out],
        { shell: false, stdio: 'ignore' }).status === 0;
    }
  },
  {
    name: 'sapi',
    what: 'the Windows built-in voices: local and offline, but robotic',
    voice: process.env.NARRATE_VOICE || '',
    available: () => process.platform === 'win32',
    speak(text, out) {
      /* SAPI writes wav; ffmpeg does not mind the extension difference. */
      const ps = `Add-Type -AssemblyName System.Speech;`
        + `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;`
        + (this.voice ? `$s.SelectVoice('${this.voice}');` : '')
        + `$s.SetOutputToWaveFile(${JSON.stringify(out)});`
        + `$s.Speak(${JSON.stringify(text)}); $s.Dispose()`;
      return spawnSync('powershell', ['-NoProfile', '-Command', ps],
        { shell: false, stdio: 'ignore' }).status === 0;
    }
  }
];

/** @returns the first usable engine, or null when there is no voice at all. */
export function pickEngine() {
  for (const e of ENGINES) {
    try { if (e.available()) return e; } catch { /* try the next one */ }
  }
  return null;
}

/**
 * Mix spoken captions onto a video.
 * @returns {{ok: boolean, reason?: string, out?: string}}
 */
export function narrate({ video, timeline, out, workDir = 'demo/.audio' }) {
  if (!existsSync(video)) return { ok: false, reason: `no video at ${video}` };
  if (!existsSync(timeline)) return { ok: false, reason: `no caption timeline at ${timeline}` };
  if (!has('ffmpeg', ['-version'])) return { ok: false, reason: 'ffmpeg is not installed' };

  const engine = pickEngine();
  if (!engine) return { ok: false, reason: 'no speech engine available' };

  const lines = JSON.parse(readFileSync(timeline, 'utf8'));
  if (!lines.length) return { ok: false, reason: 'the walkthrough recorded no captions' };

  mkdirSync(workDir, { recursive: true });
  console.log(`narrating with ${engine.name} (${engine.what})`);

  const clips = [];
  for (const [i, line] of lines.entries()) {
    const file = join(workDir, `${String(i).padStart(3, '0')}.mp3`);
    if (engine.speak(line.text, file) && existsSync(file)) {
      clips.push({ file, at: line.at });
    } else {
      console.warn(`  could not speak: "${line.text.slice(0, 48)}…"`);
    }
  }
  if (!clips.length) return { ok: false, reason: `${engine.name} produced no audio` };

  /* Delay each clip to its caption's moment, then mix them into one track. */
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const delays = clips.map((c, i) =>
    `[${i + 1}:a]adelay=${Math.max(0, Math.round(c.at))}|${Math.max(0, Math.round(c.at))}[a${i}]`);
  const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0[out]`;

  const res = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', video, ...inputs,
    '-filter_complex', `${delays.join(';')};${mix}`,
    '-map', '0:v', '-map', '[out]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', out
  ], { shell: false });

  rmSync(workDir, { recursive: true, force: true });
  if (res.status !== 0) return { ok: false, reason: 'ffmpeg could not mix the audio' };
  return { ok: true, out, engine: engine.name, spoken: clips.length };
}

/** `node tools/narrate.mjs <video> <timeline> <out>` */
if (process.argv.length > 4) {
  const [video, timeline, out] = process.argv.slice(2);
  const r = narrate({ video, timeline, out });
  console.log(r.ok ? `wrote ${r.out}` : `narration skipped: ${r.reason}`);
}
