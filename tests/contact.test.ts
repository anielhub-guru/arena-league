import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import { generateTeams } from "../src/league/teams";
import { buildScene, sceneMs } from "../src/viewer/scenes";
import { ArenaView } from "../src/viewer/arena";

const teams = generateTeams(7);

function stubDom() {
  const ctx = new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true });
  (globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };
  (globalThis as any).requestAnimationFrame = () => 0;
  (globalThis as any).cancelAnimationFrame = () => {};
}

describe("tackles need contact", () => {
  it("the tackler is touching the runner when a tackle lands, and the carrier is still moving", () => {
    stubDom();
    let hits = 0;
    let tooFar = 0;
    let stillCarrier = 0;
    let moving = 0;
    for (let n = 0; n < 40; n++) {
      const m = simulateMatch({ id: "c", season: 1, matchday: 1, home: teams[n % 8], away: teams[(n + 2) % 8], homeTactic: "balanced", awayTactic: n % 2 ? "attacking" : "balanced", seed: hashSeed("ct", n) });
      for (const e of m.events) {
        if (!e.highlight || !["break", "try", "turnover"].includes(e.type)) continue;
        const sc = buildScene(e);
        if (!sc) continue;
        const v = new ArenaView("A", "B") as any;
        const orig = v.applyHit.bind(v);
        v.applyHit = (hit: any, R: any, O: any) => {
          if (hit.kind === "tackle") {
            hits++;
            if (Math.hypot(R.x - O.x, R.y - O.y) > 1.6) tooFar++;
            if (Math.hypot(R.vx, R.vy) > 3) moving++;
            else stillCarrier++;
          }
          orig(hit, R, O);
        };
        v.load(sc);
        while (v.sim.t < sceneMs(sc) + 1500) v.step(16);
      }
    }
    expect(hits).toBeGreaterThan(20);
    
    expect(tooFar).toBe(0);
    expect(moving / hits).toBeGreaterThan(0.8);
  });
});
