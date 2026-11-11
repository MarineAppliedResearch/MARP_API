# The second overnight queue, started 2026-11-10: the habitat crop given the same treatment
# the old crop had. Five DINOv2 seeds on the habitat crop (seed 1 already trained), averaged,
# then scored two ways against the old crop's five:
#   - on the test frames, as overnight.py's Part 2 was;
#   - on the 8 sample lines as habitat records, with run 3's rules, Mud's extra cut-off chosen
#     on the tuning lines only.
# Progress goes to runs/overnight-habitat.log; results/overnight-habitat-summary.md is rewritten
# after every step, so stopping it leaves the results so far.
#   python -I overnight_habitat.py
import json
import os
import runpy
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = ["train.py"]
T = runpy.run_path(os.path.join(HERE, "train.py"), run_name="overnight_habitat")
CLASSES = T["CLASSES"]
PY = sys.executable
LOG = os.path.join(HERE, "runs", "overnight-habitat.log")
SUMMARY = os.path.join(HERE, "results", "overnight-habitat-summary.md")
ARGS = ["3e-5", "llrd=0.75", "warmup=1", "epochs=10", "batch=16"]
NAME = "dinov2_vitb-dataset_full-{crop}-518-lr3e-5-llrd0.75-warmup1-epochs10-batch16-seed{seed}"
SEEDS = [1, 2, 3, 4, 5]
RULES = ["frames=frames_3fps", "step=0.3333333333", "smooth=1", "min=2", "gap=2", "one_soft=1"]
MUD_RAISES = ["0.0", "0.1", "0.2", "0.3", "0.4"]
TESTS, TUNING = ["2949", "4065", "1545", "3138", "4101"], ["1572", "3167", "4250"]
out = {"seeds": {}, "frames": {}, "lines": {}}


def say(msg):
    line = f"{time.strftime('%H:%M')} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def stay_awake():
    # As overnight.py: held by this process only, dropped when it exits.
    if os.name == "nt":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)


def frames_score(crop):
    # Average the five seeds' answers; cut-offs on the tuning dives; score the test dives.
    import csv
    rows = list(csv.DictReader(open(os.path.join(HERE, "dataset_full.csv"))))
    split = {s: [r for r in rows if r["split"] == s] for s in ("val", "test")}
    y = {s: np.array([[float(r[c]) for c in CLASSES] for r in split[s]]) for s in split}
    names = [NAME.format(crop=crop, seed=s) for s in SEEDS]
    p = {s: np.mean([np.load(os.path.join(HERE, "runs", f"{n}_{s}_scores.npy")) for n in names], 0) for s in split}
    th = T["best_thresholds"](p["val"], y["val"])
    s = T["scores"](p["test"], y["test"], th)
    years = {}
    for proj in sorted({r["project"] for r in split["test"]}):
        idx = [i for i, r in enumerate(split["test"]) if r["project"] == proj]
        years[proj] = T["scores"](p["test"][idx], y["test"][idx], th)["macro_f1"]
    return {"macro_f1": s["macro_f1"], "all_right": s["all_substrates_right"],
            "per_substrate": {c: s[c]["f1"] for c in CLASSES}, "by_year": years}


def lines_score(crop, raise_mud):
    tag = f"ovn_{crop}_mud{raise_mud}"
    runs = ",".join(NAME.format(crop=crop, seed=s) for s in SEEDS)
    with open(LOG, "a", encoding="utf-8") as f:
        subprocess.run([PY, "-I", "sample_output.py", *RULES, f"raise_Mud={raise_mud}", f"runs={runs}",
                        f"crop={crop}", f"tag={tag}"], cwd=HERE, stdout=f, stderr=subprocess.DEVNULL, check=True)
    R = json.load(open(os.path.join(HERE, "sample", f"report_{tag}.json")))["lines"]
    mean = lambda keys: float(np.mean([R[k]["model_vs_people"][0] for k in keys]))
    return {"tuning": mean(TUNING), "test": mean(TESTS),
            "per_line": {R[k]["line"]: R[k]["model_vs_people"][0] for k in TESTS}}


def write():
    L = ["# Overnight: the habitat crop, five seeds", "",
         "Written by `overnight_habitat.py`. Average F1 over Rock, Mud, Sand, Cobble, Boulder.", ""]
    if out["seeds"]:
        L += ["## Each seed on the test frames", "", "| Seed | Test F1 |", "| --- | --- |"]
        L += [f"| {s} | {v:.3f} |" for s, v in sorted(out["seeds"].items())]
    if out["frames"]:
        L += ["", "## Five seeds averaged, test frames (all three years)", "",
              "| Crop | Test F1 | Every substrate right | " + " | ".join(CLASSES) + " | By year |",
              "| --- | --- | --- | " + " | ".join("---" for _ in CLASSES) + " | --- |"]
        for crop, f in out["frames"].items():
            L.append(f"| {crop} | {f['macro_f1']:.3f} | {f['all_right']:.3f} | "
                     + " | ".join(f"{f['per_substrate'][c]:.2f}" for c in CLASSES) + f" | {f['by_year']} |")
    if out["lines"]:
        L += ["", "## Five seeds averaged, 8 sample lines as habitat records (run 3's rules)", "",
              "Mud's extra cut-off is chosen by the tuning lines; the test mean beside it is not used to choose.", "",
              "| Crop | Mud raise | Tuning mean | Test mean | Test lines |", "| --- | --- | --- | --- | --- |"]
        for (crop, m), r in out["lines"].items():
            L.append(f"| {crop} | +{m} | {r['tuning']:.3f} | {r['test']:.3f} | "
                     + ", ".join(f"{k}: {v:.2f}" for k, v in r["per_line"].items()) + " |")
        for crop in sorted({c for c, _ in out["lines"]}):
            mine = {m: r for (c, m), r in out["lines"].items() if c == crop}
            if mine:
                best = max(mine, key=lambda m: mine[m]["tuning"])
                L.append(f"\n**{crop}, chosen on the tuning lines:** Mud +{best}, test mean {mine[best]['test']:.3f}.")
    os.makedirs(os.path.dirname(SUMMARY), exist_ok=True)
    open(SUMMARY, "w", encoding="utf-8").write("\n".join(L) + "\n")


def main():
    stay_awake()
    say("habitat-crop overnight queue started")
    for seed in SEEDS:
        name = NAME.format(crop="habitat", seed=seed)
        if not os.path.exists(os.path.join(HERE, "runs", f"{name}_results.json")):
            say(f"training seed {seed} on the habitat crop")
            with open(LOG, "a", encoding="utf-8") as f:
                r = subprocess.run([PY, "-I", "train.py", "dinov2_vitb", "dataset_full.csv", "habitat", "518", *ARGS,
                                    f"seed={seed}"], cwd=HERE, stdout=f, stderr=subprocess.DEVNULL)
            if r.returncode:
                say(f"seed {seed} FAILED with exit {r.returncode}; carrying on")
                continue
        res = json.load(open(os.path.join(HERE, "runs", f"{name}_results.json")))
        out["seeds"][seed] = res["finetuned_test"]["macro_f1"]
        say(f"seed {seed}: test F1 {out['seeds'][seed]:.3f}")
        write()
    if len(out["seeds"]) < len(SEEDS):
        say("not every seed trained; stopping before the averages")
        return
    for crop in ("habitat", "full"):
        out["frames"][crop] = frames_score(crop)
        say(f"{crop}, five seeds, test frames: F1 {out['frames'][crop]['macro_f1']:.3f}")
        write()
    for crop in ("habitat", "full"):
        for m in MUD_RAISES:
            out["lines"][(crop, m)] = lines_score(crop, m)
            say(f"{crop}, Mud +{m}: tuning lines {out['lines'][(crop, m)]['tuning']:.3f}, test lines {out['lines'][(crop, m)]['test']:.3f}")
            write()
    say("habitat-crop overnight queue finished")


if __name__ == "__main__":
    main()
