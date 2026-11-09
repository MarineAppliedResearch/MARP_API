# Dataset check 1: do the labels run late against the picture?
# Recompute each test frame's labels as if the annotation were shifted by d seconds,
# and see which shift the ResNet-50's answers agree with best. d > 0 means the label
# describes what was on screen d seconds *before* the annotated time.
import csv
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
rows = [r for r in csv.DictReader(open(os.path.join(HERE, "dataset.csv"))) if r["split"] == "test"]
scores = np.load(os.path.join(HERE, "runs", "resnet50_test_scores.npy"))
th = json.load(open(os.path.join(HERE, "runs", "resnet50_results.json")))["thresholds"]
pred = np.stack([scores[:, i] >= th[c] for i, c in enumerate(CLASSES)], 1)
intervals = json.load(open(os.path.join(HERE, "intervals.json")))


def labels_at(row, shift_ms):
    ivs = intervals[row["session"]]
    off = next(i["offset"] for i in ivs if i["file"] == row["video"])
    t = float(row["seconds_into_video"]) * 1000 + off - shift_ms
    return [int(any(i["name"] == c and i["a"] <= t <= i["b"] for i in ivs)) for c in CLASSES]


def macro_f1(y):
    f1s = []
    for c in range(len(CLASSES)):
        tp = (pred[:, c] & (y[:, c] == 1)).sum()
        p = tp / max(pred[:, c].sum(), 1)
        r = tp / max(y[:, c].sum(), 1)
        f1s.append(2 * p * r / (p + r) if p + r else 0)
    return np.mean(f1s), f1s


for d in range(-20, 21, 2):
    y = np.array([labels_at(r, -d * 1000) for r in rows])
    m, f1s = macro_f1(y)
    print(f"labels shifted {d:+3d} s: macro F1 {m:.3f}  " + "  ".join(f"{c} {f:.2f}" for c, f in zip(CLASSES, f1s)))
