# Feasibility test: build the dataset from the frames on disk.
# One row per picture. Each picture was taken from inside annotated start/end stretches,
# and its 0/1 columns say which substrates were active at that moment.
# Frames that are not seabed (black screens, "Device Unplugged!", "End Line" cards)
# are left out and listed in rejected.csv.
import csv
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
# Screens seen by eye that are not seabed; anything this close to one is dropped.
EXEMPLARS = {
    "device unplugged": "frames/train/1510_520000.jpg",
    "end line card": "frames/test/4110_1000000.jpg",
}
MAX_DIFF = 12.0


def small(path):
    return np.asarray(Image.open(os.path.join(HERE, path)).convert("L").resize((32, 18)), dtype=np.float32)


plan = json.load(open(os.path.join(HERE, "plan.json")))
exemplars = {k: small(v) for k, v in EXEMPLARS.items()}
kept, rejected = [], []
for f in plan["frames"]:
    image = f"frames/{f['split']}/{f['session']}_{round(f['position'] * 1000)}.jpg"
    if not os.path.exists(os.path.join(HERE, image)):
        continue
    s = small(image)
    reason = "blank screen" if s.std() < 2 else next(
        (k for k, e in exemplars.items() if np.abs(s - e).mean() < MAX_DIFF), None)
    row = {"image": image, "split": f["split"], "project": f["project"], "dive": f["dive"],
           "line": f["line"], "session": f["session"], "video": f["file"],
           "seconds_into_video": f["position"], **dict(zip(CLASSES, f["labels"]))}
    (rejected if reason else kept).append({**row, "reason": reason} if reason else row)

with open(os.path.join(HERE, "dataset.csv"), "w", newline="") as out:
    w = csv.DictWriter(out, fieldnames=list(kept[0].keys()))
    w.writeheader()
    w.writerows(kept)
with open(os.path.join(HERE, "rejected.csv"), "w", newline="") as out:
    w = csv.DictWriter(out, fieldnames=list(rejected[0].keys()))
    w.writeheader()
    w.writerows(rejected)

print(f"kept {len(kept)}, rejected {len(rejected)}:",
      {r: sum(x['reason'] == r for x in rejected) for r in {x['reason'] for x in rejected}})
for split in ("train", "val", "test"):
    rows = [r for r in kept if r["split"] == split]
    print(f"{split}: {len(rows)} frames, {len({(r['project'], r['dive']) for r in rows})} dives; "
          + ", ".join(f"{c} {sum(r[c] for r in rows)}" for c in CLASSES))
