# Contact sheets: 24 random frames per single-substrate label, to judge the labels by eye.
import csv, os, random
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
rows = list(csv.DictReader(open(os.path.join(HERE, "dataset_v2.csv"))))
os.makedirs(os.path.join(HERE, "sheets"), exist_ok=True)
random.seed(287)
for c in CLASSES:
    only = [r for r in rows if r[c] == "1" and sum(int(r[k]) for k in CLASSES) == 1]
    pick = random.sample(only, min(24, len(only)))
    sheet = Image.new("RGB", (6 * 320, 4 * 180))
    for i, r in enumerate(pick):
        im = Image.open(os.path.join(HERE, r["image"]))
        sheet.paste(im, ((i % 6) * 320, (i // 6) * 180))
        ImageDraw.Draw(sheet).text(((i % 6) * 320 + 4, (i // 6) * 180 + 165), r["image"].split("/")[-1], fill=(255, 255, 0))
    sheet.save(os.path.join(HERE, "sheets", f"{c}-only.jpg"), quality=85)
    print(c, "only:", len(only))
