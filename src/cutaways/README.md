# Illustrated cutaways

Now and then a match moment (a card, a try, a big tackle, a jackal turnover) is shown as a detailed
drawing over the arena, instead of only the arena animation. The arena always plays first; the cutaway
is a bonus on top. If a cutaway does not apply or its art fails to load, nothing changes.

| File | What it does |
|---|---|
| `index.ts` | Decides when a cutaway plays and who is drawn (`kindsFor`, odds, cooldown, saved setting) |
| `render.ts` | Draws the illustration and the entry/exit transitions |
| `data.ts` | Tuning: odds, timing, framing, hairstyle mapping |
| `art/` | The artwork, generated from the silhouette lab |

The only hook into the rest of the game is in `viewer/live.ts` (`Cutaways`, `cutaways.play`, `cardCutaway`).

## Updating the artwork

1. Export the new multi-highlight test page from the silhouette lab.
2. Run `npm run cutaways:extract -- /path/to/dominion-multi-test.html`. This rewrites `art/*.webp`.
3. If a pose changed size or position, adjust its entry in `data.ts` (`STORY`). `npm test` checks that
   every kind, pose and hairstyle still has a file.

## Changing how often they appear

`CHANCE` (per kind), `COOLDOWN_SEC` and `MAX_PER_MATCH` (three) in `data.ts`. The roll is seeded from the event, so a replay shows
the same cutaways.

## Adding a new cutaway

Add the art to the extract script, a `STORY` entry in `data.ts`, a `Kind` and a `CHANCE`, and return it
from `kindsFor` in `index.ts`.
