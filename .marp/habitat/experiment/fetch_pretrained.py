# Pretrained starting points for train.py that torchvision does not ship: seabed-trained
# BenthicNet, and DINOv2. Downloads each from Hugging Face at a pinned revision, checks it
# against the published checksum, and prints where it is. Safe to run twice.
#
# They live outside every checkout, so any working copy or agent workspace on this machine
# shares one copy: MARP_PRETRAINED_DIR if set, else the per-user MARP data folder.
#   python -I fetch_pretrained.py          download what is missing, print the folder
import hashlib
import os
import sys
import urllib.request

MODELS = {
    # Barlow Twins ResNet-50 on ~1.3M seafloor images (BenthicNet, Lowe et al. 2025).
    "benthicnet_rn50": ("MLIsaac/benthicnet_bt_rn50_e600_prod", "9cb475dce8bebf2aa8060f4849e782e1447f8b0b",
                        "bt-600e-prod_rn50_epoch=599.ckpt",
                        "da263ddf54815717588d09c568b173eff0ce5464d5d28ae0d399a81a768758f2"),
    # MoCo v3 ViT-S/16 on the same images.
    "benthicnet_vits": ("MLIsaac/benthicnet_mcv3_vit-s_e200_prod", "741483472e22fb9e9e22b7ed76af35a92455418c",
                        "mocov3-200e-prod_vit-s_epoch=199.ckpt",
                        "9d638588897d4b4dc9a512bf987d3879795cb107e306959d2933cef7d487334b"),
    # DINOv2 ViT-B/14, self-supervised on 142M general images; timm's packaging.
    "dinov2_vitb": ("timm/vit_base_patch14_dinov2.lvd142m", "4685c99dabffe5affac90bd99dbffd25801ae58d",
                    "model.safetensors",
                    "55cbb5d887b336d430e649c277b85a1429e724871f9d02ac16203235886d8c7b"),
}


def folder():
    if os.environ.get("MARP_PRETRAINED_DIR"):
        return os.environ["MARP_PRETRAINED_DIR"]
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "MARP", "pretrained")


def path(name):
    """Where train.py finds a model's downloaded file."""
    repo, rev, file, sha = MODELS[name]
    return os.path.join(folder(), name, file)


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(name):
    repo, rev, file, want = MODELS[name]
    out = path(name)
    if os.path.exists(out):
        return out
    # Each model in its own folder; a partial download never takes the real name.
    os.makedirs(os.path.dirname(out), exist_ok=True)
    url = f"https://huggingface.co/{repo}/resolve/{rev}/{file}"
    print(f"{name}: downloading {url}", flush=True)
    with urllib.request.urlopen(url) as r, open(out + ".part", "wb") as f:
        while block := r.read(1 << 22):
            f.write(block)
    got = sha256(out + ".part")
    if got != want:
        os.remove(out + ".part")
        raise SystemExit(f"{name}: checksum {got} is not the published {want}; deleted")
    os.replace(out + ".part", out)
    return out


# Left beside the files, so whoever finds the folder knows what is in it without this script.
README = """# Pretrained weights

Starting points for image models, downloaded by `fetch_pretrained.py` in MARP_API's
`.marp/habitat/experiment/` (branch `287-habitat-classification`, MarineAppliedResearch/MARP_API#287).
Shared by every checkout on this machine. Do not edit or move them; run that script again on a
new machine, or to replace a deleted file. It checks every download against its published checksum.

| Folder | What it is | Source | Licence |
| --- | --- | --- | --- |
| `benthicnet_rn50` | ResNet-50 trained with Barlow Twins on ~1.3M seafloor images (BenthicNet). No labels. | huggingface.co/MLIsaac/benthicnet_bt_rn50_e600_prod | BSD-3-Clause |
| `benthicnet_vits` | ViT-S/16 trained with MoCo v3 on the same images. No labels. | huggingface.co/MLIsaac/benthicnet_mcv3_vit-s_e200_prod | BSD-3-Clause |
| `dinov2_vitb` | DINOv2 ViT-B/14, self-supervised on 142M general images, packaged for timm. | huggingface.co/timm/vit_base_patch14_dinov2.lvd142m | Apache-2.0 |

## Loading them

- **BenthicNet** files are PyTorch Lightning training checkpoints. They load with
  `torch.load(path, weights_only=True)`. The encoder is `state_dict` entries starting
  `backbone.`; strip that prefix. Everything else (projector, predictor, momentum copies,
  optimiser state) is training-only and can be ignored.
  - `benthicnet_rn50`: the stripped entries load into torchvision `models.resnet50(weights=None)`;
    only `fc` is missing.
  - `benthicnet_vits`: they load into timm `vit_small_patch16_224`; only `head` is missing.
    It was trained at 224 px, so resize `pos_embed` with `timm.layers.resample_abs_pos_embed`
    for any other input size.
- **DINOv2**: `timm.create_model("vit_base_patch14_dinov2.lvd142m", pretrained=True,
  pretrained_cfg_overlay={"file": path})`. Patches are 14 px; for a size that is not a
  multiple of 14, pass `dynamic_img_pad=True, dynamic_img_size=True`.
- All three expect ImageNet normalisation (mean 0.485/0.456/0.406, std 0.229/0.224/0.225).

`train.py` beside `fetch_pretrained.py` does all of this; its `build()` is a working example.
"""


if __name__ == "__main__":
    for name in (sys.argv[1:] or MODELS):
        print(f"{name}: {fetch(name)}")
    with open(os.path.join(folder(), "README.md"), "w", encoding="utf-8") as f:
        f.write(README)
    print(f"all in {folder()}")
