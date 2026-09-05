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

/** How long an audio file runs, in milliseconds. */
function durationMs(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file], { shell: false, encoding: 'utf8' });
  const secs = parseFloat((r.stdout || '').trim());
  return Number.isFinite(secs) ? Math.round(secs * 1000) : null;
}

/**
 * Speak each line and measure it.
 *
 * Measuring first is what stops lines talking over one another: the walkthrough
 * holds each caption for as long as its own narration runs.
 *
 * @returns {Array<{file: string, ms: number}>|null} null when there is no voice.
 */
export function synthesize(lines, workDir) {
  const engine = pickEngine();
  if (!engine) return null;
  if (!has('ffprobe', ['-version'])) return null;

  mkdirSync(workDir, { recursive: true });
  const clips = [];
  for (const [i, text] of lines.entries()) {
    const file = join(workDir, `${String(i).padStart(3, '0')}.mp3`);
    if (!engine.speak(text, file) || !existsSync(file)) {
      console.warn(`  could not speak: "${text.slice(0, 48)}…"`);
      return null;                       // a partial narration would desynchronise
    }
    clips.push({ file, ms: durationMs(file) ?? 3000, engine: engine.name });
  }
  return clips;
}

/**
 * Mix spoken captions onto a video.
 * @returns {{ok: boolean, reason?: string, out?: string}}
 */
export function narrate({ video, clips, timeline, out }) {
  if (!existsSync(video)) return { ok: false, reason: `no video at ${video}` };
  if (!existsSync(timeline)) return { ok: false, reason: `no caption timeline at ${timeline}` };
  if (!has('ffmpeg', ['-version'])) return { ok: false, reason: 'ffmpeg is not installed' };
  if (!clips || !clips.length) return { ok: false, reason: 'no narration audio was produced' };

  const marks = JSON.parse(readFileSync(timeline, 'utf8'));
  if (!marks.length) return { ok: false, reason: 'the walkthrough recorded no captions' };

  /* Place each already-spoken clip at the moment its caption appeared. */
  const placed = clips.slice(0, marks.length).map((c, i) => ({ ...c, at: marks[i].at }));

  /* Delay each clip to its caption's moment, then mix them into one track. */
  const inputs = placed.flatMap((c) => ['-i', c.file]);
  const delays = placed.map((c, i) =>
    `[${i + 1}:a]adelay=${Math.max(0, Math.round(c.at))}|${Math.max(0, Math.round(c.at))}[a${i}]`);
  const mix = `${placed.map((_, i) => `[a${i}]`).join('')}amix=inputs=${placed.length}:normalize=0[out]`;

  const res = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', video, ...inputs,
    '-filter_complex', `${delays.join(';')};${mix}`,
    '-map', '0:v', '-map', '[out]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', out
  ], { shell: false });

  if (res.status !== 0) return { ok: false, reason: 'ffmpeg could not mix the audio' };
  return { ok: true, out, engine: placed[0].engine, spoken: placed.length };
}


