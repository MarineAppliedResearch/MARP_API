# The overnight queue for DINOv2, started 2026-11-09.
#
# Part 1: at 384 px on dataset_full_run1.csv (the data behind the 0.707 run), try the usual
#   ways of stopping a ViT memorising. The winner is chosen by the TUNING dives only, so the
#   test dives stay a fair measure of the final model.
# Part 2: the winner's settings at 518 px on the full dataset (all three years in tuning and
#   test), once per seed. After each one, every finished seed is averaged into one model,
#   with its cut-offs picked on the tuning dives, and scored on the test dives.
#
# Progress goes to runs/overnight.log; results/overnight-summary.md is rewritten after every
# run, so stopping it at any point leaves the results so far.
#   python -I overnight.py
import json
import os
import re
import runpy
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = ["train.py"]
T = runpy.run_path(os.path.join(HERE, "train.py"), run_name="overnight")
CLASSES = T["CLASSES"]

PART1_DATA = "dataset_full_run1.csv"
# The run this is trying to beat: gentle whole-model speed, nothing else.
BASELINE = ("baseline", "dinov2_vitb-dataset_full_run1-full-384-lr1e-5", ["1e-5"])
PART1 = [
    ("longer, warm-up", ["1e-5", "warmup=1", "epochs=10"]),
    ("layer-wise speeds", ["3e-5", "llrd=0.75", "warmup=1", "epochs=10"]),
    ("stronger variation", ["1e-5", "warmup=1", "epochs=10", "aug=strong"]),
    ("stochastic depth + averaging", ["1e-5", "warmup=1", "epochs=10", "drop_path=0.1", "ema=0.999"]),
    ("all of them", ["3e-5", "llrd=0.75", "warmup=1", "epochs=10", "aug=strong", "drop_path=0.1", "ema=0.999"]),
]
PART2_DATA, PART2_SIZE, SEEDS = "dataset_full.csv", "518", [1, 2, 3, 4, 5]
PY = sys.executable
LOG = os.path.join(HERE, "runs", "overnight.log")
SUMMARY = os.path.join(HERE, "results", "overnight-summary.md")
summary = {"part1": [], "winner": None, "part2": [], "ensembles": []}


def say(msg):
    line = f"{time.strftime('%H:%M')} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def run_name(data, size, args):
    """train.py's own name for a run, so its files can be found afterwards."""
    pos = [a for a in args if "=" not in a]
    opts = [a.split("=", 1) for a in args if "=" in a]
    name = f"dinov2_vitb-{os.path.splitext(data)[0]}-full-{size}"
    name += f"-lr{pos[0]}" if pos else ""
    return name + "".join(f"-{k}{v}" for k, v in opts)


def best_val(name):
    # From the log, so the runs from before best_val_macro_f1 was recorded count too.
    text = open(os.path.join(HERE, "runs", f"{name}.log"), encoding="utf-8").read()
    return max(float(v) for v in re.findall(r"val macro F1 ([0-9.]+)", text))


def train(data, size, args, label):
    name = run_name(data, size, args)
    if os.path.exists(os.path.join(HERE, "runs", f"{name}_results.json")):
        say(f"{label}: already done ({name})")
        return name
    say(f"{label}: training {name}")
    with open(LOG, "a", encoding="utf-8") as f:
        # train.py's own progress lines go into the same log, for watching live.
        proc = subprocess.run([PY, "-I", "train.py", "dinov2_vitb", data, "full", size, *args],
                              cwd=HERE, stdout=f, stderr=subprocess.DEVNULL)
    if proc.returncode:
        say(f"{label}: FAILED with exit {proc.returncode}; carrying on")
        return None
    return name


def test_scores(name):
    r = json.load(open(os.path.join(HERE, "runs", f"{name}_results.json")))
    t = r["finetuned_test"]
    return {"macro_f1": t["macro_f1"], "all_right": t["all_substrates_right"],
            "per_substrate": {c: t[c]["f1"] for c in CLASSES},
            "by_year": {p: v["macro_f1"] for p, v in r["finetuned_test_by_project"].items()},
            "kept": r.get("kept", "fine-tuned")}


def ensemble(names):
    # Average the finished seeds' answers, pick cut-offs on the tuning dives, score the test dives.
    rows = [r for r in __import__("csv").DictReader(open(os.path.join(HERE, PART2_DATA)))]
    split = {s: [r for r in rows if r["split"] == s] for s in ("val", "test")}
    y = {s: np.array([[float(r[c]) for c in CLASSES] for r in split[s]]) for s in split}
    p = {s: np.mean([np.load(os.path.join(HERE, "runs", f"{n}_{s}_scores.npy")) for n in names], 0) for s in split}
    th = T["best_thresholds"](p["val"], y["val"])
    s = T["scores"](p["test"], y["test"], th)
    years = {}
    for proj in sorted({r["project"] for r in split["test"]}):
        idx = [i for i, r in enumerate(split["test"]) if r["project"] == proj]
        years[proj] = T["scores"](p["test"][idx], y["test"][idx], th)["macro_f1"]
    return {"models": len(names), "macro_f1": s["macro_f1"], "all_right": s["all_substrates_right"],
            "per_substrate": {c: s[c]["f1"] for c in CLASSES}, "by_year": years}


def write_summary():
    L = ["# Overnight DINOv2 runs", "",
         "Written by `overnight.py` after every run. Average F1 over Rock, Mud, Sand, Cobble, Boulder.", "",
         "## Part 1: settings, at 384 px on the data behind the 0.707 run", "",
         "Chosen by the tuning dives. Test scores are shown but were not used to choose.", "",
         "| Settings | Best tuning F1 | Test F1 | Every substrate right |", "| --- | --- | --- | --- |"]
    for e in summary["part1"]:
        L.append(f"| {e['label']} | {e['val']:.3f} | {e['test']['macro_f1']:.3f} | {e['test']['all_right']:.3f} |")
    if summary["winner"]:
        L += ["", f"Winner: **{summary['winner']}**."]
    L += ["", f"## Part 2: the winner at {PART2_SIZE} px on the full dataset, one run per seed", "",
          "Tuning and test dives now include CAMPA 2026, so these do not compare with Part 1.", "",
          "| Seed | Test F1 | Every substrate right | " + " | ".join(CLASSES) + " | By year |",
          "| --- | --- | --- | " + " | ".join("---" for _ in CLASSES) + " | --- |"]
    for e in summary["part2"]:
        t = e["test"]
        L.append(f"| {e['seed']} | {t['macro_f1']:.3f} | {t['all_right']:.3f} | "
                 + " | ".join(f"{t['per_substrate'][c]:.2f}" for c in CLASSES) + f" | {t['by_year']} |")
    if summary["ensembles"]:
        L += ["", "## The seeds averaged into one model", "",
              "| Models | Test F1 | Every substrate right | " + " | ".join(CLASSES) + " | By year |",
              "| --- | --- | --- | " + " | ".join("---" for _ in CLASSES) + " | --- |"]
        for e in summary["ensembles"]:
            L.append(f"| {e['models']} | {e['macro_f1']:.3f} | {e['all_right']:.3f} | "
                     + " | ".join(f"{e['per_substrate'][c]:.2f}" for c in CLASSES) + f" | {e['by_year']} |")
    os.makedirs(os.path.dirname(SUMMARY), exist_ok=True)
    open(SUMMARY, "w", encoding="utf-8").write("\n".join(L) + "\n")


def stay_awake():
    # Ask Windows not to idle-sleep while this process runs. Held by this process only and
    # dropped when it exits; no power setting is changed.
    if os.name == "nt":
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)


def main():
    stay_awake()
    say("overnight queue started")
    label, name, _ = BASELINE
    summary["part1"].append({"label": label, "args": ["1e-5"], "name": name, "val": best_val(name), "test": test_scores(name)})
    write_summary()
    for label, args in PART1:
        name = train(PART1_DATA, "384", args, f"part 1, {label}")
        if name:
            summary["part1"].append({"label": label, "args": args, "name": name, "val": best_val(name), "test": test_scores(name)})
            say(f"part 1, {label}: best tuning F1 {summary['part1'][-1]['val']:.3f}")
            write_summary()

    win = max(summary["part1"], key=lambda e: e["val"])
    summary["winner"] = f"{win['label']} ({' '.join(win['args'])}), tuning F1 {win['val']:.3f}"
    say(f"winner: {summary['winner']}")
    write_summary()

    done = []
    for seed in SEEDS:
        # Batch 16 at 518 px: 9.7 GB with averaging on, against 16 GB.
        args = win["args"] + ["batch=16", f"seed={seed}"]
        name = train(PART2_DATA, PART2_SIZE, args, f"part 2, seed {seed}")
        if not name:
            continue
        done.append(name)
        summary["part2"].append({"seed": seed, "name": name, "test": test_scores(name)})
        say(f"part 2, seed {seed}: test F1 {summary['part2'][-1]['test']['macro_f1']:.3f}")
        summary["ensembles"].append(ensemble(done))
        say(f"part 2, {len(done)} seeds averaged: test F1 {summary['ensembles'][-1]['macro_f1']:.3f}")
        write_summary()
    say("overnight queue finished")


if __name__ == "__main__":
    main()
