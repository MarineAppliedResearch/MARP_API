// How well do two annotators agree on the same stretch? Scored the way the model is, so the
// two compare: one session's substrates against the other's, per substrate, as F1.
//
// Lines annotated in two or more sessions over the same stretch (>=80% shared, as in
// duplicates.js). Each pair of sessions is compared second by second on the clock, over
// the seconds both recorded something in -- a gap is unknown, not a disagreement, as in
// plan.js -- and, like the model's frames, away from any change of substrate in either
// session by MARGIN_S. Read-only.
// Run from MARP_API: node .marp/habitat/audit/agreement.js
'use strict';
require('dotenv').config();
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');

const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];
const MARGIN_S = 2;

(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await db.query(`SELECT s.session_id, s.user_id, p.name AS project, s.dive, s.line, o.comname, o.tc, o.etc
        FROM observations o JOIN sessions s USING (session_id) JOIN projects p ON p.project_id = s.project_id
        WHERE s.type = 'Habitat' AND o.comname = ANY($1)`, [SUBSTRATES]);
    await db.end();

    // Line -> session -> its substrate spans, in whole clock seconds.
    const lines = new Map();
    for (const r of rows) {
        const a = parseTimeSpan(r.tc), b = parseTimeSpan(r.etc);
        if (a == null || b == null || b < a) continue;
        const k = `${r.project}|${r.dive}|${r.line}`;
        if (!lines.has(k)) lines.set(k, new Map());
        const s = lines.get(k);
        if (!s.has(r.session_id)) s.set(r.session_id, { user: r.user_id, spans: [] });
        s.get(r.session_id).spans.push({ name: r.comname, a: Math.round(a / 1000), b: Math.round(b / 1000) });
    }

    const extent = (spans) => [Math.min(...spans.map((x) => x.a)), Math.max(...spans.map((x) => x.b))];
    const at = (spans, t) => SUBSTRATES.map((n) => spans.some((x) => x.name === n && x.a <= t && t <= x.b));
    const near = (spans, t) => spans.some((x) => Math.abs(x.a - t) < MARGIN_S || Math.abs(x.b - t) < MARGIN_S);

    const tally = () => ({ tp: SUBSTRATES.map(() => 0), fp: SUBSTRATES.map(() => 0), fn: SUBSTRATES.map(() => 0), seconds: 0, allRight: 0, pairs: 0, lines: new Set() });
    // CAMPA by year, since a year can label differently; everything else together.
    const groups = {};
    const perLine = [];

    for (const [k, sessions] of lines) {
        if (sessions.size < 2) continue;
        const list = [...sessions.entries()];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const [ia, A] = list[i]; const [ib, B] = list[j];
                const [a0, a1] = extent(A.spans); const [b0, b1] = extent(B.spans);
                const shared = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
                if (shared < 0.8 * Math.min(a1 - a0, b1 - b0)) continue;
                const year = k.startsWith('CAMPA') ? k.split('|')[0] : 'other projects';
                const g = groups[year] || (groups[year] = tally());
                const all = groups['all CAMPA'] || (groups['all CAMPA'] = tally());
                if (year !== 'other projects') { all.pairs++; all.lines.add(k); }
                g.pairs++; g.lines.add(k);
                let n = 0; let right = 0;
                const pair = tally();
                for (let t = Math.max(a0, b0); t <= Math.min(a1, b1); t++) {
                    const la = at(A.spans, t); const lb = at(B.spans, t);
                    if (!la.some(Boolean) || !lb.some(Boolean)) continue;
                    if (near(A.spans, t) || near(B.spans, t)) continue;
                    n++;
                    if (la.every((v, c) => v === lb[c])) right++;
                    // F1 is symmetric, so which session is "truth" does not matter.
                    SUBSTRATES.forEach((_, c) => {
                        if (la[c] && lb[c]) pair.tp[c]++;
                        else if (lb[c]) pair.fp[c]++;
                        else if (la[c]) pair.fn[c]++;
                    });
                }
                SUBSTRATES.forEach((_, c) => { g.tp[c] += pair.tp[c]; g.fp[c] += pair.fp[c]; g.fn[c] += pair.fn[c]; });
                g.seconds += n; g.allRight += right;
                if (year !== 'other projects') {
                    all.seconds += n; all.allRight += right;
                    SUBSTRATES.forEach((_, c) => { all.tp[c] += pair.tp[c]; all.fp[c] += pair.fp[c]; all.fn[c] += pair.fn[c]; });
                }
                perLine.push({ line: k, sessions: `${ia} (user ${A.user}) vs ${ib} (user ${B.user})`, seconds: n, allRight: n ? right / n : null });
            }
        }
    }

    for (const [name, g] of Object.entries(groups)) {
        if (!g.pairs) continue;
        const f1 = SUBSTRATES.map((_, c) => {
            const d = 2 * g.tp[c] + g.fp[c] + g.fn[c];
            return d ? (2 * g.tp[c]) / d : null;
        });
        const present = f1.filter((v) => v != null);
        console.log(`\n${name}: ${g.lines.size} lines, ${g.pairs} pairs of sessions, ${g.seconds} seconds compared`);
        console.log(`  average F1 ${(present.reduce((x, y) => x + y, 0) / present.length).toFixed(3)} over the substrates either recorded; ` +
            `every substrate the same: ${(g.allRight / g.seconds).toFixed(3)}`);
        SUBSTRATES.forEach((s, c) => console.log(`  ${s.padEnd(8)} F1 ${f1[c] == null ? '  -  ' : f1[c].toFixed(3)}` +
            `  (both ${g.tp[c]} s, only one ${g.fp[c] + g.fn[c]} s)`));
    }
    console.log('\nPer pair:');
    for (const p of perLine.sort((x, y) => x.line.localeCompare(y.line))) {
        console.log(`  ${p.line.padEnd(28)} ${p.sessions.padEnd(36)} ${String(p.seconds).padStart(5)} s, all the same ${p.allRight == null ? '-' : p.allRight.toFixed(2)}`);
    }
})().catch((e) => { console.error(e); process.exit(1); });
