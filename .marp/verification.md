# Verification plan — MARP_API #166: application account menus

Issue: https://github.com/MarineAppliedResearch/MARP_API/issues/166

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1/R3/R6 | `frontend/apps/marp-ml-dashboard/tools/account-check.mjs`: signed-in ML menu at desktop, phone portrait, and phone landscape | rendered browser | ML shows identity, Dashboard, and Sign out only; no Mosaic self-link, other app link, or inert settings control appears. |
| R2/R7 | `account-check.mjs`: signed-out and signed-in ML states | rendered browser | A signed-out session shows Not signed in, Dashboard, and Sign in; a signed-in session shows the returned name and initials, hides Sign in, and offers Sign out. The menu opens, closes on an outside click, and closes on Escape. |
| R3 | `account-check.mjs`: dashboard home at all three viewports | rendered browser | The dashboard page visibly retains separate links to Mosaic and ML, while its account menu contains only identity, Dashboard, and Sign out. |
| R4 | `account-check.mjs`: ML menu geometry at all three viewports | rendered browser | All four menu corners remain inside the viewport and `elementFromPoint` resolves to the menu at each corner, so panels or controls cannot cover it. |
| R3/R5 | `frontend/apps/marp-mosaic-review/tests/api/account-menu.spec.mjs`: `Mosaic account menu works` at all three viewports | real-API rendered browser | The control is visible in the top 80 pixels, opens with real session identity, shows Dashboard and Sign out only, stays inside the viewport, and is the top painted element at all four corners. |
| R3 | `account-menu.spec.mjs`: `the Mosaic dashboard item reaches the main dashboard` | real-API rendered browser | Activating Dashboard navigates to `/apps/dashboard/index.html` under the same authenticated session. |
| R1/R3/R7 | `tests/dashboard-shell.test.js`: account markup and dashboard application links | file contract | All four legacy dashboard pages carry Dashboard, Sign in, and Sign out hooks, no account-menu link to Mosaic or ML, and the dashboard home retains both app links. |
| R2/R7/R9 | Existing entry browser cases `R18`, `R19`, and `R21` in `frontend/apps/entry/tests/e2e/render.spec.mjs` | rendered browser | The public entry keeps its visible Login invitation when signed out, derives signed-in identity, opens and dismisses the menu, posts Sign out, and handles a failed session probe. |
| R8 | The ML/dashboard and Mosaic browser cases above at the named three viewports | rendered browser | The reported content, visibility, clipping, stacking, and interaction defects each have an assertion at a tier that can observe them. |

## Requirements with no test

None. R6 does not invent tests for future app-specific settings; it is proved by asserting
that the current menus contain no inert settings rows.

## Edge cases

- **A signed-out open application.** ML is not session-gated, so it must offer Sign in rather
  than Sign out while still providing the Dashboard route.
- **Phone landscape selects a wider breakpoint.** The 915 by 412 browser case catches rules
  that key only on portrait width and menus that run below a short screen.
- **Mosaic clips its own descendants.** The geometry check samples actual painted points,
  rather than trusting a high `z-index` on a menu still clipped by its header.
- **ML has nested stacking contexts.** The same point sampling catches content painted over
  the dropdown even when the menu itself reports a high `z-index`.
- **The top bar moves while reading.** The ML browser opens the menu from the live top bar;
  the implementation keeps the bar shown while that menu remains open.
- **A menu initially renders before session introspection finishes.** Sign in and Sign out
  are both present in markup, but the shared controller makes exactly one visible for the
  resolved session state.

## Regression coverage

- PR #165 placed Dashboard, Mosaic, and ML links in every account menu. The new browser and
  file-contract assertions require the settled identity/Dashboard/session-action contents.
- Mosaic deliberately hid `.hdr .right` below 760px and clipped dropdown overflow in the
  header. The portrait test requires a visible top control and a fully painted menu.
- ML allowed its content row to paint over the top-bar dropdown. The three viewport geometry
  checks fail whenever any sampled menu corner belongs to a panel, table, or other overlay.
- A session action could previously offer only Sign out even when the session probe returned
  nobody. The signed-out ML case requires Sign in and excludes Sign out.

## Commands, in order

Run from the issue workspace repository root after this plan is approved:

1. `npm --prefix frontend/apps/marp-ml-dashboard run lint`
   - Parses the changed ML script and checks its stylesheet vocabulary.
2. `npm --prefix frontend/apps/marp-ml-dashboard run check:account`
   - Runs the focused rendered-browser checks for ML and the legacy dashboard at desktop,
     phone portrait, and phone landscape sizes.
3. `npm run test:app:mosaic-review:api -- account-menu.spec.mjs`
   - Provisions or reuses the disposable testing database, starts a private API on an
     operating-system-selected port, signs in, runs four focused real-API browser cases,
     and stops the API.
4. `npm run test:core -- --runTestsByPath tests/dashboard-shell.test.js`
   - Runs only the dashboard markup contract changed by this issue.
5. `npm run test:app:entry`
   - Runs the entry application's own group because both entry menu bodies and the shared
     session controller changed. Its existing account cases cover signed-out, signed-in,
     failed-probe, dismissal, and sign-out behavior.
6. Run `git diff --check`, `marp spec check`, and `marp harness check`.

The browser runners start and stop their own servers. No running agent server is adopted.

## Known gaps

- No future application settings are tested because none exist. The host-owned markup seam
  leaves room to add a real item with its own behavior and test later.
- Sign in is asserted as a link to the public entry surface. The existing entry browser tier
  separately proves that surface opens and submits the login dialog; this plan does not
  repeat the login endpoint test from every application.
- The legacy dashboard still carries its older standalone Logout buttons in addition to the
  account menu's Sign out action. Removing those controls is outside #166.
- No screenshot threshold is used. Bounding boxes and hit testing observe clipping and
  coverage without making unrelated application pixels part of the contract.
- No whole repository suite or narrated walkthrough is planned. The targeted application
  groups cover the files and behaviors changed here; the end-of-phase suite remains the
  human's call.
- No production or development corpus is read or written. The one real-API browser command
  uses the disposable testing database managed by the repository.

## Manual steps

No manual step is required for verification. After the automated evidence passes, the
workspace can be started for the human's visual review using the API address reported by
`marp agent list`.

---

## Results

Plan approved by the human on 2026-09-13. All commands below ran from the isolated issue
workspace against the current `origin/develop` commit reported by `git fetch`.
The human then reviewed the application running against the populated disposable corpus and
accepted the behavior and this evidence on 2026-09-13.

### Passing evidence

- ML parse and vocabulary lint: `ok 7 files parse` and
  `ok no raw colours, no states outside the vocabulary`.
- Focused ML/dashboard browser check: `8 screens, each drawing one account control`, then
  `ok the account menu is the shared one, and it names nobody it has not been told about`.
- Focused Mosaic real-API browser check: all four named cases passed in 4.7 seconds. This
  used the disposable test database with 2,092 observations and 2,079 thumbnail files;
  the runner reported `The API tier passed, against a real server on the testing database.`
- Dashboard shell contract: 27 passed, 0 failed, 0 skipped.
- Entry application browser group: 59 passed and one desktop-only case skipped by its own
  viewport condition. Its signed-out, failed-probe, signed-in, dismissal, and sign-out
  account cases passed at desktop, phone portrait, and phone landscape sizes.
- `git diff --check`: passed. The only output was Git's local LF-to-CRLF warning; there
  were no whitespace errors.
- Spec check: `ok 3 assumptions answered`, `ok 9 numbered requirements`, and
  `ok clear to implement`.
- Harness check: `ok both gates behave as documented`, no conflicting ports or exclusive
  resources, and `ok everything the harness can verify is consistent`.
- After the final fetch, `git rev-list --left-right --count HEAD...origin/develop` reported
  `0 0`, so the verification base is current.

### Failures observed and corrected

The first sandboxed ML lint invocation could not spawn its parser children and emitted an
empty error for all seven files. Direct `node --check` succeeded, and the same lint command
outside the process sandbox produced the passing evidence above.

The first Mosaic database attempt refused to run because this new workspace did not yet
have a corpus dump configured. The reusable local test corpus was then supplied to the
repository's test-database provisioner; no shared database was used or changed.

The first completed Mosaic browser run had one passing navigation case and three failed
viewport cases. Desktop and portrait exposed both session actions because the component's
`display: block` rule overrode the HTML `hidden` state:

```text
Expected ["Open the dashboard","Sign out"]
Received ["Open the dashboard","Sign in","Sign out"]
```

Phone landscape also reproduced the reported missing control:

```text
Error: expect(locator).toBeVisible() failed
Locator:  locator('[data-account-button]')
Expected: visible
Received: hidden
```

The shared stylesheet now preserves hidden session actions. Mosaic keeps #151's short-screen
chrome collapse but fixes its one account control in the visible top corner while collapsed.
The subsequent real-API run passed desktop, portrait, landscape, and Dashboard navigation.

A later sandboxed Mosaic rerun and the first harness run were unable to spawn child
processes. Their exact process error and harness symptom were:

```text
Error: spawn EPERM
FAIL blocked spec, editing source → unparseable: , expected deny
FAIL 23 gate assertion(s) failed
```

Both exact commands passed when rerun outside the Windows child-process restriction. These
were execution-environment failures; neither produced an application or harness assertion
failure in the unrestricted rerun.
