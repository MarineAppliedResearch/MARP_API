// Read-only audit of Habitat annotation, for MARP_API#287 phase 2.
// Run from MARP_API so .env resolves: node .marp/habitat/audit/audit.js
'use strict';

require('dotenv').config();
const { Client } = require('pg');
const { parseTimeSpan } = require('../../../db/timecode');

const DAY = 24 * 3600 * 1000;

function pct(sorted, p) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}
const s = (ms) => (ms == null ? '' : (ms / 1000).toFixed(0));
const table = (head, rows) => [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

(async () => {
    const db = new Client({
        host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    });
    await db.connect();
    // Read-only for the whole connection, so nothing below can write.
    await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

    const { rows } = await db.query(`
        SELECT o.observation_id, o.session_id, o.user_id AS obs_user, s.user_id, s.project_id,
               p.name AS project, s.dive, s.line, s."lineId", o.comname, o.tc, o.etc,
               o."mediaPosition", o."actualPosition", o.coarsesize, o.video_source,
               o."createdAt"
          FROM observations o
          JOIN sessions s ON s.session_id = o.session_id
          JOIN projects p ON p.project_id = s.project_id
         WHERE s.type = 'Habitat'
         ORDER BY o.session_id, o.observation_id`);

    const out = [];
    const problems = { blankName: 0, noTc: 0, noEtc: 0, zero: 0, negative: 0, rollover: 0 };

    // Parse each row into an interval in ms of clock time.
    const intervals = [];
    for (const r of rows) {
        const name = (r.comname || '').trim();
        if (!name) { problems.blankName++; continue; }
        const a = parseTimeSpan(r.tc);
        let b = parseTimeSpan(r.etc);
        if (a == null) { problems.noTc++; continue; }
        if (b == null) { problems.noEtc++; continue; }
        // An end before its start by most of a day is a midnight crossing.
        if (b < a && a - b > DAY / 2) { b += DAY; problems.rollover++; }
        if (b === a) problems.zero++;
        if (b < a) { problems.negative++; continue; }
        intervals.push({ ...r, name, a, b, len: b - a });
    }

    out.push(`# Habitat audit\n\nRun ${new Date().toISOString()} against the local production copy.\n`);
    out.push(`Habitat observations: ${rows.length}. Usable intervals: ${intervals.length}.\n`);
    out.push('## Rows that cannot be used\n');
    out.push(table(['Problem', 'Rows'], [
        ['No substrate name', problems.blankName],
        ['No start (tc)', problems.noTc],
        ['No end (etc)', problems.noEtc],
        ['End before start (dropped)', problems.negative],
        ['Zero length (kept)', problems.zero],
        ['Crosses midnight (fixed)', problems.rollover],
    ]));

    // 1 and 2: names, counts, time, and interval lengths.
    const byName = new Map();
    for (const i of intervals) {
        if (!byName.has(i.name)) byName.set(i.name, []);
        byName.get(i.name).push(i);
    }
    const nameRows = [...byName.entries()]
        .map(([name, list]) => {
            const lens = list.map((i) => i.len).sort((x, y) => x - y);
            const total = lens.reduce((t, x) => t + x, 0);
            const sessions = new Set(list.map((i) => i.session_id)).size;
            const projects = new Set(list.map((i) => i.project_id)).size;
            return { name, n: list.length, total, sessions, projects, lens };
        })
        .sort((x, y) => y.total - x.total);
    out.push('\n## Substrate names in use (interval lengths in seconds)\n');
    out.push(table(
        ['Name', 'Intervals', 'Total hours', 'Sessions', 'Projects', 'Shortest', '5th pct', 'Median', '95th pct', 'Longest'],
        nameRows.map((r) => [r.name, r.n, (r.total / 3.6e6).toFixed(1), r.sessions, r.projects,
            s(r.lens[0]), s(pct(r.lens, 0.05)), s(pct(r.lens, 0.5)), s(pct(r.lens, 0.95)), s(r.lens[r.lens.length - 1])]),
    ));

    // 3 and 4: overlap and coverage, per session.
    const bySession = new Map();
    for (const i of intervals) {
        if (!bySession.has(i.session_id)) bySession.set(i.session_id, []);
        bySession.get(i.session_id).push(i);
    }
    const pairs = new Map();
    let overlapMs = 0; let annotatedMs = 0; let spanMs = 0; let gapCount = 0;
    const gapLens = [];
    let sessionsWithOverlap = 0;
    for (const list of bySession.values()) {
        list.sort((x, y) => x.a - y.a || x.b - y.b);
        let had = false;
        for (let x = 0; x < list.length; x++) {
            for (let y = x + 1; y < list.length && list[y].a < list[x].b; y++) {
                // More than one second, so touching boundaries do not count.
                const o = Math.min(list[x].b, list[y].b) - list[y].a;
                if (o <= 1000) continue;
                had = true;
                overlapMs += o;
                const key = [list[x].name, list[y].name].sort().join(' + ');
                pairs.set(key, (pairs.get(key) || 0) + 1);
            }
        }
        if (had) sessionsWithOverlap++;
        // Union of the intervals, and the gaps between them.
        let curA = list[0].a; let curB = list[0].b;
        for (const i of list.slice(1)) {
            if (i.a <= curB + 1000) { curB = Math.max(curB, i.b); continue; }
            annotatedMs += curB - curA; gapCount++; gapLens.push(i.a - curB);
            curA = i.a; curB = i.b;
        }
        annotatedMs += curB - curA;
        spanMs += Math.max(...list.map((i) => i.b)) - list[0].a;
    }
    gapLens.sort((x, y) => x - y);
    out.push('\n## Overlap (mixed substrate)\n');
    out.push(`Sessions with any overlap over 1 s: ${sessionsWithOverlap} of ${bySession.size}. ` +
        `Overlapping time: ${(overlapMs / 3.6e6).toFixed(1)} h of ${(annotatedMs / 3.6e6).toFixed(1)} h annotated.\n`);
    out.push(table(['Pair', 'Overlaps'],
        [...pairs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25)));
    out.push('\n## Coverage\n');
    out.push(`Annotated: ${(annotatedMs / 3.6e6).toFixed(1)} h of ${(spanMs / 3.6e6).toFixed(1)} h between each session's first start and last end ` +
        `(${(100 * annotatedMs / spanMs).toFixed(1)}%). Gaps over 1 s: ${gapCount}; ` +
        `median ${s(pct(gapLens, 0.5))} s, 95th pct ${s(pct(gapLens, 0.95))} s, longest ${s(gapLens[gapLens.length - 1])} s.\n`);

    // 5: how PCTcover (coarsesize) is filled in.
    const cover = new Map();
    for (const i of intervals) {
        const v = i.coarsesize;
        const k = v == null ? 'empty' : v === 0 ? '0' : v === 100 ? '100' : '1-99';
        cover.set(k, (cover.get(k) || 0) + 1);
    }
    out.push('\n## PCTcover (coarsesize)\n');
    out.push(table(['Value', 'Intervals'], [...cover.entries()]));

    // 6: projects, annotators, dives.
    const proj = new Map();
    for (const i of intervals) {
        if (!proj.has(i.project)) proj.set(i.project, { sessions: new Set(), users: new Set(), dives: new Set(), videos: new Set(), ms: 0, years: new Set() });
        const p = proj.get(i.project);
        p.sessions.add(i.session_id); p.users.add(i.user_id); p.dives.add(i.dive); p.videos.add(i.video_source);
        p.ms += i.len; p.years.add(new Date(i.createdAt).getFullYear());
    }
    out.push('\n## By project\n');
    out.push(table(['Project', 'Sessions', 'Dives', 'Annotators', 'Video files', 'Hours', 'Annotated in'],
        [...proj.entries()].sort((x, y) => y[1].ms - x[1].ms).map(([n, p]) =>
            [n, p.sessions.size, p.dives.size, p.users.size, p.videos.size, (p.ms / 3.6e6).toFixed(1), [...p.years].sort().join(', ')])));

    // 7: the same project, dive and line annotated in more than one session.
    const lines = new Map();
    for (const i of intervals) {
        const k = `${i.project} / dive ${i.dive} / line ${i.line}`;
        if (!lines.has(k)) lines.set(k, new Map());
        lines.get(k).set(i.session_id, i.user_id);
    }
    const twice = [...lines.entries()].filter(([, m]) => m.size > 1);
    const twiceByOthers = twice.filter(([, m]) => new Set(m.values()).size > 1);
    out.push('\n## Annotated more than once\n');
    out.push(`Project/dive/line with more than one Habitat session: ${twice.length}; ` +
        `of those, by different annotators: ${twiceByOthers.length}.\n`);
    if (twiceByOthers.length) {
        out.push(table(['Project / dive / line', 'Sessions (annotator)'],
            twiceByOthers.slice(0, 20).map(([k, m]) => [k, [...m.entries()].map(([sid, u]) => `${sid} (${u})`).join(', ')])));
    }

    // 8: video files, and whether the clock time maps to a file position consistently.
    const videos = new Map();
    for (const i of intervals) {
        const m = parseTimeSpan(i.mediaPosition); const t = parseTimeSpan(i.actualPosition);
        if (!videos.has(i.video_source)) videos.set(i.video_source, { offsets: [], sessions: new Set() });
        const v = videos.get(i.video_source);
        v.sessions.add(i.session_id);
        if (m != null && t != null) v.offsets.push(t - m);
    }
    let consistent = 0; let inconsistent = 0; let noPos = 0;
    for (const v of videos.values()) {
        if (!v.offsets.length) { noPos++; continue; }
        const spread = Math.max(...v.offsets) - Math.min(...v.offsets);
        if (spread <= 2000) consistent++; else inconsistent++;
    }
    const multiFile = [...bySession.values()].filter((l) => new Set(l.map((i) => i.video_source)).size > 1).length;
    out.push('\n## Video files\n');
    out.push(table(['Measure', 'Count'], [
        ['Distinct video files', videos.size],
        ['Files where clock time minus file position is constant (within 2 s)', consistent],
        ['Files where it is not', inconsistent],
        ['Files with no positions recorded', noPos],
        ['Sessions spanning more than one file', multiFile],
    ]));

    console.log(out.join('\n'));
    await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
