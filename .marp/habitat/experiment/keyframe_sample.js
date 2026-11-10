// Sample model output, step 5: give each posted habitat stretch a box, so the Mosaic can
// cut a picture for it. A stretch has no box of its own; habitat uses one fixed crop, the
// bottom-middle patch of seabed (train.py's CROPS["bottom_middle"], the box the dataset
// viewer outlines). Each observation gets a start keyframe at the stretch's first frame and
// an end keyframe at its last, both with that box.
//
// Frame numbers use the video's real frame rate as Jellyfin reports it; the thumbnail maker
// takes the keyframe nearest its own frame, so a small difference in rate does not matter.
// Observations that already have keyframes are left alone, so this can run twice.
// Run from MARP_API, with the API and token post_sample.js uses:
//   node .marp/habitat/experiment/keyframe_sample.js [tag ...]     (no tags: '', v2, v3d)
'use strict';

require('dotenv').config();
if (process.env.HABITAT_JELLYFIN_URL) process.env.JELLYFIN_BASE_URL = process.env.HABITAT_JELLYFIN_URL;
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');
const jellyfin = require('../../../repository/jellyfin.repository');
const { MIN_MATCH_SCORE } = require('../../../config/thumbnails');

const HERE = __dirname;
const API = process.env.HABITAT_API_URL;
const TOKEN = fs.readFileSync(process.env.HABITAT_API_TOKEN_FILE, 'utf8').trim();
const TAGS = process.argv.length > 2 ? process.argv.slice(2).map((t) => (t === '-' ? '' : t)) : ['', 'v2', 'v3d'];
// x0, y0, x1, y1 as fractions of the frame, as in train.py; keyframes are centre-origin.
const CROP = [0.2, 0.45, 0.8, 1.0];
const BOX = { x: (CROP[0] + CROP[2]) / 2, y: (CROP[1] + CROP[3]) / 2, width: CROP[2] - CROP[0], height: CROP[3] - CROP[1] };
const IDENTITY = { name: 'MARP habitat keyframes' };

async function api(method, route, body) {
    const res = await fetch(`${API}/api/v2${route}`, {
        method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}

const rates = new Map();
async function frameRate(file) {
    if (!rates.has(file)) {
        const itemId = /^[0-9a-f]{32}$/.test(file) ? file : (await jellyfin.resolveVideoSource(file, MIN_MATCH_SCORE, IDENTITY)).item.id;
        const r = await jellyfin.getVideoFrameRate(itemId, IDENTITY);
        const fps = r && (r.realFrameRate || r.averageFrameRate);
        if (!fps) throw new Error(`no frame rate for ${file}`);
        rates.set(file, fps);
    }
    return rates.get(file);
}

(async () => {
    const lines = JSON.parse(fs.readFileSync(path.join(HERE, 'sample', 'lines.json'), 'utf8'));
    const db = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await db.connect();
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

    for (const tag of TAGS) {
        const report = JSON.parse(fs.readFileSync(path.join(HERE, 'sample', tag ? `report_${tag}.json` : 'report.json'), 'utf8'));
        const posted = JSON.parse(fs.readFileSync(path.join(HERE, 'sample', `posted${tag ? `_${tag}` : ''}.json`), 'utf8'));
        for (const [ref, sessionId] of Object.entries(posted)) {
            const L = lines[ref];
            const { rows } = await db.query(`SELECT o.observation_id, o.comname, o."actualPosition", o."mediaPosition", o.video_source,
                    (SELECT count(*) FROM keyframes k WHERE k.observation_id = o.observation_id)::int AS keyframes
                FROM observations o WHERE o.session_id = $1`, [sessionId]);
            // Each observation's stretch, found by substrate and start, for its exact end.
            const byStart = new Map(report.lines[ref].model.map((s) => [`${s.name}|${s.a}`, s]));
            const out = [];
            for (const o of rows) {
                if (o.keyframes > 0) continue;
                const s = byStart.get(`${o.comname}|${parseTimeSpan(o.actualPosition)}`);
                if (!s) { console.log(`  observation ${o.observation_id}: no matching stretch; skipped`); continue; }
                const fps = await frameRate(o.video_source);
                const startMs = parseTimeSpan(o.mediaPosition);
                const endMs = startMs + (s.b - s.a);
                for (const [type, ms] of [['start', startMs], ['end', endMs]]) {
                    out.push({ observation_id: o.observation_id, ...BOX, subset: '0', type, comname: o.comname,
                        framenum: Math.floor((ms * fps) / 1000) });
                }
            }
            const made = out.length ? await api('POST', '/keyframe', out) : [];
            console.log(`${tag || 'run 1'} ${L.project} dive ${L.dive} line ${L.line} (session ${sessionId}): ` +
                `${made.length} of ${out.length} keyframes stored for ${out.length / 2} stretches` +
                (rows.length - out.length / 2 ? `, ${rows.length - out.length / 2} already had keyframes` : ''));
        }
    }
    await db.end();
})().catch((e) => { console.error(e.message.replace(/api_key=[^&\s]+/gi, 'api_key=…')); process.exit(1); });
