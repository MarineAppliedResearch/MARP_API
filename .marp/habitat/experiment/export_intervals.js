// The substrate intervals of every session in the dataset, in clock ms, with each file's
// clock-minus-position offset, so labels can be recomputed at shifted times.
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');
(async () => {
    const sessions = [...new Set(require('./plan.json').frames.map((f) => f.session))];
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await db.query(`SELECT session_id, comname, tc, etc, "mediaPosition" m, "actualPosition" t, video_source
        FROM observations WHERE session_id = ANY($1) AND comname IN ('Rock','Mud','Sand','Cobble','Boulder')`, [sessions]);
    await db.end();
    const out = {};
    for (const r of rows) {
        const tc = parseTimeSpan(r.tc), etc = parseTimeSpan(r.etc), m = parseTimeSpan(r.m), t = parseTimeSpan(r.t);
        if ([tc, etc, m, t].some((v) => v == null) || etc < tc) continue;
        (out[r.session_id] = out[r.session_id] || []).push({ name: r.comname, a: t, b: t + (etc - tc), file: r.video_source, offset: t - m });
    }
    fs.writeFileSync(path.join(__dirname, 'intervals.json'), JSON.stringify(out));
    console.log(`${Object.keys(out).length} sessions, ${rows.length} rows`);
})().catch((e) => { console.error(e); process.exit(1); });
