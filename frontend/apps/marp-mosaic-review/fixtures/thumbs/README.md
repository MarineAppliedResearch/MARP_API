# The demo thumbnails

Thirty photographs, five species by six, reused across the three thousand rows in
`observations.json`. Reuse costs nothing here: a reviewer is judging the organism against
the name it was given, not whether they have seen that exact frame before.

## `manifest.json` is the authority

**It says which species a picture shows. The filename does not.**

```json
"bat-star-05.jpg": {
  "species": "Bat Star",
  "scientific_name": "Patiria miniata",
  "batch": "murky batch",
  "water_condition": "murky",
  "notes": "Murkier-water bat star on reef.",
  "width": 512, "height": 512, "jpeg_quality": 76, "size_bytes": 49917
}
```

`tools/make-fixture.mjs` reads `species` from here and nowhere else. Deriving it from the
filename would work right up until a file was renamed, and then the fixture would quietly
claim a crab was a sea star — which is the exact mistake this application exists to catch,
so it is a poor one to build in at the source.

Some entries carry `duplicate_visual_of`, meaning that picture is the same composition
re-encoded. Nothing depends on it today; it is recorded so nobody wonders later why two
frames look identical.

## Adding or replacing pictures

1. Put the file in this folder.
2. Add an entry to `manifest.json` with at least `species`.
3. Re-run the generator and commit what it writes:

```bash
cd frontend/apps/marp-mosaic-review
node tools/make-fixture.mjs
npm run test:unit
```

`fixtures/observations.json` records which picture each of three thousand rows uses, so it
has to be regenerated in the same change or the fixture points at files that are gone.

Anything the browser can draw works — `.jpg`, `.png`, `.webp`. Square is what matters:
#68's crop rule makes a tile square, and a non-square image is cropped by the browser
rather than by anything that knows what is in the frame. 512×512 is what is here and is
comfortably more than the ~200 pixels a tile is ever drawn at.

## `marp-mark.png` is not one of them

It is the placeholder drawn behind a thumbnail that has not arrived or has failed, and it
has no manifest entry. It was deleted once during a bulk replacement of this folder, which
left `ui/tile.js` pointing at nothing for every queued tile. Leave it alone.

## How a misclassification is represented

`comname` on an observation is **what the model claimed**. The picture is **what is really
there**. Where they disagree, that row is a misclassification — and it stays on a page of
Bat Stars precisely because the label is wrong, which is why it is there to be caught.

About 7% of every species' rows are like that, deliberately and evenly: filtering to Rock
Crab gives pages of crabs with a few wrong ones among them, exactly as Bat Star does.
Otherwise four of the five species would lead somewhere with nothing to practise on. See
`WRONG_RATE` and `MIX` in `tools/make-fixture.mjs`.

## Transporting images as text

`tools/decode-thumbs.mjs` turns `<name>.jpg.b64` text files back into images, checking the
magic number and, if a `SHA256SUMS` file is present, the hash. It exists because an agent
generating imagery had a GitHub connector that could commit text but not binary. Not needed
when files can be added directly; kept because that situation recurs.
