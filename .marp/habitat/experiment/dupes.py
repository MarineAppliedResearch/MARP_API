# Frames that repeat almost exactly are a frozen or error screen, not seabed.
import glob, os, collections
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
groups = collections.defaultdict(list)
for p in glob.glob(os.path.join(here, "frames", "*", "*.jpg")):
    a = np.asarray(Image.open(p).convert("L").resize((16, 9)), dtype=np.float32)
    key = tuple((a // 16).astype(int).ravel())  # coarse, so JPEG noise does not split a group
    groups[key].append(os.path.relpath(p, here).replace("\\", "/"))
big = sorted((g for g in groups.values() if len(g) >= 5), key=len, reverse=True)
print("groups of 5+ near-identical frames:", len(big), "frames in them:", sum(map(len, big)))
for g in big[:12]:
    print(len(g), g[0])
