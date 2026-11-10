# Sample model output, step 3: each line as a timeline, every annotator's stretches above
# the model's, one band per substrate, so the output can be judged by eye beside a person's.
# The model's bars are as dark as it was sure. Reads sample/report.json and sample/lines.json.
#   python -I sample_sheet.py      -> sheets/sample-output/<line>.png
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
COLOR = {"Rock": "#5b6b82", "Mud": "#8a5a35", "Sand": "#d9a92b", "Cobble": "#2a9d8f", "Boulder": "#7b5cc4"}
# A tag as the first argument reads that run's report and names its pictures after it.
TAG = sys.argv[1] if len(sys.argv) > 1 else ""
report = json.load(open(os.path.join(HERE, "sample", f"report_{TAG}.json" if TAG else "report.json")))
lines = json.load(open(os.path.join(HERE, "sample", "lines.json")))
out_dir = os.path.join(HERE, "sheets", "sample-output")
os.makedirs(out_dir, exist_ok=True)

for ref, R in report["lines"].items():
    L = lines[ref]
    people = list(L["sessions"].items())
    t0 = min(x["a"] for _, S in people for x in S["spans"])
    rows_per = len(people) + 1
    fig, ax = plt.subplots(figsize=(18, 0.32 * rows_per * 5 + 1.6))
    ticks, labels = [], []
    for k, c in enumerate(CLASSES):
        base = (len(CLASSES) - 1 - k) * (rows_per + 1)
        for i, (sid, S) in enumerate(people):
            y = base + rows_per - i
            for x in S["spans"]:
                if x["name"] == c:
                    ax.barh(y, (x["b"] - x["a"]) / 60000, left=(x["a"] - t0) / 60000, height=0.8, color=COLOR[c])
            ticks.append(y)
            labels.append(f"{c}: person {i + 1}" if len(people) > 1 else f"{c}: annotator")
        y = base + rows_per - len(people)
        for x in R["model"]:
            if x["name"] == c:
                ax.barh(y, (x["b"] - x["a"]) / 60000, left=(x["a"] - t0) / 60000, height=0.8,
                        color=COLOR[c], alpha=0.25 + 0.75 * x["confidence"], edgecolor="black", linewidth=0.4)
        ticks.append(y)
        labels.append(f"{c}: MODEL")
    ax.set_yticks(ticks, labels, fontsize=8)
    ax.set_xlabel("minutes into the line")
    mv, pv = R["model_vs_people"], R["people_vs_people"]
    title = (f"{R['line']} ({'tuning' if R['split'] == 'val' else 'test'} line)   model vs annotator"
             f"{'s' if len(people) > 1 else ''}: F1 {mv[0]:.2f}")
    if pv:
        title += f"   annotators vs each other: F1 {pv[0]:.2f}"
    title += (f"\nstretches: model {R['model_stretches']}, annotator {R['annotator_stretches']} on average;"
              f"  median length: model {R['model_median_s']} s, annotator {R['annotator_median_s']} s")
    ax.set_title(title, fontsize=10, loc="left")
    ax.grid(axis="x", alpha=0.3)
    fig.tight_layout()
    path = os.path.join(out_dir, f"{R['split']}-{R['line']}{'-' + TAG if TAG else ''}.png")
    fig.savefig(path, dpi=110)
    plt.close(fig)
    print(path)
