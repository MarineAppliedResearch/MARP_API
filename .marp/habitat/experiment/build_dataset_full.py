# Full-resolution dataset: dataset.csv's rows whose full frame was cut, pointing at
# frames_full/. Labels are dataset.csv's own, unshifted: a full frame is cut at its exact
# position, unlike the trickplay thumbnails that dataset_v2.csv corrects for.
# Also writes the thumbnail rows for exactly the same frames, so the two compare fairly.
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.DictReader(open(os.path.join(HERE, "dataset.csv"))))
full, thumbs = [], []
for r in rows:
    image = r["image"].replace("frames/", "frames_full/", 1)
    if os.path.exists(os.path.join(HERE, image)):
        full.append({**r, "image": image})
        thumbs.append(r)

for name, out in (("dataset_full.csv", full), ("dataset_full_thumbs.csv", thumbs)):
    with open(os.path.join(HERE, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(out)
print(f"kept {len(full)} of {len(rows)}")
for split in ("train", "val", "test"):
    s = [r for r in full if r["split"] == split]
    projects = {}
    for r in s:
        projects[r["project"]] = projects.get(r["project"], 0) + 1
    print(f"{split}: {len(s)} frames, {len({r['dive'] + r['project'] for r in s})} dives; {projects}")
