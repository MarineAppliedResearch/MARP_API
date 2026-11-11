# Sample model output, step 2: run the final model (five DINOv2 runs averaged) on one frame
# per second of the lines sample_lines.js fetched, turn its answers into habitat stretches
# the way the protocol has annotators record them, and set them beside the annotators'.
#
# Stretch rules, from Protocol_Habitat (02.2024) and MARE Substrate Annotation:
#   - each substrate is its own layer, decided independently;
#   - a stretch is at least MIN_S seconds;
#   - a break shorter than the bridging gap does not end a stretch. The protocol says
#     "less than 2 meters"; the gap in seconds is chosen on the tuning lines, never the test.
# Comparison is second by second, as audit/agreement.js compares two annotators.
#   python -I sample_output.py                  the first run: 1 frame/s, as described above
# Settings as key=value, each one changing a rule above, and a tag naming the run's outputs:
#   frames=frames_3fps step=0.3333  frames sample_lines.js fetched, and their spacing in s
#   smooth=2     average each frame's scores over this many seconds around it first
#   raise=0.1    added to every substrate's cut-off (capped at 0.95); raise_Mud=0.1 for one alone
#   min=4        shortest stretch kept, in seconds
#   gap=2        break bridged, in seconds; given, it is used as is instead of tuned
#   one_soft=1   at most one of Mud and Sand at a time (Isaac, 2026-11-10: Mud, Sand and Gravel
#                never overlap; annotators never label Mud with Sand). Where both pass their
#                cut-off, the one the model is surer of stays. The model has no Gravel.
#   runs=a,b     which trained runs to average (names under runs/); default the five 518 px seeds
#   crop=habitat which of train.py's CROPS to cut each frame to; default "full", as those were trained
#   tag=v2       names report_v2.json and the CSVs (and, with runs=, the cached answers)
import csv
import json
import os
import sys

import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
RUNS = [f"dinov2_vitb-dataset_full-full-518-lr3e-5-llrd0.75-warmup1-epochs10-batch16-seed{i}" for i in range(1, 6)]
CROP_BOX = None  # set from train.py's CROPS once it is loaded
SIZE, OVERLAY_ROWS = 518, 0.25
MARGIN_S = 2
GAPS = [0, 2, 4, 6, 8, 10, 15]
OUT = os.path.join(HERE, "sample")
OPT = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
FRAMES = OPT.get("frames", "frames_1s")
STEP_MS = round(float(OPT.get("step", 1)) * 1000)
SMOOTH_S = float(OPT.get("smooth", 0))
RAISE = float(OPT.get("raise", 0))
MIN_S = float(OPT.get("min", 2))
TAG = OPT.get("tag", "")
if "runs" in OPT:
    RUNS = OPT["runs"].split(",")
CROP = OPT.get("crop", "full")
ONE_SOFT = OPT.get("one_soft") == "1"


class Seconds(Dataset):
    # The same picture train.py's evaluation sees: overlay cut off, resized, normalised.
    def __init__(self, paths, box):
        # The box travels with the dataset: Windows loader workers start fresh and do not
        # see a global set in the main process.
        self.paths, self.box = paths, box
        self.tf = transforms.Compose([transforms.Resize((SIZE, SIZE)), transforms.ToTensor(),
                                      transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        img = Image.open(self.paths[i]).convert("RGB")
        w, h = img.size
        x0, y0, x1, y1 = self.box
        return self.tf(img.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1))))


def models():
    sys.argv = ["train.py", "dinov2_vitb", "dataset_full.csv", "full", str(SIZE), "3e-5"]
    import runpy
    T = runpy.run_path(os.path.join(HERE, "train.py"), run_name="sample")
    out = []
    for name in RUNS:
        m, _ = T["build"]("dinov2_vitb")
        m.load_state_dict(torch.load(os.path.join(HERE, "runs", f"{name}.pt"), map_location="cpu", weights_only=True))
        out.append(m.cuda().eval())
    return T, out


def answers(ref, line, T, nets):
    # Per second of video: clock ms and the averaged probability of each substrate.
    cache = os.path.join(OUT, f"{ref}_answers.npz" if FRAMES == "frames_1s" else f"{ref}_answers_{FRAMES}.npz")
    if "runs" in OPT:
        # Keyed by which models and crop made the answers, not the run's tag, so rule
        # variants over the same models reuse them.
        import hashlib
        key = hashlib.md5(f"{OPT['runs']}|{CROP}".encode()).hexdigest()[:10]
        cache = cache.replace(".npz", f"_{key}.npz")
    if os.path.exists(cache):
        z = np.load(cache)
        return z["clock"], z["p"]
    paths, clock = [], []
    for f in line["files"]:
        d = os.path.join(HERE, FRAMES, ref, str(f["k"]))
        for name in sorted(os.listdir(d), key=lambda n: int(n[:-4])):
            paths.append(os.path.join(d, name))
            clock.append(int(name[:-4]) + f["offset"])
    dl = DataLoader(Seconds(paths, CROP_BOX), batch_size=32, num_workers=6)
    ps = []
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
        for x in dl:
            x = x.cuda()
            ps.append(torch.stack([torch.sigmoid(n(x)).float() for n in nets]).mean(0).cpu())
    p = torch.cat(ps).numpy()
    clock = np.array(clock)
    order = np.argsort(clock)
    np.savez(cache, clock=clock[order], p=p[order])
    return clock[order], p[order]


def smooth(clock, p):
    # A running average of each frame's scores over SMOOTH_S seconds centred on it, within
    # one unbroken run of frames (a file change or a gap restarts it).
    if not SMOOTH_S:
        return p
    half = int(round(SMOOTH_S * 1000 / STEP_MS / 2))
    out = np.empty_like(p)
    breaks = np.where(np.diff(clock) > 2 * STEP_MS)[0] + 1
    for seg in np.split(np.arange(len(clock)), breaks):
        k = np.ones(2 * half + 1)
        n = np.convolve(np.ones(len(seg)), k, "same")
        for c in range(p.shape[1]):
            out[seg, c] = np.convolve(p[seg, c], k, "same") / n
    return out


def stretches(clock, p, th, gap):
    # Per substrate: frames over its cut-off, short breaks bridged, short stretches dropped.
    # A frame stands for STEP_MS of video from its own time.
    out = []
    for c, name in enumerate(CLASSES):
        on = p[:, c] >= th[c]
        runs, start = [], None
        for i, v in enumerate(on):
            broken = i > 0 and clock[i] - clock[i - 1] > 2 * STEP_MS
            if start is not None and (not v or broken):
                runs.append([start, i - 1])
                start = None
            if v and start is None:
                start = i
        if start is not None:
            runs.append([start, len(on) - 1])
        merged = []
        for r in runs:
            if merged and clock[r[0]] - (clock[merged[-1][1]] + STEP_MS) <= gap * 1000:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        for a, b in merged:
            if clock[b] + STEP_MS - clock[a] >= MIN_S * 1000:
                out.append({"name": name, "a": int(clock[a]), "b": int(clock[b]) + STEP_MS - 1,
                            "confidence": round(float(p[a:b + 1, c].mean()), 3)})
    return out


def compare(A, B):
    # agreement.js's rule: whole clock seconds both recorded something in, away from any
    # change of substrate in either by MARGIN_S. Returns per-substrate tp/fp/fn and seconds.
    sec = lambda spans: [(x["name"], x["a"] // 1000, x["b"] // 1000) for x in spans]
    A, B = sec(A), sec(B)
    if not A or not B:
        return None
    lo, hi = max(min(x[1] for x in A), min(x[1] for x in B)), min(max(x[2] for x in A), max(x[2] for x in B))
    at = lambda S, t: [any(n == c and a <= t <= b for n, a, b in S) for c in CLASSES]
    near = lambda S, t: any(abs(a - t) < MARGIN_S or abs(b - t) < MARGIN_S for _, a, b in S)
    tp, fp, fn = np.zeros(5), np.zeros(5), np.zeros(5)
    n = same = 0
    for t in range(lo, hi + 1):
        la, lb = at(A, t), at(B, t)
        if not any(la) or not any(lb) or near(A, t) or near(B, t):
            continue
        n += 1
        same += la == lb
        for c in range(5):
            tp[c] += la[c] and lb[c]
            fp[c] += lb[c] and not la[c]
            fn[c] += la[c] and not lb[c]
    return {"tp": tp, "fp": fp, "fn": fn, "seconds": n, "same": same}


def f1(tally):
    d = 2 * tally["tp"] + tally["fp"] + tally["fn"]
    per = [float(2 * tally["tp"][c] / d[c]) if d[c] else None for c in range(5)]
    present = [v for v in per if v is not None]
    return (float(np.mean(present)) if present else None), per, tally["same"] / max(tally["seconds"], 1)


def add(x, y):
    return {k: x[k] + y[k] for k in x}


def clock_text(ms):
    s = ms / 1000
    return f"{int(s // 3600) % 24:02d}:{int(s // 60) % 60:02d}:{s % 60:06.3f}"


def main():
    global CROP_BOX
    lines = json.load(open(os.path.join(OUT, "lines.json")))
    T, nets = models()
    CROP_BOX = T["CROPS"][CROP]
    # The ensemble's cut-offs, picked on the full dataset's tuning dives as overnight.py did.
    rows = list(csv.DictReader(open(os.path.join(HERE, "dataset_full.csv"))))
    yv = np.array([[float(r[c]) for c in CLASSES] for r in rows if r["split"] == "val"])
    pv = np.mean([np.load(os.path.join(HERE, "runs", f"{n}_val_scores.npy")) for n in RUNS], 0)
    # raise_<Substrate>=x overrides raise for that substrate alone.
    th = [min(t + float(OPT.get(f"raise_{c}", RAISE)), 0.95) for c, t in zip(CLASSES, T["best_thresholds"](pv, yv))]
    print(f"{FRAMES}, {STEP_MS} ms apart, smoothed over {SMOOTH_S} s, minimum {MIN_S} s; cut-offs:",
          {c: round(t, 2) for c, t in zip(CLASSES, th)})

    got = {}
    for ref, L in lines.items():
        clock, p = answers(ref, L, T, nets)
        p = smooth(clock, p)
        if ONE_SOFT:
            mud, sand = CLASSES.index("Mud"), CLASSES.index("Sand")
            both = (p[:, mud] >= th[mud]) & (p[:, sand] >= th[sand])
            p = p.copy()
            p[both & (p[:, mud] < p[:, sand]), mud] = 0
            p[both & (p[:, sand] <= p[:, mud]), sand] = 0
        got[ref] = (clock, p)
    del nets
    torch.cuda.empty_cache()

    # The bridging gap, on the tuning lines only.
    score = {}
    for gap in GAPS:
        total = None
        for ref, L in lines.items():
            if L["split"] != "val":
                continue
            r = compare(L["sessions"][ref]["spans"], stretches(*got[ref], th, gap))
            total = r if total is None else add(total, r)
        score[gap] = f1(total)[0]
    gap = float(OPT["gap"]) if "gap" in OPT else max(score, key=score.get)
    print("tuning lines, average F1 by bridging gap (s):", {g: round(v, 3) for g, v in score.items()}, "-> chosen", gap)

    report = {"settings": OPT, "cut_offs": dict(zip(CLASSES, th)), "gap_s": gap, "gap_scores": score, "lines": {}}
    for ref, L in lines.items():
        model = stretches(*got[ref], th, gap)
        name = f"{L['project']} dive {L['dive']} line {L['line']}".replace("/", "-")
        with open(os.path.join(OUT, f"{L['split']}-{name}{'-' + TAG if TAG else ''}.csv"), "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["substrate", "start_clock", "end_clock", "seconds", "confidence"])
            for s in sorted(model, key=lambda x: (x["a"], CLASSES.index(x["name"]))):
                w.writerow([s["name"], clock_text(s["a"]), clock_text(s["b"]), round((s["b"] - s["a"]) / 1000), s["confidence"]])
        people = {sid: S for sid, S in L["sessions"].items()}
        vs_model, vs_people = None, None
        for sid, S in people.items():
            r = compare(S["spans"], model)
            vs_model = r if vs_model is None else add(vs_model, r)
        ids = list(people)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                r = compare(people[ids[i]]["spans"], people[ids[j]]["spans"])
                if r:
                    vs_people = r if vs_people is None else add(vs_people, r)
        lengths = lambda S: [(x["b"] - x["a"]) / 1000 for x in S]
        entry = {"split": L["split"], "line": name, "annotators": len(people),
                 "model_stretches": len(model), "annotator_stretches": round(np.mean([len(S["spans"]) for S in people.values()]), 1),
                 "model_median_s": round(float(np.median(lengths(model))), 1) if model else None,
                 "annotator_median_s": round(float(np.median([v for S in people.values() for v in lengths(S["spans"])])), 1),
                 "model_vs_people": f1(vs_model), "people_vs_people": f1(vs_people) if vs_people else None,
                 "model": model}
        report["lines"][ref] = entry
        mv = entry["model_vs_people"]
        pv_ = entry["people_vs_people"]
        print(f"{L['split']:4} {name:36} people {len(people)}  model F1 {mv[0]:.3f} (all same {mv[2]:.2f})"
              + (f"  people vs people F1 {pv_[0]:.3f} (all same {pv_[2]:.2f})" if pv_ else "")
              + f"  stretches: model {len(model)}, annotator {entry['annotator_stretches']}"
              + f"; median length model {entry['model_median_s']} s, annotator {entry['annotator_median_s']} s")
    json.dump(report, open(os.path.join(OUT, f"report{'_' + TAG if TAG else ''}.json"), "w"), indent=1, default=float)


if __name__ == "__main__":
    main()
