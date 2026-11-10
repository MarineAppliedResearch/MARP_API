// Sample model output, step 4: put the model's stretches into MARP through the API, as one
// automated Habitat session per line beside the annotators', so they can be opened and
// compared in the annotation GUI.
//
// The session is made the way inference-session.service.js makes an inference run's: owned
// by the "MARP Inference" user, is_automated, the line's own project, dive, line and lineId.
// The GPU ingest route cannot be used: it refuses Habitat sessions and writes no end time.
// Each observation carries substrate, start and end on the clock (as annotators' tc/etc),
// file and clock positions, and the model's confidence.
//
// Each run of sample_output.py is posted once: HABITAT_SAMPLE_TAG names the run (its report is
// sample/report_<tag>.json; none means the first run's report.json), and what was posted is
// kept in sample/posted_<tag>.json, so running this twice posts nothing new. Two runs on one
// line are two model sessions beside each other, to compare.
// Writes through the API named by HABITAT_API_URL with the token in HABITAT_API_TOKEN_FILE;
// reads the database only to look up the inference user and the substrates' species rows.
// Run from MARP_API: node .marp/habitat/experiment/post_sample.js
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const HERE = __dirname;
const API = process.env.HABITAT_API_URL;
const TOKEN = fs.readFileSync(process.env.HABITAT_API_TOKEN_FILE, 'utf8').trim();
const SUBSTRATES = ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'];
const TAG = process.env.HABITAT_SAMPLE_TAG || '';
const REPORT = path.join(HERE, 'sample', TAG ? `report_${TAG}.json` : 'report.json');
const POSTED = path.join(HERE, 'sample', `posted${TAG ? `_${TAG}` : ''}.json`);

async function api(method, route, body) {
    const res = await fetch(`${API}/api/v2${route}`, {
        method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}

// Clock ms as the annotators record it: whole seconds for tc/etc, ms for positions.
const pad = (n) => String(n).padStart(2, '0');
const hms = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const precise = (ms) => `${hms(ms)}.${String(Math.round(ms % 1000)).padStart(3, '0')}`;

(async () => {
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const inference = (await db.query(`SELECT user_id FROM users WHERE name = 'MARP Inference'`)).rows[0].user_id;
    // Each substrate's species row, as most existing habitat records link it.
    const species = {};
    for (const r of (await db.query(`SELECT o.comname, o.taxserial, o.species_id, count(*) n FROM observations o
            JOIN sessions s USING (session_id) WHERE s.type = 'Habitat' AND o.comname = ANY($1) AND o.species_id IS NOT NULL
            GROUP BY 1, 2, 3 ORDER BY n DESC`, [SUBSTRATES])).rows) {
        if (!species[r.comname]) species[r.comname] = { taxserial: r.taxserial, species_id: r.species_id };
    }
    await db.end();

    const lines = JSON.parse(fs.readFileSync(path.join(HERE, 'sample', 'lines.json'), 'utf8'));
    const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    const posted = fs.existsSync(POSTED) ? JSON.parse(fs.readFileSync(POSTED, 'utf8')) : {};
    for (const [ref, L] of Object.entries(lines)) {
        const own = await api('GET', `/session/${ref}`);
        const s = own.session || own;
        const label = `${L.split === 'val' ? 'tuning' : 'test'} line ${L.project} dive ${L.dive} line ${L.line}`;
        if (posted[ref]) { console.log(`${label}: this run is already session ${posted[ref]}; left alone`); continue; }

        const made = await api('POST', '/session', { session: {
            project_id: s.project_id, user_id: inference, created_by: null, is_automated: true,
            dive: s.dive, line: s.line, lineId: s.lineId, type: 'Habitat' } });
        const sessionId = (made.session || made).session_id;
        if (!sessionId) throw new Error(`${label}: session not created: ${JSON.stringify(made).slice(0, 200)}`);

        let ok = 0;
        for (const st of report.lines[ref].model) {
            // The file this stretch starts in, for its position within that file.
            const f = L.files.find((x) => st.a - x.offset >= x.from * 1000 - 1000 && st.a - x.offset <= x.to * 1000 + 1000) || L.files[0];
            const r = await api('POST', '/observation', { observation: {
                session_id: sessionId, project_id: s.project_id, comname: st.name, ...species[st.name],
                tc: hms(st.a), etc: hms(st.b), actualPosition: precise(st.a), mediaPosition: precise(st.a - f.offset),
                video_source: f.file, videoLocation: f.file, confidence: st.confidence } });
            if ((r.observation || r).observation_id) ok++;
            else console.log(`  ${st.name} ${hms(st.a)}-${hms(st.b)}: not stored: ${JSON.stringify(r).slice(0, 150)}`);
        }
        posted[ref] = sessionId;
        fs.writeFileSync(POSTED, JSON.stringify(posted, null, 1));
        console.log(`${label}: model session ${sessionId}, ${ok} of ${report.lines[ref].model.length} stretches stored`);
    }
})().catch((e) => { console.error(e.message); process.exit(1); });
