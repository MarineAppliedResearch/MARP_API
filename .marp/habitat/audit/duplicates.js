// For lines annotated in more than one session: do the sessions cover the same stretch of video?
'use strict';
require('dotenv').config();
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');
(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await db.query(`SELECT s.session_id, p.name, s.dive, s.line, o.tc, o.etc FROM observations o
        JOIN sessions s USING (session_id) JOIN projects p ON p.project_id = s.project_id
        WHERE s.type = 'Habitat' AND coalesce(o.comname,'') <> ''`);
    const lines = new Map();
    for (const r of rows) {
        const a = parseTimeSpan(r.tc), b = parseTimeSpan(r.etc);
        if (a == null || b == null || b < a) continue;
        const k = `${r.name}|${r.dive}|${r.line}`;
        if (!lines.has(k)) lines.set(k, new Map());
        const m = lines.get(k);
        const span = m.get(r.session_id) || [Infinity, -Infinity];
        m.set(r.session_id, [Math.min(span[0], a), Math.max(span[1], b)]);
    }
    let same = 0, partial = 0, apart = 0; const byProject = new Map();
    for (const [k, m] of lines) {
        if (m.size < 2) continue;
        const spans = [...m.values()];
        // Share of the shorter session's span that the others also cover, worst pair.
        let worst = 1;
        for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
            const o = Math.max(0, Math.min(spans[i][1], spans[j][1]) - Math.max(spans[i][0], spans[j][0]));
            const shorter = Math.min(spans[i][1] - spans[i][0], spans[j][1] - spans[j][0]) || 1;
            worst = Math.min(worst, o / shorter);
        }
        const kind = worst >= 0.8 ? 'same' : worst > 0 ? 'partial' : 'apart';
        if (kind === 'same') same++; else if (kind === 'partial') partial++; else apart++;
        const p = k.split('|')[0];
        if (!byProject.has(p)) byProject.set(p, { same: 0, partial: 0, apart: 0 });
        byProject.get(p)[kind]++;
    }
    console.log(`Lines with 2+ sessions: same stretch (>=80% shared) ${same}, partly shared ${partial}, separate stretches ${apart}`);
    for (const [p, c] of [...byProject].sort((x, y) => y[1].same - x[1].same)) console.log(`  ${p}: same ${c.same}, partial ${c.partial}, apart ${c.apart}`);
    await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
