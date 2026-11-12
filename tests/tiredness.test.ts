import { describe, expect, it } from "vitest";
import { MatchSim } from "../src/engine/match";
import { afterMatch, newGame, playMatchday, teamById } from "../src/league/season";

/** Tiredness after `n` full matches in a row for a given stamina. */
const settle = (stamina: number, n = 20) => {
  const p = { stamina, tired: 0 as number | undefined };
  for (let i = 0; i < n; i++) p.tired = afterMatch(p, 1);
  return p.tired ?? 0;
};

describe("post-match tiredness", () => {
  it("scales with stamina: high stamina barely tires, low stamina carries more", () => {
    const hi = settle(90);
    const mid = settle(60);
    const lo = settle(40);
    console.log("steady tiredness:", { hi, mid, lo });
    expect(hi).toBeLessThan(mid);
    expect(mid).toBeLessThan(lo);
    expect(lo).toBeLessThan(45);
  });

  it("resting recovers most of it within two matches", () => {
    let t: number | undefined = settle(60);
    const start = t;
    for (let i = 0; i < 2; i++) t = afterMatch({ stamina: 60, tired: t }, 0);
    expect(t).toBeLessThan(start * 0.25);
  });

  it("a tired player starts the match weaker than a fresh one", () => {
    const g = newGame(1, "ash");
    const mk = (tired?: number) => {
      const home = structuredClone(teamById(g, "ash"));
      home.players.forEach((p) => (p.tired = tired));
      const away = teamById(g, g.teams.find((t) => t.id !== "ash")!.id);
      const sim = new MatchSim({ id: "t", season: 1, matchday: 1, home, away, homeTactic: "balanced", awayTactic: "balanced", seed: 1, homeAuto: true, awayAuto: true });
      return sim.energy(0, sim.sides[0].field[0]);
    };
    expect(mk(40)).toBeLessThan(mk(undefined));
  });

  it("a played matchday records load and updates tiredness", () => {
    const { state, logs } = playMatchday(newGame(1, "ash"));
    expect(logs[0].load).toBeDefined();
    const team = teamById(state, "ash");
    const starter = team.players.find((p) => team.lineup[0] === p.id)!;
    const bench = team.players.find((p) => !team.lineup.includes(p.id))!;
    expect(starter.tired ?? 0).toBeGreaterThan(5);
    expect(bench.tired ?? 0).toBeLessThan(starter.tired ?? 0);
  });
});
