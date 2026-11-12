import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import { generateTeams } from "../src/league/teams";
import { ArenaView } from "../src/viewer/arena";
import { buildScene } from "../src/viewer/scenes";

const teams = generateTeams(3);

/** Steps a highlight scene without a canvas and reports odd carrier movement. */
function watch(e: Parameters<typeof buildScene>[0]) {
  const sc = buildScene(e)!;
  const v: any = Object.create(ArenaView.prototype);
  v.cam = 0;
  v.rate = () => 1;
  v.load(sc);
  const cid = (sc.beats.find((b) => b.ball.k === "held")!.ball as { by: string }).by;
  let turnedBack = false;
  let offField = false;
  for (let t = 0; t < 15000 && v.sim.t < v.total; t += 16) {
    v.step(16);
    const a = v.sim.agents[cid];
    // The carrier sprinting back the way he came, ball in hand, is the "turns round to get tackled" glitch.
    if (v.sim.holder === cid && a.down <= 0 && a.hx < -0.2 && Math.hypot(a.vx, a.vy) > 1.5) turnedBack = true;
    for (const ag of Object.values(v.sim.agents) as { x: number }[]) if (ag.x > 103 || ag.x < -3) offField = true;
  }
  return { turnedBack, offField };
}

describe("highlight animation movement", () => {
  it("a runner who has beaten the defence never turns back into the tackle, and nobody leaves the field", () => {
    let scenes = 0;
    for (let n = 0; n < 60; n++) {
      const m = simulateMatch({ id: "s", season: 1, matchday: 1, home: teams[n % 8], away: teams[(n + 3) % 8], homeTactic: "balanced", awayTactic: n % 2 ? "attacking" : "territory", seed: hashSeed("sc", n) });
      for (const e of m.events) {
        if (!e.highlight || !["break", "try", "turnover"].includes(e.type)) continue;
        const r = watch(e);
        scenes++;
        expect(r.turnedBack, `${e.type}/${e.variant} in match ${n}: carrier turned back`).toBe(false);
        expect(r.offField, `${e.type}/${e.variant} in match ${n}: left the field`).toBe(false);
      }
    }
    expect(scenes).toBeGreaterThan(50);
  });
});
