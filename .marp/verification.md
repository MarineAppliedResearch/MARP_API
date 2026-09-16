# Verification — MarineAppliedResearch/MARP_API#192

This is the G3 plan. The focused red/green browser runs made while implementing the fix are
development feedback, not the approved G4 record. Do not run the verification below until
the human approves this plan.

## What each test proves

| Requirements | Evidence | Tier | What it proves |
| --- | --- | --- | --- |
| R1–R9 | `tests/e2e/login-modal.spec.mjs` in the `phone-short` project | real Chromium browser with phone/touch emulation | The normal phone keeps its visual panel; small and keyboard-reduced heights hide decoration, constrain and scroll the dialog, keep the page fixed, accept both fields, submit the request, expose the status, and make close reachable. |
| R1, R5–R7, R10 | Existing `tests/e2e/render.spec.mjs` in `desktop`, `phone`, and `phone-landscape` | real Chromium browser at three established viewports | Both public pages remain free of response/page errors and horizontal overflow, existing dialog open/close still works, and ordinary page layout remains intact. |
| R6 | The focused request interception plus existing login/open-close browser assertions | browser interaction | Form submission retains the existing JSON shape and error-status path; existing dialog opening and closing remain operational. |

## Requirements with no complete automated test

- Playwright reduces a Chromium viewport after focusing the password field; it cannot summon
  the real iOS Safari keyboard or reproduce every Visual Viewport quirk. A supervised iPhone
  check must confirm that a finger can scroll from the focused fields to Sign in and Close.
- The tests assert that the established visual panel remains present at ordinary phone size,
  but they are not pixel-diff tests. A person must confirm the short layout still looks
  deliberate and professional.

## Commands, in order

1. Run `git fetch origin`, then confirm this branch contains current `origin/develop`.
   - If `develop` moved, integrate it before collecting evidence.
2. Run `git diff --check` and the umbrella `marp spec check`.
   - Expected: no whitespace/conflict errors; all ten requirements and three assumptions are
     accepted at the verification gate.
3. From `frontend/apps/entry`, run
   `npx playwright test tests/e2e/login-modal.spec.mjs --project=phone-short`.
   - Expected: the named #192 regression passes once, including ordinary-phone appearance,
     small-phone presentation, keyboard-reduced scrolling, background containment, request
     submission, status output, and close.
4. From `frontend/apps/entry`, run `npm test`.
   - Expected: the established desktop, phone, and phone-landscape render projects plus the
     focused phone-short project pass with no skips. This is the entry app's complete owned
     browser group, not the repository suite.
5. Start this branch through the real MARP API on a free test port and open the landing page
   on the user's iPhone.
   - Open Login through the phone navigation; focus and type both fields so the real keyboard
     appears; swipe inside the dialog to Sign in; return to the top and close it.
   - Expected: the form, submit, status area, and close control remain reachable; the landing
     page underneath does not move; the compact form looks intentional. Leave the existing
     issue #183 server alone.
6. Run final `git diff --check` and record every real result below, including failed attempts
   that occurred before correction.

No API/database suite, production login, migration, Mosaic Viewer, or live service is in
scope. The login response in automation is intercepted so no credential or session is
created.

## Edge cases and regression coverage

- The dialog uses dynamic viewport height where supported and retains the small-viewport
  fallback for older engines.
- At ordinary phone height, the existing stacked diver panel remains visible.
- At narrow short height, the diver panel disappears, the form becomes the only content,
  and the dialog itself is the scroll owner.
- At keyboard-reduced height, dialog bounds remain inside the viewport while its scroll
  height exceeds its client height.
- A wheel/touch-like scroll over the dialog changes its scroll position without changing
  `window.scrollY`.
- Both a bottom control (Sign in/status) and a top control (Close) are reached in one open
  session.

## Known gaps

- The unrelated hero Login button is overlapped by the hero scroll cue at the deliberately
  narrow initial test size. Issue #192 changes the modal, not the hero; the regression opens
  Login through the real phone navigation path and does not alter that adjacent defect.
- This does not redesign login, change authentication, implement Forgot password, or alter
  successful-login routing.

---

## Results

<!-- Appended only during the approved G4 run. -->
