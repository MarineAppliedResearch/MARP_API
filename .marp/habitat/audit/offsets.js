// The files where clock time minus file position is not constant: how far off, and why.
'use strict';
require('dotenv').config();
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');
const found = new Map(require('./jellyfin-check.json').map((r) => [r.source, r.score >= 96 || /^[0-9a-f]{32}$/.test(r.source)]));
(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await db.query(`SELECT o.video_source, o.session_id, p.name, o."mediaPosition" m, o."actualPosition" t
        FROM observations o JOIN sessions s ON s.session_id = o.session_id JOIN projects p ON p.project_id = s.project_id
        WHERE s.type = 'Habitat' AND o.comname IN ('Rock','Mud','Sand','Cobble','Boulder')`);
    await db.end();
    const files = new Map();
    for (const r of rows) {
        const m = parseTimeSpan(r.m), t = parseTimeSpan(r.t);
        if (m == null || t == null) continue;
        const f = files.get(r.video_source) || { project: r.name, bySession: new Map() };
        if (!f.bySession.has(r.session_id)) f.bySession.set(r.session_id, []);
        f.bySession.get(r.session_id).push(t - m);
        files.set(r.video_source, f);
    }
    let bad = 0, withinSession = 0, betweenSessions = 0; const spreads = []; const proj = {};
    for (const [src, f] of files) {
        const all = [...f.bySession.values()].flat();
        const spread = Math.max(...all) - Math.min(...all);
        if (spread <= 2000) continue;
        bad++; spreads.push(spread);
        const inSession = [...f.bySession.values()].some((o) => Math.max(...o) - Math.min(...o) > 2000);
        if (inSession) withinSession++; else betweenSessions++;
        const k = `${f.project}${found.get(src) ? '' : ' (not in Jellyfin)'}`;
        proj[k] = (proj[k] || 0) + 1;
    }
    spreads.sort((a, b) => a - b);
    console.log(`Misaligned files: ${bad}. Offset differs inside one session: ${withinSession}; only between sessions: ${betweenSessions}.`);
    console.log(`Spread: median ${(spreads[Math.floor(spreads.length / 2)] / 1000).toFixed(0)} s, largest ${(spreads[spreads.length - 1] / 1000).toFixed(0)} s.`);
    console.log(proj);
})().catch((e) => { console.error(e); process.exit(1); });
