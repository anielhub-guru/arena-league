# Illustrated cutaways

Now and then a match moment (a card, a try, a big tackle, a jackal turnover, an interception, a kick) is shown as a detailed
drawing over the arena, instead of only the arena animation. The arena plays first and the cutaway is a
bonus on top, except for kinds in `BEFORE` (data.ts), which show the action itself and play ahead of it:
a kick drawn after the ball has landed makes no sense. If a cutaway does not apply or its art fails to load, nothing changes.

| File | What it does |
|---|---|
| `index.ts` | Decides when a cutaway plays and who is drawn (`kindsFor`, odds, cooldown, saved setting) |
| `render.ts` | Draws the illustration and the entry/exit transitions |
| `data.ts` | Tuning: odds, timing, framing, hairstyle mapping |
| `art/` | The artwork, generated from the silhouette lab |

The only hook into the rest of the game is in `viewer/live.ts` (`Cutaways`, `cutaways.play`, `cardCutaway`).

## Updating the artwork

1. Export the multi-highlight and solo test pages from the silhouette lab.
2. Run `npm run cutaways:extract -- /path/to/dominion-multi-test.html /path/to/dominion-solo-test.html`. This rewrites `art/*.webp`.
3. If a pose changed size or position, adjust its entry in `data.ts` (`STORY`). `npm test` checks that
   every kind, pose and hairstyle still has a file.

## Changing how often they appear

`CHANCE` (per kind), `COOLDOWN_SEC` and `MAX_PER_MATCH` (three) in `data.ts`. The roll is seeded from the event, so a replay shows
the same cutaways.

## Adding a new cutaway

Add the art to the extract script, a `STORY` entry in `data.ts`, a `Kind` and a `CHANCE`, and return it
from `kindsFor` in `index.ts`. If it shows the action itself rather than a result, add it to `BEFORE`.
