# Bring the feasibility habitat model into MARP

Issue: MarineAppliedResearch/MARP_API#287 · Branch: `287-import-habitat-model` from `develop`

## Goal

Isaac, 2026-11-20: run a habitat line now and review it in the Mosaic, without a weekend of
training through MARP first. MARP registers habitat models only from its own training jobs,
so this adds a way to register one trained outside it: the feasibility experiment's.

## Settled (Isaac, 2026-11-20, in conversation)

- **Import the experiment's trained model** rather than train one through MARP or use only
  existing results. Machine-learning work otherwise waits; the focus is the Mosaic and the
  biologists' review tools.
- **Seed 2 of the habitat-crop runs**, the best single model: test macro F1 0.738. Its
  weights are a timm state dict, the same file MARP's habitat trainer writes, and load into
  the worker's habitat engine unchanged.
- **Mud's +0.2 raise applies**, the settled rule for every habitat model, though it was tuned
  on the five-seed average rather than on seed 2 alone.
- **Into the production copy** (`habitat-test`), where the real dives and 44,453 annotated
  habitat stretches are, for Isaac's trial of the review tools.

## Requirements

- **R1** -- `registerHabitatModel` registers a habitat model from a weights file and its
  published rules exactly as a MARP-trained one is: substrates from the Habitat list in the
  file's class order, `rulesForModel` rules, weights copied into the model store with their
  sha256, a `model_species` row per substrate. The same weights twice register once.
- **R2** -- `scripts/import-habitat-model.js` reads the experiment's `_results.json` (cut-offs,
  crop, input size), refuses anything but a habitat-crop model of the five substrates, and
  writes nothing without `--apply`.

## Open assumptions

None open.

---

# A habitat timeline on the Mosaic's video page

Issue: MarineAppliedResearch/MARP_API#287 · Branch: `287-trial-fixes`

## Goal

Isaac, 2026-11-20: *"in our video_processing_gui, when we have a habitat session, we show a
special timeline the user can click on to navigate and generally see what is happening for
the whole video, i'd like to be able to show this timeline here too, and perhaps also be able
to drag and drop the ends of this timeline to change how long a specific observation is, and
then a way to see on the timeline, if it's been reviewed or flagged"*.

## What exists

- **The GUI's strip** (`VIDEO_PROCESSING_GUI` `HabitatTimelineWindow.xaml.cs`, its #205): one
  thin bar per habitat record in its place along the video, fixed lanes top to bottom --
  Cobble; Boulder; Sand and Mud; Rock; Stop, Pull and Off Transect -- each substrate its own
  colour, a playhead, and a right-click menu naming the record with Go To Start / Go To End.
  No labels on the strip.
- **The video page already holds what a strip needs to draw**: `POST /api/mosaic/video/observations`
  answers every observation in the video that the Mosaic's query matches, each with
  `start_s`, `end_s`, `comname`, `session_id`, `review_decision` and `flag_reason`.
- **A habitat stretch's ends are stored in more than one place.** A machine stretch carries
  `mediaPosition`, `actualPosition`, `tc`, `frame`, `observed_at` for its start and `etc` for
  its end, *and* a start and an end keyframe. A GUI-annotated stretch carries the timecode
  columns only; its keyframes are worked out from them (`db/habitat-keyframes.js`). The box
  editor refuses to edit a habitat stretch for exactly this reason (A20, A22).

## Proposed requirements (not settled)

- **R3** -- On a habitat session's video, a strip under the player draws each stretch as a bar
  in its substrate's GUI lane and colour, with the playhead. Clicking the strip seeks there;
  clicking a bar selects that stretch, as clicking its box does.
- **R4** -- Each bar shows its scientific review: reviewed, flagged (with the reason on hover),
  or not yet reviewed, distinguishably at a glance.
- **R5** -- Dragging either end of a bar changes when the stretch starts or ends. Every column
  that states that time moves together, through `db/timecode.js`, for both kinds of stretch;
  the video follows the dragged end so the reviewer sees the frame it lands on. Only for a
  reviewer who may annotate.

## Open assumptions

- [x] **A1 · product/UI · blocking** — answered 2026-11-20: **the whole session**, whatever the Mosaic is filtered to, so the strip always shows every stretch and what has been reviewed. Needs a read the page does not make today: the video read follows the filter.
- [x] **A2 · product/UI · blocking** — answered 2026-11-20: **the opened observation's session only.**
- [x] **A3 · scientific/data-meaning · blocking** — answered 2026-11-20: **it stays reviewed**; fixing the times is part of reviewing it. A flag stays until it is taken back.
- [x] **A4 · behavioural · blocking** — answered 2026-11-20: **the two merge**, through the Mosaic's existing merge.
- [ ] **A5 · behavioural · non-blocking** — Moving a start leaves the Mosaic picture as it is
      (it can be replaced with *Use this picture*), rather than re-cutting it. Proposed default.
- [ ] **A6 · product/UI · non-blocking** — Lanes taller than the GUI's 5 px so an end can be
      grabbed with a mouse or a finger; the GUI's lanes and colours otherwise. Proposed default.

## Zoom, and smaller player controls (Isaac, 2026-11-20)

Asked for after using the strip: *"to make it easier to edit things on the timeline, we should
make it possible to zoom in on the timeline as well"*, and *"adapt the video player controls to
make them take up less of the screen"*.

- **R6** -- The strip zooms: the mouse wheel over it zooms in and out around the pointer (pinch
  on a touch screen), dragging an empty part pans, and a double-click on an empty part shows the
  whole video again. A click still goes there; dragging a bar's end still retimes it.
- **R7** -- Zoomed in, the strip follows the playhead: when the video plays past the part on
  screen, the strip moves along so the playhead stays in view.
- **R8** -- The player's controls take less of the screen. Settled: **in the player itself**
  (`marp-video-player`), not restyled on this page, so the GUI's WebView2 copy changes with it.
  Its contract -- `MarpVideoEngine`, the `postMessage` protocol, `player.html`'s parameters --
  does not change; only how big the controls are.
- **A7** (answered 2026-11-20, after using it) -- **the boxes and the timeline show the same
  stretches.** A1 had the strip show the whole session while the boxes followed the Mosaic's
  filter, whose default hides reviewed stretches -- so a reviewed stretch was on the strip with
  no box, and clicking it said so. Isaac: *"All the data we should show should be cohesive."*
  On a habitat video the page draws every stretch of the opened session, plus whatever else in
  the video the filter matches.

## Answered while using it (Isaac, 2026-11-20)

- **#352** -- Habitat labels sharing a box go in a **fixed order, packed**: Cobble, Boulder, Sand,
  Mud, Rock, Stop, Pull, Off Transect, then anything else; only the types showing at that moment,
  side by side, no gaps. They were laid side by side only when their boxes matched to the pixel,
  which two habitat boxes half a pixel apart did not.
- **#357** -- A stretch added on the video page appears on the timeline at once. **The GUI's
  lanes stay** (Sand and Mud share one). **Lanes 8 px**, down from 12.
- **#358** -- The habitat list over the picture is **the GUI's**: top left, one translucent panel
  per habitat at the current moment in its timeline colour, its name in white, no clicks.
- **#355** -- Dragging an end leaves the video where it is; near the playhead it lands on it.
- **#356** -- A press on the player's controls is the controls', whatever box is beneath.
- **#360 cut** (Isaac, 2026-11-20) -- select the cutter, then Ctrl+click the stretch to cut, on the
  timeline's bars or the boxes' labels; right-click, *Cut <second> with <first>*. The second no
  longer covers the first's time. **A cut in the middle splits it in two**: the original keeps the
  part before, a new stretch of the same substrate (new obs ID) takes the part after. **Both keep
  the original's review**, as a drag does (A3).
- **End time** (Isaac, 2026-11-20) -- setting, moving or removing a habitat stretch's end keyframe
  keeps `etc` (and the start columns) in step, by the same rule as a drag (`retimedColumns`). A
  stretch added on the video page had its end only as a keyframe and no `etc`.
