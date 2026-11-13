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
        // Players in the sin bin or sent off are not on the pitch, so they are not in the scene.
        const offIds = new Set([...(e.cast?.offA ?? []).map((i) => `a${i}`), ...(e.cast?.offD ?? []).map((i) => `d${i}`)]);
        const on = IDS.filter((id) => !offIds.has(id));
        for (const b of sc!.beats) {
          for (const id of on) {
            expect(b.to[id], `${e.type} beat missing ${id}`).toBeDefined();
            expect(Number.isFinite(b.to[id].x) && Number.isFinite(b.to[id].y)).toBe(true);
          }
          for (const id of offIds) expect(b.to[id], `${e.type} beat should not include off player ${id}`).toBeUndefined();
          const ball = b.ball;
          const refs = ball.k === "held" ? [ball.by] : ball.k === "pass" ? [ball.from, ball.to] : ball.k === "fly" && typeof ball.from === "string" ? [ball.from] : [];
          for (const r of refs) expect(on, `${e.type} ball ref ${r}`).toContain(r);
        }
        for (const b of sc!.beats) for (const h of b.hits ?? []) {
          expect(on, `${e.type} hit runner`).toContain(h.runner);
          expect(on, `${e.type} hit other`).toContain(h.other);
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
      expect(v.min, k).toBeGreaterThan(1800); // a play right by the line is short
      expect(v.max, k).toBeLessThan(15000);
    }
    for (const t of ["try:break", "try:power", "break:covered", "break:caught", "break:touch", "break:foul", "turnover", "carry:held", "turnover:sixth", "kick:touch", "intercept", "kick:live", "conversion:good", "conversion:post-in", "conversion-miss:post", "conversion-miss:wide", "conversion-miss:short", "penalty-goal:good"]) expect(seen.has(t), t).toBe(true);
  }, 30000);

  it("held-up carries are rare, and the scene has several looks", () => {
    let held = 0, matches = 0;
    const caps = new Set<string>();
    for (let n = 0; n < 60; n++) {
      const m = simulateMatch({ id: "h", season: 1, matchday: 1, home: teams[n % 8], away: teams[(n + 3) % 8], homeTactic: "attacking", awayTactic: "balanced", seed: hashSeed("held", n) });
      matches++;
      for (const e of m.events) {
        if (e.type !== "carry" || e.variant !== "held") continue;
        held++;
        caps.add(buildScene(e)!.beats.map((b) => b.cap ?? "").join("|"));
      }
    }
    expect(held / matches).toBeLessThan(4); // a moment, not a flood
    expect(caps.size).toBeGreaterThanOrEqual(2);
  }, 30000);
});
