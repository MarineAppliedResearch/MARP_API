---
applyTo: "frontend/**"
---

# The browser applications

`app.js` serves any folder under `frontend/apps/` by name, with shared assets under
`frontend/shared/`. Adding an application is a folder, not a route. Gating one behind a
session is a `requirePermissionSession` line registered *before* the static mount, the way
`/apps/dashboard` already is.

**Each application owns its own test suite**, so it can be extracted into its own
repository later without untangling anything. `npm run test:apps` runs them all.

Use relative `/api/...` paths. Never a hard-coded hostname.

`frontend/apps/marp-mosaic-review/CLAUDE.md` holds that application's architecture notes —
the layering rule, the one-way data flow, and the invariants that will bite. Read it before
changing anything structural there.

**Choosing the test tier is the decision that matters here.** Every rendering defect in the
mosaic reviewer so far passed the store-level checks: a badge never drawn, a panel
positioned off-screen, a tick rendered at four times its size — the store was correct every
time. If a fix is about what appears, the test belongs in Playwright.
