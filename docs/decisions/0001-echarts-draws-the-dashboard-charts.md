# ADR-0001 — Apache ECharts draws the ML Dashboard's charts

- **Status:** accepted
- **Date:** 2026-10-28
- **Scope:** marp-api, `frontend/apps/ml-dashboard`
- **Refs:** MarineAppliedResearch/MARP_API#275, #104, #268

## Context

Every chart in the ML Dashboard was hand-written SVG in `screens.js`. They render, but none
can be zoomed, panned or hovered for an exact value, and each new chart was more drawing
code. #275 asked for a free, permissively licensed library that loads as a plain script with
no build step, is vendored and served by MARP rather than a CDN, draws a missing reading as a
gap, and can be styled with the dashboard's own tokens.

Three candidates were tried on the same real charts: training run 205's loss, ABYSS's seven
days of one-minute GPU readings with its 230 offline gaps on two y-axes, and a live replay
appending one reading at a time.

| | ECharts 6.1.0 | uPlot 1.6.32 | Chart.js 4.5.1 + zoom 2.2.0 |
| --- | --- | --- | --- |
| Licence | Apache-2.0 | MIT | MIT |
| Size | 1.1 MB | 51 KB | 244 KB with plugins |
| Zoom and pan | built in (`dataZoom`, box zoom, restore) | drag a range | plugin |
| Heatmap (confusion matrix) | built in | none | another plugin |
| A lone reading between two gaps | drawn | hidden unless configured | drawn |
| Append at about 3,000 points | 7 ms | not measurable (draws on the next frame) | 2.3 ms |

## Decision

**ECharts**, chosen by Isaac on 2026-10-28 after the trial.

It is the only candidate that covers every chart type in #275's scope (time-series lines and
areas, dual y-axes, bars, the confusion-matrix heatmap, threshold curves, sorted horizontal
bars) without a second plugin or leaving some charts hand-drawn. uPlot was faster and far
smaller, but the heatmap and the bar charts would have stayed hand-written, which is the
thing this exists to end.

How it is used:

- Vendored at `frontend/shared/vendor/echarts/`, with its licence, notice and `VERSION`. See
  the README there for updating it.
- Drawn with the **SVG renderer**. The dashboard's series are hundreds to a few thousand
  points, which SVG handles, and the unit tests can then read what was drawn in jsdom.
- One helper in `screens.js` (`chartSlot`, mounted by `mountCharts`) holds the MARP theme:
  colours and dashes come from each series' existing CSS key (`--key`, `--dash-on`,
  `--dash-off`), so the legend vocabulary and the colours do not change.
- A missing reading stays `null` and the line breaks (`connectNulls: false`).

## Consequences

- 1.1 MB on the first page load, cached after that, served from the same machine.
- Charts move across one screen at a time, starting with the training run's epoch charts. The
  hand-drawn helpers (`gappyPath` and the rest) go when nothing uses them.
- Unit tests about a chart assert the series it was given and what ECharts drew, not path
  strings written by hand.
