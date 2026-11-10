# Does averaging each frame's answer with its neighbours along the video help? Seabed does
# not change every 10 s, but the model judges every frame on its own.
# Uses a trained run's saved weights to score the tuning and test dives, then for each
# window: smooths both, picks the cut-offs on the tuning dives, and scores the test dives.
# No retraining, so the test dives stay unseen.
#   python -I smooth.py <arch> <dataset csv> <crop> <size> [full lr]   (as given to train.py)
import os
import runpy
import sys

import numpy as np
import torch
from torch.utils.data import DataLoader

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = ["train.py"] + sys.argv[1:]
T = runpy.run_path(os.path.join(HERE, "train.py"), run_name="smooth")
CLASSES, RUN = T["CLASSES"], T["RUN"]


def answers(split, rows, model, device):
    cache = os.path.join(HERE, "runs", f"{RUN}_{split}_scores.npy")
    if os.path.exists(cache):
        return np.load(cache)
    # One process: Windows cannot hand a class loaded through runpy to loader workers.
    dl = DataLoader(T["Frames"](rows, False), batch_size=T["BATCH"], num_workers=0)
    p, _ = T["predict"](model, dl, device)
    np.save(cache, p)
    return p


def smooth(p, rows, half):
    # Neighbours are frames of the same line and video within `half` steps of 10 s; a gap in
    # the annotation (a change of substrate, or none recorded) is not reached across.
    if half == 0:
        return p
    out = np.empty_like(p)
    key = lambda r: (r["session"], r["video"])
    groups = {}
    for i, r in enumerate(rows):
        groups.setdefault(key(r), []).append(i)
    for idx in groups.values():
        idx.sort(key=lambda i: float(rows[i]["seconds_into_video"]))
        t = np.array([float(rows[i]["seconds_into_video"]) for i in idx])
        for j, i in enumerate(idx):
            near = [idx[k] for k in range(max(0, j - half), min(len(idx), j + half + 1))
                    if abs(t[k] - t[j]) <= 10 * half + 1]
            out[i] = p[near].mean(0)
    return out


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    rows = T["read_rows"]()
    split = {s: [r for r in rows if r["split"] == s] for s in ("val", "test")}
    model, _ = T["build"](T["ARCH"])
    model.load_state_dict(torch.load(os.path.join(HERE, "runs", f"{RUN}.pt"), map_location="cpu", weights_only=True))
    model.to(device)
    p = {s: answers(s, split[s], model, device) for s in split}
    y = {s: np.array([[float(r[c]) for c in CLASSES] for r in split[s]]) for s in split}

    print(f"{RUN}: {len(split['val'])} tuning frames, {len(split['test'])} test frames")
    for half in (0, 1, 2, 3):
        pv, pt = smooth(p["val"], split["val"], half), smooth(p["test"], split["test"], half)
        th = T["best_thresholds"](pv, y["val"])
        s = T["scores"](pt, y["test"], th)
        years = {}
        for proj in sorted({r["project"] for r in split["test"]}):
            idx = [i for i, r in enumerate(split["test"]) if r["project"] == proj]
            years[proj] = T["scores"](pt[idx], y["test"][idx], th)["macro_f1"]
        print(f"  window {2 * half + 1} frames ({20 * half} s): test macro F1 {s['macro_f1']}, every substrate right "
              f"{s['all_substrates_right']}  " + "  ".join(f"{c} {s[c]['f1']}" for c in CLASSES) + f"  | {years}")


if __name__ == "__main__":
    main()
