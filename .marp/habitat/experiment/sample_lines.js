// Sample model output, step 1: for a few whole lines, every annotator's habitat stretches
// and one frame per second of the video they cover.
//
// The lines are named by their dataset session (the one plan.js kept for the line); every
// other Habitat session on the same project, dive and line is read too, so the model can be
// set beside every person who annotated it. Clock times use each session's own
// clock-minus-file offset, as export_intervals.js does. Read-only on the database.
// Run from MARP_API: node .marp/habitat/experiment/sample_lines.js
'use strict';

require('dotenv').config();
if (process.env.HABITAT_JELLYFIN_URL) process.env.JELLYFIN_BASE_URL = process.env.HABITAT_JELLYFIN_URL;
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');
const jellyfin = require('../../../repository/jellyfin.repository');
const { MIN_MATCH_SCORE } = require('../../../config/thumbnails');

const HERE = __dirname;
const PYTHON = process.env.HABITAT_PYTHON || path.resolve(HERE, '../../../../marp-inference-worker/.venv312/Scripts/python.exe');
const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];
// Tuning lines set the stretch rules; test lines (dives the model never saw) are only scored.
const LINES = { val: [1572, 3167, 4250], test: [4065, 2949, 3138, 1545, 4101] };
const CHUNK_S = 120;
// Seconds between frames, and where they go: HABITAT_SAMPLE_STEP=0.3333 HABITAT_SAMPLE_DIR=frames_3fps
// gives three a second. Defaults to one a second in frames_1s.
const STEP = Number(process.env.HABITAT_SAMPLE_STEP) || 1;
const FRAMES = process.env.HABITAT_SAMPLE_DIR || 'frames_1s';
const PARALLEL = 6;

function grab(job) {
    return new Promise((resolve, reject) => {
        const child = spawn(PYTHON, ['-I', path.join(HERE, 'grab_every.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => (code ? reject(new Error(`grabber exited ${code}: ${err.slice(-300)}`))
            : resolve(JSON.parse(out.trim().split('\n').pop()))));
        child.stdin.end(JSON.stringify(job));
    });
}

(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const all = [...LINES.val, ...LINES.test];
    const { rows } = await db.query(`
        SELECT s.session_id, s.user_id, p.name AS project, s.dive, s.line, o.comname, o.tc, o.etc,
               o."mediaPosition" AS media, o."actualPosition" AS actual, o.video_source,
               ref.session_id AS ref
          FROM sessions ref
          JOIN sessions s ON s.project_id = ref.project_id AND s.dive = ref.dive AND s.line = ref.line AND s.type = 'Habitat'
               -- People only: a model session posted earlier is not an annotator.
               AND NOT s.is_automated
          JOIN projects p ON p.project_id = s.project_id
          JOIN observations o ON o.session_id = s.session_id
         WHERE ref.session_id = ANY($1) AND o.comname = ANY($2)`, [all, SUBSTRATES]);
    await db.end();

    const lines = {};
    for (const r of rows) {
        const tc = parseTimeSpan(r.tc), etc = parseTimeSpan(r.etc), m = parseTimeSpan(r.media), t = parseTimeSpan(r.actual);
        if ([tc, etc, m, t].some((v) => v == null) || etc < tc) continue;
        const L = lines[r.ref] || (lines[r.ref] = {
            split: LINES.val.includes(r.ref) ? 'val' : 'test', project: r.project, dive: r.dive, line: r.line, sessions: {},
        });
        const S = L.sessions[r.session_id] || (L.sessions[r.session_id] = { user: r.user_id, spans: [] });
        S.spans.push({ name: r.comname, a: t, b: t + (etc - tc), file: r.video_source, offset: t - m });
    }

    // The video to sample is the dataset session's, over the stretch it annotated in each of
    // its files; a line can run across more than one.
    const jobs = [];
    for (const [ref, L] of Object.entries(lines)) {
        const spans = L.sessions[ref].spans;
        L.files = [...new Set(spans.map((x) => x.file))].map((file, k) => {
            const own = spans.filter((x) => x.file === file);
            const offset = own[0].offset;
            const f = { file, k, offset,
                from: Math.ceil((Math.min(...own.map((x) => x.a)) - offset) / 1000),
                to: Math.floor((Math.max(...own.map((x) => x.b)) - offset) / 1000) };
            for (let s = f.from; s <= f.to; s += CHUNK_S) jobs.push({ ref, k, file, start: s, end: Math.min(s + CHUNK_S - 1, f.to) });
            return f;
        });
        console.log(`${L.split} ${L.project} dive ${L.dive} line ${L.line}: session ${ref}, ` +
            `${Object.keys(L.sessions).length} annotator session(s), ` +
            `${L.files.reduce((n, f) => n + f.to - f.from + 1, 0)} s of video in ${L.files.length} file(s)`);
    }
    fs.mkdirSync(path.join(HERE, 'sample'), { recursive: true });
    fs.writeFileSync(path.join(HERE, 'sample', 'lines.json'), JSON.stringify(lines, null, 1));

    let done = 0; let frames = 0; const started = Date.now();
    // Each worker is its own Jellyfin device, as in extract_full.js.
    async function worker(n) {
        const IDENTITY = { name: `MARP habitat sample ${n}` };
        while (jobs.length) {
            const j = jobs.shift();
            const outdir = path.join(HERE, FRAMES, String(j.ref), String(j.k));
            const have = Math.floor((j.end - j.start) / STEP) + 1;
            const existing = fs.existsSync(outdir) ? fs.readdirSync(outdir).filter((f) => {
                const s = Number(f.replace('.jpg', '')) / 1000;
                return s >= j.start && s <= j.end;
            }).length : 0;
            if (existing < have) {
                try {
                    const itemId = /^[0-9a-f]{32}$/.test(j.file) ? j.file
                        : (await jellyfin.resolveVideoSource(j.file, MIN_MATCH_SCORE, IDENTITY)).item.id;
                    const url = await jellyfin.buildDirectStreamUrl(itemId, IDENTITY);
                    const r = await grab({ url, start: j.start, end: j.end + 1 - STEP, step: STEP, outdir });
                    frames += r.ok;
                    if (r.ok < have) console.log(`  session ${j.ref} ${j.start}-${j.end} s: ${r.ok} of ${have} frames${r.error ? ` (${r.error})` : ''}`);
                } catch (e) {
                    console.log(`  session ${j.ref} ${j.start}-${j.end} s: ${e.message.replace(/api_key=[^&\s]+/gi, 'api_key=…')}`);
                }
            }
            done++;
            if (done % 10 === 0) console.log(`${done} pieces, ${frames} frames, ${((Date.now() - started) / 60000).toFixed(1)} min`);
        }
    }
    await Promise.all(Array.from({ length: PARALLEL }, (_, n) => worker(n)));
    console.log(`done: ${frames} frames in ${((Date.now() - started) / 60000).toFixed(1)} min`);
})().catch((e) => { console.error(e); process.exit(1); });
