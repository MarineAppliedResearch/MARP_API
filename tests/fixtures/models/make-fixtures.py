"""
Writes the tiny model checkpoints the #321 tests read.

A real Ultralytics checkpoint is megabytes, so these are written by `torch.save` exactly as
a real one is -- the same zip, the same pickle protocol -- around stand-in classes named
as Ultralytics names them. What MARP reads (the model class, `names`, `yaml`) is real; the
weights are not, and nothing reads them.

Run from this directory with any Python that has torch:
    python make-fixtures.py
"""

import sys
import types

import torch

# Stand-in classes under the module path Ultralytics pickles its models from.
tasks = types.ModuleType("ultralytics.nn.tasks")
sys.modules["ultralytics"] = types.ModuleType("ultralytics")
sys.modules["ultralytics.nn"] = types.ModuleType("ultralytics.nn")
sys.modules["ultralytics.nn.tasks"] = tasks


class DetectionModel:
    pass


class ClassificationModel:
    pass


for cls in (DetectionModel, ClassificationModel):
    cls.__module__ = "ultralytics.nn.tasks"
    setattr(tasks, cls.__name__, cls)


def save(path, cls, names, yaml):
    model = cls()
    model.names = names
    model.yaml = yaml
    model.weight = torch.zeros(4)
    torch.save({"model": model, "ema": None, "epoch": -1, "date": "2026-10-31"}, path)


# A detector whose YAML names its file, as a model built by YOLO11 does.
save("tiny-detector.pt", DetectionModel, {0: "jest-321 urchin", 1: "jest-321 not a species"},
     {"yaml_file": "yolo11n.yaml", "nc": 2, "scale": "n"})

# A classifier from an older Ultralytics, whose YAML carries contents and no file name:
# recognised by its C2f blocks and its depth and width multiples (YOLOv8 m).
save("tiny-classifier.pt", ClassificationModel, {0: "jest-321 urchin"},
     {"nc": 1, "depth_multiple": 0.67, "width_multiple": 0.75,
      "backbone": [[-1, 1, "Conv", [64, 3, 2]], [-1, 3, "C2f", [128, True]]],
      "head": [[-1, 1, "Classify", [1]]]})

print("wrote tiny-detector.pt and tiny-classifier.pt")
