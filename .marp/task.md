---
task: MarineAppliedResearch/MARP_API#166
repos: [MARP_API]
status: ready-for-pr
needs: []
---

## Goal

Restore each MARP application dropdown as that application's own menu while keeping the
shared MARP appearance, account interaction, and route back to the main dashboard. The ML
Dashboard and Picture Mosaic Reviewer menus must remain visible, usable, and above their
application content on desktop and phone layouts.

## Requirements

- **R1** — The legacy dashboard, Machine Learning Dashboard, and Picture Mosaic Reviewer
  each own their dropdown contents. Every menu has room for its host application to add
  settings or other local actions later without adding them to every other application.
- **R2** — The applications continue to share the account menu's visual treatment, identity
  rendering, open/close interaction, Escape and outside-click dismissal, and sign-out
  behavior.
- **R3** — Every application menu identifies the signed-in user and provides a working link
  to the main dashboard. The main dashboard itself provides separate visible links to each
  application rather than putting those application links in every account menu.
- **R4** — The Machine Learning Dashboard's open dropdown paints above its panels, tables,
  top bar, and other visible application content at desktop, phone portrait, and phone
  landscape viewports.
- **R5** — The Picture Mosaic Reviewer exposes its account-menu control at the top of the
  visible interface at desktop, phone portrait, and phone landscape viewports. The control
  opens the menu and the open menu is neither clipped nor covered.
- **R6** — Every displayed application-specific menu item performs its defined action; no
  inert placeholder item is presented as a working control.
- **R7** — Session-derived identity and signed-out behavior remain accurate. Signed-in menus
  offer Sign out. Signed-out applications offer a Sign in link to the login surface. No
  application introduces a literal person's name or initials.
- **R8** — Rendered browser checks assert each application's expected menu contents,
  interaction, bounding box, and stacking at desktop, phone portrait, and phone landscape
  sizes. They exercise the Mosaic control and at least one working menu item.
- **R9** — The public entry application's existing signed-in and signed-out account-menu
  behavior remains functional while the shared behavior and styles change.

## Open assumptions

- [x] **A1 · product/UI · blocking** — Answered 2026-09-13: omit the old nonfunctional
  *Preferences*, *Keyboard shortcuts*, *Tile density*, and *Worker service tokens* buttons.
  Each menu contains identity, Dashboard, and Sign in or Sign out, with a host-owned slot for
  real application settings or actions when those exist later.
- [x] **A2 · product/UI · blocking** — Answered 2026-09-13: the legacy dashboard uses the
  same identity, Dashboard, and Sign in or Sign out core. Its main page, outside the account
  menu, links to every application. Existing dashboard controls such as Refresh remain where
  they are.
- [x] **A3 · product/UI · non-blocking** — Answered by the same rule for all applications:
  the public entry menu keeps the core identity, Dashboard, and session action. It does not
  use the account menu as a second list of application links or invent entry-specific actions.

## Decisions

- **2026-09-13** — The issue's later, specific correction supersedes #151's decision to use
  identical menu contents. Shared means appearance, reusable interaction, session identity,
  Sign out, and the dashboard route; each host supplies its own entries.
- **2026-09-13** — The issue's phone requirement supersedes #151's decision to hide the
  Mosaic account control below 760px.
- **2026-09-13** — Browser tests are required because file-reading and DOM-only checks cannot
  observe clipping, overlap, stacking, or whether a control is actually visible and usable.
- **2026-09-13** — The core menu contents are identity, Dashboard, and the session action.
  A signed-out user gets Sign in; a signed-in user gets Sign out. Application-owned entries
  can be inserted later, but this issue does not show controls for features that do not exist.
- **2026-09-13** — Links to Mosaic and ML belong on the main dashboard, where they already
  exist as separate application buttons, rather than inside every account menu.

## Plan

1. Keep the shared account controller responsible for identity, open/close behavior, and
   sign-out while allowing each application to supply its own menu body.
2. Give the legacy dashboard, ML Dashboard, and Mosaic Reviewer their settled menu entries
   without changing unrelated page structure or application behavior.
3. Correct ML stacking and Mosaic desktop/phone placement using the smallest local layout
   changes that keep the menu inside the viewport and above application content.
4. Write the G3 verification plan with named browser checks for R1-R9 and present it for
   human review before running any test.

## Acceptance criteria

- Each reproduction area shows only its settled menu entries plus the shared account
  elements, and every presented item works.
- ML and Mosaic menus open above visible content without clipping at all three required
  viewport classes.
- Mosaic's account control is visible at the top of both phone layouts.
- The dashboard route, identity, dismissal, and Sign out work from each applicable menu.
- Named browser regressions fail for the reported content, stacking, clipping, visibility,
  and interaction defects and pass after the implementation.
- The public entry account states continue to work.

## Test plan

Filled in at G3 after the blocking product decisions are settled. No tests are run before
the human reviews `.marp/verification.md`.

## Status

- **Gate:** ready-for-pr
- **Notes:** G0-G4 are complete. The human reviewed the running application and accepted
  the recorded verification evidence on 2026-09-13. `marp agent list` reports this
  workspace's assigned API and disposable database ports.
