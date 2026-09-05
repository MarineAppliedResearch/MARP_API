# marp-api — Claude Code

See **[AGENTS.md](AGENTS.md)**. It is the single source for how to work in this
repository, whichever assistant is reading it. Shared platform conventions are synced into
the top of that file from the [umbrella repository](https://github.com/MarineAppliedResearch/MARP).

Application-level notes stay where they are: `frontend/apps/marp-mosaic-review/CLAUDE.md`
holds that app's architecture, its four test tiers, and how the narrated walkthroughs are
written. Read it before changing anything structural there.

## Claude-specific

`.claude/settings.json` holds this repository's permission rules; `.claude/hooks/` holds
the two gates that are enforced rather than requested:

- **spec-gate** refuses edits outside `.marp/` while a `blocking` assumption in
  `.marp/task.md` is unanswered. That is gate G1 in `AGENTS.md`, and it is what stops the
  design stage being skipped by momentum.
- **danger-gate** stops commands that reach production, force-push, delete a branch, or
  migrate a database that is not local and disposable.

To see what the gate sees:

```bash
node ../scripts/harness/spec-check.mjs .
```

Both hooks fail open if the umbrella is not checked out beside this repository — a
standalone clone is a supported way to work here, and a missing gate must not be a broken
repository.
