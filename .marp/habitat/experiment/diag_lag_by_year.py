# Dataset check 1, per CAMPA year and on full frames: does one year's labelling run early or
# late against the picture? diag_lag.py asked this of all the thumbnails together; a full
# frame is cut at its exact time, so every year should fit best at no shift at all.
# d > 0 means the label describes what was on screen d seconds before the annotated time.
#   python -I diag_lag_by_year.py <run name> <dataset csv>
import csv
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
RUN, DATA = sys.argv[1], sys.argv[2]
rows = [r for r in csv.DictReader(open(os.path.join(HERE, DATA))) if r["split"] == "test"]
scores = np.load(os.path.join(HERE, "runs", f"{RUN}_test_scores.npy"))
th = json.load(open(os.path.join(HERE, "runs", f"{RUN}_results.json")))["thresholds"]
pred = np.stack([scores[:, i] >= th[c] for i, c in enumerate(CLASSES)], 1)
intervals = json.load(open(os.path.join(HERE, "intervals.json")))


def labels_at(row, shift_ms):
    ivs = intervals[row["session"]]
    off = next(i["offset"] for i in ivs if i["file"] == row["video"])
    t = float(row["seconds_into_video"]) * 1000 + off - shift_ms
    return [int(any(i["name"] == c and i["a"] <= t <= i["b"] for i in ivs)) for c in CLASSES]


def f1s(p, y):
    out = []
    for c in range(len(CLASSES)):
        tp = (p[:, c] & (y[:, c] == 1)).sum()
        prec, rec = tp / max(p[:, c].sum(), 1), tp / max(y[:, c].sum(), 1)
        out.append(2 * prec * rec / (prec + rec) if prec + rec else 0)
    return out


for project in sorted({r["project"] for r in rows}):
    idx = [i for i, r in enumerate(rows) if r["project"] == project]
    print(f"== {project}: {len(idx)} test frames")
    best = None
    for d in range(-20, 21, 2):
        y = np.array([labels_at(rows[i], -d * 1000) for i in idx])
        f = f1s(pred[idx], y)
        if best is None or np.mean(f) > best[1]:
            best = (d, np.mean(f))
        print(f"  shifted {d:+3d} s: macro F1 {np.mean(f):.3f}  " + "  ".join(f"{c} {v:.2f}" for c, v in zip(CLASSES, f)))
    print(f"  best fit at {best[0]:+d} s")
