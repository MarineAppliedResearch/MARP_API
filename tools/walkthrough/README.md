# Narrated walkthroughs

Playwright drives a scenario, records video, and a spoken narration is mixed over it. A
person watches these to confirm behaviour, so they are a **review surface**, not a test
report — but they assert as they go, so a broken application fails and writes no video
rather than producing a convincing film of something that does not work.

Extracted from `frontend/apps/marp-mosaic-review`, where all of this was worked out. See
ADR-0007 in the umbrella. Three defects were found by a walkthrough that every automated
tier passed.

**This is development tooling.** Nothing in an application or the API depends on it, and it
must never be the reason a build fails. With no speech engine, no ffmpeg or no network, it
says why and leaves the silent video alone.

**Record them when asked, not as part of the loop.** The fast tiers run after every change;
videos are produced on request.

## Using it from an application

Two small files. Everything else is shared.

```js
// tests/walkthrough/run.spec.mjs
import { test, expect } from '@playwright/test';
import { walkthrough } from '<path>/tools/walkthrough/spec.mjs';
import { scenarios } from './scenarios.mjs';

walkthrough({
  test, expect, scenarios,
  async settled({ page }) { /* resolve when the page has stopped moving */ },
});
```

```js
// tools/record-demo.mjs
import { recordWalkthroughs } from '<path>/tools/walkthrough/record.mjs';
import { scenarios } from '../tests/walkthrough/scenarios.mjs';

await recordWalkthroughs({ scenarios, defaultId: 'review' });
```

`test` and `expect` are passed in rather than imported here. Playwright only registers a
test when it is the *same* module instance the runner loaded, and each application installs
its own — this directory sits above them all and would resolve a different one, or none.

`settled` is the only genuinely application-specific part. For the mosaic reviewer it is
"the grid has tiles and no skeletons"; for another application it will be something else,
and it cannot be guessed from shared code.

The application also needs a Playwright project named `walkthrough` with `video: 'on'` and
a long timeout — a narrated run takes minutes, not seconds.

## Writing a scenario

One entry in the application's own `scenarios.mjs`. The runner and the recorder need no
changes — that file is the whole interface.

```js
'verify-something': {
  title: 'Verifying: what this shows',
  scenes: [
    {
      caption: 'On screen, short',        // read at a glance
      say: "What the voice says.",        // conversational, spelled for a speech engine
      async act({ page, expect, settled, store }) { /* drive it, and assert */ }
    }
  ]
}
```

The three parts are deliberately separate, and each has its own rules:

- **`caption`** is read at a glance while the voice is talking. A few words.
- **`say`** is spoken. Write it as if narrating to somebody watching over your shoulder.
  **Spell for the engine, not for the page**: write `Marp`, because `MARP` is read out as
  four letters. Say what to look at *before* it happens — *"watch the badges"* — because the
  viewer cannot pause and ask.
- **`act`** drives the application and **must assert what the line is claiming.** This is
  the rule that matters most. One scene passed for a week while excluding nothing, because
  it only asserted that a panel had opened. **A scene that narrates a result and does not
  assert it can lie.**

A verification scenario should also **name the old behaviour** — *"before the fix, this
click appeared to do nothing"* — so the viewer can tell whether they are looking at the fix
or at the bug.

Open a panel at the *start* of the scene that talks about it and leave it open while the
line plays. An early cut did a whole species correction inside one act, so the window came
and went in two seconds under twelve seconds of narration about it.

## Timing

Each line is **spoken and measured before the run**, and the scene is then held for exactly
as long as its own narration. Without that, captions advance on a timer and the next line
talks over the last one. `<out>/<id>.holds.json` carries the measured durations into the
run; `<out>/<id>.timeline.json` records when each caption appeared so ffmpeg can place the
audio.

## Speech engines

| Engine | Quality | Notes |
| --- | --- | --- |
| `edge-tts` | good, neural | Free, no key. Sends the caption text to a Microsoft endpoint, so it needs internet. `pip install edge-tts` |
| Windows SAPI | robotic | Local, offline, no install. The fallback |

Each run prints which engine it chose and what that means — an earlier version fell back to
the robotic voice silently, because the availability check ran through a shell that mangled
`python -c "import edge_tts"`. Adding an engine, including a local neural one such as
Piper, is one entry in `ENGINES` in `narrate.mjs`.

## Still to do

Cross-repository use. `marp-video-player` and `VIDEO_PROCESSING_GUI` are separate
repositories and cannot import from here; serving them means publishing this as a package
or vendoring it, and vendoring is the duplication the harness exists to prevent. ADR-0007
records the intent; this directory is the first half of it.
