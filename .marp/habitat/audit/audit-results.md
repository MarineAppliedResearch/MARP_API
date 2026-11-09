# Habitat audit

Run 2026-11-05T21:08:06.243Z against the local production copy.

Habitat observations: 42741. Usable intervals: 40709.

## Rows that cannot be used

| Problem | Rows |
| --- | --- |
| No substrate name | 1461 |
| No start (tc) | 0 |
| No end (etc) | 558 |
| End before start (dropped) | 13 |
| Zero length (kept) | 28 |
| Crosses midnight (fixed) | 9 |

## Substrate names in use (interval lengths in seconds)

| Name | Intervals | Total hours | Sessions | Projects | Shortest | 5th pct | Median | 95th pct | Longest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rock | 9383 | 198.0 | 885 | 18 | 0 | 2 | 21 | 324 | 4591 |
| Mud | 3557 | 120.5 | 457 | 17 | 0 | 3 | 19 | 908 | 4591 |
| Sand | 6387 | 120.2 | 536 | 18 | 0 | 2 | 15 | 282 | 3390 |
| TYPE 2 | 1634 | 86.6 | 226 | 7 | 0 | 9 | 76 | 803 | 2737 |
| Cobble | 7646 | 67.9 | 681 | 19 | 0 | 2 | 10 | 93 | 4050 |
| Boulder | 6207 | 32.1 | 519 | 17 | 1 | 2 | 9 | 57 | 1363 |
| Off Transect | 1208 | 18.3 | 347 | 16 | 2 | 4 | 16 | 216 | 2821 |
| TYPE 3 | 961 | 7.2 | 166 | 7 | 2 | 4 | 13 | 59 | 1931 |
| TYPE 1 | 594 | 5.7 | 134 | 8 | 0 | 5 | 18 | 110 | 727 |
| UI feather star | 786 | 4.4 | 47 | 3 | 0 | 1 | 9 | 64 | 1135 |
| Pull | 113 | 2.5 | 80 | 2 | 14 | 20 | 65 | 174 | 325 |
| Club-tipped anemone | 994 | 2.5 | 117 | 3 | 0 | 1 | 5 | 27 | 245 |
| Rubble 1 | 38 | 2.3 | 11 | 1 | 2 | 3 | 17 | 835 | 1169 |
| Stop | 77 | 2.1 | 52 | 3 | 8 | 9 | 31 | 217 | 1875 |
| TYPE 4 | 160 | 1.9 | 72 | 7 | 3 | 4 | 19 | 162 | 268 |
| Rubble 2 | 58 | 1.7 | 15 | 1 | 4 | 11 | 41 | 397 | 711 |
| Off Bottom | 246 | 1.4 | 76 | 2 | 1 | 3 | 10 | 75 | 333 |
| UI brittle stars | 294 | 1.3 | 37 | 2 | 1 | 2 | 9 | 51 | 206 |
| UI brachiopoda | 164 | 0.4 | 13 | 2 | 1 | 2 | 5 | 30 | 57 |
| UI zoanthid | 202 | 0.4 | 40 | 2 | 0 | 1 | 5 | 18 | 31 |

## Overlap (mixed substrate)

Sessions with any overlap over 1 s: 939 of 1302. Overlapping time: 333.9 h of 431.1 h annotated.

| Pair | Overlaps |
| --- | --- |
| Rock + Sand | 9512 |
| Cobble + Rock | 7437 |
| Mud + Rock | 6117 |
| Boulder + Rock | 5941 |
| Boulder + Cobble | 4245 |
| Cobble + Sand | 4085 |
| Boulder + Sand | 2516 |
| Cobble + Mud | 2414 |
| Boulder + Mud | 2259 |
| Off Transect + Rock | 472 |
| Mud + Off Transect | 294 |
| Off Transect + Sand | 251 |
| Rock + TYPE 2 | 188 |
| Pull + Sand | 159 |
| Sand + TYPE 2 | 141 |
| Pull + Rock | 135 |
| Mud + UI feather star | 130 |
| Mud + TYPE 2 | 128 |
| Club-tipped anemone + Rock | 120 |
| Rock + UI feather star | 117 |
| Rock + Rock | 106 |
| Rock + UI brittle stars | 103 |
| Cobble + Off Transect | 100 |
| Mud + Sand | 97 |
| Boulder + Boulder | 93 |

## Coverage

Annotated: 431.1 h of 816.7 h between each session's first start and last end (52.8%). Gaps over 1 s: 1858; median 13 s, 95th pct 308 s, longest 85605 s.


## PCTcover (coarsesize)

| Value | Intervals |
| --- | --- |
| empty | 38270 |
| 1-99 | 2439 |

## By project

| Project | Sessions | Dives | Annotators | Video files | Hours | Annotated in |
| --- | --- | --- | --- | --- | --- | --- |
| CAMPA 2026 | 252 | 58 | 14 | 292 | 115.7 | 2026 |
| NOAA Express 2018 | 152 | 33 | 5 | 146 | 95.6 | 2024 |
| CAMPA-2025 | 216 | 35 | 8 | 126 | 86.7 | 2026 |
| SALT 7 | 118 | 18 | 3 | 61 | 63.8 | 2025, 2026 |
| CAMPA 2024 | 141 | 20 | 9 | 93 | 56.4 | 2024 |
| SALT 6 | 65 | 9 | 7 | 32 | 52.0 | 2025 |
| MERCI 3 | 84 | 15 | 4 | 40 | 41.8 | 2023 |
| SALT 4 | 63 | 12 | 10 | 29 | 40.5 | 2023, 2026 |
| SALT 5 | 30 | 13 | 6 | 16 | 34.2 | 2023, 2024 |
| MERCI 5 | 60 | 12 | 7 | 27 | 26.4 | 2025, 2026 |
| MERCI 4 | 38 | 17 | 7 | 21 | 22.4 | 2025 |
| MBNMS 2025 | 28 | 4 | 5 | 16 | 13.4 | 2025 |
| NF2603 | 23 | 2 | 3 | 34 | 13.3 | 2026 |
| MERCI 1 | 13 | 9 | 3 | 13 | 7.1 | 2023, 2025, 2026 |
| DEPR_2 Leg_1 | 5 | 1 | 5 | 3 | 2.2 | 2026 |
| DEPR_2 Leg_2 | 5 | 1 | 5 | 2 | 1.7 | 2026 |
| TEST | 4 | 3 | 2 | 5 | 1.7 | 2023, 2024, 2025, 2026 |
| SALT 4 TEST | 2 | 2 | 1 | 2 | 1.1 | 2023 |
| Test | 1 | 1 | 1 | 1 | 0.7 | 2026 |
| test | 1 | 1 | 1 | 1 | 0.5 | 2026 |
| PS2410 | 1 | 1 | 1 | 1 | 0.3 | 2024 |

## Annotated more than once

Project/dive/line with more than one Habitat session: 355; of those, by different annotators: 355.

| Project / dive / line | Sessions (annotator) |
| --- | --- |
| SALT 4 / dive 2 / line 1 | 354 (20), 556 (23) |
| SALT 4 / dive 10 / line 3 | 362 (26), 363 (27), 364 (28), 369 (29), 618 (23) |
| SALT 4 / dive 13 / line 2 | 365 (27), 366 (26), 367 (28), 386 (31), 622 (23) |
| SALT 4 / dive 7 / line 1 | 370 (24), 558 (23) |
| SALT 4 / dive 10 / line 1 | 371 (24), 616 (23) |
| SALT 4 / dive 13 / line 1 | 372 (24), 621 (23) |
| SALT 4 / dive 16 / line 2 | 373 (24), 630 (23) |
| SALT 4 / dive 21 / line 2 | 375 (24), 649 (23) |
| SALT 4 / dive 7 / line 2 | 376 (30), 391 (23) |
| SALT 4 / dive 10 / line 2 | 377 (30), 563 (23) |
| SALT 4 / dive 20 / line 1 | 378 (24), 639 (23) |
| SALT 4 / dive 23 / line 4 | 379 (24), 660 (23) |
| SALT 4 / dive 14 / line 2 | 380 (30), 626 (23) |
| SALT 4 / dive 16 / line 3 | 381 (30), 632 (23) |
| SALT 4 / dive 20 / line 2 | 384 (30), 642 (23) |
| SALT 4 / dive 23 / line 3 | 385 (30), 512 (27), 527 (26), 529 (28), 530 (29), 533 (32) |
| SALT 4 / dive 21 / line 1 | 387 (30), 644 (23) |
| SALT 4 / dive 19 / line 2 | 388 (30), 638 (23) |
| SALT 4 / dive 11 / line 1 | 394 (30), 619 (23) |
| SALT 4 / dive 23 / line 2 | 398 (30), 658 (23) |

## Video files

| Measure | Count |
| --- | --- |
| Distinct video files | 850 |
| Files where clock time minus file position is constant (within 2 s) | 784 |
| Files where it is not | 66 |
| Files with no positions recorded | 0 |
| Sessions spanning more than one file | 77 |
