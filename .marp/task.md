# Content-addressed thumbnail filenames, and a testing-database login

Branch `thumbnail-content-hash`, off `origin/develop`.

Two pieces of work, one branch, one commit each. They are related only by where
they land: both are about a database that is not the development one being usable
on its own.

## Piece 1 -- name a thumbnail by its bytes

### The problem

`service/thumbnail-extraction.service.js` names every tile `${observationId}.jpg`.
`observation_id` is assigned as `max(observation_id) + 1` **per database** (#62), so
two independent databases hand out overlapping ranges by construction and both own
`582.jpg`. `routes/thumbnail.routes.js` serves `path.join(STORAGE_DIR, row.filename)`
after `fs.existsSync` alone -- no comparison of `byte_size`, `width` or `height`
against the row -- so a collision is not a broken tile. It is a 200, a plausible
ETag, and a confident picture of the wrong animal.

### Requirements

- **R1** A thumbnail's filename is a hash of its own bytes. Identical bytes give
  identical names, so a collision is impossible by construction rather than by
  discipline.
- **R2** No schema migration. `observation_thumbnails.filename` already stores the
  name and serving reads it off the row, so the column's meaning does not change.
  Thumbnails have never run on production, so there is no installed base and no
  compatibility shim.
- **R3** The comment at the old naming line is replaced. It claims derivability --
  row from file, file from row -- which is deliberately being given up, and it says
  why.
- **R4** A checked-in script renames what already exists and updates
  `observation_thumbnails.filename` to match. Every `status = 'ready'` row still
  serves its picture afterwards.
- **R5** That script is idempotent: a second run changes nothing.
- **R6** It reports what it would do before `--apply`, the way `load-corpus.js`
  does, and confirms afterwards that every ready row's file exists.
- **R7** It works against whatever `DB_*` and `THUMBNAIL_STORAGE_DIR` point at, so
  it runs on a disposable database first and the development one after.
- **R8** It leaves nothing orphaned, and says plainly when it finds a file no row
  names or a row whose file is missing. Reports them; does not "fix" them.

### What is on the development corpus today

Measured, read-only, 2026-09-12 -- not assumed from the brief, whose figures are a
day old:

- 2,091 rows: **2,076 `ready`, all with a file**, and **15 `failed`** whose
  `filename` is null and always was. Every one of the fifteen carries the same
  shape of `last_error`: *"ffmpeg returned 44 frames for 45 asked for, so frame
  40251 did not arrive."* They are failed extractions, not lost files, and
  `frontend/apps/marp-mosaic-review/CLAUDE.md` already names them -- the API tier's
  `breakThumbnails` affordance uses "rows whose picture genuinely failed, of which
  the corpus has fifteen". Nothing to fix.
- 2,079 files: the 2,076 named ones plus **three orphans** -- `1233.jpg`,
  `1239.jpg`, `2037.jpg` -- that no row names. Reported, left alone.
- **No two files are byte-identical.** 2,079 files, 2,079 distinct sha256 digests.

## Piece 2 -- a testing database always has a login

The human, 2026-09-12: *"Make sure the test databases and the dump databases always
have an admin account with all rights that I could sign in with a lowercase
i-s-a-a-c for both the username and the password."* `marp agent start` creates the
bootstrap administrator row and never sets its password, so there is an account and
no way to authenticate as it.

### Requirements

- **R9** `scripts/testing-database.js` ends every `up` with a working login,
  username `isaac`, password `isaac`, both lowercase.
- **R10** That account holds **every permission key in the catalogue**, read from
  the catalogue rather than typed, so a newly seeded key is included automatically.
  `admin` is not a bypass: `/apps/marp-mosaic-review` is gated on
  `observations:read` and `requirePermission` compares the key exactly.
- **R11** Idempotent: a re-run resets the password and re-grants rather than
  failing or duplicating. It runs on the **reused** path too, not only on
  provisioning -- "always" is the requirement, and a reused database that cannot be
  signed into is the state this exists to end.
- **R12** Refused unless the target is local and disposable, loudly.
  `tests/setup/local-database-guard.js` is the judgement being reused, not
  re-derived.
- **R13** The existing `mosaic-testing` reviewer login is untouched. Its narrow
  permission set is what lets the browser tier show the gate works.

## Open assumptions

- [x] **architectural**, non-blocking -- **sha256, full 64-character hex, flat
  directory, `.jpg`.** Not truncated: a truncated digest reintroduces by arithmetic
  exactly the collision this removes by construction. Not sharded into
  subdirectories: nothing in this repository shards, `load-corpus.js` copies the
  directory wholesale, and 440,000 files in one directory is the shape already
  chosen.
- [x] **behavioural**, non-blocking -- **identical bytes mean one file shared by
  two rows.** That is the point of content addressing rather than a side effect.
  Two consequences, both accepted: no row owns its file, so nothing may delete a
  file on the strength of one row; and a re-extraction that produces different
  bytes writes a new name and **leaves the old file behind**, where the old code
  overwrote in place. Nothing deletes it. Recommended because a delete needs
  reference counting to be safe, which is machinery for a problem nobody has --
  R8's orphan report is the sanctioned way to see them. Named in the report.
- [x] **security/permissions**, non-blocking, and the coordinator asked for a
  recommendation rather than a decision -- **`marp db load` does not learn about
  the `isaac` account.** A load can target the development database, and planting a
  known weak credential there is a different act from doing it to a throwaway the
  script itself created and can drop. Recommendation in the report; not built.
- [x] **environment**, non-blocking -- **the weak password is a literal in a
  script that only ever touches a local disposable database.** Said out loud in a
  comment, so the next person does not "fix" it into `.env` and thereby let it
  reach somewhere real.

Nothing here is blocking. The brief settles the rest.

## Verification

`.marp/verification.md`.
