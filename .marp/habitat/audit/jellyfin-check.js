// Which video files behind the substrate intervals can Jellyfin still find?
// Read-only: searches Jellyfin, never changes it. Run from MARP_API.
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');
const jellyfin = require('../../../repository/jellyfin.repository');
const { MIN_MATCH_SCORE } = require('../../../config/thumbnails');

const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];
const TEST_PROJECTS = ['TEST', 'Test', 'test', 'SALT 4 TEST'];
const IDENTITY = { name: 'MARP habitat audit' };

(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const { rows } = await db.query(`
        SELECT o.video_source, p.name AS project, o.tc, o.etc
          FROM observations o JOIN sessions s USING (session_id) JOIN projects p ON p.project_id = s.project_id
         WHERE s.type = 'Habitat' AND o.comname = ANY($1) AND NOT p.name = ANY($2)`, [SUBSTRATES, TEST_PROJECTS]);
    await db.end();

    // Hours of substrate interval per file, so the result is weighted by what it costs.
    const files = new Map();
    for (const r of rows) {
        const a = parseTimeSpan(r.tc); const b = parseTimeSpan(r.etc);
        const ms = a != null && b != null && b >= a ? b - a : 0;
        const f = files.get(r.video_source) || { project: r.project, ms: 0 };
        f.ms += ms; files.set(r.video_source, f);
    }

    const results = [];
    let n = 0;
    for (const [source, f] of files) {
        n++;
        let score = 0; let name = null; let error = null;
        try {
            const r = await jellyfin.resolveVideoSource(source, 1, IDENTITY);
            score = r.score; name = r.item.Name || r.item.name || null;
        } catch (e) { error = e.message; }
        results.push({ source, project: f.project, hours: f.ms / 3.6e6, score, name, error });
        if (n % 50 === 0) process.stderr.write(`${n}/${files.size}\n`);
    }
    fs.writeFileSync(path.join(__dirname, 'jellyfin-check.json'), JSON.stringify(results, null, 2));

    const ok = results.filter((r) => r.score >= MIN_MATCH_SCORE);
    const sum = (list) => list.reduce((t, r) => t + r.hours, 0).toFixed(1);
    console.log(`Files: ${results.length}. Found at score >= ${MIN_MATCH_SCORE}: ${ok.length} (${sum(ok)} of ${sum(results)} interval-hours).`);
    const byProject = new Map();
    for (const r of results) {
        const p = byProject.get(r.project) || { files: 0, ok: 0, hours: 0, okHours: 0 };
        p.files++; p.hours += r.hours;
        if (r.score >= MIN_MATCH_SCORE) { p.ok++; p.okHours += r.hours; }
        byProject.set(r.project, p);
    }
    console.log('| Project | Files | Found | Interval hours | Found hours |\n| --- | --- | --- | --- | --- |');
    for (const [p, c] of [...byProject].sort((x, y) => y[1].hours - x[1].hours)) {
        console.log(`| ${p} | ${c.files} | ${c.ok} | ${c.hours.toFixed(1)} | ${c.okHours.toFixed(1)} |`);
    }
    const errors = new Map();
    for (const r of results.filter((x) => x.score < MIN_MATCH_SCORE)) {
        const k = r.error || `weak match (score ${r.score})`;
        errors.set(k, (errors.get(k) || 0) + 1);
    }
    console.log('\nNot found:');
    for (const [k, c] of errors) console.log(`  ${c} x ${k}`);
})().catch((e) => { console.error(e); process.exit(1); });
