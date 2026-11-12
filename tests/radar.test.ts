import { describe, expect, it } from "vitest";
import { ATTRS, ROLES } from "../src/engine/types";
import { RADAR_ORDER, TACTIC_FOCUS, bestFive, playerProfile, profileOf } from "../src/viewer/radar";
import { autoPlan, checkPlan, completeOffseason, isSeasonOver, newGame, playMatchday, startNextSeason, teamById } from "../src/league/season";
import { OUT_OF_POSITION_PENALTY } from "../src/engine/match";

describe("radar data", () => {
  const team = teamById(newGame(1, "ash"), "ash");

  it("covers each rating exactly once, and tactics only lean on real ratings", () => {
    expect([...RADAR_ORDER].sort()).toEqual([...ATTRS].sort());
    for (const focus of Object.values(TACTIC_FOCUS)) for (const a of focus) expect(ATTRS).toContain(a);
    expect(TACTIC_FOCUS.attacking).toEqual(["pace", "handling"]);
  });

  it("a team profile is the mean of its players, and a player profile is their own ratings", () => {
    const [a, b] = team.players;
    const prof = profileOf([a, b]);
    for (const k of ATTRS) expect(prof[k]).toBe(Math.round((a[k] + b[k]) / 2));
    expect(playerProfile(a).pace).toBe(a.pace);
  });

  it("the best five fills each slot once, prefers natural roles, and applies the out-of-position penalty", () => {
    const five = bestFive(team.players);
    expect(five.map((p) => p.role)).toEqual([...ROLES]);
    expect(new Set(five.map((p) => p.id)).size).toBe(5);
    // Drop every natural Winger: someone else must play there, at a penalty.
    const noWinger = team.players.filter((p) => p.role !== "Winger");
    const slot = bestFive(noWinger)[ROLES.indexOf("Winger")];
    const original = noWinger.find((p) => p.id === slot.id)!;
    expect(slot.pace).toBe(original.pace - OUT_OF_POSITION_PENALTY);
    expect(() => bestFive(team.players.slice(0, 4))).toThrow();
  });

  it("the offseason plan reports the squad it would produce", () => {
    let s = newGame(5, "ash");
    while (!s.intake) {
      while (!isSeasonOver(s)) s = playMatchday(s).state;
      s = startNextSeason(s);
      if (!s.intake!.retiring.length) s = completeOffseason(s, autoPlan(s));
    }
    const c = checkPlan(s, autoPlan(s));
    expect(c.roster).toHaveLength(10);
    expect(c.roster.some((p) => s.intake!.retiring.includes(p.id))).toBe(false);
    expect(bestFive(c.roster)).toHaveLength(5);
  });
});
