// Feasibility test, step 2: take the planned frames from Jellyfin's trickplay thumbnails.
// Jellyfin already holds one 320x180 thumbnail every 10 s, packed 100 to a tile image,
// so this downloads a few tiles per video instead of streaming the video itself
// (streaming measured at ~7 s per frame from this machine).
// Resumable: frames already on disk are skipped. Writes labels.csv when done.
// Run from MARP_API: node .marp/habitat/experiment/extract.js [maxFiles]
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const jellyfin = require('../../../repository/jellyfin.repository');
const { MIN_MATCH_SCORE } = require('../../../config/thumbnails');

const HERE = __dirname;
const WIDTH = 320;
const IDENTITY = { name: 'MARP habitat experiment' };
const plan = JSON.parse(fs.readFileSync(path.join(HERE, 'plan.json'), 'utf8'));
const maxFiles = Number(process.argv[2]) || Infinity;

const outPath = (f) => path.join(HERE, 'frames', f.split, `${f.session}_${Math.round(f.position * 1000)}.jpg`);

(async () => {
    const byFile = new Map();
    for (const f of plan.frames) byFile.set(f.file, [...(byFile.get(f.file) || []), f]);

    let done = 0; let ok = 0; let failed = 0; const started = Date.now();
    for (const [file, frames] of byFile) {
        if (done >= maxFiles) break;
        done++;
        const todo = frames.filter((f) => !fs.existsSync(outPath(f)));
        if (!todo.length) continue;
        try {
            // An item id opens directly; a filename goes through the API's own resolver.
            const itemId = /^[0-9a-f]{32}$/.test(file)
                ? file
                : (await jellyfin.resolveVideoSource(file, MIN_MATCH_SCORE, IDENTITY)).item.id;
            const info = await jellyfin.getTrickplayInfo(itemId, WIDTH, {}, IDENTITY);
            const perTile = info.columns * info.rows;
            const tiles = new Map();
            for (const f of todo) {
                const k = Math.round(f.position / info.thumbnailDurationSeconds);
                const tile = Math.floor(k / perTile);
                if (tile >= info.tileImageUrls.length) { failed++; continue; }
                if (!tiles.has(tile)) {
                    const res = await fetch(info.tileImageUrls[tile]);
                    if (!res.ok) throw new Error(`tile ${tile}: HTTP ${res.status}`);
                    tiles.set(tile, Buffer.from(await res.arrayBuffer()));
                }
                const i = k % perTile;
                fs.mkdirSync(path.dirname(outPath(f)), { recursive: true });
                await sharp(tiles.get(tile))
                    .extract({
                        left: (i % info.columns) * info.thumbnailWidth,
                        top: Math.floor(i / info.columns) * info.thumbnailHeight,
                        width: info.thumbnailWidth,
                        height: info.thumbnailHeight,
                    })
                    .jpeg({ quality: 95 })
                    .toFile(outPath(f));
                ok++;
            }
        } catch (e) {
            failed += todo.length;
            console.log(`  ${file}: ${e.message.replace(/ApiKey=[^&\s]+/g, 'ApiKey=…')}`);
        }
        if (done % 25 === 0 || done === byFile.size) {
            console.log(`${done}/${byFile.size} files, ${ok} frames, ${failed} failed, ${((Date.now() - started) / 60000).toFixed(1)} min`);
        }
    }

    // Labels for every frame that exists, whichever run cut it.
    const header = ['split', 'image', 'project', 'dive', 'line', 'session', 'file', 'position', ...plan.settings.SUBSTRATES];
    const lines = [header.join(',')];
    for (const f of plan.frames) {
        if (!fs.existsSync(outPath(f))) continue;
        const image = path.relative(HERE, outPath(f)).replace(/\\/g, '/');
        lines.push([f.split, image, JSON.stringify(f.project), JSON.stringify(f.dive), JSON.stringify(f.line),
            f.session, JSON.stringify(f.file), f.position.toFixed(3), ...f.labels].join(','));
    }
    fs.writeFileSync(path.join(HERE, 'labels.csv'), `${lines.join('\n')}\n`);
    console.log(`labels.csv: ${lines.length - 1} frames`);
})().catch((e) => { console.error(e); process.exit(1); });
