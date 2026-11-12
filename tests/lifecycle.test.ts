import { describe, expect, it } from "vitest";
import { SAVE_VERSION, autoPicks, isSeasonOver, migrateSave, newGame, playMatchday, signProspects, startNextSeason, teamById, type SeasonState } from "../src/league/season";
import { overall, potentialStars } from "../src/league/teams";
import { ROLES } from "../src/engine/types";

/** A competent manager: best available player per slot. */
function setBestLineup(s: SeasonState) {
  const t = teamById(s, s.managedId);
  const used = new Set<string>();
  t.lineup = ROLES.map((role) => {
    const p = t.players.filter((x) => !used.has(x.id) && !((x.ban ?? 0) > 0)).sort((a, b) => Number(b.role === role) - Number(a.role === role) || overall(b) - overall(a))[0];
    used.add(p.id);
    return p.id;
  });
}

const meanOverall = (s: SeasonState) => {
  const all = s.teams.flatMap((t) => t.players.map(overall));
  return all.reduce((a, b) => a + b, 0) / all.length;
};

describe("player lifecycle", () => {
  it("the league stays alive for 50 seasons: squads stay whole, ages and ratings stay in a healthy band", () => {
    let s = newGame(2024, "ash", "women");
    const start = meanOverall(s);
    let decisions = 0;
    for (let season = 1; season <= 50; season++) {
      while (!isSeasonOver(s)) {
        s = playMatchday(s).state;
        setBestLineup(s);
      }
      s = startNextSeason(s);
      if (s.intake) {
        decisions++;
        s = signProspects(s, autoPicks(s));
      }
      setBestLineup(s);
      for (const t of s.teams) {
        expect(t.players).toHaveLength(8);
        expect(new Set(t.players.map((p) => p.id)).size).toBe(8);
        expect(new Set(t.lineup).size).toBe(5);
        for (const id of t.lineup) expect(t.players.some((p) => p.id === id)).toBe(true);
      }
      const ages = s.teams.flatMap((t) => t.players.map((p) => p.age));
      expect(Math.max(...ages)).toBeLessThanOrEqual(36);
    }
    const end = meanOverall(s);
    expect(Math.abs(end - start)).toBeLessThan(8);
    expect(decisions).toBeGreaterThan(30); // an offseason decision most years
    expect(JSON.stringify(s).length).toBeLessThan(150_000); // the save does not grow without bound
    expect(s.history).toHaveLength(50);
  }, 120_000);

  it("a title is not a formality: over 50 seasons several clubs win, and no club wins most", () => {
    let s = newGame(99, "gra", "men");
    const titles: Record<string, number> = {};
    for (let season = 1; season <= 50; season++) {
      while (!isSeasonOver(s)) {
        s = playMatchday(s).state;
        setBestLineup(s);
      }
      s = startNextSeason(s);
      if (s.intake) s = signProspects(s, autoPicks(s));
      setBestLineup(s);
      const c = s.history[s.history.length - 1].championId;
      titles[c] = (titles[c] ?? 0) + 1;
    }
    expect(Object.keys(titles).length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...Object.values(titles))).toBeLessThan(35);
  }, 120_000);

  it("the next season cannot be played until the offseason signings are confirmed", () => {
    let s = newGame(5, "ash");
    for (let season = 1; season <= 6 && !s.intake; season++) {
      while (!isSeasonOver(s)) s = playMatchday(s).state;
      s = startNextSeason(s);
    }
    expect(s.intake).toBeDefined();
    expect(() => playMatchday(s)).toThrow(/signings/);
    const mandatory = s.intake!.slots.findIndex((x) => !x.optional);
    if (mandatory >= 0) expect(() => signProspects(s, {})).toThrow(/every retiring/);
    const after = signProspects(s, autoPicks(s));
    expect(after.intake).toBeUndefined();
    expect(() => playMatchday(after)).not.toThrow();
  });

  it("prospects hide their true potential, and a signed prospect takes the retiree's place in the lineup", () => {
    let s = newGame(11, "ash");
    while (!s.intake) {
      while (!isSeasonOver(s)) s = playMatchday(s).state;
      s = startNextSeason(s);
    }
    const slot = s.intake.slots.find((x) => !x.optional);
    if (!slot) return; // only an optional slot this year: covered above
    for (const o of slot.options) {
      expect(o.age).toBeGreaterThanOrEqual(17);
      expect(o.age).toBeLessThanOrEqual(19);
      expect(Math.abs((o.scouted ?? 0) - (o.potential ?? 0))).toBeLessThanOrEqual(6);
      expect(potentialStars(o.potential ?? 0)).toBeGreaterThanOrEqual(1);
    }
    const idx = s.intake.slots.indexOf(slot);
    const wasStarter = teamById(s, s.managedId).lineup.includes(slot.outId);
    const after = signProspects(s, { ...autoPicks(s), [idx]: slot.options[0].id });
    const team = teamById(after, after.managedId);
    expect(team.players.some((p) => p.id === slot.outId)).toBe(false);
    expect(team.players.some((p) => p.id === slot.options[0].id)).toBe(true);
    if (wasStarter) expect(team.lineup).toContain(slot.options[0].id);
  });

  it("training stops at a player's potential", () => {
    let s = newGame(3, "ash");
    const team = teamById(s, s.managedId);
    for (const p of team.players) p.potential = overall(p); // nobody has headroom
    const before = JSON.stringify(team.players.map(overall));
    s.training = "attack";
    s = playMatchday(s).state;
    expect(JSON.stringify(teamById(s, "ash").players.map(overall))).toBe(before);
  });

  it("saves from version 4 get potentials and load", () => {
    const s = newGame(8, "ash");
    const old = structuredClone(s) as unknown as SeasonState;
    old.version = 4;
    for (const t of old.teams) for (const p of t.players) delete p.potential;
    const up = migrateSave(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const t of up.teams) for (const p of t.players) expect(p.potential).toBeGreaterThanOrEqual(overall(p));
  });
});
