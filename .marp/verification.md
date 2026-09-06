---
task: MarineAppliedResearch/MARP_API#79
repos: [MARP_API]
status: verified
---

# Verification — resumability: the question survives a reload

## What each requirement is proved by, and where

The split is deliberate. Everything about *reading and writing an address* is string
handling, so it is proved in the fast tier where forty malformed addresses cost a
millisecond each. Everything about *a reload actually working* is proved in the browser,
because reloading is the one thing a unit test cannot do.

| Req | Claim | Tier | Named test |
| --- | --- | --- | --- |
| R1 | mode, filters, sort and page all survive the round trip | unit | `R1: mode, filters, sort and page all survive the round trip` |
| R1 | a filter is in the address and comes back after a reload | render | `R1: a filter is in the address, and comes back after a reload` |
| R2 | marks do not come back | render | `R2: marks do not come back, because the record does not have them` |
| R3 | a confidence range outside its bounds is discarded, not clamped | unit | `R3: a confidence range outside its own bounds is discarded, not clamped` |
| R3 | a range the wrong way round is discarded | unit | `R3: a range whose ends are the wrong way round is discarded` |
| R3 | except a time window, where that is the midnight wrap | unit | `R3: a time window may be the wrong way round, because that is the midnight wrap` |
| R3 | malformed times and dates are discarded | unit | `R3: malformed times and dates are discarded` |
| R3 | a range with no separator is discarded | unit | `R3: a range with no separator is discarded rather than read as one end` |
| R3 | one broken dimension does not cost another | unit | `R3: one broken dimension does not cost the reviewer another` |
| R3 | an unknown mode falls back rather than breaking | unit | `R3: an unknown mode falls back to scientific rather than breaking` |
| R3 | a page that is not a page becomes page one | unit | `R3: a page that is not a page becomes page one` |
| R3 | a sort nobody offers is ignored | unit | `R3: a sort nobody offers is ignored` |
| R3 | a parameter naming no dimension is ignored | unit | `R3: a parameter naming no dimension is simply ignored` |
| R3 | an unrecognised status value leaves the mode default in place | unit | `R3: an unrecognised status value leaves the mode default in place` |
| R3 | a half-escaped address does not throw | unit | `a half-escaped address does not throw` |
| R3 | nonsense still opens the application | render | `R3: an address that makes no sense still opens the application` |
| R4 | a bare address is the default question, and the reverse | unit | `R4: a bare address is the default question, and the default writes a bare address` |
| R5 | Reset restores the default question in one gesture | render | `R5: Reset restores the default question in one gesture` |
| R5 | Reset keeps the mode the reviewer is in | render | `R5: Reset keeps the mode the reviewer is working in` |
| R6 | every declared dimension survives the round trip | unit | `R6: every declared dimension can be written and read back` |
| R6 | the address is a link | render | `R6: the address is a link — a fresh visit lands on the same question and page` |

Plus the traps found while building it, each with a test of its own:

| Claim | Tier | Named test |
| --- | --- | --- |
| clearing every filter is not the default question | unit | `clearing every filter is not the same address as the default question` |
| a species name containing a comma stays one value | unit | `a value containing a comma stays one value` |
| a mode keeps its own status filter and ignores the other's | unit | `the mode keeps its own status filter, and ignores the other mode's` |
| a status filter at the mode default is not written | unit | `a status filter matching the mode default is not written into the address` |
| an open-ended range keeps which end was open | unit | `an open-ended range keeps which end was open` |
| a link naming both a dive and its line arrives with both | unit | `a dimension that nests keeps its dependents, because the address is not a gesture` |
| the address stays legible | unit | `the address stays readable: colons survive, commas do not become separators` |

## Results — 2026-09-06

Verbatim.

```
npm run test:unit      91 passed, 0 failed          60 ms
npm run test:e2e      127 passed, 3 skipped         1.0 min   (desktop + phone)
```

The 3 skipped are the same render check as before, which needs a failed thumbnail on the
first page and does not always get one. A weakness in the check, not a pass. Unchanged
here, and still not fixed.

**The reload tests were proved to catch a regression**: commenting out the one call that
writes the address made 4 of the 6 fail. `src/store.js` was restored from a copy taken
first — not with `git checkout`, which discarded uncommitted work during #77.

## Three defects found on the way, none of them in the new code

1. **Three unit tests were asserting against a data shape the application stopped
   producing in #77.** `activeFilterCount` was being handed `species: 'Bat Star'` — a bare
   string where every set dimension has held an array since the filter refactor. They
   passed anyway, because a string has a `length` and the count came out right. They were
   verifying the old app.
2. **A render helper had the same fault.** `emptyIt()` set `state.filters.species` to a
   bare string to produce an empty result, and got one — for the wrong reason. `'No Such
   Species'.includes('Bat Star')` is false, so the filter matched nothing by accident
   rather than by filtering.
3. **`isActive` accepted that invalid shape.** It tested `value && value.length`, which a
   string satisfies, so a stray string read as an active filter and then failed only where
   something tried to iterate it — nowhere, until an address needed writing, and then it
   threw inside `refresh()`. It now requires an array, so an invalid shape is inert instead
   of half-applied.

All three are the same underlying thing: a shape changed in #77 and the checks that should
have noticed kept passing on the old one.

## A test weakened deliberately, and why

`R6: the address is a link` first asserted that a fresh visit to a page-2 address showed
the same tiles. That passed on a desktop and failed on a phone. The cause is not the link:
**how many tiles fit on a page is measured from the window**, and the page size is
deliberately not in the address, so page two of the same question is honestly a different
handful of observations on a narrower screen. It now asserts the question, the page number
and the address, which is what the link actually promises.

## What this does NOT cover

- **No history stack.** The address is written with `replaceState`, so the back button
  leaves the application rather than stepping back through filters. A slider fires a change
  per drag, and pushing an entry for each would bury the reviewer's real history. Nothing
  requires the other behaviour; if it is ever wanted, it belongs to page changes only.
- **Nothing is proved against a real database.** Still the fixture. A restored filter that
  names something the viewer is not allowed to see simply returns nothing for it — that is
  A5, and it cannot be built or tested until there is a user, in phase 8.
- **Scroll position, an open video and a frame-inspection path are not restored**, which
  #68 says explicitly is not required.
- **Two tabs on the same question are not coordinated.** Each has its own address and its
  own memory, which is the intended consequence of there being no shared store.
