# Dataset v2: the same pictures, labelled at the moment they actually show.
# Jellyfin's trickplay thumbnail k is not the frame at k*10 s: the burned-in ROV clock on
# checked frames reads 3-4 s later, and model/label agreement peaks with labels taken
# 4-6 s later (diag_lag.py). So each picture is labelled at its position + 5 s, and the
# 2 s margin around substrate changes is applied at that time too.
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
SHIFT_MS = 5000
MARGIN_MS = 2000
intervals = json.load(open(os.path.join(HERE, "intervals.json")))

rows = list(csv.DictReader(open(os.path.join(HERE, "dataset.csv"))))
kept = []
dropped = {"near a change": 0, "in a gap": 0}
for r in rows:
    ivs = intervals[r["session"]]
    off = next(i["offset"] for i in ivs if i["file"] == r["video"])
    t = float(r["seconds_into_video"]) * 1000 + off + SHIFT_MS
    if any(abs(e - t) < MARGIN_MS for i in ivs for e in (i["a"], i["b"])):
        dropped["near a change"] += 1
        continue
    covering = [i for i in ivs if i["a"] <= t <= i["b"]]
    if not covering:
        dropped["in a gap"] += 1
        continue
    kept.append({**r, **{c: int(any(i["name"] == c for i in covering)) for c in CLASSES}})

with open(os.path.join(HERE, "dataset_v2.csv"), "w", newline="") as out:
    w = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(kept)
print(f"kept {len(kept)} of {len(rows)}; dropped {dropped}")
for split in ("train", "val", "test"):
    s = [r for r in kept if r["split"] == split]
    print(f"{split}: {len(s)} frames; " + ", ".join(f"{c} {sum(int(r[c]) for r in s)}" for c in CLASSES))
