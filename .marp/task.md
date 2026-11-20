# Bring the feasibility habitat model into MARP

Issue: MarineAppliedResearch/MARP_API#287 · Branch: `287-import-habitat-model` from `develop`

## Goal

Isaac, 2026-11-20: run a habitat line now and review it in the Mosaic, without a weekend of
training through MARP first. MARP registers habitat models only from its own training jobs,
so this adds a way to register one trained outside it: the feasibility experiment's.

## Settled (Isaac, 2026-11-20, in conversation)

- **Import the experiment's trained model** rather than train one through MARP or use only
  existing results. Machine-learning work otherwise waits; the focus is the Mosaic and the
  biologists' review tools.
- **Seed 2 of the habitat-crop runs**, the best single model: test macro F1 0.738. Its
  weights are a timm state dict, the same file MARP's habitat trainer writes, and load into
  the worker's habitat engine unchanged.
- **Mud's +0.2 raise applies**, the settled rule for every habitat model, though it was tuned
  on the five-seed average rather than on seed 2 alone.
- **Into the production copy** (`habitat-test`), where the real dives and 44,453 annotated
  habitat stretches are, for Isaac's trial of the review tools.

## Requirements

- **R1** -- `registerHabitatModel` registers a habitat model from a weights file and its
  published rules exactly as a MARP-trained one is: substrates from the Habitat list in the
  file's class order, `rulesForModel` rules, weights copied into the model store with their
  sha256, a `model_species` row per substrate. The same weights twice register once.
- **R2** -- `scripts/import-habitat-model.js` reads the experiment's `_results.json` (cut-offs,
  crop, input size), refuses anything but a habitat-crop model of the five substrates, and
  writes nothing without `--apply`.

## Open assumptions

None open.
