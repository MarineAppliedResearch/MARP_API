# Feasibility test, step 3: can a fine-tuned image model tell the CAMPA substrates apart?
# One yes/no output per substrate (mixed substrate is the norm), ImageNet ResNet-50,
# BenthicNet's recipe: train the last layer on a frozen backbone, then unfreeze everything
# at a tenth of the learning rate. Scored on dives it never saw.
#
# Run with the worker's interpreter, from this folder:
#   ..\..\..\..\marp-inference-worker\.venv312\Scripts\python.exe -I train.py
import csv
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

HERE = os.path.dirname(os.path.abspath(__file__))
CLASSES = ["Rock", "Mud", "Sand", "Cobble", "Boulder"]
# The ROV's overlay (heading, depth, date, clock) is burned into the top of every frame.
# Left in, the model could learn which dive a frame is from instead of what the seabed is.
OVERLAY_ROWS = 0.25
HEAD_EPOCHS, FULL_EPOCHS = 3, 6  # validation peaked by epoch 2-4 for ResNet-50


ARCH = sys.argv[1] if len(sys.argv) > 1 else "resnet50"
DATA = sys.argv[2] if len(sys.argv) > 2 else "dataset.csv"
# "full": everything below the overlay. "bottom_middle": the seabed patch in front of the
# ROV, away from the dark edges and the water column at the top.
CROP = sys.argv[3] if len(sys.argv) > 3 else "full"
CROPS = {"full": (0.0, OVERLAY_ROWS, 1.0, 1.0), "bottom_middle": (0.2, 0.45, 0.8, 1.0)}
# Input size. 224 shrinks a full frame's detail away; larger needs a smaller batch to fit 8 GB.
SIZE = int(sys.argv[4]) if len(sys.argv) > 4 else 224
BATCH = 64 if SIZE <= 224 else 24
RUN = ARCH if (DATA, CROP) == ("dataset.csv", "full") else f"{ARCH}-{os.path.splitext(DATA)[0]}-{CROP}"
RUN += "" if SIZE == 224 else f"-{SIZE}"


def build(arch):
    # Every backbone here ships with torchvision; weights come from download.pytorch.org.
    if arch == "resnet50":
        m = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
        m.fc = nn.Linear(m.fc.in_features, len(CLASSES))
        return m, m.fc
    if arch == "convnext_tiny":
        m = models.convnext_tiny(weights=models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1)
        m.classifier[2] = nn.Linear(m.classifier[2].in_features, len(CLASSES))
        return m, m.classifier[2]
    if arch == "vit_b16_swag":
        # Pretrained weakly supervised on ~3.6B Instagram images, then ImageNet.
        m = models.vit_b_16(weights=models.ViT_B_16_Weights.IMAGENET1K_SWAG_LINEAR_V1)
        m.heads.head = nn.Linear(m.heads.head.in_features, len(CLASSES))
        return m, m.heads.head
    raise SystemExit(f"unknown arch {arch}")


def read_rows():
    with open(os.path.join(HERE, DATA), newline="") as f:
        return list(csv.DictReader(f))


class Frames(Dataset):
    def __init__(self, rows, train):
        self.rows = rows
        aug = [transforms.RandomHorizontalFlip(), transforms.ColorJitter(0.2, 0.2, 0.1)] if train else []
        self.tf = transforms.Compose([
            transforms.Resize((SIZE, SIZE)),
            *aug,
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        img = Image.open(os.path.join(HERE, r["image"]))
        # Decode a 1080p frame at half size: still well over SIZE after any crop, and
        # it keeps the loaders from starving the GPU. A thumbnail is left alone.
        if img.width > 1000:
            img.draft("RGB", (img.width // 2, img.height // 2))
        img = img.convert("RGB")
        w, h = img.size
        x0, y0, x1, y1 = CROPS[CROP]
        img = img.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
        y = torch.tensor([float(r[c]) for c in CLASSES])
        return self.tf(img), y


def predict(model, loader, device):
    model.eval()
    out, ys = [], []
    with torch.no_grad(), torch.autocast(device.type, dtype=torch.float16):
        for x, y in loader:
            out.append(torch.sigmoid(model(x.to(device))).float().cpu())
            ys.append(y)
    return torch.cat(out).numpy(), torch.cat(ys).numpy()


def f1_at(p, y, t):
    pred = p >= t
    tp = (pred & (y == 1)).sum()
    prec = tp / max(pred.sum(), 1)
    rec = tp / max((y == 1).sum(), 1)
    return (2 * prec * rec / (prec + rec)) if prec + rec else 0.0, prec, rec


def best_thresholds(p, y):
    # The cut-off per substrate that gives the best F1 on the tuning dives.
    grid = np.linspace(0.05, 0.95, 19)
    return [float(grid[np.argmax([f1_at(p[:, c], y[:, c], t)[0] for t in grid])]) for c in range(len(CLASSES))]


def scores(p, y, thresholds):
    per = {}
    for c, name in enumerate(CLASSES):
        f1, prec, rec = f1_at(p[:, c], y[:, c], thresholds[c])
        prevalence = float(y[:, c].mean())
        # Trivial baseline: say "present" on every frame.
        base = 2 * prevalence / (1 + prevalence) if prevalence else 0.0
        per[name] = {"f1": round(float(f1), 3), "precision": round(float(prec), 3), "recall": round(float(rec), 3),
                     "frames_present": int(y[:, c].sum()), "always_present_f1": round(base, 3)}
    per["macro_f1"] = round(float(np.mean([per[n]["f1"] for n in CLASSES])), 3)
    per["macro_always_present_f1"] = round(float(np.mean([per[n]["always_present_f1"] for n in CLASSES])), 3)
    # Exact match: every substrate right on the frame.
    pred = np.stack([p[:, c] >= thresholds[c] for c in range(len(CLASSES))], 1)
    per["all_substrates_right"] = round(float((pred == (y == 1)).all(1).mean()), 3)
    return per


def run_epochs(model, params, lr, epochs, train_dl, val_dl, pos_weight, device, label, log):
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    scaler = torch.amp.GradScaler()
    best = (-1, None, None)
    for epoch in range(epochs):
        model.train()
        t0, total = time.time(), 0.0
        for x, y in train_dl:
            opt.zero_grad()
            with torch.autocast(device.type, dtype=torch.float16):
                loss = loss_fn(model(x.to(device)), y.to(device))
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            total += loss.item() * len(x)
        sched.step()
        p, y = predict(model, val_dl, device)
        th = best_thresholds(p, y)
        s = scores(p, y, th)
        log(f"{label} epoch {epoch + 1}/{epochs}: loss {total / len(train_dl.dataset):.4f}, "
            f"val macro F1 {s['macro_f1']} ({time.time() - t0:.0f}s)")
        if s["macro_f1"] > best[0]:
            best = (s["macro_f1"], {k: v.detach().clone() for k, v in model.state_dict().items()}, th)
    model.load_state_dict(best[1])
    return best[2]


def main():
    torch.manual_seed(287)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    rows = read_rows()
    split = {s: [r for r in rows if r["split"] == s] for s in ("train", "val", "test")}
    loader = lambda rs, train: DataLoader(Frames(rs, train), batch_size=BATCH, shuffle=train,
                                          num_workers=4, persistent_workers=True, pin_memory=True)
    train_dl, val_dl, test_dl = loader(split["train"], True), loader(split["val"], False), loader(split["test"], False)

    # Weight each substrate's positives by how rare it is, so Rock does not swamp Boulder.
    y = np.array([[float(r[c]) for c in CLASSES] for r in split["train"]])
    pos_weight = torch.tensor((len(y) - y.sum(0)) / y.sum(0), dtype=torch.float32)

    os.makedirs(os.path.join(HERE, "runs"), exist_ok=True)
    log_path = os.path.join(HERE, "runs", f"{RUN}.log")
    log_file = open(log_path, "w")

    def log(msg):
        print(msg, flush=True)
        log_file.write(msg + "\n")
        log_file.flush()

    log(f"device {torch.cuda.get_device_name(0) if device.type == 'cuda' else 'cpu'}; "
        + ", ".join(f"{k} {len(v)} frames" for k, v in split.items()))

    model, head = build(ARCH)
    model.to(device)
    results = {"settings": {"arch": ARCH, "data": DATA, "crop": CROP, "overlay_rows_removed": OVERLAY_ROWS, "size": SIZE, "head_epochs": HEAD_EPOCHS,
                            "full_epochs": FULL_EPOCHS, "frames": {k: len(v) for k, v in split.items()}}}

    # Stage 1: frozen backbone, last layer only. This is also the "frozen features" result.
    for p_ in model.parameters():
        p_.requires_grad = False
    for p_ in head.parameters():
        p_.requires_grad = True
    th = run_epochs(model, head.parameters(), 1e-3, HEAD_EPOCHS, train_dl, val_dl, pos_weight, device, "frozen", log)
    p, yt = predict(model, test_dl, device)
    results["frozen_test"] = scores(p, yt, th)
    log(f"frozen backbone, test: macro F1 {results['frozen_test']['macro_f1']}")

    # Stage 2: unfreeze everything at a tenth of the learning rate.
    for p_ in model.parameters():
        p_.requires_grad = True
    th = run_epochs(model, model.parameters(), 1e-4, FULL_EPOCHS, train_dl, val_dl, pos_weight, device, "fine-tune", log)
    p, yt = predict(model, test_dl, device)
    results["finetuned_test"] = scores(p, yt, th)
    results["thresholds"] = dict(zip(CLASSES, th))

    # The same scores per CAMPA year, so one weak year is visible.
    by_project = {}
    for proj in sorted({r["project"] for r in split["test"]}):
        idx = [i for i, r in enumerate(split["test"]) if r["project"] == proj]
        by_project[proj] = scores(p[idx], yt[idx], th)
    results["finetuned_test_by_project"] = by_project
    np.save(os.path.join(HERE, "runs", f"{RUN}_test_scores.npy"), p)
    torch.save(model.state_dict(), os.path.join(HERE, "runs", f"{RUN}.pt"))
    with open(os.path.join(HERE, "runs", f"{RUN}_results.json"), "w") as f:
        json.dump(results, f, indent=2)
    log(f"fine-tuned, test: macro F1 {results['finetuned_test']['macro_f1']}")
    log(json.dumps(results["finetuned_test"], indent=2))


if __name__ == "__main__":
    main()
