# Training curves for the five-seed runs on each crop, from their logs: the training loss and
# the tuning-dive score after every pass, and the test score of the pass that was kept.
# The logs record nothing else per pass -- no training-set score, no tuning-set loss.
#   python -I curves_sheet.py      -> sheets/training-curves.png
import json
import os
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "dinov2_vitb-dataset_full-{crop}-518-lr3e-5-llrd0.75-warmup1-epochs10-batch16-seed{seed}"
# Reference palette slots 1 and 2, validated for colour-blind separation on the light surface.
CROPS = [("habitat", "Quarter crop (bottom half, middle half)", "#2a78d6"),
         ("full", "Old crop (full width below the overlay)", "#eb6834")]
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
PASS = re.compile(r"(frozen|fine-tune) epoch (\d+)/\d+: loss ([0-9.]+), val macro F1 ([0-9.]+)")


def curves(name):
    loss, val = [], []
    for line in open(os.path.join(HERE, "runs", f"{name}.log"), encoding="utf-8"):
        m = PASS.search(line)
        if m:
            loss.append(float(m.group(3)))
            val.append(float(m.group(4)))
    test = json.load(open(os.path.join(HERE, "runs", f"{name}_results.json")))["finetuned_test"]["macro_f1"]
    # The trainer keeps the best tuning pass across both stages.
    kept = max(range(len(val)), key=lambda i: val[i])
    return loss, val, test, kept


def averaged_test(crop):
    for line in open(os.path.join(HERE, "results", "overnight-habitat-summary.md"), encoding="utf-8"):
        if line.startswith(f"| {crop} |") and line.count("|") > 8:
            return float(line.split("|")[2])
    return None


fig, (ax_loss, ax_f1) = plt.subplots(1, 2, figsize=(15, 7), facecolor=SURFACE)
for ax in (ax_loss, ax_f1):
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=MUTED)
    # Passes 1-3 train only the new last layer; from pass 4 the whole model adjusts.
    ax.axvline(3.5, color=MUTED, linewidth=1, linestyle=":")

passes = list(range(1, 14))
for crop, label, color in CROPS:
    runs = [curves(NAME.format(crop=crop, seed=s)) for s in range(1, 6)]
    for i, (loss, val, test, kept) in enumerate(runs):
        ax_loss.plot(passes, loss, color=color, linewidth=1.2, alpha=0.55, label=label if i == 0 else None)
        ax_f1.plot(passes, val, color=color, linewidth=1.2, alpha=0.55, label=f"{label}: tuning dives" if i == 0 else None)
        # The kept pass, and that model's test score: an open marker on the tuning line, a filled one for test.
        ax_f1.plot(kept + 1, val[kept], marker="o", markersize=8, markerfacecolor=SURFACE, markeredgecolor=color, markeredgewidth=2)
        ax_f1.plot(kept + 1, test, marker="D", markersize=8, color=color, markeredgecolor=SURFACE, markeredgewidth=2,
                   label=f"{label}: test, at the kept pass" if i == 0 else None)
    avg = averaged_test(crop)
    if avg:
        ax_f1.axhline(avg, color=color, linewidth=2, linestyle="--")
        ax_f1.text(13.3, avg + 0.0015, f"five averaged,\ntest {avg:.3f}", color=INK, va="bottom", fontsize=9)

ax_loss.set_title("Training loss after each pass (five seeds per crop)", loc="left", color=INK, fontsize=12)
ax_loss.set_xlabel("pass", color=MUTED)
ax_loss.set_ylabel("loss on the training frames (lower is better)", color=MUTED)
ax_loss.text(3.6, 0.02, "whole model\nadjusts from here", color=MUTED, fontsize=9, va="bottom")

ax_f1.set_title("Tuning-dive score each pass; test score of the kept pass", loc="left", color=INK, fontsize=12)
ax_f1.set_xlabel("pass", color=MUTED)
ax_f1.set_ylabel("average F1 over the five substrates (higher is better)", color=MUTED)
ax_f1.set_xlim(0.5, 16)
ax_f1.text(3.6, 0.722, "whole model\nadjusts from here", color=MUTED, fontsize=9, va="bottom")
# One legend for both panels, below them, so it covers no data.
handles, labels = ax_f1.get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=2, frameon=False, labelcolor=INK, fontsize=10,
           bbox_to_anchor=(0.5, 0.045))
for ax in (ax_loss, ax_f1):
    ax.set_xticks(passes)

fig.text(0.01, 0.01, "Each thin line is one seed. Circle: the pass the trainer kept (best tuning score). "
         "Diamond: that model's score on the test dives, never used for any choice. Dashed: the five seeds averaged.",
         color=MUTED, fontsize=9)
fig.tight_layout(rect=(0, 0.13, 1, 1))
out = os.path.join(HERE, "sheets", "training-curves.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
fig.savefig(out, dpi=120, facecolor=SURFACE)
print(out)
