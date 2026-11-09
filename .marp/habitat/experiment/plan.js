// Feasibility test, step 1: choose dives, split them, and decide which frames to cut.
// Read-only. Writes plan.json beside this file. Run from MARP_API.
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');

const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];
const PROJECTS = ['CAMPA 2024', 'CAMPA-2025', 'CAMPA 2026']; // a CAMPA model
const STEP_MS = 10000;     // one frame every 10 s, Jellyfin's trickplay interval
const MARGIN_MS = 2000;    // no frame within 2 s of any substrate change
const DIVES = { train: 0.7, val: 0.15, test: 0.15 }; // share of each project's dives; frames are cheap, so all of them
const playable = new Set(require('../audit/jellyfin-check.json')
    .filter((r) => r.score >= 96 || /^[0-9a-f]{32}$/.test(r.source)).map((r) => r.source));

// Seeded shuffle, so the same dives are chosen every run.
function shuffle(list, seed) {
    let s = seed;
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}

(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await db.query(`
        SELECT o.session_id, p.name AS project, s.dive, s.line, o.comname, o.tc, o.etc,
               o."mediaPosition" AS media, o."actualPosition" AS actual, o.video_source
          FROM observations o JOIN sessions s ON s.session_id = o.session_id
          JOIN projects p ON p.project_id = s.project_id
         WHERE s.type = 'Habitat' AND o.comname = ANY($1) AND p.name = ANY($2)`, [SUBSTRATES, PROJECTS]);
    await db.end();

    // Intervals per session, in clock ms, with the file offset each row implies.
    const sessions = new Map();
    for (const r of rows) {
        const tc = parseTimeSpan(r.tc); const etc = parseTimeSpan(r.etc);
        const media = parseTimeSpan(r.media); const actual = parseTimeSpan(r.actual);
        if ([tc, etc, media, actual].some((v) => v == null) || etc < tc) continue;
        const s = sessions.get(r.session_id) || { id: r.session_id, project: r.project, dive: r.dive, line: r.line, rows: [], bad: false };
        if (!playable.has(r.video_source)) s.bad = true;
        // Start at the precise clock time; the length comes from tc/etc.
        s.rows.push({ name: r.comname, a: actual, b: actual + (etc - tc), file: r.video_source, offset: actual - media });
        sessions.set(r.session_id, s);
    }

    // A session is usable when every file is playable and each file's offset is constant.
    const usable = [...sessions.values()].filter((s) => {
        if (s.bad) return false;
        const byFile = new Map();
        for (const r of s.rows) byFile.set(r.file, [...(byFile.get(r.file) || []), r.offset]);
        return [...byFile.values()].every((o) => Math.max(...o) - Math.min(...o) <= 2000);
    });

    // One session per dive and line, so a line annotated twice is not counted twice.
    const lineKey = (s) => `${s.project}|${s.dive}|${s.line}`;
    const perLine = new Map();
    for (const s of usable.sort((x, y) => x.id - y.id)) if (!perLine.has(lineKey(s))) perLine.set(lineKey(s), s);

    // Choose dives per project and split them; every line of a dive goes to the same split.
    const plan = { settings: { STEP_MS, MARGIN_MS, SUBSTRATES }, frames: [] };
    const summary = [];
    for (const project of PROJECTS) {
        const lines = [...perLine.values()].filter((s) => s.project === project);
        const dives = shuffle([...new Set(lines.map((s) => s.dive))].sort(), 287);
        let k = 0;
        for (const [split, share] of Object.entries(DIVES)) {
            const n = split === 'test' ? dives.length - k : Math.round(share * dives.length);
            for (const dive of dives.slice(k, k + n)) {
                for (const s of lines.filter((l) => l.dive === dive)) {
                    const offsets = new Map(s.rows.map((r) => [r.file, r.offset]));
                    const edges = s.rows.flatMap((r) => [r.a, r.b]);
                    const start = Math.min(...s.rows.map((r) => r.a));
                    const end = Math.max(...s.rows.map((r) => r.b));
                    let count = 0;
                    // Frames sit on the file's own STEP_MS grid, which is where Jellyfin's
                    // trickplay thumbnails are, so each frame is one ready-made thumbnail.
                    for (const [file, offset] of offsets) {
                        const fileRows = s.rows.filter((r) => r.file === file);
                        const from = Math.min(...fileRows.map((r) => r.a)) - offset;
                        const to = Math.max(...fileRows.map((r) => r.b)) - offset;
                        for (let p = Math.max(0, Math.ceil(from / STEP_MS) * STEP_MS); p <= to; p += STEP_MS) {
                            const t = p + offset;
                            if (edges.some((e) => Math.abs(e - t) < MARGIN_MS)) continue;
                            const covering = s.rows.filter((r) => r.a <= t && t <= r.b);
                            if (!covering.length) continue; // a gap: unknown, not empty
                            plan.frames.push({
                                split, project, dive, line: s.line, session: s.id, file, position: p / 1000,
                                labels: SUBSTRATES.map((n2) => (covering.some((r) => r.name === n2) ? 1 : 0)),
                            });
                            count++;
                        }
                    }
                    summary.push({ project, split, dive, line: s.line, session: s.id, frames: count });
                }
            }
            k += n;
        }
    }
    fs.writeFileSync(path.join(__dirname, 'plan.json'), JSON.stringify(plan));
    const totals = {};
    for (const f of plan.frames) {
        const t = totals[f.split] || (totals[f.split] = { frames: 0, dives: new Set(), files: new Set(), labels: [0, 0, 0, 0, 0] });
        t.frames++; t.dives.add(`${f.project}|${f.dive}`); t.files.add(f.file);
        f.labels.forEach((v, i) => { t.labels[i] += v; });
    }
    console.log(`Usable sessions: ${usable.length} of ${sessions.size}; one per line: ${perLine.size}`);
    for (const [split, t] of Object.entries(totals)) {
        console.log(`${split}: ${t.frames} frames, ${t.dives.size} dives, ${t.files.size} files; ` +
            SUBSTRATES.map((n, i) => `${n} ${t.labels[i]}`).join(', '));
    }
})().catch((e) => { console.error(e); process.exit(1); });
