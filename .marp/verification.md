# Verification — content-addressed thumbnails, and a testing-database login

Branch `thumbnail-content-hash`. Everything below was run; the numbers are what
came back, not what was expected.

## What each requirement is proved by

| Req | Proved by | Tier |
| --- | --- | --- |
| R1 the name is a hash of the bytes | `tests/thumbnail-naming.test.js`, *what the extractor actually writes* | unit, through the real `cropToTile` |
| R2 no migration | nothing in `migrations/` changed; `filename` untouched | inspection |
| R3 the comment is replaced | `service/thumbnail-extraction.service.js`, at the write | inspection |
| R4 the rename works | applied to `marp_test`, then to `mare_v1`; every ready row verified | script + independent digest pass |
| R5 idempotent | second and third `--apply` on both databases: `0 rows to rename` | script |
| R6 reports before `--apply` | dry run against both databases | script |
| R7 follows `DB_*` and `THUMBNAIL_STORAGE_DIR` | run against `marp_test` with both overridden, then `mare_v1` with neither | script |
| R8 nothing orphaned, said plainly | 15 fileless rows and 3 orphan files reported on `mare_v1` | script |
| R9-R11 the login, always, idempotent | `npm run testing-db` twice; argon2 verify against the stored hash | script + database |
| R10 every permission | 27 of 27 held, read from the catalogue | database |
| R12 refused off a disposable database | `tests/testing-database-admin.test.js` | unit |
| R13 reviewer login untouched | `mosaic-testing` still signs the API tier in | API tier |

## Proved red before it was proved green

Each was made to fail first, one file at a time. Never a suite.

- **The service still named by observation.** `cropToTile` exported, naming
  unchanged: four failures, each `Received: "582.jpg"`.
- **The planner.** Its idempotency check and its missing-file guard removed by
  file copy: `10 passed, 3 failed` — the second run, the half-done run, and the
  missing file.
- **The guard.** `weakCredentialRefusal` made to return null: `3 passed, 5
  failed` — every refusal case.
- **The API tier.** Every ready row's `filename` prefixed in `marp_test` so the
  rows and the files disagreed: both checks failed with a real 404 from the
  route, *"has a thumbnail recorded but its file is missing from storage."*

## What was run

```
npm run test:mosaic                  246 passed, 7 suites
npm run test:core                    209 passed, 13 suites
npm run test:subsystems              ok, every suite in exactly one group
npm run test:app:mosaic-review:api    19 passed, including the two new ones
```

`test:mosaic` and `test:core` were run again after the development corpus was
renamed underneath them, and are the figures above.

## The corpus

Dump taken first: `.marp/local/corpus/20260912-163517`, 2,091 rows and 2,079
files. Then renamed: 2,076 files moved, 2,076 rows updated, and an independent
pass — not the script's own report — confirming for all 2,076 ready rows that
`filename === sha256(file) + '.jpg'`, that `byte_size` still agrees with the
file, and that all 2,076 names are distinct. Three files keep an old-style name
because no row names them.

## What is not covered

- **No browser tier ran against the development corpus**, deliberately: that tier
  writes, and the harness says to point it at a copy. Serving from renamed rows
  was proved at the API tier against `marp_test`, which was renamed by the same
  script in the same way, plus the digest pass above on `mare_v1` itself.
- **Nothing re-extracted a thumbnail through ffmpeg and Jellyfin.** `cropToTile`
  is exercised on a real frame, but a full extraction run needs the media server.
- **The orphan files and the 15 failed rows are reported, not resolved.** Neither
  is this branch's to decide about.
