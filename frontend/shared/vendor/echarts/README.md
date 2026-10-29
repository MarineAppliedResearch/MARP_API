# Apache ECharts, as the ML Dashboard uses it

The chart library the ML Dashboard draws its charts with, chosen in
[docs/decisions/0001-echarts-draws-the-dashboard-charts.md](../../../../docs/decisions/0001-echarts-draws-the-dashboard-charts.md)
(MarineAppliedResearch/MARP_API#275). The dashboard pages load it from
`/shared/vendor/echarts/echarts.min.js`, served by MARP itself, so the dashboard works on a
machine with no internet access.

**Do not edit these files by hand.** `VERSION` records which release is installed; editing
the files makes that record false, and it is the only way to know what was served.

## Updating

```bash
npm pack echarts@<version>
tar -xzf echarts-<version>.tgz
```

Copy `package/dist/echarts.min.js`, `package/LICENSE` and `package/NOTICE` here, write the
version to `VERSION`, then run the dashboard's unit tests and open the Training screen's run
panel to check the charts draw and zoom.

## What is here

| File | Comes from |
| --- | --- |
| `echarts.min.js` | the npm package's `dist/`, the full build |
| `LICENSE`, `NOTICE` | the npm package. Apache-2.0 asks for both to travel with the code |
| `VERSION` | written here, the installed release |
