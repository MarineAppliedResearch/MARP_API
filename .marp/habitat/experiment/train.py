# Feasibility test, step 3: can a fine-tuned image model tell the CAMPA substrates apart?
# One yes/no output per substrate (mixed substrate is the norm), ImageNet ResNet-50,
# BenthicNet's recipe: train the last layer on a frozen backbone, then unfreeze everything
# at a tenth of the learning rate. Scored on dives it never saw.
#
# Run with the worker's interpreter, from this folder:
#   ..\..\..\..\marp-inference-worker\.venv312\Scripts\python.exe -I train.py
import csv
import json
import math
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


# Settings beyond the positional five come as key=value, and each one given is added to the
# run's name so two runs never share a file: train.py dinov2_vitb data.csv full 384 1e-5 llrd=0.75
OPTS = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
sys.argv = [a for a in sys.argv if "=" not in a]
ARCH = sys.argv[1] if len(sys.argv) > 1 else "resnet50"
DATA = sys.argv[2] if len(sys.argv) > 2 else "dataset.csv"
# "full": everything below the overlay. "bottom_middle": the seabed patch in front of the
# ROV, away from the dark edges and the water column at the top.
CROP = sys.argv[3] if len(sys.argv) > 3 else "full"
# "habitat": the bottom half, middle half of the width -- the patch of seabed a habitat call
# is made on (Isaac, 2026-11-10). Mosaic keyframes and the dataset viewer use the same box.
CROPS = {"full": (0.0, OVERLAY_ROWS, 1.0, 1.0), "bottom_middle": (0.2, 0.45, 0.8, 1.0),
         "habitat": (0.25, 0.5, 0.75, 1.0)}
# Input size. 224 shrinks a full frame's detail away; larger needs a smaller batch to fit 8 GB.
SIZE = int(sys.argv[4]) if len(sys.argv) > 4 else 224
BATCH = int(OPTS.get("batch", 64 if SIZE <= 224 else 24))
RUN = ARCH if (DATA, CROP) == ("dataset.csv", "full") else f"{ARCH}-{os.path.splitext(DATA)[0]}-{CROP}"
RUN += "" if SIZE == 224 else f"-{SIZE}"
# How fast the whole model adjusts once unfrozen. A tenth of the head's suits ConvNeXt;
# DINOv2's ViT lost what it knew at that speed, so it is a setting.
FULL_LR = float(sys.argv[5]) if len(sys.argv) > 5 else 1e-4
RUN += "" if len(sys.argv) <= 5 else f"-lr{sys.argv[5]}"
RUN += "".join(f"-{k}{v}" for k, v in OPTS.items())
FULL_EPOCHS = int(OPTS.get("epochs", FULL_EPOCHS))
HEAD_EPOCHS = int(OPTS.get("head_epochs", HEAD_EPOCHS))
SEED = int(OPTS.get("seed", 287))
# Warm-up passes, then a cosine slow-down stepped every batch; 0 keeps the original per-pass cosine.
WARMUP = float(OPTS.get("warmup", 0))
# Layer-wise speeds for a ViT: each block deeper than the top adjusts this much slower (MAE's recipe).
LLRD = float(OPTS.get("llrd", 1.0))
# Stochastic depth: randomly skip ViT blocks while training, so no one path is memorised.
DROP_PATH = float(OPTS.get("drop_path", 0.0))
# Score and keep a running average of the weights instead of the latest ones.
EMA = float(OPTS.get("ema", 0.0))
# "strong": random zoomed crops, a slight tilt and more colour change on top of the default flips.
AUG = OPTS.get("aug", "default")


def backbone(name):
    """The encoder weights from a BenthicNet training checkpoint, without its training-only parts."""
    sys.path.insert(0, HERE)  # -I leaves this folder off the path
    import fetch_pretrained
    path = fetch_pretrained.path(name)
    if not os.path.exists(path):
        raise SystemExit(f"{name} is not downloaded: python -I fetch_pretrained.py {name}")
    state = torch.load(path, map_location="cpu", weights_only=True)["state_dict"]
    return {k[len("backbone."):]: v for k, v in state.items() if k.startswith("backbone.")}


def load(m, state, name):
    # Only the new head may be missing; anything else means the checkpoint did not fit.
    missing, unexpected = m.load_state_dict(state, strict=False)
    missing = [k for k in missing if not k.startswith(("fc.", "head."))]
    if missing or unexpected:
        raise SystemExit(f"{name} does not fit: missing {missing[:5]}, unexpected {unexpected[:5]}")


def build(arch):
    # The torchvision backbones' weights come from download.pytorch.org; the others are
    # fetched by fetch_pretrained.py.
    if arch == "benthicnet_rn50":
        m = models.resnet50(weights=None)
        load(m, backbone(arch), arch)
        m.fc = nn.Linear(m.fc.in_features, len(CLASSES))
        return m, m.fc
    if arch in ("benthicnet_vits", "dinov2_vitb"):
        import timm
        from timm.layers import resample_abs_pos_embed
        if arch == "benthicnet_vits":
            m = timm.create_model("vit_small_patch16_224", pretrained=False, num_classes=len(CLASSES), img_size=SIZE)
            state = backbone(arch)
            # Trained at 224 px: stretch its position grid to this input size.
            state["pos_embed"] = resample_abs_pos_embed(state["pos_embed"], m.patch_embed.grid_size, num_prefix_tokens=1)
            load(m, state, arch)
        else:
            sys.path.insert(0, HERE)
            import fetch_pretrained
            # Patches are 14 px, so the input is padded up to a whole number of them and the
            # position grid is fitted to the padded size.
            m = timm.create_model("vit_base_patch14_dinov2.lvd142m", pretrained=True, num_classes=len(CLASSES),
                                  img_size=SIZE, dynamic_img_pad=True, dynamic_img_size=True, drop_path_rate=DROP_PATH,
                                  pretrained_cfg_overlay={"file": fetch_pretrained.path(arch)})
        return m, m.head
    if arch == "convnext_small":
        m = models.convnext_small(weights=models.ConvNeXt_Small_Weights.IMAGENET1K_V1)
        m.classifier[2] = nn.Linear(m.classifier[2].in_features, len(CLASSES))
        return m, m.classifier[2]
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
        size = [transforms.Resize((SIZE, SIZE))]
        if train and AUG == "strong":
            # Crops keep a wide shape, as the frames are; the tilt stays small so up stays up.
            size = [transforms.RandomResizedCrop((SIZE, SIZE), scale=(0.5, 1.0), ratio=(1.5, 3.0))]
            aug = [transforms.RandomHorizontalFlip(), transforms.RandomRotation(5),
                   transforms.ColorJitter(0.3, 0.3, 0.2, 0.02)]
        self.tf = transforms.Compose([
            *size,
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
        # Only when the cropped half-size frame is still taller than SIZE, or 518 px loses detail.
        if img.width > 1000 and img.height // 2 * (CROPS[CROP][3] - CROPS[CROP][1]) >= SIZE:
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


def layer_groups(model):
    """The whole model's parameters, in groups with their own speed when LLRD is set."""
    if LLRD == 1.0:
        return model.parameters()
    if not hasattr(model, "blocks"):
        raise SystemExit("llrd needs a ViT")
    top = len(model.blocks) + 1
    depth = lambda n: (int(n.split(".")[1]) + 1 if n.startswith("blocks.")
                       else 0 if n.startswith(("patch_embed", "cls_token", "pos_embed", "reg_token")) else top)
    groups = {}
    for n, p_ in model.named_parameters():
        groups.setdefault(depth(n), []).append(p_)
    # Each group starts at its own speed; the schedule then scales them all alike.
    return [{"params": ps, "lr": FULL_LR * LLRD ** (top - d)} for d, ps in sorted(groups.items())]


def run_epochs(model, params, lr, epochs, train_dl, val_dl, pos_weight, device, label, log, start=(-1, None, None)):
    # Returns the best (score, weights, thresholds) seen, `start` included: a stage that
    # never beats the one before it leaves the model as that one left it.
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=1e-4)
    steps, warm = epochs * len(train_dl), WARMUP * len(train_dl)
    per_batch = WARMUP > 0 and label == "fine-tune"
    if per_batch:
        def factor(i):
            if i < warm:
                return (i + 1) / warm
            return 0.5 * (1 + math.cos(math.pi * (i - warm) / max(steps - warm, 1)))
        sched = torch.optim.lr_scheduler.LambdaLR(opt, factor)
    else:
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, epochs)
    avg = None
    if EMA and label == "fine-tune":
        from torch.optim.swa_utils import AveragedModel, get_ema_multi_avg_fn
        avg = AveragedModel(model, multi_avg_fn=get_ema_multi_avg_fn(EMA), use_buffers=True)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    scaler = torch.amp.GradScaler()
    best = start
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
            if per_batch:
                sched.step()
            if avg is not None:
                avg.update_parameters(model)
            total += loss.item() * len(x)
        if not per_batch:
            sched.step()
        scored = model if avg is None else avg.module
        p, y = predict(scored, val_dl, device)
        th = best_thresholds(p, y)
        s = scores(p, y, th)
        log(f"{label} epoch {epoch + 1}/{epochs}: loss {total / len(train_dl.dataset):.4f}, "
            f"val macro F1 {s['macro_f1']} ({time.time() - t0:.0f}s)")
        if s["macro_f1"] > best[0]:
            best = (s["macro_f1"], {k: v.detach().clone() for k, v in scored.state_dict().items()}, th)
    model.load_state_dict(best[1])
    return best


def main():
    torch.manual_seed(SEED)
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
                            "full_epochs": FULL_EPOCHS, "full_lr": FULL_LR, "options": OPTS, "frames": {k: len(v) for k, v in split.items()}}}

    # Stage 1: frozen backbone, last layer only. This is also the "frozen features" result.
    for p_ in model.parameters():
        p_.requires_grad = False
    for p_ in head.parameters():
        p_.requires_grad = True
    frozen = run_epochs(model, head.parameters(), 1e-3, HEAD_EPOCHS, train_dl, val_dl, pos_weight, device, "frozen", log)
    th = frozen[2]
    p, yt = predict(model, test_dl, device)
    results["frozen_test"] = scores(p, yt, th)
    log(f"frozen backbone, test: macro F1 {results['frozen_test']['macro_f1']}")

    # Stage 2: unfreeze everything, more slowly (FULL_LR).
    for p_ in model.parameters():
        p_.requires_grad = True
    best = run_epochs(model, layer_groups(model), FULL_LR, FULL_EPOCHS, train_dl, val_dl, pos_weight, device, "fine-tune", log,
                      start=frozen)
    results["best_val_macro_f1"] = best[0]
    th = best[2]
    results["kept"] = "frozen" if best is frozen else "fine-tuned"
    if best is frozen:
        log("fine-tuning never beat the frozen backbone on the tuning dives; kept the frozen one")
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
    # The tuning dives' answers too, so models can be averaged with cut-offs picked on them.
    np.save(os.path.join(HERE, "runs", f"{RUN}_val_scores.npy"), predict(model, val_dl, device)[0])
    torch.save(model.state_dict(), os.path.join(HERE, "runs", f"{RUN}.pt"))
    with open(os.path.join(HERE, "runs", f"{RUN}_results.json"), "w") as f:
        json.dump(results, f, indent=2)
    log(f"fine-tuned, test: macro F1 {results['finetuned_test']['macro_f1']}")
    if device.type == "cuda":
        log(f"peak GPU memory {torch.cuda.max_memory_allocated() / 2**30:.1f} GB")
    log(json.dumps(results["finetuned_test"], indent=2))


if __name__ == "__main__":
    main()
