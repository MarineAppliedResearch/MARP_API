# The demo thumbnails

Fifty pictures, five species by ten variations, reused across the three thousand rows in
`observations.json`. A reviewer is judging the organism against the name it was given, not
whether they have seen that exact picture before, so reuse costs nothing.

## What is in here now, and what should be

**The `.svg` files are a stand-in.** They are drawn from code by
`tools/make-thumbs.mjs` — deterministic, dependency-free, and obviously illustrations.
They exist so the app has five visibly different organisms to work with.

**The intention is realistic model-generated photographs**, as the earlier `t*.jpg` files
were. Those were generated outside this repository. Nothing in the code prefers one over
the other.

## Dropping real images in

`tools/make-fixture.mjs` reads this folder rather than assuming a naming template, so the
changeover is: add the files, re-run the generator, done. No code change.

```
bat-star-01.jpg  …  bat-star-10.jpg
red-urchin-01.jpg  …  red-urchin-10.jpg
rockfish-01.jpg  …  rockfish-10.jpg
rock-crab-01.jpg  …  rock-crab-10.jpg
sea-cucumber-01.jpg  …  sea-cucumber-10.jpg
```

```bash
node tools/make-fixture.mjs
```

Rules the loader follows:

- `.jpg`, `.jpeg`, `.png`, `.webp` and `.avif` all work, and **a raster file beats an
  `.svg` of the same number** — so the species can be replaced one at a time without the
  app breaking in between.
- The numbering must be two digits. Ten per species is what the generator expects; more
  or fewer works, it just uses what it finds.
- Square. #68's crop rule means a tile is square, and a non-square image is letterboxed
  or cropped by the browser rather than by anything that knows what is in it.
- Around 256×256 is plenty. The largest a tile is ever drawn is about 200 pixels.

## What each one should show

The whole point is **contrast at tile size**. A page holds one predicted species and the
reviewer's job is to spot the one that does not belong, so a wrong classification has to
be obvious in a 150-pixel square, at a glance, without reading the caption. Five species
that are hard to tell apart would make a prettier fixture and a useless one.

Common to all fifty:

> Underwater ROV survey still from a temperate Pacific rocky reef. Natural available
> light with a slight cool cast, mild backscatter, shallow depth of field. A single
> organism roughly centred, filling about half the frame, resting on the substrate.
> Square crop. Photographic, not illustrated; the look of a frame grabbed from survey
> video rather than a studio photograph.

Then per species, ten each — vary the angle, the distance, the substrate and how much of
the animal is occluded, because a fixture where every picture is the same pose teaches a
reviewer to recognise the picture instead of the animal:

| File prefix | Species | What it should read as |
| --- | --- | --- |
| `bat-star` | Bat star, *Patiria miniata* | A webbed five-armed sea star, short blunt arms, mottled orange to red. The common case, and the species most of the fixture claims to be. |
| `red-urchin` | Red urchin, *Mesocentrotus franciscanus* | A dark test under long red-purple spines. A spiny ball. |
| `rockfish` | Rockfish, *Sebastes* sp. | A fish in profile, banded copper and olive, hovering just off the bottom. The only vertebrate, and the clearest wrong answer. |
| `rock-crab` | Rock crab, *Cancer productus* | A wide brick-red carapace, walking legs out to the sides, claws forward. |
| `sea-cucumber` | Sea cucumber, *Parastichopus* sp. | An elongate ochre body with papillae, lying along the substrate. |

A few of each should be **awkward** — partly occluded by kelp, at an oblique angle, or
further from the camera. A fixture in which every organism is perfectly presented cannot
show what the reviewer's job is actually like, and the interface has states for exactly
those cases.

## How a misclassification is represented

`comname` on an observation is **what the model claimed**. The picture is **what is really
there**. Where they disagree, that row is a misclassification, and it stays on a page of
Bat Stars precisely because the label is wrong — which is what the reviewer is there to
catch. `tools/make-fixture.mjs` does this deliberately; see the comment on `isMisclassified`.

`marp-mark.png` is not one of the fifty. It is the placeholder behind a thumbnail that has
not arrived or has failed, and it stays.
