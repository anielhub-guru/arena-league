import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import { generateTeams } from "../src/league/teams";
import { buildScene, sceneMs } from "../src/viewer/scenes";

const teams = generateTeams(3);
const IDS = ["a0", "a1", "a2", "a3", "a4", "d0", "d1", "d2", "d3", "d4"];

describe("highlight scenes", () => {
  it("builds a complete, sensibly timed scene for every highlight type", () => {
    const seen = new Map<string, { n: number; min: number; max: number }>();
    for (let n = 0; n < 150; n++) {
      const home = teams[n % 8];
      const away = teams[(n * 3 + 1) % 8 === n % 8 ? (n + 1) % 8 : (n * 3 + 1) % 8];
      const m = simulateMatch({ id: "s", season: 1, matchday: 1, home, away, homeTactic: "balanced", awayTactic: n % 2 ? "attacking" : "territory", seed: hashSeed("sc", n) });
      for (const e of m.events) {
        if (!e.highlight) continue;
        const sc = buildScene(e);
        expect(sc, `${e.type} should build`).not.toBeNull();
        for (const b of sc!.beats) {
          for (const id of IDS) {
            expect(b.to[id], `${e.type} beat missing ${id}`).toBeDefined();
            expect(Number.isFinite(b.to[id].x) && Number.isFinite(b.to[id].y)).toBe(true);
          }
        }
        for (const b of sc!.beats) for (const h of b.hits ?? []) {
          expect(IDS, `${e.type} hit runner`).toContain(h.runner);
          expect(IDS, `${e.type} hit other`).toContain(h.other);
        }
        if (/^(conversion|penalty|drop)/.test(e.type)) {
          expect(sc!.kick, `${e.type} should have a kicker's-view`).toBeDefined();
          expect(sc!.kick!.start).toBeGreaterThan(1000);
          expect(["good", "post-in", "post", "wide", "short"]).toContain(sc!.kick!.outcome);
        }
        const ms = sceneMs(sc!);
        const k = e.type + (e.variant ? `:${e.variant}` : "");
        const cur = seen.get(k) ?? { n: 0, min: Infinity, max: 0 };
        seen.set(k, { n: cur.n + 1, min: Math.min(cur.min, ms), max: Math.max(cur.max, ms) });
      }
    }
    console.table([...seen.entries()].map(([k, v]) => ({ kind: k, count: v.n, minSec: +(v.min / 1000).toFixed(1), maxSec: +(v.max / 1000).toFixed(1) })));
    for (const [k, v] of seen) {
      expect(v.min, k).toBeGreaterThan(2500);
      expect(v.max, k).toBeLessThan(15000);
    }
    for (const t of ["try:break", "try:power", "break:covered", "break:caught", "break:touch", "break:foul", "turnover", "intercept", "kick:live", "conversion:good", "conversion:post-in", "conversion-miss:post", "conversion-miss:wide", "conversion-miss:short", "penalty-goal:good"]) expect(seen.has(t), t).toBe(true);
  }, 30000);
});
