import { describe, expect, it } from "vitest";
import { generateTeams, makeProspects, makeReserves } from "../src/league/teams";
import { BUILDS, VISIBLE_HAIR, lookOf, makeLook } from "../src/league/look";

describe("player looks", () => {
  it("every women's player is created with a valid look", () => {
    for (const t of generateTeams(7, "women")) {
      for (const p of t.players) {
        const l = p.look!;
        expect(VISIBLE_HAIR).toContain(l.portrait);
        expect(l.build).toBeLessThan(BUILDS.length);
        expect([0, 1]).toContain(l.face);
      }
    }
    const t = generateTeams(7, "women")[0];
    expect(makeReserves(t, 7).every((p) => p.look)).toBe(true);
    expect(makeProspects(t, "1.1", "Winger", 7).every((p) => p.look)).toBe(true);
  });
  it("men have no look yet, and adding looks did not change the generated squads", () => {
    const men = generateTeams(7, "men");
    expect(men.every((t) => t.players.every((p) => !p.look))).toBe(true);
    const strip = (g: ReturnType<typeof generateTeams>) => JSON.stringify(g.map((t) => t.players.map(({ look, ...p }) => p)));
    expect(strip(generateTeams(7, "women"))).toBe(strip(generateTeams(7, "women").map((t) => ({ ...t, players: t.players.map((p) => ({ ...p, look: undefined })) }))));
  });
  it("is deterministic, varied, and filled in for old saves", () => {
    expect(generateTeams(3, "women")[0].players[0].look).toEqual(generateTeams(3, "women")[0].players[0].look);
    const hair = new Set(generateTeams(3, "women").flatMap((t) => t.players.map((p) => p.look!.portrait)));
    expect(hair.size).toBeGreaterThan(2);
    const old = { ...generateTeams(3, "women")[0].players[0], look: undefined };
    expect(lookOf(old, "women")).toEqual(makeLook(`${old.id}|${old.name}`));
    expect(lookOf(old, "men")).toBeNull();
  });
});
