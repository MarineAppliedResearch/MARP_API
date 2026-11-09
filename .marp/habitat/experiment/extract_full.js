// Full-resolution frames for every picture in dataset.csv, cut from the video itself.
// Jellyfin's LAN address can be far faster than its public one (9 Mbit/s against 144 on
// one machine), so HABITAT_JELLYFIN_URL overrides .env's for this script only.
// A few videos at a time; resumable.
// Run from MARP_API: node .marp/habitat/experiment/extract_full.js [maxFiles]
'use strict';

require('dotenv').config();
if (process.env.HABITAT_JELLYFIN_URL) process.env.JELLYFIN_BASE_URL = process.env.HABITAT_JELLYFIN_URL;
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const jellyfin = require('../../../repository/jellyfin.repository');
const { MIN_MATCH_SCORE } = require('../../../config/thumbnails');

const HERE = __dirname;
// The worker's venv has torch and OpenCV; HABITAT_PYTHON points elsewhere on another machine.
const PYTHON = process.env.HABITAT_PYTHON || path.resolve(HERE, '../../../../marp-inference-worker/.venv312/Scripts/python.exe');
const PARALLEL = 6;
const maxFiles = Number(process.argv[2]) || Infinity;

// The same picture name as the thumbnail, under frames_full/.
const inDataset = new Set(fs.readFileSync(path.join(HERE, 'dataset.csv'), 'utf8')
    .split(/\r?\n/).slice(1).map((line) => line.split(',')[0]).filter(Boolean));
const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'plan.json'), 'utf8')).frames
    .map((f) => ({ image: `frames/${f.split}/${f.session}_${Math.round(f.position * 1000)}.jpg`, video: f.file, position: f.position }))
    .filter((f) => inDataset.has(f.image))
    .map((f) => ({ out: path.join(HERE, f.image.replace(/^frames\//, 'frames_full/')), video: f.video, position: f.position }));

function grab(url, items) {
    return new Promise((resolve, reject) => {
        const child = spawn(PYTHON, ['-I', path.join(HERE, 'grab_frames.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`decoder exited ${code}: ${err.slice(-300)}`));
            resolve(JSON.parse(out.trim().split('\n').pop()));
        });
        child.stdin.end(JSON.stringify({ url, width: 0, items }));
    });
}

(async () => {
    const byVideo = new Map();
    for (const r of rows) byVideo.set(r.video, [...(byVideo.get(r.video) || []), r]);
    const queue = [...byVideo.entries()].slice(0, maxFiles);
    let done = 0; let ok = 0; let failed = 0; const started = Date.now();

    // Each worker is its own Jellyfin device. Jellyfin keeps one login per device, so
    // workers sharing one cancelled each other's tokens and 206 videos came back empty.
    async function worker(n) {
        const IDENTITY = { name: `MARP habitat extract ${n}` };
        while (queue.length) {
            const [video, items] = queue.shift();
            let todo = items.filter((r) => !fs.existsSync(r.out));
            // One retry: a token that expired mid-video costs that video, not the run.
            for (let attempt = 1; todo.length && attempt <= 2; attempt++) {
                try {
                    const itemId = /^[0-9a-f]{32}$/.test(video)
                        ? video
                        : (await jellyfin.resolveVideoSource(video, MIN_MATCH_SCORE, IDENTITY)).item.id;
                    const url = await jellyfin.buildDirectStreamUrl(itemId, IDENTITY);
                    const r = await grab(url, todo.map((x) => ({ position: x.position, out: x.out })));
                    ok += r.ok;
                    if (attempt === 2) failed += r.failed;
                    // The first run lost 206 videos with no word of why.
                    if (r.failed) console.log(`  ${video}: ${r.failed} not read${r.error ? ` (${r.error})` : ''}, attempt ${attempt}`);
                } catch (e) {
                    if (attempt === 2) failed += todo.length;
                    console.log(`  ${video}: ${e.message.replace(/api_key=[^&\s]+/gi, 'api_key=…')}, attempt ${attempt}`);
                }
                todo = todo.filter((r) => !fs.existsSync(r.out));
            }
            done++;
            const mins = (Date.now() - started) / 60000;
            console.log(`${done}/${byVideo.size} videos, ${ok} frames, ${failed} failed, ${mins.toFixed(1)} min, ${(ok / Math.max(mins * 60, 1)).toFixed(1)} frames/s`);
        }
    }
    await Promise.all(Array.from({ length: PARALLEL }, (_, n) => worker(n)));
})().catch((e) => { console.error(e); process.exit(1); });
