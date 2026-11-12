import { describe, expect, it } from "vitest";
import { MatchSim } from "../src/engine/match";
import { SAVE_VERSION, migrateSave, newGame, teamById } from "../src/league/season";

describe("reserves", () => {
  it("each club has two reserves who are never on the bench", () => {
    const s = newGame(7, "ash");
    const t = teamById(s, s.managedId);
    expect(t.reserves).toHaveLength(2);
    const sim = new MatchSim({
      id: "r",
      season: 1,
      matchday: 1,
      home: t,
      away: s.teams.find((x) => x.id !== t.id)!,
      homeTactic: "balanced",
      awayTactic: "balanced",
      homeShape: "sweeper",
      awayShape: "sweeper",
      seed: 1,
    });
    for (const r of t.reserves!) expect(sim.sides[0].bench.some((p) => p.id === r)).toBe(false);
    expect(sim.sides[0].bench).toHaveLength(3);
  });
  it("old eight-player saves gain two reserves", () => {
    const s = newGame(7, "ash");
    for (const t of s.teams) {
      t.players = t.players.slice(0, 8);
      delete t.reserves;
    }
    const up = migrateSave({ ...s, version: 6 })!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const t of up.teams) {
      expect(t.players).toHaveLength(10);
      expect(t.reserves).toHaveLength(2);
    }
  });
});
