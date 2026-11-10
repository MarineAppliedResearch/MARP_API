# A sheet for a person to judge Mud against Sand by eye: the 2025 lines labelled Sand that
# the model calls Mud, a 2025 line labelled Mud that it agrees with, and a pure-Sand and a
# pure-Mud line from 2026 for reference. Under each frame: its label, and the final model's
# (five DINOv2 runs averaged) confidence that Mud and Sand are present, 0 to 1.
#   python -I mud_sand_sheet.py      -> sheets/mud-vs-sand-2025.jpg
import csv
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
RUNS = [f"dinov2_vitb-dataset_full-full-518-lr3e-5-llrd0.75-warmup1-epochs10-batch16-seed{i}" for i in range(1, 6)]
PER_ROW, W = 6, 400
OVERLAY_ROWS = 0.25

rows = list(csv.DictReader(open(os.path.join(HERE, "dataset_full.csv"))))
test = [r for r in rows if r["split"] == "test"]
p = np.mean([np.load(os.path.join(HERE, "runs", f"{n}_test_scores.npy")) for n in RUNS], 0)
score = {r["image"]: p[i] for i, r in enumerate(test)}
only = lambda r, c: r[c] == "1" and sum(r[k] == "1" for k in CLASSES) == 1


def line_with_most(project, c):
    # The test line with the most frames labelled only `c`, so the reference rows are not cherry-picked by eye.
    counts = {}
    for r in test:
        if r["project"] == project and only(r, c):
            counts[r["session"]] = counts.get(r["session"], 0) + 1
    return max(counts, key=counts.get)


SPEC = [
    ("3057", "Sand", "2025, dive 11, line 920: labelled Sand, model says Mud"),
    ("3138", "Sand", "2025, dive 14, line 1890: labelled Sand, model says Mud"),
    ("3088", "Mud", "2025, dive 14, line 2200: labelled Mud, model agrees"),
    (line_with_most("CAMPA 2026", "Sand"), "Sand", "2026 reference: the test line with the most pure-Sand frames"),
    (line_with_most("CAMPA 2026", "Mud"), "Mud", "2026 reference: the test line with the most pure-Mud frames"),
]

font = ImageFont.load_default(size=18)
title_h, caption_h = 30, 26
tile_h = round(W * 1080 * (1 - OVERLAY_ROWS) / 1920)
sheet = Image.new("RGB", (PER_ROW * W, len(SPEC) * (title_h + tile_h + caption_h)), "white")
draw = ImageDraw.Draw(sheet)
for k, (session, c, title) in enumerate(SPEC):
    pick = sorted((r for r in test if r["session"] == session and only(r, c)), key=lambda r: float(r["seconds_into_video"]))
    pick = [pick[round(i * (len(pick) - 1) / max(PER_ROW - 1, 1))] for i in range(min(PER_ROW, len(pick)))]
    y = k * (title_h + tile_h + caption_h)
    r0 = pick[0]
    draw.text((6, y + 5), f"{title}  ({r0['project']} dive {r0['dive']} line {r0['line']}, session {session})", fill="black", font=font)
    for j, r in enumerate(pick):
        im = Image.open(os.path.join(HERE, r["image"])).convert("RGB")
        im = im.crop((0, int(im.height * OVERLAY_ROWS), im.width, im.height)).resize((W, tile_h))
        sheet.paste(im, (j * W, y + title_h))
        s = score[r["image"]]
        draw.text((j * W + 6, y + title_h + tile_h + 3),
                  f"{int(float(r['seconds_into_video']) // 60)}:{int(float(r['seconds_into_video']) % 60):02d}  labelled {c}   model: Mud {s[1]:.2f}  Sand {s[2]:.2f}",
                  fill="black", font=font)
os.makedirs(os.path.join(HERE, "sheets"), exist_ok=True)
out = os.path.join(HERE, "sheets", "mud-vs-sand-2025.jpg")
sheet.save(out, quality=90)
print(out)
