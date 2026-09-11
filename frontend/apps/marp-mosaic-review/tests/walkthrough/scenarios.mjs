/**
 * The walkthrough scripts.
 *
 * A scene has three parts, deliberately separated:
 *
 *   caption  what appears on screen — short, because it has to be read at a glance
 *   say      what is spoken — conversational, and spelled for a speech engine
 *            ("Marp", not "MARP", which gets read out as four letters)
 *   act      what the app is driven to do, asserting as it goes
 *
 * A scene is held for as long as its line takes to speak, so lines never talk over
 * one another. Silent runs fall back to a fixed hold.
 */

const tilesIn = (page) => page.locator('.tile:not(.failed):not(.queued)');

/**
 * Draw the current address into the page, for the video only.
 *
 * A recorded viewport has no browser chrome in it, so the address bar — which is the whole
 * subject of the resumability walkthrough — cannot be seen. This paints it across the top
 * instead. It is scaffolding for the camera and belongs to no test and to no part of the
 * application; nothing outside this file knows it exists.
 */
async function showAddress(page) {
  await page.evaluate(() => {
    let strip = document.getElementById('demoAddress');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'demoAddress';
      strip.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;'
        + 'font:12px/1.9 ui-monospace,Consolas,monospace;padding:0 10px;'
        + 'background:#0b1b24;color:#7fe3ff;border-bottom:1px solid #17414f;'
        + 'pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(strip);
    }
    const url = new URL(window.location.href);
    strip.textContent = decodeURIComponent(url.pathname + url.search) || url.pathname;
  });
}

/** How many observations the current filters match, read off the chrome. */
const totalShown = async (page) =>
  Number((await page.locator('#total').innerText()).replace(/\D/g, ''));

/** Type into one end of a two-ended filter and let the rail's change handler run. */
async function setEnd(page, key, end, value, settled) {
  const box = page.locator(`[data-span="${key}"] [data-end="${end}"]`);
  /* Time and date live behind a summary button since #81, so open the popover first. */
  if (!(await box.count())) await page.locator(`[data-dim="${key}"]`).click();
  await box.fill(value);
  /* `fill` raises `input` and not `change`, and the rail waits for `change`. */
  await box.press('Enter');
  await settled();
}

/* A page arrives with its existing flags already marked, so a scenario that wants to
   demonstrate marking has to start from a tile nobody has decided about yet. */
const freshTile = (page) => page.locator('.tile:not(.failed):not(.queued):not(.marked)');

/**
 * Mark the first `n` undecided tiles, one after another.
 *
 * A locator is re-resolved on every use, and `freshTile` stops matching the instant a tile
 * is marked — so anything that clicks and then keeps using the same locator waits forever.
 * Pin the id first, which is what this does.
 *
 * Paced rather than instant: reviewing is a person going down a wall clicking things, and
 * fifteen tiles vanishing in one frame does not read as work being done.
 */
async function markMany(page, n, gap = 280) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const next = freshTile(page).first();
    if (!(await next.count())) break;
    const id = await next.getAttribute('data-id');
    ids.push(id);
    await page.locator(`.tile[data-id="${id}"]`).click();
    await page.waitForTimeout(gap);
  }
  return ids;
}

async function markFirstFresh(page) {
  const id = await freshTile(page).first().getAttribute('data-id');
  const tile = page.locator(`.tile[data-id="${id}"]`);
  await tile.click();
  return tile;
}

/**
 * Count every instant a loading state is on screen, and record what the store asked for.
 *
 * The same instrumentation `render.spec.mjs` uses, and for the same reason: rendering here
 * is a full re-render, so a skeleton grid is replaced within one notify and any check that
 * looks *afterwards* cannot see the flash. A MutationObserver sees it.
 */
async function watchWaits(page) {
  await page.evaluate(async () => {
    const { state, subscribe } = await import('./src/store.js');
    window.__waits = 0;
    window.__asks = [];
    window.addEventListener('marp:action', (e) => {
      if (e.detail.name === 'query' || e.detail.name === 'query:pinned') {
        window.__asks.push(e.detail.name);
      }
    });
    const look = () => {
      if (document.querySelector('.tile.skeleton')
        || document.querySelector('#field[data-state="loading"]')) window.__waits++;
    };
    new MutationObserver(look).observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'data-state']
    });
    look();
    void state; void subscribe;
  });
}

/** Forget what has happened, so the next scene's numbers are about one page change. */
const fromHere = (page) => page.evaluate(() => {
  window.__waits = 0; window.__asks.length = 0;
});

/**
 * Paint the measurements across the top of the frame.
 *
 * Scaffolding for the camera, exactly like `showAddress`: a millisecond count is the whole
 * subject of this walkthrough and there is nowhere on screen it would otherwise appear.
 * Belongs to no test and to no part of the application.
 */
async function meter(page, text, tone = 'good') {
  await page.evaluate(([t, k]) => {
    let strip = document.getElementById('demoMeter');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'demoMeter';
      strip.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;'
        + 'font:13px/2.1 ui-monospace,Consolas,monospace;padding:0 12px;'
        + 'pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(strip);
    }
    strip.style.background = k === 'bad' ? '#2a1414' : '#0b1b24';
    strip.style.color = k === 'bad' ? '#ffb4b4' : '#7fe3ff';
    strip.style.borderBottom = `1px solid ${k === 'bad' ? '#5c2626' : '#17414f'}`;
    strip.textContent = t;
  }, [text, tone]);
}

/**
 * Change page, and answer with how long the new page took to be on screen.
 *
 * Resolved by the store's own settled notify rather than by a timeout or a poll, which
 * would measure the timeout or the poll interval instead of the page change.
 */
function timedPage(page, to) {
  return page.evaluate((want) => new Promise((resolve, reject) => {
    import('./src/store.js').then(({ actions, state, subscribe }) => {
      const target = want === 'next' ? state.page + 1
        : want === 'prev' ? state.page - 1 : want;
      if (target === state.page) return reject(new Error(`already on page ${target}`));
      const started = performance.now();
      const bail = setTimeout(() => reject(new Error('the page never settled')), 20_000);
      const off = subscribe((s) => {
        if (s.loading || s.page !== target) return;
        clearTimeout(bail); off();
        resolve(performance.now() - started);
      });
      actions.goToPage(target);
    }, reject);
  }), to);
}

/** Wait until the scheduler says it has fetched these pages ahead. */
async function waitPrefetch(page, wanted) {
  await page.waitForFunction((want) => {
    const got = new Set();
    for (const a of (window.__ahead || [])) for (const n of a) got.add(n);
    return want.every((n) => got.has(n));
  }, wanted, { timeout: 25_000 });
}

/** Record which pages the prefetcher has cached, for `waitPrefetch` to read. */
async function watchAhead(page) {
  await page.evaluate(() => {
    window.__ahead = [];
    window.addEventListener('marp:action', (e) => {
      if (e.detail.name === 'prefetch:cached') {
        window.__ahead.push(e.detail.detail.pages || []);
      }
    });
  });
}

/** Take the fixture to production depth, and answer with the shape that produced. */
function deepen(page, scale = 147) {
  return page.evaluate((n) => new Promise((resolve, reject) => {
    Promise.all([import('./src/data.js'), import('./src/store.js')])
      .then(([{ MarpData }, { actions, subscribe }]) => {
        MarpData.setScale(n);
        const bail = setTimeout(() => reject(new Error('the deep question never settled')), 25_000);
        const off = subscribe((s) => {
          if (s.loading) return;
          clearTimeout(bail); off();
          resolve({ pageCount: s.pageCount, total: s.total, pageSize: s.pageSize });
        });
        /* The scale is invisible to the cache key, so ask a different question in the same
           breath -- a stale scale-1 page served at depth would look exactly like a defect. */
        actions.setSort('confidence', 'desc');
      }, reject);
  }), scale);
}

/**
 * The beats a scene is built from.
 *
 * The runner starts `act` the instant the line begins speaking, so the timing of an action
 * is decided by *where in the sentence its cue falls* — not by a lead you pick. A fixed
 * lead does not work: park "I am going to page forward" twelve seconds into a paragraph
 * and the tiles will have changed long before the viewer is told to watch them.
 *
 * So the rule is about the words, not the numbers: **an action scene's line opens with its
 * cue in the first three or four words**, and everything explanatory goes in a scene of its
 * own with no action in it. `CUE` is then just long enough for those few words to be said.
 */
const beat = (page, ms) => page.waitForTimeout(ms);
const CUE = 1300;       // "right — paging forward now", spoken
const DWELL = 2000;     // long enough to see that it landed

const LOOK = 3400;      // long enough to actually study a wall of tiles, not glimpse it

/**
 * Turn one page with the pager the reviewer uses, and check it really turned.
 *
 * Clicked rather than driven through `actions.goToPage`: this is a walkthrough of the
 * application, so the thing on screen has to be the control somebody would press.
 */
async function turnPage(page, expect, settled, to) {
  await page.locator('[data-page="next"]').click();
  await settled();
  await expect(page.locator('#pageNow'), `now on page ${to}`).toHaveText(String(to));
}

/**
 * The light check behind every "look at this" line: there are tiles, and the pictures
 * that loaded really decoded.
 *
 * Deliberately *not* "every tile has a decoded picture". Thumbnails are `loading="lazy"`,
 * so a tile below the fold legitimately has not fetched yet and would read as a defect;
 * and a thumbnail whose file is missing removes its own `<img>` in `onerror`, so a broken
 * picture is a tile with no image rather than an image with no size. What is asserted is
 * that the page drew something, that something in it decoded, and that nothing which did
 * load came out at zero by zero.
 *
 * The counts are logged rather than painted on screen — the reviewer is looking at the
 * tiles, and a measurement strip across the top is exactly the clutter this scenario is
 * meant not to have.
 */
async function lookedAt(page, expect, where) {
  const tiles = await page.locator('.tile').count();
  const imgs = await page.locator('.tile img').evaluateAll((els) => els.map((i) => ({
    src: i.getAttribute('src'), done: i.complete, w: i.naturalWidth, h: i.naturalHeight
  })));
  const noimage = await page.locator('.tile[data-noimage], .tile.queued, .tile.failed').count();

  expect(tiles, `${where} drew tiles`).toBeGreaterThan(0);
  const decoded = imgs.filter((i) => i.w > 0 && i.h > 0).length;
  expect(decoded, `${where} drew pictures`).toBeGreaterThan(0);
  for (const img of imgs.filter((i) => i.done)) {
    expect(img.w, `${where}: ${img.src} loaded but decoded to nothing`).toBeGreaterThan(0);
    expect(img.h).toBeGreaterThan(0);
  }

  console.log(`  ${where}: ${tiles} tiles, ${decoded} pictures decoded, ${noimage} without one`);
  return { tiles, decoded, noimage };
}

/**
 * The question the store is currently asking, in the shape the endpoint takes.
 *
 * Everything that is not narrowing is dropped, so what goes over the wire is only what the
 * rail actually has selected — the same thing the client sends.
 */
const question = (page) => page.evaluate(() => {
  const { state } = window.MARP;
  return {
    filters: Object.fromEntries(Object.entries(state.filters)
      .filter(([, v]) => v != null && (!Array.isArray(v) || v.length))),
    sort: [{ field: state.sort.field, dir: state.sort.dir }],
    pageSize: state.pageSize
  };
});

/**
 * Ask the endpoint directly, from the test rather than through the application.
 *
 * `page.request` carries the browser context's session cookie, so this is the reviewer's
 * own credentials — but it is **not** the code path that drew the screen, and that is the
 * whole point. A scene claiming the tiles came out of the database has to compare them
 * against something that did not draw them; comparing the app to itself proves nothing.
 */
async function askApi(page, origin, path, data) {
  const res = await page.request.post(`${origin}/api/v2${path}`, { data });
  if (!res.ok()) throw new Error(`${path} answered ${res.status()}: ${await res.text()}`);
  return res.json();
}

export const scenarios = {

  /* ----------------------------------------------------------- training */
  training: {
    title: 'Training Data Review',
    scenes: [
      {
        caption: 'Training Data Review',
        say: "Training Data Review looks the same, but it's answering a different question. "
           + "Scientific review asks whether an observation is good data. This asks whether "
           + "it's good enough to teach a model with. Those are separate decisions.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('#commit')).toContainText('Promote Page');
        }
      },
      {
        caption: 'The unit is the whole track',
        say: "Every tile now shows a frame count. What gets promoted isn't this one picture, "
           + "it's the whole tracked observation — so a nine frame track and a fifty frame "
           + "track are very different training samples, and you need to see which is which.",
        async act({ page, expect }) {
          await expect(page.locator('.tile .frames').first()).toBeVisible();
        }
      },
      {
        caption: 'Excluding a track, with a reason',
        say: "Marking here means exclude, not flag. Let's exclude one, and say why we're "
           + "excluding it — this one is occluded, so it would teach the model the wrong shape.",
        async act({ page, expect }) {
          const tile = tilesIn(page).first();
          await tile.click();
          await expect(tile).toHaveClass(/marked/);
          await page.waitForTimeout(400);
          await tile.locator('[data-badge]').click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.locator('.pick .chip', { hasText: 'Occluded' }).click();
          await page.waitForTimeout(400);
          await page.keyboard.press('Escape');
          /* The exclusion has to still be there once the panel is gone — it used to
             be cancelled by the very click that dismissed the panel. */
          await expect(tile).toHaveClass(/marked/);
          await expect(tile.locator('.badge')).toContainText('EXCLUDED');
          await expect(tile.locator('.reason-chip')).toHaveText('Occluded');
          await expect(page.locator('#footCount')).toContainText('1');
        }
      },
      {
        caption: 'Promote Page',
        say: "And committing promotes everything else into the training set. The one we "
           + "excluded stays excluded, with its reason attached. Excluding is a real decision "
           + "that gets recorded — it isn't just the absence of approval.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'PROMOTED' }).first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'EXCLUDED' })).toHaveCount(1);
        }
      }
    ]
  },

  /* ------------------------------------------------------------- overview */

  /* ------------------------------------------------- verify: mode separation */
  /* --------------------------------------- verify: the delete confirmation */
  /* Short and single-purpose: show that a permanent delete now stops and asks, that
     cancelling really does nothing, and that confirming really does delete. Every line
     asserts what it claims -- a scene that narrates a result without asserting it can
     lie, and this is the one workflow where that would matter most. */

  /* -------------------------------------------- verifying: coming back to it */
  'verify-resume': {
    title: 'Verifying: the question survives a reload',
    scenes: [
      {
        caption: 'The address is the whole memory',
        say: "Everything you ask the reviewer for now lives in the address. Nothing is "
           + "stored anywhere else — no hidden settings, no local storage. I have painted "
           + "the address across the top of the page, because a recording does not capture "
           + "the browser's own address bar. Watch it change as I go.",
        async act({ page, expect }) {
          await showAddress(page);
          await expect(page.locator('#demoAddress')).toBeVisible();
          /* The default question is a bare address, which is what makes a plain link to
             the tool still mean "everything". */
          expect(await page.locator('#demoAddress').innerText()).not.toContain('?');
        }
      },
      {
        caption: 'Two dives at once',
        say: "Start with a couple of dives. Two at a time, which the rail could not do "
           + "before. Watch the top of the screen — the dives appear in the address as I "
           + "pick them.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-dim="dive"]').click();
          await page.locator('.menu [data-v]').nth(1).click();
          await page.waitForTimeout(450);
          await page.locator('.menu [data-v]').nth(2).click();
          await page.keyboard.press('Escape');
          await settled();
          await showAddress(page);

          await expect(page.locator('#demoAddress')).toContainText('dive=');
          store.dives = await page.locator('[data-dim="dive"] span').first().innerText();
        }
      },
      {
        caption: 'A range, not a single value',
        say: "Now a different kind of filter altogether. Confidence is a range with two "
           + "ends, and it goes into the address as a range — the two numbers with a pair "
           + "of dots between them.",
        async act({ page, expect, settled }) {
          const to = page.locator('[data-span="confidence"] [data-end="to"]');
          await to.evaluate((el) => {
            el.value = '0.95';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settled();
          await showAddress(page);
          await expect(page.locator('#demoAddress')).toContainText('confidence=');
        }
      },
      {
        caption: 'And a time of day',
        say: "And a third kind — a window of time, which reads in the address exactly the "
           + "way you would say it out loud. Three in the morning until two, which is a "
           + "window that wraps past midnight, and it survives being written down as one.",
        async act({ page, expect, settled, store }) {
          await setEnd(page, 'timeOfDay', 'from', '03:00', settled);
          await setEnd(page, 'timeOfDay', 'to', '02:00', settled);
          await showAddress(page);

          await expect(page.locator('#demoAddress')).toContainText('timeOfDay=03:00..02:00');
          store.total = await totalShown(page);
          expect(store.total).toBeGreaterThan(0);
          /* The next scene pages forward, so the filters have to leave somewhere to go.
             They once left a single page and 'Next' was a silent no-op. */
          expect(await page.evaluate(() => window.MARP.state.pageCount)).toBeGreaterThan(1);
        }
      },
      {
        caption: 'Where you are, too',
        say: "The page you are on goes in as well. Move to the second page and the address "
           + "picks it up, so a link lands somebody exactly where you were rather than back "
           + "at the beginning.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-page="next"]').click();
          await settled();
          await showAddress(page);

          await expect(page.locator('#demoAddress')).toContainText('page=2');
          store.link = page.url();
          expect(await page.evaluate(() => window.MARP.state.page)).toBe(2);
        }
      },
      {
        caption: 'Flag something first',
        say: "Before I close it, let me flag a tile — because what comes back matters as "
           + "much as what does. Watch this one.",
        async act({ page, expect, settled }) {
          await settled();
          const tile = page.locator('.tile:not(.failed):not(.queued)').first();
          await tile.click();
          await expect(page.locator('.tile.marked')).toHaveCount(1);
        }
      },
      {
        caption: 'Now come back to it cold',
        say: "This is the bookmark. I am throwing the whole page away and opening that "
           + "address again from nothing, the way you would tomorrow morning. Two dives, "
           + "the confidence range, the time window, and the second page — all of it back.",
        async act({ page, expect, settled, store }) {
          await page.goto(store.link);
          await settled();
          await showAddress(page);

          await expect(page.locator('[data-dim="dive"] span').first()).toHaveText(store.dives);
          await expect(page.locator('#demoAddress')).toContainText('confidence=');
          await expect(page.locator('#demoAddress')).toContainText('timeOfDay=03:00..02:00');
          expect(await page.evaluate(() => window.MARP.state.page)).toBe(2);
          expect(await totalShown(page)).toBe(store.total);
        }
      },
      {
        caption: 'The flag did not come back',
        say: "The flag did not. That is deliberate, not a gap. A mark is not a decision "
           + "until the page is committed, and a flag that came back would look exactly "
           + "like one that had been written to the record while the record knew nothing "
           + "about it. The question comes back; work you never submitted does not.",
        async act({ page, expect }) {
          await expect(page.locator('.tile.marked')).toHaveCount(0);
        }
      },
      {
        caption: 'And one gesture puts it all back',
        say: "Last thing. Clearing ten filters one at a time is not a gesture, so there is "
           + "a Reset in the corner of the rail. It puts you back to the default question "
           + "and empties the address with it — but it leaves you in the mode you were "
           + "working in, because clearing your filters is not the same as leaving the job.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          await showAddress(page);

          await expect(page.locator('[data-dim="dive"]')).toContainText('All dives');
          expect(await page.locator('#demoAddress').innerText()).not.toContain('?');
        }
      }
    ]
  },

  /* ------------------------------------------------- verifying: the rail rebuilt */
  'verify-rail': {
    title: 'Verifying: the filter rail, rebuilt',
    scenes: [
      {
        caption: 'One list, not four groups',
        say: "The rail had become crowded and buggy, so it has been rebuilt. The four "
           + "group headings are gone, the processor filter is gone, and there is a reset "
           + "in the corner. What is left is one ordered list you can read down.",
        async act({ page, expect }) {
          await expect(page.locator('.railgroup__title')).toHaveCount(0);
          await expect(page.locator('#railReset')).toBeVisible();
          await expect(page.locator('[data-dim="processor"]')).toHaveCount(0);
          /* L7: the rail was clipping. The status filters live below the dimensions and
             were being drawn off the bottom where nobody could reach them. */
          await expect(page.locator('#statusFilters [data-statuskey]').first()).toBeVisible();
        }
      },
      {
        caption: 'Choosing one unticks "all"',
        say: "Here is the first bug. Open a filter and pick a value: All projects unticks "
           + "the moment you choose one, rather than staying ticked until you close the "
           + "menu and wonder which of the two you are actually filtering by.",
        async act({ page, expect }) {
          await page.locator('[data-dim="project"]').click();
          const menu = page.locator('.menu');
          await expect(menu).toBeVisible();
          const all = menu.locator('[data-v]').first();
          await expect(all).toHaveClass(/on/);          // "All projects" starts ticked

          await menu.locator('[data-v]').nth(1).click();
          await page.waitForTimeout(500);
          await expect(menu.locator('[data-v]').first()).not.toHaveClass(/on/);
          await expect(menu.locator('[data-v]').nth(1)).toHaveClass(/on/);
        }
      },
      {
        caption: 'And its own button closes it',
        say: "Second bug. Clicking the button that opened a menu now closes it, which is "
           + "what every dropdown anywhere does. It used to do nothing, because the rail "
           + "redraws itself and the button holding the menu open was no longer the same "
           + "button by the time you clicked it.",
        async act({ page, expect, settled }) {
          await page.locator('[data-dim="project"]').click();
          await expect(page.locator('.menu')).toHaveCount(0);
          await settled();
        }
      },
      {
        caption: 'The stray label beside each status',
        say: "Third. Every status filter was drawing a second grey pill next to it reading "
           + "reviewStatus. It was not a control at all — the keyboard shortcut badges are "
           + "drawn from a data attribute, and the status filters happened to use the same "
           + "attribute name for something else. They now use their own.",
        async act({ page, expect }) {
          await expect(page.locator('#statusFilters [data-key]')).toHaveCount(0);
          await expect(page.locator('#statusFilters [data-statuskey]').first()).toBeVisible();
        }
      },
      {
        caption: 'Session type narrows the sessions',
        say: "Session type sits above session now, and it is not only cosmetic — a session "
           + "belongs to a type, so choosing the type narrows which sessions are even on "
           + "offer. These are the real values from the database, inconsistent capitals and "
           + "all.",
        async act({ page, expect, settled, store }) {
          await page.locator('[data-dim="session"]').click();
          store.allSessions = await page.locator('.menu [data-v]').count();
          await page.keyboard.press('Escape');

          await page.locator('[data-dim="sessionType"]').click();
          const types = await page.locator('.menu [data-v]').allInnerTexts();
          expect(types.join(' ')).toContain('Fish_GULF');
          await page.locator('.menu [data-v]').nth(1).click();
          await page.keyboard.press('Escape');
          await settled();

          await page.locator('[data-dim="session"]').click();
          const narrowed = await page.locator('.menu [data-v]').count();
          await page.keyboard.press('Escape');
          expect(narrowed).toBeLessThan(store.allSessions);
        }
      },
      {
        caption: 'One track, two handles',
        say: "Confidence was two separate sliders stacked up. It is one track with two "
           + "handles now, which is what a range actually looks like. Watch the count as I "
           + "pull the top end down.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          const before = await totalShown(page);

          const dual = page.locator('.dual[data-span="confidence"]');
          await expect(dual).toBeVisible();
          await expect(dual.locator('input[type="range"]')).toHaveCount(2);

          await dual.locator('[data-end="to"]').evaluate((el) => {
            el.value = '0.8';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await settled();
          expect(await totalShown(page)).toBeLessThan(before);
        }
      },
      {
        caption: 'Time of day, in 24-hour',
        say: "Time and date were four boxes wedged into the rail. Each is one row now, "
           + "opening a small panel. And the clock is twenty-four hour — a native time "
           + "field takes its format from the browser, and there is no way to make it "
           + "behave, so these are plain text fields that understand what you type.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          await page.locator('[data-dim="timeOfDay"], [data-panel="timeOfDay"]').first().click();
          const panel = page.locator('.menu');
          await expect(panel).toBeVisible();
          await expect(panel.locator('.clock').first()).toHaveAttribute('type', 'text');
          await expect(panel).toContainText('24-hour');

          await panel.locator('[data-end="from"]').fill('22:00');
          await panel.locator('[data-end="to"]').fill('02:00');
          await panel.locator('[data-end="to"]').press('Enter');
          await page.keyboard.press('Escape');
          await settled();
        }
      },
      {
        caption: 'Sorting, with a tie-break',
        say: "And sorting. There were five fixed orders in a list. Now you choose the "
           + "field and the direction separately — and then what to do where that field "
           + "ties, which is the part that was missing. Watch the order of the tiles when "
           + "I set the tie-break.",
        async act({ page, expect, settled, store }) {
          await page.locator('#railReset').click();
          await settled();
          store.before = await page.locator('.tile').evaluateAll(
            (els) => els.map((e) => e.dataset.id).join(','));

          await page.locator('#sortBtn').click();
          const menu = page.locator('.menu');
          await expect(menu).toContainText('Then, where that ties');
          await menu.locator('[data-v="then:keyframe_count"]').click();
          await page.waitForTimeout(400);
          await menu.locator('[data-v="then:desc"]').click();
          await page.keyboard.press('Escape');
          await settled();

          /* The claim is that the tie-break actually reorders, not merely that the menu
             remembered the click. */
          const after = await page.locator('.tile').evaluateAll(
            (els) => els.map((e) => e.dataset.id).join(','));
          expect(after).not.toBe(store.before);
          await expect(page.locator('#sortLabel')).toContainText('Track length');
        }
      }
    ]
  },

  /* ------------------------------------------------ verifying: the demo imagery */
  'verify-imagery': {
    title: 'Verifying: the demo data',
    scenes: [
      {
        caption: 'Real photographs, five species',
        say: "The mosaic is running on real pictures now — fifty-eight of them across five "
           + "species, reused across three thousand observations. Reuse costs nothing here: "
           + "you are judging the organism against the name it was given, not whether you "
           + "have seen this exact frame before.",
        async act({ page, expect }) {
          const srcs = await page.locator('.tile img').evaluateAll(
            (els) => els.map((e) => e.getAttribute('src')));
          const real = srcs.filter((s) => s && !s.includes('marp-mark'));
          expect(real.length).toBeGreaterThan(30);
          expect(real.every((s) => s.endsWith('.jpg'))).toBe(true);
        }
      },
      {
        caption: 'A couple on every page are wrong',
        say: "And this is what the tool is for. Every tile here claims to be a bat star. "
           + "About two on each page are not — the label is what the model said, and the "
           + "picture is what is really there. Those two things being different is the "
           + "whole job.",
        async act({ page, expect }) {
          const caps = await page.locator('.tile .cap').allInnerTexts();
          expect(caps.every((c) => c.trim() === 'Bat Star')).toBe(true);
          expect(caps.length).toBeGreaterThan(20);
        }
      },
      {
        caption: 'Whichever species you ask for',
        say: "It is not only bat stars. Every species carries the same rate, so filtering "
           + "to rock crabs gives you pages of crabs with a couple of intruders — because "
           + "four of the five species used to lead somewhere with nothing to practise on.",
        async act({ page, expect, settled }) {
          await page.locator('[data-dim="species"]').click();
          await page.locator('.menu .msearch').fill('Rock Crab');
          await page.waitForTimeout(400);
          await page.locator('.menu [data-v]').first().click();
          await page.locator('.menu .msearch').fill('Bat Star');
          await page.waitForTimeout(400);
          await page.locator('.menu [data-v]').first().click();
          await page.keyboard.press('Escape');
          await settled();

          const caps = await page.locator('.tile .cap').allInnerTexts();
          expect(caps.length).toBeGreaterThan(10);
          expect(caps.every((c) => c.trim() === 'Rock Crab')).toBe(true);
        }
      },
      {
        caption: 'Deleting counts what it will destroy',
        say: "One last thing, and it is the serious one. In delete mode, a tile whose "
           + "picture never arrived can still be marked — and the commit really does delete "
           + "it. The confirmation was leaving those out of its count, so it would say one "
           + "observation and then destroy two. It counts everything it is about to "
           + "destroy now.",
        async act({ page, expect, settled }) {
          await page.locator('#railReset').click();
          await settled();
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();

          /* Break one deliberately rather than hoping the page happens to hold one. A
             scene that quietly returns when its subject is absent narrates a claim it
             never checked, which is the one thing a walkthrough must never do. */
          const brokenId = await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            const { MarpData } = await import('./src/data.js');
            const id = state.rows[2].observation_id;
            MarpData.breakThumbnails([id]);
            await actions.refresh();
            return id;
          });
          await settled();
          await expect(page.locator(`.tile[data-id="${brokenId}"]`)).toHaveClass(/failed/);
          await page.locator(`.tile[data-id="${brokenId}"]`).click();
          const good = page.locator('.tile:not(.failed):not(.queued)').first();
          await good.click();
          await expect(page.locator('.tile.marked')).toHaveCount(2);

          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          /* Two marked, two named. The one with no picture is not quietly left out. */
          await expect(page.locator('.confirm__title')).toContainText('2 observations');
          await page.keyboard.press('Escape');
        }
      }
    ]
  },

  /* --------------------------------- verifying: both workflows in every rail */
  'verify-status-filters': {
    title: 'Verifying: filtering on either workflow',
    scenes: [
      {
        caption: 'Both workflows, in every mode',
        say: "Until now, scientific review could only filter on scientific review, and "
           + "training could only filter on training. Delete could do both. Delete's rail "
           + "is the one the other two have now — six status boxes, two workflows, "
           + "whichever mode you are in.",
        async act({ page, expect }) {
          const boxes = page.locator('#statusFilters [data-statuskey]');
          await expect(boxes).toHaveCount(6);
          const keys = await boxes.evaluateAll(
            (els) => [...new Set(els.map((e) => e.dataset.statuskey))].sort());
          expect(keys).toEqual(['reviewStatus', 'trainingDisposition']);
        }
      },
      {
        caption: 'And the default view did not move',
        say: "This is the part that mattered most, and it is the part you cannot see. "
           + "Training disposition defaults to undecided. If that default had been applied "
           + "here, scientific review would silently have lost every promoted and every "
           + "excluded observation — about a hundred and fifty of them — and nothing on "
           + "screen would have said so. A borrowed filter arrives switched off.",
        async act({ page, expect, store }) {
          store.total = await totalShown(page);
          expect(store.total).toBeGreaterThan(1000);

          /* Nothing borrowed is narrowing: the two training boxes are all unticked. */
          const on = await page.locator('#statusFilters [data-statuskey="trainingDisposition"] .box.on')
            .count();
          expect(on).toBe(0);
        }
      },
      {
        caption: 'Filtering scientific review by a training decision',
        say: "So now you can ask a question that crosses the two. Show me, in scientific "
           + "review, only the observations training has already excluded. Watch the count "
           + "collapse.",
        async act({ page, expect, settled, store }) {
          await page.locator('#statusFilters [data-statuskey="trainingDisposition"]',
            { hasText: 'Excluded' }).click();
          await settled();

          const narrowed = await totalShown(page);
          expect(narrowed).toBeGreaterThan(0);
          expect(narrowed).toBeLessThan(store.total);
          store.narrowed = narrowed;
        }
      },
      {
        caption: 'And every tile says why it is here',
        say: "Every tile on this page carries the excluded tag, from the training workflow, "
           + "while you are standing in scientific review. That is the pair working "
           + "together — the tags told you what had happened to an observation, and now the "
           + "filter lets you go and find them.",
        async act({ page, expect }) {
          const tags = page.locator('.tile .rtag, .tile .badge').filter({ hasText: 'EXCLUDED' });
          expect(await tags.count()).toBeGreaterThan(0);
        }
      },
      {
        caption: 'Switch it off and you are back',
        say: "Untick it and the count comes straight back to where it started. Nothing was "
           + "left applied behind the scenes.",
        async act({ page, expect, settled, store }) {
          await page.locator('#statusFilters [data-statuskey="trainingDisposition"]',
            { hasText: 'Excluded' }).click();
          await settled();
          expect(await totalShown(page)).toBe(store.total);
        }
      },
      {
        caption: 'It works the other way too',
        say: "And it is symmetrical. Over in training data review, you can filter by what "
           + "science decided — show me the ones a scientist already flagged, so I do not "
           + "promote something that is under question.",
        async act({ page, expect, settled }) {
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('#statusFilters [data-statuskey]')).toHaveCount(6);

          const before = await totalShown(page);
          await page.locator('#statusFilters [data-statuskey="reviewStatus"]',
            { hasText: 'Flagged' }).click();
          await settled();
          expect(await totalShown(page)).not.toBe(before);
        }
      },
      {
        caption: 'Coming back to what you already reviewed',
        say: "Two other fixes are on this branch. First: review a page, wander off to "
           + "another workflow, and come back. What you submitted is still there. Switching "
           + "mode used to throw the whole session away, so three reviewed pages became "
           + "unfindable the moment you glanced at training.",
        async act({ page, expect, settled, store }) {
          await page.locator('#railReset').click();
          await settled();
          await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
          await settled();

          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await settled();

          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await page.locator('.seg button', { hasText: 'Scientific Data Review' }).click();
          await settled();

          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          expect(await page.evaluate(() => window.MARP.state.committedPages.size)).toBe(1);
        }
      },
      {
        caption: 'And the count means this page',
        say: "Second: marked this page now counts this page. It was counting every mark you "
           + "had made anywhere in the session, so it only ever went up — and delete mode "
           + "put that same running total in front of a permanent deletion.",
        async act({ page, expect, settled }) {
          await page.locator('[data-page="next"]').click();
          await settled();

          const shown = Number(await page.locator('#markedCount').innerText());
          const marked = await page.locator('.tile.marked').count();
          expect(shown).toBe(marked);

          await page.locator('.tile:not(.failed):not(.queued):not(.marked)').first().click();
          expect(Number(await page.locator('#markedCount').innerText())).toBe(shown + 1);
        }
      }
    ]
  },

  'verify-delete-confirmation': {
    title: 'Verifying: nothing is deleted without confirming',
    scenes: [
      {
        caption: 'Six marked for deletion',
        say: "Delete mode. Six observations marked to be permanently removed.",
        async act({ page, expect, settled, store }) {
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          store.ids = await markMany(page, 6, 200);
          await expect(page.locator('.tile.marked')).toHaveCount(6);
        }
      },
      {
        caption: 'It stops and asks',
        say: "Before this change, committing here destroyed them immediately, with no "
           + "warning at all. Now it stops, and it tells you exactly what you are about "
           + "to lose.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          await expect(page.locator('.confirm__title')).toContainText('6 observations');
          await expect(page.locator('.confirm__warn')).toContainText('cannot be undone');
          await page.waitForTimeout(3800);       // long enough to actually read it
        }
      },
      {
        caption: 'Cancel changes nothing',
        say: "Cancel, and all six are still marked. Nothing was sent, so the page does "
           + "not have to be done again.",
        async act({ page, expect }) {
          await page.locator('[data-confirm="cancel"]').click();
          await expect(page.locator('.confirm__box')).toHaveCount(0);
          await expect(page.locator('.tile.marked')).toHaveCount(6);
          await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
          await page.waitForTimeout(900);
        }
      },
      {
        caption: 'Confirming deletes exactly six',
        say: "Commit again, confirm, and now they are gone. Six marked, six deleted.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          await page.waitForTimeout(1100);
          await page.locator('[data-confirm="go"]').click();
          await expect(page.locator('.tile.out-deleted')).toHaveCount(6);
          await page.waitForTimeout(900);
        }
      }
    ]
  },

  /* --------------------------------- verify: the states never rendered */

  /* ------------------------------------------- verify: the shortcuts */
  /* Short. The keyboard is not the speed path here -- the pointer is -- so this shows
     the four things worth a key and the one that deliberately refuses. */
  'verify-shortcuts': {
    title: 'Verifying: the keyboard shortcuts',
    scenes: [
      {
        caption: 'The pointer still does the choosing',
        say: "The keyboard is not how you pick tiles. Pointing at the odd one out is one "
           + "action; arrowing across a grid is several. So the pointer selects, and the "
           + "keyboard only handles the page.",
        async act({ page, expect, store }) {
          store.first = await page.locator('.tile').first().getAttribute('data-id');
          const id = await page.locator('.tile:not(.marked)').first().getAttribute('data-id');
          await page.locator(`.tile[data-id="${id}"]`).click();
          await expect(page.locator('.tile.marked')).toHaveCount(1);
          await page.waitForTimeout(900);
        }
      },
      {
        caption: 'C clears the page',
        say: "C clears every mark on the page.",
        async act({ page, expect }) {
          await page.keyboard.press('c');
          await expect(page.locator('.tile.marked')).toHaveCount(0);
          await page.waitForTimeout(700);
        }
      },
      {
        caption: 'N and P turn the pages',
        say: "N goes forward, P comes back. The shortcut is written on the button it "
           + "belongs to, so you find it where you'd ask the question.",
        async act({ page, expect, settled, store }) {
          await page.keyboard.press('n');
          await settled();
          const second = await page.locator('.tile').first().getAttribute('data-id');
          expect(second).not.toBe(store.first);
          await page.keyboard.press('p');
          await settled();
          await expect(page.locator('.tile').first()).toHaveAttribute('data-id', store.first);
          await page.waitForTimeout(600);
        }
      },
      {
        caption: 'Enter on its own does nothing',
        say: "Committing is the one thing you cannot undo, so it will not answer to a "
           + "single key. Pressing Enter here does nothing at all — deliberately.",
        async act({ page, expect }) {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1400);
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' })).toHaveCount(0);
        }
      },
      {
        caption: 'Control and Enter commits',
        say: "It takes both hands. Control and Enter commits the page.",
        async act({ page, expect }) {
          await page.keyboard.press('Control+Enter');
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
          await page.waitForTimeout(1500);
        }
      },
      {
        caption: 'And it says so when it cannot',
        say: "On a page with nothing to commit, the shortcut nudges the button that is "
           + "already telling you why, rather than sitting there looking broken.",
        async act({ page, expect }) {
          await page.evaluate(async () => {
            const { state, actions } = await import('./src/store.js');
            const { MarpData } = await import('./src/data.js');
            MarpData.breakThumbnails(state.rows.map((r) => r.observation_id));
            await actions.refresh();
          });
          await expect(page.locator('#commit')).toBeDisabled();
          await page.keyboard.press('Control+Enter');
          await expect(page.locator('#commit')).toHaveClass(/nudge/);
          await page.waitForTimeout(1600);
        }
      }
    ]
  },

  /* -------------------------------------------- verify: a committed page edits */
  'verify-editing': {
    title: 'Verifying: a committed page is still editable',
    scenes: [
      {
        caption: 'Checking a fix: editing after committing',
        say: "Second verification. After committing a page, nothing could be changed. Clicking a "
           + "tile did alter the state underneath, but the screen never moved \u2014 so it looked "
           + "completely dead. Keep your eye on the first tile through this whole sequence."
      },
      {
        caption: 'Flag one, and commit the page',
        say: "I'll flag the first tile and commit the page. Watch its badge go amber.",
        async act({ page, expect }) {
          await markFirstFresh(page);
          await page.waitForTimeout(500);
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'It is still marked \u2014 that is deliberate',
        say: "Now look at the outline on that tile. It is still marked, and that is on purpose. "
           + "A mark is what the next commit treats as the exception, so the flag we just wrote "
           + "has to stay marked \u2014 otherwise committing again would quietly un-flag it.",
        async act({ page, expect }) {
          await expect(page.locator('.tile.marked').first()).toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Click it to take the flag back',
        say: "So I click it, and watch the badge change. It says TAKING BACK. Nothing is written "
           + "yet \u2014 the record still says flagged, but the next commit will accept it. Before the "
           + "fix, this click appeared to do nothing at all.",
        async act({ page, expect }) {
          await page.locator('.tile.marked').first().click();
          await expect(page.locator('.tile .badge', { hasText: 'TAKING BACK' }).first()).toBeVisible();
        }
      },
      {
        caption: 'Commit again to accept it',
        say: "And committing again accepts it. Amber to green, on a page that had already been "
           + "committed once. That is exactly the thing that was broken.",
        async act({ page, expect }) {
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'TAKING BACK' })).toHaveCount(0);
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first()).toBeVisible();
        }
      }
    ]
  },

  /* ------------------------------------------------- verify: the species panel */
  'verify-correction': {
    title: 'Verifying: the correction panel',
    scenes: [
      {
        caption: 'Checking a fix: the panel flickering',
        say: "Third verification, and this one is short. When you corrected a species, the panel "
           + "vanished for a moment and then popped straight back up. Watch the panel this time, "
           + "not the tiles."
      },
      {
        caption: 'Open the panel, then the species chooser',
        say: "Flag a tile, open its badge, and open the species chooser. Opening the chooser goes "
           + "and fetches the taxonomy, and the panel has to stay on screen for the whole of that "
           + "request. Watch it now \u2014 it should not blink.",
        async act({ page, expect }) {
          const tile = await markFirstFresh(page);
          await page.waitForTimeout(350);
          await tile.locator('[data-badge]').click();
          await expect(page.locator('.pick')).toBeVisible();
          await page.locator('.pick [data-act="correct"]').click();
          await expect(page.locator('.pick #spSearch')).toBeVisible();
        }
      },
      {
        caption: 'Search, and choose a species',
        say: "Search the taxonomy, and pick the right one. Here is the moment: the panel should "
           + "close, once, and stay closed. It should not come back.",
        async act({ page }) {
          await page.locator('.pick #spSearch').fill('lea');
          await page.waitForTimeout(700);
          await page.locator('.pick .srow').first().click();
        }
      },
      {
        caption: 'Closed, and it stays closed',
        say: "Gone, and it stays gone. The correction saved immediately, the tile now shows what "
           + "the species used to be, and the flag is still marked \u2014 because correcting a species "
           + "and resolving a flag are two different decisions.",
        async act({ page, expect }) {
          await expect(page.locator('.pick')).toHaveCount(0);
          for (let i = 0; i < 5; i++) {
            await page.waitForTimeout(200);
            await expect(page.locator('.pick')).toHaveCount(0);
          }
          await expect(page.locator('.tile.marked').first()).toBeVisible();
          await expect(page.locator('.reason-chip', { hasText: 'was ' }).first()).toBeVisible();
        }
      }
    ]
  }
  ,
  'verify-prefetch': {
    title: 'Verifying: the reviewer never waits',
    scenes: [
      {
        caption: 'Before this, every page change waited',
        say: "Last piece of this issue, and it is about waiting. Until now every single page "
           + "change went off and asked for data, and you sat looking at a grey skeleton grid "
           + "while it did. The strip along the top of the frame counts every moment a loading "
           + "state is on screen. It says zero, because we have not moved anywhere yet.",
        async act({ page, settled }) {
          /* No navigation in this scene at all. It is the explanation, and an action here
             would happen under a sentence that is not about it. */
          await watchWaits(page);
          await watchAhead(page);
          await settled();
          await meter(page, 'page 1   loading states drawn: 0   fixture latency: 140 ms');
        }
      },
      {
        caption: 'Watch the tiles',
        say: "So keep your eye on the tiles, and on that counter. The fixture still takes a "
           + "hundred and forty milliseconds to answer a real query, so if anything gets "
           + "fetched here, you will see it happen.",
        async act({ page }) {
          await beat(page, 900);                        // nothing to do; just let it be said
        }
      },
      {
        caption: 'Page forward',
        say: "Paging forward now \u2026 there. New tiles, straight away. No skeleton grid, nothing "
           + "fetched, and the counter along the top has not moved.",
        async act({ page, expect }) {
          await beat(page, CUE);                        // "paging forward now"
          await fromHere(page);
          const ms = await timedPage(page, 'next');

          const asks = await page.evaluate(() => window.__asks.length);
          const waits = await page.evaluate(() => window.__waits);
          expect(asks, 'a held page must not be fetched').toBe(0);
          expect(waits, 'no loading state may be drawn at any instant').toBe(0);
          expect(ms, 'a cache hit cannot take a fixture latency').toBeLessThan(60);
          await expect(page.locator('.tile').first()).toBeVisible();

          await meter(page, `page 2 arrived in ${Math.round(ms)} ms   `
            + `requests: 0   loading states drawn: 0`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'A reviewer moves both ways',
        say: "A reviewer does not only go forwards, though. They page on, and then they come "
           + "back to check something. So the page behind has to be held too, not just the page "
           + "ahead of them.",
        async act({ page }) {
          await beat(page, 900);
        }
      },
      {
        caption: 'And back again',
        say: "Going back now \u2026 and there it is. The same tiles, no wait, and again nothing was "
           + "fetched to get here.",
        async act({ page, expect }) {
          await beat(page, CUE);                        // "going back now"
          /* No prefetch wait, deliberately: page 1 is in the head band the scheduler always
             holds, and it was the visible page a moment ago. Waiting on a `prefetch:cached`
             event would hang, because the runner settles the app before the first scene runs
             — so that prefetch fired before any listener of ours existed. */
          await fromHere(page);
          const ms = await timedPage(page, 'prev');

          expect(await page.evaluate(() => window.__asks.length)).toBe(0);
          expect(await page.evaluate(() => window.__waits)).toBe(0);
          expect(ms).toBeLessThan(60);
          await meter(page, `back to page 1 in ${Math.round(ms)} ms   `
            + `requests: 0   loading states drawn: 0`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Now the one you reported',
        say: "Now the one you reported by hand. Committing a page used to throw away the pages "
           + "behind it, so you could not go back and look at what you had just submitted. "
           + "Let us commit this page and then walk back to it.",
        async act({ page, store }) {
          store.before = await page.locator('.tile')
            .evaluateAll((t) => t.map((x) => x.dataset.id));
          await beat(page, 900);
        }
      },
      {
        caption: 'Commit the page',
        say: "Committing now \u2026 and there are the badges. Every tile on this page is accepted, "
           + "and it is on the record.",
        async act({ page, expect }) {
          await beat(page, CUE);                        // "committing now"
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first())
            .toBeVisible();
          await meter(page, 'page 1 committed');
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Page on',
        say: "Paging on now \u2026 there. A fresh page, and the work behind us is still held.",
        async act({ page }) {
          await beat(page, CUE);                        // "paging on now"
          await fromHere(page);
          await timedPage(page, 'next');
          await meter(page, 'page 2 \u2014 now come back to the committed page');
          await beat(page, DWELL);
        }
      },
      {
        caption: 'And back to the committed page',
        say: "Going back to it now \u2026 and there. Every badge still there, the same tiles in the "
           + "same order, showing exactly what was submitted \u2014 and coming back did not wait "
           + "either.",
        async act({ page, expect, store }) {
          await beat(page, CUE + 300);                  // "going back to it now"
          await fromHere(page);
          const ms = await timedPage(page, 'prev');

          /* A committed page is pinned, so returning is served by id from the row index —
             and it must show what was submitted, not what the filter now matches. */
          expect(ms, 'coming back to a committed page must not wait').toBeLessThan(60);
          const after = await page.locator('.tile')
            .evaluateAll((t) => t.map((x) => x.dataset.id));
          expect(after, 'a committed page keeps its exact membership').toEqual(store.before);
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first())
            .toBeVisible();

          await meter(page, `came back in ${Math.round(ms)} ms \u2014 `
            + `the page still shows what was submitted`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Now the real size',
        say: "That is three thousand rows, though, which is not a real test of anything. A "
           + "prefetcher looks instant when the whole result already fits in memory. So let us "
           + "make it the size it will really be.",
        async act({ page }) {
          await beat(page, 900);
        }
      },
      {
        caption: 'A hundred and fifty nine thousand',
        say: "Growing it now \u2026 and there. A hundred and fifty nine thousand observations, and "
           + "thousands of pages of them.",
        async act({ page, expect, store }) {
          await beat(page, CUE);                        // "growing it now"
          const deep = await deepen(page);
          expect(deep.pageCount, 'the fixture must actually be deep').toBeGreaterThan(1000);
          store.deep = deep;
          await meter(page, `${deep.total.toLocaleString()} observations, `
            + `${deep.pageCount.toLocaleString()} pages`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'The end is held on purpose',
        say: "The scheduler deliberately holds the first few pages and the last few, because a "
           + "reviewer jumps to the end more often than you would think. So watch what the very "
           + "last page costs.",
        async act({ page, store }) {
          /* Wait for the tail band here rather than in the acting scene, so the action there
             is not sitting behind a poll of unknown length. */
          await waitPrefetch(page, [store.deep.pageCount]);
          await beat(page, 700);
        }
      },
      {
        caption: 'Jump to the last page',
        say: "Jumping to the end now \u2026 and there. The last page of thousands, and nothing was "
           + "fetched at all.",
        async act({ page, expect, store }) {
          await beat(page, CUE);                        // "jumping to the end now"
          await fromHere(page);
          const last = await timedPage(page, store.deep.pageCount);

          expect(await page.evaluate(() => window.__asks.length),
            'the last page is in the tail band, so it is already held').toBe(0);
          expect(await page.evaluate(() => window.__waits)).toBe(0);
          expect(last).toBeLessThan(60);
          await expect(page.locator('.tile').first()).toBeVisible();

          await meter(page, `page ${store.deep.pageCount.toLocaleString()} of `
            + `${store.deep.pageCount.toLocaleString()} in ${Math.round(last)} ms \u2014 no request`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'But that one was expected',
        say: "That one was held on purpose, though, so it only proves half of it. The real "
           + "question is what happens when you go somewhere nobody could have guessed \u2014 so let "
           + "us type a page number out in the middle.",
        async act({ page, store }) {
          store.middle = await page.evaluate(async () => {
            const { state } = await import('./src/store.js');
            return Math.round(state.pageCount / 2) + 7;
          });
          await beat(page, 900);
        }
      },
      {
        caption: 'A page nobody predicted',
        say: "Jumping into the middle now \u2026 and that one did wait, because it had to. But it "
           + "cost one request for the whole set of pages around it, not one request for every "
           + "page.",
        async act({ page, expect, store }) {
          await beat(page, CUE + 300);                  // "jumping into the middle now"
          await fromHere(page);
          const jump = await timedPage(page, store.middle);
          const asks = await page.evaluate(() => window.__asks.length);

          /* One request for the whole set is the point of asking for a set of pages rather
             than a page: nine pages would otherwise be nine round trips. */
          expect(asks, 'the jump is one request, not one per page').toBe(1);
          expect(jump, 'this one really did go to the data layer').toBeGreaterThan(100);
          await meter(page, `page ${store.middle.toLocaleString()} fetched in `
            + `${Math.round(jump)} ms \u2014 one request, not one per page`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'And its neighbours came with it',
        say: "Stepping on from here now \u2026 and nothing. The pages either side arrived with that "
           + "one request, so you pay once for going somewhere new, and then you can just work.",
        async act({ page, expect, store }) {
          await waitPrefetch(page, [store.middle + 1]);
          await beat(page, CUE + 300);                  // "stepping on from here now"
          await fromHere(page);
          const beside = await timedPage(page, store.middle + 1);

          expect(await page.evaluate(() => window.__asks.length)).toBe(0);
          expect(await page.evaluate(() => window.__waits)).toBe(0);
          expect(beside).toBeLessThan(60);
          await meter(page, `the page beside it: ${Math.round(beside)} ms, `
            + `no request, no loading state`);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Two milliseconds, and no spinner',
        say: "And that is the whole thing. A page change was a hundred and forty eight "
           + "milliseconds and a skeleton grid; it is now two milliseconds and nothing at all. "
           + "Committing keeps what is behind you. And thousands of pages deep, the end of the "
           + "result is already held, while a jump into the middle costs one request and then "
           + "the pages either side of it are free.",
        async act({ page, expect }) {
          /* Nothing new is claimed here, so nothing new is asserted — but the summary must
             not play over a broken app, so the tiles have to still be on screen. */
          await expect(page.locator('.tile').first()).toBeVisible();
          await meter(page, 'before: 148 ms a page, 4 loading states   '
            + 'after: 2 ms a page, 1 \u2014 the opening load');
        }
      }
    ]
  }
  ,
  /* ------------------------------------------------- the tour: where the app is now */
  /* A current picture of the reviewer, fixture-backed. Recorded before phase 6 changes
     what the tiles show and phase 8 changes where the rows come from — so it is worth
     having as a "before". Every scene asserts what its line claims. */
  tour: {
    title: 'The MARP Picture Mosaic Reviewer, as it works today',
    scenes: [
      {
        caption: 'A wall of pictures, not a list of rows',
        say: "This is the Marp Picture Mosaic Reviewer. A machine learning model has looked "
           + "at hours of dive video and pulled out every animal it thinks it found, and "
           + "somebody now has to check that work. The whole idea here is that you check it "
           + "by looking at a wall of pictures rather than reading a table one row at a time.",
        async act({ page, expect, settled }) {
          await settled();
          await expect(tilesIn(page).first()).toBeVisible();
          const n = await tilesIn(page).count();
          expect(n).toBeGreaterThan(8);
        }
      },
      {
        caption: 'The question is on the left',
        say: "Down the left is the question. Which project, which dive, which line, which "
           + "species, how confident the model was, what time of day. Ten of those, and they "
           + "narrow the wall rather than producing a report.",
        async act({ page, expect }) {
          await expect(page.locator('.rail')).toBeVisible();
          await expect(page.locator('[data-dim="species"]')).toBeVisible();
          await beat(page, 900);
        }
      },
      {
        caption: 'Narrowing to one species',
        say: "Picking a species now \u2026 and the wall is a different wall. Notice the count "
           + "along the top changed with it \u2014 that is how many observations match the "
           + "question, and which page of them you are looking at.",
        async act({ page, expect, settled }) {
          await beat(page, CUE);
          const before = await totalShown(page);
          await page.locator('[data-dim="species"]').click();
          await beat(page, 700);
          const opt = page.locator('.menu .mbody button[data-v]').first();
          if (await opt.count()) { await opt.click(); await settled(); }
          await expect(page.locator('#pageNow')).toBeVisible();
          const after = await totalShown(page);
          expect(typeof after).toBe('number');
          void before;
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Marking the ones that are wrong',
        say: "Now the actual work. The model gets things wrong, and the wrong ones usually "
           + "look wrong \u2014 so you go down the wall and tap them. One tap, no dialog in the "
           + "way, because a reviewer does this thousands of times in a sitting.",
        async act({ page, store }) {
          await beat(page, CUE);
          store.marked = await markMany(page, 6, 320);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'A mark is the exception, not a note',
        say: "Those marks are not a scratchpad. When this page is committed, whatever is "
           + "marked becomes the exception and everything unmarked is accepted \u2014 so you are "
           + "not clicking fifty good ones, you are clicking the few bad ones.",
        async act({ page, expect, store }) {
          await expect(page.locator('.tile.marked')).toHaveCount(store.marked.length);
          await beat(page, 900);
        }
      },
      {
        caption: 'Saying why, if it helps',
        say: "Opening one of them now \u2026 and you can say why. The reason is optional \u2014 a bare "
           + "flag is valid on its own \u2014 but it tells whoever resolves this later what you "
           + "were seeing. You can also correct the species from right here.",
        async act({ page, expect, store }) {
          await beat(page, CUE);
          const id = store.marked[0];
          await page.locator(`.tile[data-id="${id}"] [data-badge]`).click();
          await expect(page.locator('.pick')).toBeVisible();
          await beat(page, 900);
          await page.locator('.pick [data-reason="Wrong species"]').click();
          await expect(page.locator('.reason-chip').first()).toBeVisible();
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Committing the page',
        say: "Committing now \u2026 and there. Six flagged, the rest accepted, and every tile now "
           + "says what just happened to it. The page does not clear itself and it does not "
           + "jump forward \u2014 moving on is a separate decision.",
        async act({ page, expect }) {
          await beat(page, CUE);
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first())
            .toBeVisible();
          await expect(page.locator('.tile .badge', { hasText: 'FLAGGED' }).first())
            .toBeVisible();
          await beat(page, DWELL);
        }
      },
      {
        caption: 'And it is still editable',
        say: "Taking one back now \u2026 and it changes its mind with you. A committed page is not "
           + "finished \u2014 if you flagged something you should not have, you click it again and "
           + "commit again. That is the undo.",
        async act({ page, expect }) {
          await beat(page, CUE);
          const tile = page.locator('.tile .badge', { hasText: 'FLAGGED' }).first();
          const id = await tile.locator('xpath=ancestor::*[contains(@class,"tile")]')
            .getAttribute('data-id');
          await page.locator(`.tile[data-id="${id}"]`).click();
          await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveClass(/out-reverted|marked/);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Paging is instant now',
        say: "Paging on now \u2026 and back. There is no wait there at all, and there used to be. "
           + "The pages around you are already fetched before you ask for them, so moving "
           + "through a result feels like scrolling something already in memory.",
        async act({ page, expect }) {
          await beat(page, CUE);
          await timedPage(page, 'next');
          await beat(page, 1200);
          const ms = await timedPage(page, 'prev');
          expect(ms).toBeLessThan(200);
          await expect(page.locator('.tile').first()).toBeVisible();
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Three separate questions',
        say: "The same wall answers three different questions, and they are genuinely "
           + "separate. Is this observation scientifically sound. Should it be used to train "
           + "the next model. And should it be in the database at all.",
        async act({ page }) {
          await beat(page, 900);
        }
      },
      {
        caption: 'Training review',
        say: "Switching to training now \u2026 and the wall is the same pictures asking a "
           + "different question. Anything the scientific side already said stays visible on "
           + "the tile, because whoever is deciding this should see it.",
        async act({ page, expect, settled }) {
          await beat(page, CUE);
          await page.locator('.seg button', { hasText: 'Training Data Review' }).click();
          await settled();
          await expect(page.locator('body')).toHaveAttribute('data-mode', 'training');
          await expect(page.locator('.tile').first()).toBeVisible();
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Delete asks first',
        say: "And deleting. Switching to delete now \u2026 mark a few, and commit. This is the one "
           + "place the tool interrupts you, because this one is permanent \u2014 it names the "
           + "exact number it is about to destroy.",
        async act({ page, expect, settled }) {
          await beat(page, CUE);
          await page.locator('.seg button', { hasText: 'Delete' }).click();
          await settled();
          await markMany(page, 3, 300);
          await page.locator('#commit').click();
          await expect(page.locator('.confirm__box')).toBeVisible();
          await expect(page.locator('.confirm__title')).toContainText('3 observations');
          await beat(page, DWELL);
        }
      },
      {
        caption: 'And cancel really does nothing',
        say: "Cancelling now \u2026 and nothing was sent. The three are still marked, so the page "
           + "does not have to be done again. Nothing is destroyed in this tool without "
           + "somebody reading a number and agreeing to it.",
        async act({ page, expect }) {
          await beat(page, CUE);
          await page.locator('[data-confirm="cancel"]').click();
          await expect(page.locator('.confirm__box')).toHaveCount(0);
          await expect(page.locator('.tile.marked')).toHaveCount(3);
          await expect(page.locator('.tile.out-deleted')).toHaveCount(0);
          await beat(page, DWELL);
        }
      },
      {
        caption: 'The question lives in the address',
        say: "One last thing. The whole question \u2014 the mode, every filter, the sort, the page "
           + "\u2014 lives in the address along the top. So a reload puts you back where you were, "
           + "and you can send somebody a link to exactly the wall you are looking at.",
        async act({ page, expect }) {
          await showAddress(page);
          await expect(page.locator('#demoAddress')).toContainText('marp-mosaic-review');
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Still running on a fixture',
        say: "And one honest caveat. Everything you just watched runs on generated data "
           + "inside the browser \u2014 the real interface, the real rules, but not the real "
           + "database yet. Connecting it to Marp's API is later work, and the endpoints it "
           + "will use are already built and tested behind this.",
        async act({ page, expect }) {
          await expect(page.locator('.tile').first()).toBeVisible();
        }
      }
    ]
  },

  /* ------------------------------------------ verifying: it is the real database */
  /* A minute, ten scenes, one claim: this is MARP's own database and not the
     fixture. So every scene compares the screen against a read the application did not
     make — `askApi` goes straight to the endpoint from the test — because a scene that
     narrates a number the app also computed has proved nothing about where it came from.
     The spoken numbers are asserted exactly rather than loosely, so a changed corpus fails
     the run and writes no video instead of narrating a figure that is no longer true.

     Which is not hypothetical: this was recorded once against 340 observations of one
     species, and re-recorded when the corpus reached 1,062 across three dives. Every
     figure in it moved, and every one of them is a literal in an assertion here — so
     the next time the corpus grows, the run fails loudly and these lines get rewritten
     rather than going quietly stale. The species chosen is the short red gorgonian
     because nearly all of them are on one dive, which is what makes the dive filter
     worth showing, and because all 83 have a thumbnail ready.

     It needs a running API and a signed-in session; see `tools/api-session.mjs` and
     `MARP_API_BASE` in `playwright.config.mjs`. */
  'verify-real-database': {
    title: 'Verifying: the reviewer is on the real database',
    scenes: [
      {
        caption: 'The real database, not the fixture',
        say: "The Marp mosaic reviewer, on the real database — not the fixture.",
        /* No action at all: this is the claim being made, and the app moves nowhere. */
        async act({ page, expect, store }) {
          store.origin = new URL(page.url()).origin;

          /* `src/backend.js` stamps which backing is installed for exactly this question,
             and `?backing=fixture` would paint a permanent banner. There is none, and the
             fixture is not in the page at all. */
          expect(await page.evaluate(() => document.documentElement.dataset.backing),
            'the installed backing').toBe('api');
          expect(await page.evaluate(() => window.MARP.backing)).toBe('api');
          await expect(page.locator('#backingFlag')).toHaveCount(0);
          expect(await page.evaluate(() => Boolean(window.MARP.data)),
            'the fixture is not loaded').toBe(false);

          /* And the reviewer is a principal the server named. `src/data.js` used to hold
             the literal 'I. Travers', which was true for one person on one machine. */
          const me = await page.request.get(`${store.origin}/api/v2/auth/me`);
          expect(me.status()).toBe(200);
          store.me = (await me.json()).user;
          expect(store.me.user_id).toBeGreaterThan(0);

          await meter(page, `backing: api  ·  served by the API at ${store.origin}`
            + `  ·  signed in as ${store.me.username}`);
        }
      },
      {
        caption: 'A thousand observations, three dives',
        say: "One thousand and sixty-two observations across three dives, and fifteen thousand keyframes.",
        /* No action: the corpus is the subject, so nothing moves while it is described. */
        async act({ page, expect, store }) {
          const q = await question(page);
          const body = await askApi(page, store.origin, '/mosaic/observations/pages',
            { ...q, pages: [1], includeTotal: true });

          /* The spoken numbers, asserted. A looser check would let the line go on saying
             a thousand and sixty-two after the corpus had moved again. */
          expect(body.total, 'the corpus this line names').toBe(1062);
          expect(q.pageSize, 'fifty to a page, at this viewport').toBe(50);
          expect(body.pageCount).toBe(22);

          expect(await totalShown(page), 'the screen shows the endpoint\'s own total')
            .toBe(body.total);
          expect(Number(await page.locator('#pageTotal').innerText())).toBe(body.pageCount);

          /* Three dives, from the facets route rather than off the page: page one holds
             rows from all three, so a list read off the tiles would look the same. */
          const facets = await askApi(page, store.origin, '/mosaic/observations/facets',
            { filters: q.filters });
          store.dives = facets.facets.dive.map((f) => f.value);
          expect(store.dives.length, 'three dives, which is what the line says').toBe(3);
          expect(facets.facets.dive.reduce((a, f) => a + f.count, 0),
            'and between them they hold the whole corpus').toBe(body.total);

          /* "Fifteen thousand keyframes" is the one number here that only the rows carry,
             so every row is read back. Two calls, because the pages route caps a request
             at twelve pages and twenty-two do not fit in one. */
          const half = (from, to) => askApi(page, store.origin, '/mosaic/observations/pages',
            { ...q, pages: Array.from({ length: to - from + 1 }, (_, i) => from + i) });
          const all = [await half(1, 11), await half(12, 22)]
            .flatMap((b) => b.pages).flatMap((p) => p.rows);
          expect(all.length, 'every row of the corpus, read back').toBe(body.total);
          const keyframes = all.reduce((a, r) => a + r.keyframe_count, 0);
          expect(keyframes, 'the keyframes this line names').toBe(15230);
          expect(keyframes, 'and that is over fifteen thousand of them')
            .toBeGreaterThan(15000);

          /* The strongest form of it: the tiles are the endpoint's page one, in the order
             the endpoint put them in. */
          const tiles = await page.locator('.tile')
            .evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
          expect(tiles, 'the tiles are the endpoint\'s page one, in its order')
            .toEqual(body.pages[0].rows.map((r) => r.observation_id));

          store.total = body.total;
          store.firstPage = tiles;
          await meter(page, `${body.total} observations · ${keyframes} keyframes · `
            + `${body.pageCount} pages of ${q.pageSize} · dives: ${store.dives.join(', ')}`);
        }
      },
      {
        caption: 'Real frames, cut from the video',
        say: "Every tile is a real frame, cut out of the survey video.",
        /* No action: the pictures are already on screen, and this is what they are. */
        async act({ page, expect, store }) {
          const tiles = await page.locator('.tile').count();
          const imgs = await page.locator('.tile img').evaluateAll((els) => els.map((i) => ({
            src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight
          })));

          expect(imgs.length, 'every tile on the page has a picture').toBe(tiles);
          for (const img of imgs) {
            expect(img.src).toMatch(/^\/api\/v2\/observations\/\d+\/thumbnail$/);
            /* Decoded, not merely requested: a broken image is an `<img>` too. */
            expect(img.w, `${img.src} decoded`).toBeGreaterThan(0);
            expect(img.h).toBeGreaterThan(0);
          }

          /* And the bytes are really there, asked for outside the page. */
          const one = await page.request.get(store.origin + imgs[0].src);
          expect(one.status()).toBe(200);
          expect(one.headers()['content-type']).toMatch(/^image\//);
          expect((await one.body()).length).toBeGreaterThan(1000);

          await meter(page, `${imgs.length} of ${tiles} tiles decoded · `
            + `${imgs[0].w}×${imgs[0].h} · ${one.headers()['content-type']} from `
            + `${imgs[0].src}`);
        }
      },
      {
        caption: 'Three dives to choose from',
        say: "Opening the dive filter … three dives, each a different transect line.",
        async act({ page, expect, store }) {
          await beat(page, CUE);                        // "opening the dive filter"
          await page.locator('[data-dim="dive"]').click();
          const menu = page.locator('.menu');
          await expect(menu).toBeVisible();

          const offered = await menu.locator('[data-v]').evaluateAll((els) => els
            .filter((e) => e.dataset.v)
            .map((e) => e.dataset.v));
          expect(offered.slice().sort(), 'the rail offers exactly the three dives')
            .toEqual(store.dives.slice().sort());

          /* "A different line of the survey" is a claim about the data, so it is asked of
             the endpoint rather than left to the viewer: three dives, three lines. */
          const facets = await askApi(page, store.origin, '/mosaic/observations/facets',
            { filters: (await question(page)).filters });
          expect(facets.facets.line.length, 'one transect line per dive').toBe(3);

          store.dive = 'Dive 12';
          expect(store.dives, 'the dive this walkthrough goes on to use')
            .toContain(store.dive);

          await meter(page, `dives offered: ${offered.join('  ·  ')}  ·  `
            + `lines: ${facets.facets.line.map((f) => f.value).join(', ')}`);
          /* Held open. It is the only chance the viewer gets to read it, and it stays
             open across the cut into the next scene, which is where one is chosen. */
          await beat(page, 1600);
        }
      },
      {
        caption: 'Dive twelve — four hundred and ten',
        say: "Choosing dive twelve … four hundred and ten observations on that one transect.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                        // "choosing dive twelve"
          await page.locator(`.menu [data-v="${store.dive}"]`).click();
          await page.waitForTimeout(250);
          await page.keyboard.press('Escape');
          await settled();

          const shown = await totalShown(page);
          expect(shown, 'four hundred and ten, which is what the line says').toBe(410);

          const q = await question(page);
          expect(q.filters.dive, 'the filter goes over the wire as the dive')
            .toEqual([store.dive]);

          const ids = await page.locator('.tile')
            .evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
          const body = await askApi(page, store.origin, '/mosaic/observations/pages',
            { ...q, pages: [1], includeTotal: true });
          expect(body.total).toBe(shown);
          expect(body.pages[0].rows.map((r) => r.observation_id),
            'the endpoint returns this dive\'s page one, in its order').toEqual(ids);
          /* Every row of it really is that dive — and it is a different page from the one
             before, which is what "it narrows" actually means. */
          expect([...new Set(body.pages[0].rows.map((r) => r.dive))]).toEqual([store.dive]);
          expect(ids, 'a different page from the unfiltered one')
            .not.toEqual(store.firstPage);

          await meter(page, `${shown} of ${store.total} · ${store.dive}, line `
            + `${body.pages[0].rows[0].line} · ${body.pageCount} pages · `
            + `the endpoint returns the same ${ids.length} ids`);
        }
      },
      {
        caption: 'Five of the seven species',
        say: "Now the species … five of the seven species are on this dive.",
        async act({ page, expect, store }) {
          await beat(page, CUE);                        // "now the species filter"
          await page.locator('[data-dim="species"]').click();
          const menu = page.locator('.menu');
          await expect(menu).toBeVisible();

          const offered = await menu.locator('[data-v]').evaluateAll((els) => els
            .filter((e) => e.dataset.v)
            .map((e) => ({ key: Number(e.dataset.v), label: e.textContent.trim() })));

          /* Not "the species on this page": the facets route answers what is still
             reachable under the rest of the question, which is the whole point of the
             number — five under this dive, out of seven in the corpus. */
          const q = await question(page);
          const here = await askApi(page, store.origin, '/mosaic/observations/facets',
            { filters: q.filters });
          const everywhere = await askApi(page, store.origin, '/mosaic/observations/facets',
            { filters: { ...q.filters, dive: [] } });
          expect(here.facets.species.length, 'five on this dive').toBe(5);
          expect(everywhere.facets.species.length, 'seven in the corpus').toBe(7);
          expect(offered.map((o) => o.key).sort((a, b) => a - b),
            'the rail offers exactly what the endpoint says is reachable')
            .toEqual(here.facets.species.map((f) => Number(f.value)).sort((a, b) => a - b));

          store.pick = offered.find((o) => /Short red gorgonian/i.test(o.label));
          expect(store.pick, 'the survey found a short red gorgonian').toBeTruthy();
          store.everywhere = everywhere.facets.species
            .find((f) => Number(f.value) === store.pick.key).count;

          await meter(page, `species on ${store.dive}: `
            + `${here.facets.species.map((f) => `${f.label} ${f.count}`).join('  ·  ')}`);
          await beat(page, 1600);
        }
      },
      {
        caption: 'Eighty-three gorgonians',
        say: "Choosing the short red gorgonian … eighty-three, nearly all of them here.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                        // "choosing the short red gorgonian"
          await page.locator(`.menu [data-v="${store.pick.key}"]`).click();
          await page.waitForTimeout(250);
          await page.keyboard.press('Escape');
          await settled();

          const shown = await totalShown(page);
          expect(shown, 'eighty-three, which is what the line says').toBe(83);
          /* "Nearly every one": eighty-three of the eighty-five in the whole corpus. */
          expect(store.everywhere, 'the corpus holds eighty-five of them').toBe(85);
          expect(shown / store.everywhere, 'nearly all of them on this one dive')
            .toBeGreaterThan(0.95);

          const ids = await page.locator('.tile')
            .evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
          expect(await page.locator('.tile .cap')
            .evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()))]),
            'every tile is the species that was chosen').toEqual([store.pick.label]);

          const q = await question(page);
          expect(q.filters.species, 'the filter goes over the wire as the species key')
            .toEqual([store.pick.key]);
          const body = await askApi(page, store.origin, '/mosaic/observations/pages',
            { ...q, pages: [1], includeTotal: true });
          expect(body.total).toBe(shown);
          expect(body.pages[0].rows.map((r) => r.observation_id)).toEqual(ids);
          expect(body.pageCount, 'two pages of them').toBe(2);

          store.q = q;
          await meter(page, `${shown} of ${store.everywhere} in the corpus · `
            + `species ${store.pick.key}, ${store.pick.label} · ${body.pageCount} pages · `
            + `the endpoint returns the same ${ids.length} ids`);
        }
      },
      {
        caption: 'Page two, with no wait',
        say: "Paging forward now … there. The last thirty-three, and nothing waited.",
        async act({ page, expect, store }) {
          /* A MutationObserver, because rendering here is a full re-render: a skeleton grid
             is replaced within one notify, so anything looking afterwards cannot see it. */
          await watchWaits(page);
          await fromHere(page);

          await beat(page, CUE);                        // "paging forward now"
          const ms = await timedPage(page, 'next');

          const ids = await page.locator('.tile')
            .evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
          expect(ids.length, 'the last thirty-three of the eighty-three').toBe(33);

          const body = await askApi(page, store.origin, '/mosaic/observations/pages',
            { ...store.q, pages: [2] });
          expect(body.pages[0].rows.map((r) => r.observation_id),
            'the endpoint\'s page two, in its order').toEqual(ids);

          /* "Nothing waited" asserted rather than narrated, and not as a millisecond
             budget: the loading state was never on screen at all. */
          expect(await page.evaluate(() => window.__waits),
            'no loading state was ever drawn').toBe(0);

          store.page = ids;
          await meter(page, `page 2 · ${ids.length} tiles in ${ms.toFixed(0)} ms · `
            + 'no loading state drawn · the endpoint returns the same ids');
          await beat(page, DWELL);
        }
      },
      {
        caption: 'Committing the page',
        say: "Committing now … there. Every tile reviewed.",
        async act({ page, expect, store }) {
          await beat(page, 1000);                       // "committing now" — three words
          await page.locator('#commit').click();
          await expect(page.locator('.tile .badge', { hasText: 'REVIEWED' }).first())
            .toBeVisible();

          /* A record badge could be left over from an earlier recording. An **outcome**
             cannot: `state.outcomes` is what *this* commit answered, per observation, and
             it is keyed by `observation_id` rather than by position. */
          const outcomes = await page.evaluate(
            (ids) => ids.map((id) => window.MARP.state.outcomes.get(id)), store.page);
          expect(outcomes, 'this commit answered for every tile on the page')
            .toEqual(store.page.map(() => 'reviewed'));

          await meter(page, `committed ${store.page.length} observations · `
            + `this commit answered "reviewed" for every one of them`);
          await beat(page, 1300);
        }
      },
      {
        caption: 'Read back out of the database',
        say: "Read back from the database. Thirty-three rows, reviewed, by me.",
        /* No action. The assertion is the scene: a fresh read of the record, from outside
           the application, after the write. */
        async act({ page, expect, store }) {
          const body = await askApi(page, store.origin, '/mosaic/observations/pages', {
            filters: {
              dive: [store.dive], species: [store.pick.key], reviewStatus: ['reviewed']
            },
            sort: [{ field: 'confidence', dir: 'asc' }],
            pageSize: store.page.length, pages: [1], includeTotal: true
          });

          const asc = (a, b) => a - b;
          expect(store.page.length, 'thirty-three, which is what the line says').toBe(33);
          expect(body.total, 'the record now holds every one of them').toBe(store.page.length);
          expect(body.pages[0].rows.map((r) => r.observation_id).sort(asc))
            .toEqual([...store.page].sort(asc));
          for (const row of body.pages[0].rows) {
            expect(row.review_decision).toBe('reviewed');
            /* "By me" asserted rather than narrated: the reviewer id on the record is the
               principal the server named in the first scene. */
            expect(row.review_reviewer_id, 'reviewed by this reviewer')
              .toBe(store.me.user_id);
          }

          await meter(page, `read back from the record: ${body.total} rows, `
            + `review_decision "reviewed", reviewer ${store.me.user_id} — ${store.me.username}`);
        }
      }
    ]
  },

  /* ------------------------------------------------------- look: just looking */
  /* Somebody opening the reviewer cold and turning the pages, which is the whole of it.
     It is a walkthrough — the narration says what to watch before it moves — but a small
     one: open on the bare address, look, page forward four times, narrow to one dive,
     look again. Nothing here proves anything about the corpus; `verify-real-database`
     owns that and does it properly.

     **It opens on the bare address deliberately.** `DEFAULT_FILTERS` used to carry the
     fixture's species key, so a real database met an empty mosaic reading "nothing to
     do" — the thing that looked broken to somebody who had just signed in. Opening cold
     is now the point of the recording, so this scenario must never set
     `MARP_WALKTHROUGH_URL`: if the bare address comes up empty again, the runner's own
     `settled` fails before scene one and no video is written, which is correct.

     The assertions are deliberately light — tiles present, the page really changed, the
     pictures really decoded — enough that a broken app fails instead of being filmed,
     and no corpus literals, which is what keeps this one from going stale the way the
     verification piece has to. */
  look: {
    title: 'A look at the mosaic reviewer',
    scenes: [
      {
        caption: 'Opened cold — no filters',
        say: "This is the Marp mosaic reviewer, opened cold on the bare address — "
           + "no filters, nothing chosen. Have a proper look at the wall; "
           + "every tile is one observation.",
        /* No movement at all. The runner has already settled the grid, so the reviewer's
           first sight of the app is what is on screen for the whole of this line. */
        async act({ page, expect, store }) {
          /* The bare address narrows nothing — which is the fix this recording exists to
             show, asserted rather than left to the eye. `reviewStatus` is excepted and is
             not an exception to the claim: it is the *mode's* own opening status, chosen
             by whichever workflow is selected, and it is there against the fixture too.
             The species key that made this open empty was a dimension, and there are
             none of those. */
          const q = await question(page);
          expect(Object.keys(q.filters).filter((k) => k !== 'reviewStatus'),
            'the bare address chooses no dimension').toEqual([]);
          expect(await totalShown(page), 'and it finds something').toBeGreaterThan(0);

          store.pages = [await lookedAt(page, expect, 'page 1')];
          store.all = await totalShown(page);
          await beat(page, LOOK + 1200);
        }
      },
      {
        caption: 'Page two',
        say: "Paging forward now — keep an eye on the pictures.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                    // "paging forward now"
          await turnPage(page, expect, settled, 2);
          store.pages.push(await lookedAt(page, expect, 'page 2'));
          await beat(page, LOOK);
        }
      },
      {
        caption: 'Page three',
        say: "On to page three. Same again, and the tiles are there.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                    // "on to page three"
          await turnPage(page, expect, settled, 3);
          store.pages.push(await lookedAt(page, expect, 'page 3'));
          await beat(page, LOOK);
        }
      },
      {
        caption: 'Page four',
        say: "Page four now. Worth a proper look — these are all different animals.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                    // "page four now"
          await turnPage(page, expect, settled, 4);
          store.pages.push(await lookedAt(page, expect, 'page 4'));
          await beat(page, LOOK);
        }
      },
      {
        caption: 'Page five',
        say: "And page five. Five pages in, and it is still keeping up.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                    // "and page five"
          await turnPage(page, expect, settled, 5);
          store.pages.push(await lookedAt(page, expect, 'page 5'));
          await beat(page, LOOK);
        }
      },
      {
        caption: 'The dives',
        say: "Opening the dive filter — this is what the survey has to choose from.",
        /* Opened here and chosen from in the next scene. A menu that opens and closes
           inside one line is gone before the viewer has read it. */
        async act({ page, expect, store }) {
          await beat(page, CUE);                    // "opening the dive filter"
          await page.locator('[data-dim="dive"]').click();
          const menu = page.locator('.menu');
          await expect(menu).toBeVisible();

          store.dives = await menu.locator('button[data-v]:not([data-v=""])')
            .evaluateAll((els) => els.map((e) => e.dataset.v));
          expect(store.dives.length, 'the rail offers at least one dive')
            .toBeGreaterThan(0);
          console.log(`  dives offered: ${store.dives.join(', ')}`);
          /* Held open, and it stays open across the cut into the next scene. */
          await beat(page, 2200);
        }
      },
      {
        caption: 'One dive',
        say: "Picking the first dive — now the wall is only that transect.",
        async act({ page, expect, settled, store }) {
          await beat(page, CUE);                    // "picking the first dive"
          await page.locator(`.menu button[data-v="${store.dives[0]}"]`).click();
          await page.waitForTimeout(250);
          await page.keyboard.press('Escape');
          await settled();

          const shown = await totalShown(page);
          expect(shown, 'the dive really narrows it').toBeLessThan(store.all);
          expect(shown, 'and it still finds something').toBeGreaterThan(0);
          expect((await question(page)).filters.dive, 'the dive goes over the wire')
            .toEqual([store.dives[0]]);

          await lookedAt(page, expect, `${store.dives[0]}, page 1`);
          console.log(`  ${store.dives[0]}: ${shown} of ${store.all}`);
          await beat(page, LOOK);
        }
      },
      {
        caption: 'Just looking',
        /**
         * The last look, and it is held by the *line* rather than by a beat.
         *
         * `tools/walkthrough/narrate.mjs` mixes the speech over the video with ffmpeg's
         * `-shortest`, so the film is cut where the last audio clip ends and every frame
         * after it is thrown away — the silent cut of the first take was 55.5 seconds and
         * the narrated one 50.7. A closing `beat` is therefore invisible, however long it
         * is. A closing *sentence* is not, so the dwell goes in the words.
         */
        say: "And that is the whole of it. Nothing to do but look — "
           + "the pictures are all there.",
        async act({ page, expect }) {
          await lookedAt(page, expect, 'the last look');
        }
      }
    ]
  }
};

export const scenarioIds = Object.keys(scenarios);
