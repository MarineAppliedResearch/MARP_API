/**
 * Builds a single self-contained review page out of the screenshots.
 *
 *   node tools/review-page.mjs
 *
 * Writes shots/review.html with every shot embedded as a data URI, so the file
 * can be sent to somebody on a different machine and opened with nothing else.
 * That is the whole reason it exists: the person reviewing this design is not
 * always the person the screenshots were taken on, and a folder path is no use
 * to them.
 *
 * JPEG rather than PNG, because sixteen PNGs at this width come to about 27 MB
 * and a page has to stay small enough to send.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const APP = join(HERE, '..');
const PORT = Number(process.env.SHOT_PORT || 8128);
const BASE = `http://localhost:${PORT}/apps/marp-ml-dashboard/`;

/** The rail's order, with what each screen is for and what is not finished. */
const TABS = [
  ['dashboard', 'Dashboard', 'The landing surface. Job control first, worker capacity second.'],
  ['jobs', 'Jobs', 'One queue for training and inference. A row opens the job detail drawer.'],
  ['inference', 'Inference', 'Running a model over MARP data. Five decisions on the front, the rest under Advanced.'],
  ['training', 'Training', 'Fine-tuning from a registered model over one saved dataset.'],
  ['datasets', 'Datasets', 'Building a training set from approved observations, and splitting it by overlap group.'],
  ['models', 'Models', 'The ml_models registry, its versions, and what each is preferred for.'],
  ['workers', 'Workers', 'The pool, at the scale #104 assumes rather than at four office GPUs.'],
  ['history', 'History', 'A bounded recent view. Never the whole job table.'],
];

const VIEWS = { desktop: { width: 1672, height: 941 }, phone: { width: 390, height: 844 } };

const server = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 400));
await mkdir(join(APP, 'shots'), { recursive: true });

const browser = await chromium.launch();
const shots = {};
let bytes = 0;

for (const [view, viewport] of Object.entries(VIEWS)) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  for (const [id] of TABS) {
    await page.goto(BASE + '#/' + id, { waitUntil: 'load' });
    await page.waitForSelector('#content > *', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    /* fullPage, because a tab is taller than the viewport and the part below the
       fold is exactly the part a reviewer has not seen. */
    const buf = await page.screenshot({ type: 'jpeg', quality: 78, fullPage: true });
    shots[`${id}-${view}`] = buf.toString('base64');
    bytes += buf.length;
  }
  await page.close();
}
await browser.close();
stop();

const img = (key, alt) => shots[key]
  ? `<img loading="lazy" alt="${alt}" src="data:image/jpeg;base64,${shots[key]}">`
  : `<p class="missing">no shot</p>`;

const sections = TABS.map(([id, name, note], i) => `
<section id="${id}">
  <header>
    <span class="n">${String(i + 1).padStart(2, '0')}</span>
    <h2>${name}</h2>
    <p>${note}</p>
  </header>
  <div class="pair">
    <figure class="wide">
      <figcaption>Desktop &middot; 1672 &times; 941</figcaption>
      ${img(id + '-desktop', name + ' at desktop width')}
    </figure>
    <figure class="narrow">
      <figcaption>Phone &middot; 390 &times; 844</figcaption>
      ${img(id + '-phone', name + ' at phone width')}
    </figure>
  </div>
</section>`).join('');

const html = `<title>ML Dashboard Screens</title>
<style>
  :root {
    --ground: #05080f; --panel: #0a1120; --line: #17263c; --line-soft: #101a2b;
    --ink: #dbe6f0; --dim: #8fa3b8; --faint: #5b7288; --white: #f4f9ff;
    --cyan: #64f6f2; --amber: #f6c453;
    --body: Inter, "Segoe UI", system-ui, sans-serif;
    --display: "Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif;
  }
  body { margin: 0; background: var(--ground); color: var(--ink);
         font: 15px/1.6 var(--body); }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px 80px; }

  header.top { padding: 56px 0 28px; border-bottom: 1px solid var(--line); }
  header.top h1 { font-family: var(--display); font-size: clamp(34px, 6vw, 58px);
                  font-weight: 700; letter-spacing: .01em; color: var(--white);
                  margin: 0 0 10px; text-wrap: balance; }
  header.top .lede { max-width: 62ch; color: var(--dim); margin: 0 0 20px; }
  header.top .lede b { color: var(--ink); font-weight: 600; }

  .note { display: flex; gap: 10px; padding: 12px 14px; border-radius: 6px;
          background: rgba(246,196,83,.06); border: 1px solid rgba(246,196,83,.25);
          color: var(--amber); font-size: 13.5px; max-width: 78ch; }
  .note b { color: var(--amber); }

  nav.toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 22px 0 0; }
  nav.toc a { padding: 5px 11px; border-radius: 20px; border: 1px solid var(--line);
              color: var(--dim); text-decoration: none; font-size: 13px; }
  nav.toc a:hover { border-color: var(--cyan); color: var(--cyan); }

  section { padding: 44px 0; border-bottom: 1px solid var(--line-soft); }
  section header { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px;
                   align-items: baseline; margin-bottom: 18px; }
  section .n { font-family: var(--display); font-size: 15px; color: var(--faint);
               font-variant-numeric: tabular-nums; letter-spacing: .1em; }
  section h2 { font-family: var(--display); font-size: 27px; font-weight: 700;
               color: var(--white); margin: 0; letter-spacing: .01em; }
  section header p { grid-column: 2; margin: 0; color: var(--dim); font-size: 14px;
                     max-width: 68ch; }

  .pair { display: grid; grid-template-columns: minmax(0,1fr) 232px; gap: 18px;
          align-items: start; }
  figure { margin: 0; }
  figcaption { font-size: 11.5px; letter-spacing: .09em; text-transform: uppercase;
               color: var(--faint); margin-bottom: 7px; }
  figure img { display: block; width: 100%; height: auto; border-radius: 7px;
               border: 1px solid var(--line); background: var(--panel); }
  .missing { color: var(--amber); font-size: 13px; }

  @media (max-width: 820px) { .pair { grid-template-columns: minmax(0,1fr); }
                              .narrow { max-width: 232px; } }
  @media (prefers-color-scheme: light) { /* deliberately single-theme: these are
    screenshots of a dark console, and a light page around them fights them */ }
</style>

<div class="wrap">
<header class="top">
  <h1>MARP Machine Learning Dashboard</h1>
  <p class="lede">Every screen of the interactive mockup, at the width your reference
  mockups were drawn at and at phone width. Full page, so what sits below the fold is
  here too. Built from <b>MARP_API#104</b>, running on fixture data: 120 jobs,
  143 workers, 10 models, 8 datasets.</p>
  <p class="note"><span>&#9888;</span><span><b>Unfinished, and it shows.</b>
  Four tabs are drawn but their stylesheets are not written yet, so expect polish
  defects rather than layout &mdash; oversized icons, cells whose two lines run
  together. <b>Training</b> and <b>Datasets</b> are still placeholders.</span></p>
  <nav class="toc">${TABS.map(([id, name]) => `<a href="#${id}">${name}</a>`).join('')}</nav>
</header>
${sections}
</div>`;

const out = join(APP, 'shots', 'review.html');
await writeFile(out, html, 'utf8');
console.log(`wrote ${out}`);
console.log(`  ${Object.keys(shots).length} shots, ${(bytes / 1e6).toFixed(1)} MB of JPEG`
  + `, page ${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB`);
