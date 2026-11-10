# Overnight DINOv2 runs

Written by `overnight.py` after every run. Average F1 over Rock, Mud, Sand, Cobble, Boulder.

## Part 1: settings, at 384 px on the data behind the 0.707 run

Chosen by the tuning dives. Test scores are shown but were not used to choose.

| Settings | Best tuning F1 | Test F1 | Every substrate right |
| --- | --- | --- | --- |
| baseline | 0.797 | 0.707 | 0.600 |
| longer, warm-up | 0.797 | 0.664 | 0.508 |
| layer-wise speeds | 0.810 | 0.681 | 0.555 |
| stronger variation | 0.792 | 0.698 | 0.571 |
| stochastic depth + averaging | 0.800 | 0.705 | 0.583 |
| all of them | 0.802 | 0.714 | 0.566 |

Winner: **layer-wise speeds (3e-5 llrd=0.75 warmup=1 epochs=10), tuning F1 0.810**.

## Part 2: the winner at 518 px on the full dataset, one run per seed

Tuning and test dives now include CAMPA 2026, so these do not compare with Part 1.

| Seed | Test F1 | Every substrate right | Rock | Mud | Sand | Cobble | Boulder | By year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.751 | 0.630 | 0.95 | 0.65 | 0.83 | 0.70 | 0.62 | {'CAMPA 2024': 0.742, 'CAMPA 2026': 0.756, 'CAMPA-2025': 0.657} |
| 2 | 0.755 | 0.647 | 0.95 | 0.64 | 0.83 | 0.72 | 0.63 | {'CAMPA 2024': 0.733, 'CAMPA 2026': 0.766, 'CAMPA-2025': 0.655} |
| 3 | 0.753 | 0.633 | 0.95 | 0.65 | 0.84 | 0.69 | 0.63 | {'CAMPA 2024': 0.709, 'CAMPA 2026': 0.755, 'CAMPA-2025': 0.659} |
| 4 | 0.737 | 0.603 | 0.94 | 0.63 | 0.85 | 0.69 | 0.58 | {'CAMPA 2024': 0.702, 'CAMPA 2026': 0.744, 'CAMPA-2025': 0.661} |
| 5 | 0.733 | 0.602 | 0.94 | 0.63 | 0.84 | 0.68 | 0.57 | {'CAMPA 2024': 0.707, 'CAMPA 2026': 0.736, 'CAMPA-2025': 0.651} |

## The seeds averaged into one model

| Models | Test F1 | Every substrate right | Rock | Mud | Sand | Cobble | Boulder | By year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.751 | 0.630 | 0.95 | 0.65 | 0.83 | 0.70 | 0.62 | {'CAMPA 2024': 0.742, 'CAMPA 2026': 0.756, 'CAMPA-2025': 0.657} |
| 2 | 0.764 | 0.652 | 0.95 | 0.68 | 0.85 | 0.70 | 0.64 | {'CAMPA 2024': 0.74, 'CAMPA 2026': 0.774, 'CAMPA-2025': 0.675} |
| 3 | 0.763 | 0.641 | 0.95 | 0.66 | 0.85 | 0.70 | 0.65 | {'CAMPA 2024': 0.726, 'CAMPA 2026': 0.77, 'CAMPA-2025': 0.676} |
| 4 | 0.761 | 0.638 | 0.95 | 0.66 | 0.85 | 0.70 | 0.65 | {'CAMPA 2024': 0.729, 'CAMPA 2026': 0.768, 'CAMPA-2025': 0.671} |
| 5 | 0.755 | 0.630 | 0.95 | 0.65 | 0.85 | 0.70 | 0.63 | {'CAMPA 2024': 0.72, 'CAMPA 2026': 0.765, 'CAMPA-2025': 0.671} |
