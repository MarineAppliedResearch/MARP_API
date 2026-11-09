# Mean and spread of every frame, to find screens that are not seabed.
import csv, glob, os, sys
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
out = []
for p in glob.glob(os.path.join(here, "frames", "*", "*.jpg")):
    a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)[45:]  # below the overlay
    out.append((os.path.relpath(p, here).replace("\\", "/"), a.mean(), a.std(), a[..., 2].mean() - a[..., 0].mean()))
with open(os.path.join(here, "imgstats.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["image", "mean", "std", "blue_minus_red"]); w.writerows(out)
s = np.array([o[2] for o in out]); m = np.array([o[1] for o in out])
print(len(out), "frames; std percentiles 1/5/50:", np.percentile(s, [1, 5, 50]).round(1), "mean 1/50/99:", np.percentile(m, [1, 50, 99]).round(1))
