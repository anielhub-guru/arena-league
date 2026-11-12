import { describe, expect, it } from "vitest";
import { isSeasonOver, newGame, playMatchday, teamById } from "../src/league/season";

/** Plays a full season (manager's club simmed, never touched) and counts what the AI did. */
function season(seed: number) {
  let s = newGame(seed, "ash");
  const perClub: Record<string, number> = {};
  const minutes = new Set<number>();
  let subs = 0, mine = 0, matches = 0, rested = 0, weeks = 0;
  let prev = new Map(s.teams.map((t) => [t.id, new Set(t.lineup)]));
  while (!isSeasonOver(s)) {
    const r = playMatchday(s);
    s = r.state;
    for (const log of r.logs) {
      matches++;
      for (const e of log.events) if (e.type === "sub") {
        subs++;
        const club = e.text.split(" ")[0];
        perClub[club] = (perClub[club] ?? 0) + 1;
        minutes.add(Math.floor(e.sec / 60));
        if (e.text.startsWith(teamById(s, "ash").short)) mine++;
      }
    }
    for (const t of s.teams) {
      if (t.id === "ash") continue;
      weeks++;
      rested += t.lineup.filter((id) => !prev.get(t.id)!.has(id)).length;
    }
    prev = new Map(s.teams.map((t) => [t.id, new Set(t.lineup)]));
  }
  return { subsPerMatch: subs / matches, managedSubs: mine, changesPerClubWeek: rested / weeks, matches, perClub, minutes: minutes.size };
}

describe("AI substitutions and rest", () => {
  it("AI clubs sub about once a side, rest a starter now and then, and never touch the manager's club", () => {
    const r = season(7);
    console.log("ai subs:", JSON.stringify(r));
    expect(r.subsPerMatch).toBeGreaterThan(0.5);
    expect(r.subsPerMatch).toBeLessThan(3);
    expect(r.changesPerClubWeek).toBeGreaterThan(0.05);
    expect(r.changesPerClubWeek).toBeLessThan(1.5);
    expect(r.managedSubs).toBe(0);
    // Different coaches: clubs differ in how often they sub, and subs come at varied times.
    const counts = Object.values(r.perClub);
    expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThanOrEqual(3);
    expect(r.minutes).toBeGreaterThanOrEqual(5);
  });
});
