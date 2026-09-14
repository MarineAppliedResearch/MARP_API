# Verification — MARP_API #134: reviewer-requested replacement thumbnails

This is the G3 verification package. Run it only after the human approves the plan.

## What each test proves

| Requirement | Test | Tier | Proves |
| --- | --- | --- | --- |
| R1 | `model.test.mjs`; `render-states.spec.mjs` check `#134 R1` | unit + browser | Scientific reasons no longer include `No imagery`; the panel visibly offers the separate replacement action at desktop and phone widths. |
| R2 | `requirements-states.spec.mjs` check `#134 R1, R2, R9`; `mosaic-commit.test.js` rejection check | browser + API + database | Clicking replacement clears the pending mark/reason/note, and neither that gesture nor an attempted `No imagery` commit writes scientific review state. |
| R3 | `thumbnails.test.js` replacement-route block | HTTP + database | A ready or failed row can be queued through the single-observation endpoint; absent and structurally permanent observations are refused explicitly. |
| R4 | `thumbnails.test.js` queue-priority and FIFO checks | database | Reviewer work is claimed before older ordinary work, remains FIFO within its class, and a repeated click cannot release or duplicate an in-flight extraction. |
| R5 | `thumbnail-geometry.test.js` replacement-candidate block; `thumbnails.test.js` candidate-index plan check | unit | The representative is first, real keyframes follow by distance, bounded midpoint frames follow those, ties are deterministic, and frames are de-duplicated. |
| R6 | `thumbnail-geometry.test.js` cross-subset check | unit | Every candidate and interpolation endpoint comes from the selected first subset. |
| R7 | `thumbnails.test.js` candidate-index/exhaustion checks and repository retry checks | unit + database | One request advances one durable candidate, the last candidate is marked permanent on failure, and no gesture opens a sequence of attempts. |
| R8 | `thumbnails.test.js` requeue and failure-record checks | database | Attempts survive requeueing and the attempted frame/subset are stored structurally for failures. |
| R9 | `requirements-states.spec.mjs` check `#134 R1, R2, R9` | browser + API + database | The clicked tile immediately becomes PREPARING; page polling observes a ready result and redraws the image without a scientific flag. |
| R10 | Existing retry-route tests plus the new priority/candidate assertions | HTTP + database | Existing per-tile/page retry behavior remains bulk-compatible while using the new priority and rotation state. |
| R11 | `mosaic-commit.test.js` historical-read check | HTTP + database | A pre-existing `No imagery` log/projection row remains readable even though a new one is rejected. |
| R12 | The combined Mosaic unit, subsystem, and named real-browser commands below | unit + HTTP + database + browser | Every changed tier observes the behavior it owns rather than relying on a lower-level proxy. |
| R13 | Push the updated feature branch and inspect the resulting workflow runs | GitHub Actions | The push creates only the pull-request workflow run, while the workflow definition retains push triggers for `develop` and `master`. |

## Requirements with no test

None. Actual visual crop quality against live Jellyfin remains a manual observation, listed
separately below; the automated checks cover selection, queueing, persistence, API behavior,
polling, and rendering.

## Commands, in order

1. `git diff --check`
   - Expected: no whitespace errors or conflict markers in the working change.
2. `npm run docs:build`
   - Expected: OpenAPI lists the replacement endpoint and both tracked documentation
     surfaces regenerate successfully. The repository's known JSDoc tag warnings may be
     printed; the build script succeeds when the complete site is produced.
3. `npx sequelize-cli db:migrate:status` and `npm run testing-db -- status`
   - Expected: `20260913200000-prioritize-thumbnail-replacements.js` is up in development,
     and the disposable browser database reports ready for use.
4. `npm run test:app:mosaic-review:unit`
   - Expected: syntax, model, API-wire, row-shape, cache, URL, and scheduling checks pass.
5. `npm run test:mosaic`
   - Expected: the seven Mosaic suites pass against the local disposable development
     database and restore every row they create or change.
6. `npm run test:app:mosaic-review:api -- -g "#134"`
   - Expected: the named panel and complete replacement lifecycle checks pass against a
     real temporary API and the disposable testing database at both desktop and phone widths;
     the launcher stops its API afterwards.
7. `git diff --check` again after results are recorded.

The full repository suite and the complete Mosaic browser suite are not in this package.
The repository doctrine assigns the whole suite to the end of a phase; this task changes
the Mosaic subsystem and has named browser checks for its rendering behavior.

## Edge cases

- A second click while work is queued or claimed raises no duplicate attempt and does not
  move the request behind later reviewer work.
- A ready thumbnail advances past the frame already displayed; a failed attempted frame
  also advances, while a pre-plan infrastructure failure does not invent an attempted frame.
- A representative frame that is itself a keyframe or midpoint appears only once.
- Equal-distance candidates use the lower frame number, making selection restart-stable.
- Candidate construction ignores every subset after the first and never interpolates
  between tracks.
- The final candidate's failure becomes permanent; a request against an already-permanent
  structural failure remains refused.
- A transport failure or permanent refusal restores unsaved panel details because no
  replacement was accepted.
- Existing `No imagery` review history remains readable; only creation of a new value is
  prohibited.
- The replacement URL is stable, so the existing generation-backed ETag must change when
  the new image becomes ready.

## Regression coverage

- The old retry code reset `attempts` to zero; the repository test now requires attempts to
  survive and the candidate index to advance.
- The old planner always selected `chooseBox`, so every retry asked Jellyfin for the same
  frame; the candidate sequence and index checks prevent that regression.
- Failed attempts previously stored only prose, making the attempted frame unknowable; the
  failure-record check requires structural frame/subset fields.
- Ready thumbnails were previously refused by the only retry endpoint; the dedicated route
  test requires ready-row replacement without changing bulk retry semantics.
- `No imagery` was previously a committable scientific reason; unit, validator, and browser
  checks now hold the separation between review decisions and extraction requests.
- A repeated click could release a live claim if queue timestamps were blindly reset; the
  in-flight replacement check requires both claim and FIFO timestamp to remain intact.

## Known gaps

- Automated checks do not judge whether a newly extracted frame is a *better* view of the
  organism. That requires a person looking at real source imagery.
- The browser lifecycle check records extractor success on its own disposable row after the
  endpoint queues it. This deliberately tests polling and image replacement without relying
  on live Jellyfin availability; decoder/media integration remains covered by the existing
  media/manual tier.
- The finite midpoint policy samples one frame per adjacent keyframe span. It does not search
  every video frame, by design.
- Full-resolution frame inspection and zoom belong to #176; video-player integration remains
  later work and is not covered here.

## Manual steps

With the human present and the Mosaic pointed at a disposable database whose source video is
available through Jellyfin:

1. Open Scientific Data Review, flag a tile whose crop is unusable, open its details, and
   choose `Request replacement image`.
2. Confirm the panel closes, the temporary flag disappears, and the tile reads PREPARING.
3. Wait for the extractor. Confirm a different crop appears in the same tile without a page
   reload and that no `No imagery` decision was added.
4. Repeat once on the same observation and confirm another candidate is tried rather than the
   first crop repeating.

Do not run this manual step unattended: it uses the live Jellyfin service. It writes only the
disposable thumbnail record and files, never a production scientific review.

---

## Results

<!-- Appended by `marp verify run`. Real output, including failures, verbatim. -->

Run on 2026-09-13 PDT against branch `134-no-imagery-retry`.

### Preflight failure and remediation

The first `git diff --check` failed with exit 1 after the developer documentation was
regenerated on Windows. Its first reported error was:

```text
docs/developer/global.html:50: trailing whitespace.
```

The generated developer pages reproduce source formatting, including whitespace-only
lines, and Git's whitespace checker consequently treated regenerated page content as a
hand-written whitespace error. A repository `.gitattributes` rule now excludes only
`docs/developer/**` from whitespace lint. Hand-written sources and the generated OpenAPI
contract remain checked. The documentation was rebuilt and the approved sequence was
restarted from command 1.

### Approved run

1. `git diff --check` — **PASS** (exit 0). Git printed line-ending conversion warnings,
   but no whitespace errors or conflict markers.
2. `npm run docs:build` — **PASS** (exit 0, 15.2s). The generated contract discovered
   128 paths, including
   `/v2/observations/{observationId}/thumbnail/replacement`; the developer site completed
   and mirrored 9 assets. The known JSDoc type-expression errors and two `@type` warnings
   were printed, followed by `docs: jsdoc exited 1; the site above is complete, the errors
   are unparsed tags`, as anticipated by the plan.
3. `npx sequelize-cli db:migrate:status` — **PASS** (exit 0). The development database
   reported `up 20260913200000-prioritize-thumbnail-replacements.js`.
4. `npm run testing-db -- status` — **PASS** (exit 0). The disposable `marp_test`
   database reported `exists, ready` with 2,091 observations and 2,091 thumbnail rows.
5. `npm run test:app:mosaic-review:unit` — **PASS** (exit 0, 2.7s):

   ```text
   ℹ tests 279
   ℹ pass 279
   ℹ fail 0
   ℹ skipped 0
   ```

6. `npm run test:mosaic` — **PASS** (exit 0, 9.9s):

   ```text
   Test Suites : 7 passed, 0 failed, 7 total
   Tests       : 261 passed, 0 failed, 0 skipped, 261 total
   Result: ALL TESTS PASSED
   ```

   Full runner output was written to
   `tests/logs/test-run-2026-09-14T03-28-18-104Z.log`.
7. `npm run test:app:mosaic-review:api -- -g "#134"` — **PASS** (exit 0, 10.2s).
   Both named checks passed in the desktop and phone projects:

   ```text
   4 passed (8.2s)
   The API tier passed, against a real server on the testing database.
   ```

8. Final `git diff --check` — **PASS** (exit 0). Git printed line-ending conversion
   warnings, but no whitespace errors or conflict markers.

### CI trigger correction requested during PR review

After PR #179 exposed duplicate push-event and pull-request-event runs for the same feature
commit, the workflow push filter was narrowed from every branch to `develop` and `master`.
The pull-request trigger remains unchanged. Verification is the GitHub run inventory created
by pushing this correction: exactly one new workflow run must exist for the updated feature
commit, with event `pull_request`; no `push` run may exist for it.

**PASS.** For commit `984b3cd3ca2eba900990fb9830838a3532de76a6`, GitHub returned
exactly one workflow run: verify run 34803846855, event `pull_request`. No workflow run
with event `push` exists for that feature-branch commit.

### Manual observation not run

The live-Jellyfin crop-quality walkthrough remains for a session with the human present,
as required by the plan. This is a visual quality judgement, not an automated functional
gap; all queueing, persistence, API, polling, and rendered-state behavior in #134 passed
at its named automated tier.
