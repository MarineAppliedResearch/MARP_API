# Verification — inference processor account

Plan for `.marp/task-inference-processor-account.md`. Written before anything is run.

## Order, and why

1. **Migrate the development database** (`npx sequelize-cli db:migrate` from this branch).
   This is also the real-data check for R2: it prints how many sessions it moved, and the
   new test below assumes it has already run — otherwise its re-run of `up` would move real
   sessions, which the corpus guard would rightly fail as rows the test did not create.
2. The targeted API tests.
3. The GUI's unit and integration tiers against this branch's API.
4. Isaac in the GUI.

## What each test proves

| Req | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `tests/inference-processor.test.js` — exists as exactly one account, no login | database | the migration made one account and gave it no username |
| R2 | same file — takes the machine-made session; leaves the mixed, the empty and the person's | database | each case the backfill rule distinguishes, on rows the suite built |
| R2 | migration output on the development database | real data | how many real inference sessions moved; compared with the 76 sessions that have observations |
| R3 | `tests/gpu-observation-ingest.test.js` — *creates the session from project, dive, line and type* | database | a session the ingest creates belongs to the inference processor |
| R4 | `tests/inference-processor.test.js` — both list endpoints carry `models` | endpoint | names per session, `[]` when no model wrote in it |
| R4 | `tests/sessions-by-project.test.js` (unchanged, re-run) | endpoint | the By Dive list's existing fields are unchanged |
| R5 | GUI `ModelNamesReadsAJsonArray`, `ModelNamesIsBlankWhenThereAreNone` | unit | the column text, including the object[] trap the Video column fell into |
| R5 | GUI `ApiContractTests` session list check | integration | the real API sends `models` as a JSON array |
| R5, R6 | Isaac: processor MARP Inference → CAMPA project → sessions, Model column, Launch; and By Dive | by hand | the columns render and a session opens from the opening screen |

Commands:

```bash
npm test -- tests/inference-processor.test.js tests/sessions-by-project.test.js tests/gpu-observation-ingest.test.js
npm run test:subsystems
```

```powershell
.\run-tests.ps1 -Tier Unit
.\run-tests.ps1 -Tier Integration -SkipBuild     # MARP_API_URL at this branch's API
```

## Requirements with no automated test

- **R3 for `process-dive.js` and both seeders.** Not exercised: `process-dive.js` needs
  Jellyfin and submits real jobs; the seeders are run by hand. The change in each is one
  line naming the account; checked by reading.
- **R2's `down`.** Not run: on the development database it would hand every inference
  session back to no processor, and a test of it would touch rows it did not create.

## Known gaps

- The GUI's UI tier does not look at session lists at all, so R5 and R6 rest on the by-hand
  check.
