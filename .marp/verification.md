# Verification — MarineAppliedResearch/MARP_API#180 Dashboard revision

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1, R2, R3 | `node tools/mock-shots.mjs dashboard` from `frontend/apps/marp-ml-dashboard` | render | The former general job list is absent; all functional destinations are represented; the short activity preview includes running, needs-attention and completed states; every header sorts. |
| R4 | The same Dashboard render check at its desktop, tablet, phone and phone-fold viewports | render | Overview, Worker pool and Current and recent jobs appear in order at full content width; no clipping or container overflow is present. |
| R5, R6 | `node tools/account-check.mjs` from `frontend/apps/marp-ml-dashboard` | browser | Dashboard navigation uses real links, and the signed-out account menu targets the front-page login instruction. |
| R6 | `npx playwright test tests/e2e/render.spec.mjs --project=desktop -g "an application Sign in"` from `frontend/apps/entry` | browser | Arrival from an application opens and focuses the existing landing-page dialog, then removes the one-time URL instruction. |
| R7 | `npm run lint` from `frontend/apps/marp-ml-dashboard`, plus `git diff --check` | parse/contract | JavaScript parses, the design vocabulary remains valid, and the changed documentation and source have no malformed diff whitespace. |
| R8 | The Dashboard render check at all four viewports | render | One dual-scale graph shows stacked training/inference compute, available compute, VRAM pressure and queued training/inference jobs; offers 24h/5h/1h with 5h default; highlights each selected series and restores the full graph on a second selection; keeps high-contrast marks and labels; sits right of worker status on wide desktop; and stacks below it without overflow or wasted side-column space on narrower screens. |
| R9 | `npx jest tests/thumbnail-storage.test.js --runInBand` | unit | A stamped testing database overrides a development thumbnail directory with its paired testing directory, while a different database retains its own configured storage. |
| R10, R11 | `node tools/mock-shots.mjs jobs` from `frontend/apps/marp-ml-dashboard` | render/browser | More filters is absent; Search, Type, Status and Window remain; all seven desktop headers sort; and the same sorts remain operable after the list becomes cards. |
| R12, R13 | The Jobs render check at desktop, tablet, phone and phone-fold widths | render | The status donut separates running inference/training, queued, completed and needs-attention jobs; the moving history graph offers 24h/5h/1h with 5h default and stays legible without overflow. |
| R14 | The Jobs render check at all four widths | browser/render | Each visible job expands inline with common identity plus state-specific active, queued, attention, completed or cancelled content and its own folded Diagnostics section; Expand all / Collapse all operates on the current page. |
| R15 | The Jobs render check at all four widths | browser/render | Begun inference jobs show class counts, confidence summaries and cumulative findings; begun training jobs show loss, precision, recall and mAP curves; queued jobs show a no-metrics-yet state; every graph legend can isolate and restore one series. |
| R16 | The Jobs render check at all four widths | browser/render | A completed eight-class training example separates loss and quality history; provides split-aware per-class metrics; exposes PR, confidence, confusion and balance views; identifies best and last checkpoints; scopes legend highlighting per graph; opens mutually exclusive Artifacts and Run configuration drawers with honest file availability; and contains dense content on phone. |
| R17 | The Jobs interaction check | browser | Headline cards, filters, table concepts, expanded-job metrics, graph legends, evaluation tabs, artifact entries and run-configuration rows expose concise hover help on their useful target area without replacing more specific existing titles. |
| R18 | `node tools/mock-shots.mjs inference` from `frontend/apps/marp-ml-dashboard`, plus the Inference interaction check | render/browser | Linked cards reach their named destinations; the inference-only donut and 24h/5h/1h throughput-versus-backlog graph are legible and truthful about fixture data; graph legends isolate either series; the submission flow remains primary after the overview; and all seven recent-job sorts and direct job links remain usable when the table becomes phone cards. |

## Requirements with no test

None.

## Edge cases

- A phone has no hover state, so summary destinations retain a visible arrow and a keyboard focus state.
- Worker pool and Current and recent jobs are measured against the content width rather than only against the viewport; this catches narrow panels that technically remain on screen.
- The one-time `login=1` instruction is removed after opening the dialog so refreshing the landing page does not reopen it indefinitely.
- Activity rows remain concise links; the complete list, filters, paging and controls stay on Jobs.
- Reduced-motion users see the utilization series without its repeating live-preview animation.
- Jobs summary cards reorder matching states first without hiding unrelated rows or claiming an active column sort.
- At 1050px, Jobs has already changed from crowded columns to cards and preserves all seven sorts in the compact strip.

## Regression coverage

- The Dashboard render check names the reported phone regression: Worker pool and Current and recent jobs must remain readable at full width.
- The entry-app check names the reported Sign In failure: an application arrival must open the real front-page dialog.
- The Dashboard check fails if the removed Active and recent jobs table returns.
- The Dashboard check fails if the GPU range controls, 5h default or plotted series disappear.
- The thumbnail-storage check fails if selecting the testing database can silently retain the development corpus directory.

## Known gaps

- The dashboard still uses fixture values; these checks do not claim an API response or live update exists.
- The summary values and job names are review content, not an API contract.
- This does not verify authentication credentials or write to any database.
- No other ML Dashboard screen is visually approved by this run.

## Manual steps

1. Through the running main API origin, open `/apps/marp-ml-dashboard/` on a desktop and confirm the six overview cards, Worker pool with GPU utilization history, and short Current and recent jobs preview form a concise overview without reproducing the complete Jobs page.
2. In the single GPU graph, confirm 5h is initially selected and the dual axes and compact key make compute used/free, stacked training/inference demand, VRAM pressure, queued training/inference jobs and the largest current load legible without separate cards or rankings. Switch among 24h, 5h and 1h and confirm the plotted history and time labels change. Confirm there is no moving marker.
3. Open the same URL on a phone. Confirm the overview comes first, Worker pool second and Current and recent jobs third, with both panels and the chart readable at full content width.
4. Sort the activity preview by Job, Type, Status, Progress and Updated; confirm each header reverses direction on a second click and the row order follows the selected column.
5. Activate each overview card and the Worker pool link, then return; confirm each opens the screen named by the summary.
6. While signed out, open the account menu and select Sign in. Confirm the public MARP front page loads with its sign-in dialog already open and the username field focused.
7. Open `/apps/marp-ml-dashboard/mockups/jobs.html` at desktop, 1050px, and phone widths. Confirm the donut and activity graph are legible; 5h is initially selected; and no More filters control is present.
8. Activate each headline card and confirm matching jobs move first while every other job remains visible. Sort all seven columns from the desktop headers, then repeat from the compact sort strip at 1050px or narrower.
9. Expand several individual jobs, including Diagnostics, then use Expand all and Collapse all. Confirm each detail stays paired with its job after sorting and the card layout is not crowded at narrow-tablet width.
10. Compare an inference, training and queued expansion. Confirm inference exposes per-class counts and confidence with cumulative findings, training exposes distinguishable loss/precision/recall/mAP curves, and queued work does not invent results. Select every legend label in both graphs; confirm only its line remains emphasized, then select it again and press Escape to restore all lines.
11. Expand the completed eight-class training example. Confirm box/class/DFL losses and validation quality are separate plots; the per-class table exposes support/P/R/F1/AP; Train, Validation and Test update the metrics; the four evaluation tabs expose per-class PR, threshold P/R/F1, raw/normalized confusion and class balance; best and last checkpoints remain visible; and dense tables/matrices are contained rather than shrinking labels or overflowing the phone page.

---

## Results

Not run. Awaiting human approval of this plan.
