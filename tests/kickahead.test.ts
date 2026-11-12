import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import { generateTeams } from "../src/league/teams";
import { buildScene } from "../src/viewer/scenes";

const teams = generateTeams(5);

function run(n: number, ta: "attacking" | "balanced" | "territory" | "defensive") {
  const out = { tries: 0, kickTries: 0, kickAheadEvents: 0, variants: new Set<string>(), flies: new Set<string>(), passes: 0, maxPasses: 0 };
  for (let i = 0; i < n; i++) {
    const m = simulateMatch({ id: "k", season: 1, matchday: 1, home: teams[i % 8], away: teams[(i + 3) % 8], homeTactic: ta, awayTactic: ta, seed: hashSeed("ka", i) });
    for (const e of m.events) {
      if (e.type === "try") {
        out.tries++;
        if (e.variant === "grubber" || e.variant === "chip") out.kickTries++;
      }
      if (e.highlight && (e.variant?.startsWith("grubber") || e.variant?.startsWith("chip"))) {
        out.kickAheadEvents++;
        out.variants.add(`${e.type}:${e.variant}`);
        const sc = buildScene(e)!;
        expect(sc).not.toBeNull();
        for (const b of sc.beats) if (b.ball.k === "fly" && b.ball.style) out.flies.add(b.ball.style);
      }
      if (e.highlight && ta === "attacking" && (e.type === "break" || e.type === "try")) {
        const sc = buildScene(e)!;
        const passes = sc.beats.filter((b) => b.ball.k === "pass").length;
        out.passes += passes;
        out.maxPasses = Math.max(out.maxPasses, passes);
      }
    }
  }
  return out;
}

describe("grubber and chip and chase", () => {
  it("happens, scores sometimes but is not the main way to score, and is animated with its own ball flight", () => {
    const r = run(120, "attacking");
    expect(r.kickAheadEvents).toBeGreaterThan(5);
    expect(r.kickTries).toBeGreaterThan(0);
    expect(r.kickTries / r.tries).toBeLessThan(0.2);
    expect(r.flies.has("grubber") || r.flies.has("chip")).toBe(true);
  });
  it("defensive sides do it less than attacking sides", () => {
    const a = run(120, "attacking").kickAheadEvents;
    const d = run(120, "defensive").kickAheadEvents;
    expect(d).toBeLessThan(a);
  });
  it("attacking sides string several passes together", () => {
    expect(run(60, "attacking").maxPasses).toBeGreaterThanOrEqual(3);
  });
});
