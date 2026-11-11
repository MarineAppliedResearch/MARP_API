# Overnight: the habitat crop, five seeds

Written by `overnight_habitat.py`. Average F1 over Rock, Mud, Sand, Cobble, Boulder.

## Each seed on the test frames

| Seed | Test F1 |
| --- | --- |
| 1 | 0.728 |
| 2 | 0.738 |
| 3 | 0.732 |
| 4 | 0.734 |
| 5 | 0.721 |

## Five seeds averaged, test frames (all three years)

| Crop | Test F1 | Every substrate right | Rock | Mud | Sand | Cobble | Boulder | By year |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| habitat | 0.737 | 0.605 | 0.94 | 0.66 | 0.83 | 0.66 | 0.59 | {'CAMPA 2024': 0.729, 'CAMPA 2026': 0.725, 'CAMPA-2025': 0.665} |
| full | 0.755 | 0.630 | 0.95 | 0.65 | 0.85 | 0.70 | 0.63 | {'CAMPA 2024': 0.72, 'CAMPA 2026': 0.765, 'CAMPA-2025': 0.671} |

## Five seeds averaged, 8 sample lines as habitat records (run 3's rules)

Mud's extra cut-off is chosen by the tuning lines; the test mean beside it is not used to choose.

| Crop | Mud raise | Tuning mean | Test mean | Test lines |
| --- | --- | --- | --- | --- |
| habitat | +0.0 | 0.765 | 0.654 | CAMPA-2025 dive 23 line 2180: 0.64, CAMPA 2026 dive 13 line 2100: 0.62, CAMPA 2024 dive 12 line 600: 0.66, CAMPA-2025 dive 14 line 1890: 0.47, CAMPA 2026 dive 29 line 570: 0.88 |
| habitat | +0.1 | 0.760 | 0.654 | CAMPA-2025 dive 23 line 2180: 0.63, CAMPA 2026 dive 13 line 2100: 0.62, CAMPA 2024 dive 12 line 600: 0.66, CAMPA-2025 dive 14 line 1890: 0.47, CAMPA 2026 dive 29 line 570: 0.88 |
| habitat | +0.2 | 0.811 | 0.684 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.62, CAMPA 2024 dive 12 line 600: 0.66, CAMPA-2025 dive 14 line 1890: 0.47, CAMPA 2026 dive 29 line 570: 0.88 |
| habitat | +0.3 | 0.808 | 0.687 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.62, CAMPA 2024 dive 12 line 600: 0.67, CAMPA-2025 dive 14 line 1890: 0.47, CAMPA 2026 dive 29 line 570: 0.88 |
| habitat | +0.4 | 0.802 | 0.687 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.62, CAMPA 2024 dive 12 line 600: 0.67, CAMPA-2025 dive 14 line 1890: 0.47, CAMPA 2026 dive 29 line 570: 0.88 |
| full | +0.0 | 0.814 | 0.665 | CAMPA-2025 dive 23 line 2180: 0.64, CAMPA 2026 dive 13 line 2100: 0.61, CAMPA 2024 dive 12 line 600: 0.59, CAMPA-2025 dive 14 line 1890: 0.54, CAMPA 2026 dive 29 line 570: 0.95 |
| full | +0.1 | 0.817 | 0.696 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.61, CAMPA 2024 dive 12 line 600: 0.60, CAMPA-2025 dive 14 line 1890: 0.54, CAMPA 2026 dive 29 line 570: 0.95 |
| full | +0.2 | 0.867 | 0.699 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.61, CAMPA 2024 dive 12 line 600: 0.61, CAMPA-2025 dive 14 line 1890: 0.54, CAMPA 2026 dive 29 line 570: 0.95 |
| full | +0.3 | 0.865 | 0.701 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.61, CAMPA 2024 dive 12 line 600: 0.62, CAMPA-2025 dive 14 line 1890: 0.55, CAMPA 2026 dive 29 line 570: 0.95 |
| full | +0.4 | 0.858 | 0.701 | CAMPA-2025 dive 23 line 2180: 0.78, CAMPA 2026 dive 13 line 2100: 0.61, CAMPA 2024 dive 12 line 600: 0.60, CAMPA-2025 dive 14 line 1890: 0.56, CAMPA 2026 dive 29 line 570: 0.95 |

**full, chosen on the tuning lines:** Mud +0.2, test mean 0.699.

**habitat, chosen on the tuning lines:** Mud +0.2, test mean 0.684.
