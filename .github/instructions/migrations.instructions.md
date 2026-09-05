---
applyTo: "migrations/**,db/**,seeders/**"
---

# Migrations and the database

The production database is a scientific record. `mare_v1` holds years of annotation that is
queried and reported on by people and tools outside this workspace.

- **Every data migration wraps its work in `db/data-integrity.js`**, which counts rows and
  foreign-key references before and after and refuses to commit if anything was lost, and
  carries a `down` that restores what it changed.
- **Preserve everything currently possible.** A column that stops being populated, a value
  that becomes ambiguous, or a format an existing query no longer parses all count as loss,
  even when the application still works. Derived columns are part of the contract —
  something outside the application very likely reads them.
- **Ask what a field means rather than inferring it.** Whether two similar rows are one
  thing or two, and what an empty value means, are answerable by the person who recorded
  them and not reliably by inspection. A migration built on a guess about meaning is the
  expensive kind of wrong.
- **`migrations/` holds 19 files, not 28.** The nine already in `db/baseline/schema.sql`
  are retired to `db/retired-migrations/`, where Sequelize cannot see them. Moving one back
  breaks every fresh database.
- **The baseline is not a migration, deliberately.** A migration numbered before the others
  would run against production and be recorded in its ledger for no benefit. Keeping it a
  script means the migration history means one thing only: the upgrade path.
- Use `db/timecode.js` for the `varchar` .NET `TimeSpan` columns. Never re-implement the
  arithmetic; the truncation and negative-sign behaviour are both load-bearing and both
  were found by accident.
