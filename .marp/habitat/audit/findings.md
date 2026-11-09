# Habitat audit: findings

Phase 2 of `habitat-research-plan.md`. Read-only, against the local copy of production
(dump `mare_v1_backup_20261105_130111`, migrated to `develop`). Full tables are in
`audit-results.md`; the queries are in `audit.js` and `duplicates.js`.

## The numbers

- **42,741 Habitat observations in 1,424 sessions; 40,709 are usable intervals.** Unusable:
  1,461 have no name, 558 have no end, and 13 end before they start.
- **Five substrate names are in use: Rock, Mud, Sand, Cobble, Boulder.** **There's no
  Gravel anywhere.** Hours of interval:

  | Substrate | Hours |
  | --- | --- |
  | Rock | 198 |
  | Mud | 120 |
  | Sand | 120 |
  | Cobble | 68 |
  | Boulder | 32 |

  Each appears in 17–19 projects.
- **Intervals are short.** Median length is 9–21 s depending on the substrate, and the
  5th percentile is 2–3 s. Annotators record stretches that short themselves, so 2–3 s is
  the data's own lower limit. The minimum length for the model is a judgement call (Q6).
- **Mixed substrate is the norm, not the exception.** 334 of 431 annotated hours are
  covered by two or more overlapping intervals. Most common pairs: Rock+Sand, Cobble+Rock,
  Mud+Rock, Boulder+Rock, Boulder+Cobble. This settles it: the model must allow several
  substrates per frame.
- **PCTcover is almost never filled in:** empty on 94% of intervals (38,270 of 40,709).
  It can't be used for training or as a check.
- **Coverage:** intervals cover 53% of the time between each session's first start and
  last end. The rest is gaps, which are excluded as decided.
- **Video:** 850 distinct video files. In 784 the gap between clock time (`tc`) and file
  position (`mediaPosition`) is constant, so an interval maps cleanly to a place in the
  file. **In 66 it isn't**, and those need a look before their frames are used. 77 sessions
  span more than one file.
- **21 projects.** The largest are CAMPA 2026, NOAA Express 2018, CAMPA-2025 and SALT 7.
  Four are test projects (TEST, Test, test, SALT 4 TEST) and should be excluded.

## Names that aren't substrates

| Name | Hours | Where |
| --- | --- | --- |
| TYPE 1 / 2 / 3 / 4 | 6 / 87 / 7 / 2 | 7 projects (SALT 4–7, MERCI 3–5) |
| Off Transect, Pull, Stop | 18 / 2.5 / 2 | Excluded, as planned |
| Off Bottom | 1.4 | 2 projects |
| Rubble 1, Rubble 2 | 2.3, 1.7 | 1 project |
| UI feather star, Club-tipped anemone, UI brittle stars, UI brachiopoda, UI zoanthid | 9 total | 2–3 projects |

**The TYPE sessions are separate sessions on the same transects.** On 194 transect lines,
one session records substrates and a second records TYPE 1–4. Those TYPE sessions almost
never contain substrate names.

## Second annotations: the human ceiling

Only **26 transect lines have two or more sessions recording substrates over the same
stretch**. That's the set for measuring how well two people agree, which is the realistic
ceiling for the model. 148 other multi-session lines are neither substrate+substrate nor
substrate+TYPE, and haven't been looked at.

## Decisions (Isaac, 2026-11-05)

- **Classes: Rock, Mud, Sand, Cobble, Boulder.** Gravel isn't in the data, so it isn't a class.
- **Only straight substrate names are used.** TYPE 1–4 (meaning unknown), Off Bottom,
  Rubble 1/2, the species names, and Off Transect/Pull/Stop are all excluded. Test projects
  are excluded too.
- **The 26 lines annotated twice for substrate were independent**, done to compare how
  different annotators' judgements are. They give the agreement ceiling.
- **Minimum stretch length starts at the annotators' 2–3 s**, then gets checked against what
  the stretches actually look like in Phase 6.

## Questions for Isaac (about meaning; not inferred)

1. **What are TYPE 1–4?** A habitat-type classification built from the substrates? Should
   the model learn them too, or ignore them?
2. **Is Gravel really never recorded?** If so, the class list is Rock, Mud, Sand, Cobble,
   Boulder.
3. **Rubble 1/2 and Off Bottom:** substrate, or excluded like Off Transect?
4. **The species names in Habitat sessions** (feather star, anemones and so on): mistakes,
   or recorded on purpose? I'd exclude them.
5. **When two people annotated the same line,** were they working independently, or was one
   reviewing the other? This decides whether those 26 lines can measure agreement.
6. **Minimum stretch length.** Annotators go down to 2–3 s. Should the model match that, or
   stay longer (say 10 s) and accept missing short patches?

## Which videos Jellyfin has (checked 2026-11-05, read-only)

Only the five substrates and only real projects are counted: 846 video files. Hours are
substrate-interval hours, so overlapping substrates count separately.

| | Files | Hours |
| --- | --- | --- |
| Found by name (match score ≥ 96, the threshold thumbnails use) | 620 | 335.6 |
| `video_source` is a Jellyfin item id, which opens directly (CAMPA 2026) | 43 | 10.5 |
| **Usable now** | **663** | **346.1 of 533.9 (65%)** |
| Transect clips named `dive_line.mp4` (`2_1.mp4`), not in Jellyfin | 170 | 185.7 |
| Other, such as SALT 7 `Transit N.mp4` | 13 | 2.1 |

- **Usable now:** CAMPA 2024, CAMPA-2025, CAMPA 2026 (most of it), NOAA Express 2018, DEPR_2
  and PS2410.
- **Missing:** almost all of SALT 4–7, MERCI 1/3/4/5, NF2603 and MBNMS 2025. Their
  annotation was done on **transect clips cut from the dive video and kept on local
  drives** (`G:\MERCI 3 Transect Clips\Dive 1\1_1.mp4`, `D:\SALT 7\Transect Videos\...`).
  Jellyfin has no files with those names. Its closest matches score 85 and are other dives,
  so they're correctly refused.

**This matters for the model, not just the amount of data.** Without the clips, training and
the benchmark cover only the CAMPA and NOAA Express footage. Whether the model works on
SALT/MERCI cameras can't be measured.

## The 64 files whose clock time and file position disagree

- **54 are the same clip name used in different dives.** `2_1.mp4` in two projects is two
  different videos, so the shift between them is meaningless.
- **10 shift within one session.** The median shift is about 6 hours and the largest exactly
  24 hours, which looks like clock or time-zone settings rather than video error.
- **Only 14 of the 64 are videos Jellyfin has.**

**Consequence for the dataset builder:** cut frames by file position (`mediaPosition`, plus
the interval's length from `tc`/`etc`), never by clock time. Exclude the 10 files that shift
within a session, or check them against the video first.

## Open

- **Where are the transect clips?** Can they go into Jellyfin, or can they be matched to dive
  videos Jellyfin already has? That's 186 hours, and every SALT and MERCI project.
