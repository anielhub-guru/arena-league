import { describe, expect, it } from "vitest";
import { acceptOffer, autoPlan, completeOffseason, declineOffers, isSeasonOver, newGame, playMatchday, startNextSeason, teamById, type SeasonState } from "../src/league/season";
import { teamRating } from "../src/league/teams";
import { ROLES } from "../src/engine/types";
import { overall } from "../src/league/teams";

function playSeason(s: SeasonState): SeasonState {
  while (!isSeasonOver(s)) s = playMatchday(s).state;
  return s;
}

/** Plays many seasons, answering offers with `answer`. Returns every offer round seen. */
function run(seed: number, seasons: number, answer: (s: SeasonState) => SeasonState) {
  let s = newGame(seed, "ash");
  const rounds: { season: number; offers: NonNullable<SeasonState["offers"]>; rank: Record<string, number> }[] = [];
  for (let i = 0; i < seasons; i++) {
    s = startNextSeason(playSeason(s));
    if (s.offers?.length) {
      const sorted = [...s.teams].sort((a, b) => teamRating(b) - teamRating(a));
      rounds.push({ season: s.season - 1, offers: s.offers, rank: Object.fromEntries(sorted.map((t, k) => [t.id, k])) });
      s = answer(s);
    }
    s = completeOffseason(s, autoPlan(s));
  }
  return { s, rounds };
}

describe("job offers", () => {
  it("never come before two seasons are done or in back-to-back years, and come every few seasons", () => {
    let total = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const { rounds } = run(seed, 14, declineOffers);
      total += rounds.length;
      for (const r of rounds) expect(r.season).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < rounds.length; i++) expect(rounds[i].season - rounds[i - 1].season).toBeGreaterThanOrEqual(2);
    }
    expect(total).toBeGreaterThan(2);
  }, 120_000);

  it("poor form only ever brings a lifeline from the bottom clubs, never a top team", () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { rounds } = run(seed, 14, declineOffers);
      for (const r of rounds) for (const o of r.offers) if (o.tier === "lifeline") expect(r.rank[o.clubId]).toBeGreaterThanOrEqual(4);
    }
  }, 120_000);

  it("accepting moves you to the new club with its budget and keeps the league whole", () => {
    let s = newGame(11, "ash");
    let accepted = false;
    for (let i = 0; i < 30 && !accepted; i++) {
      s = startNextSeason(playSeason(s));
      if (s.offers?.length) {
        const o = s.offers[0];
        const before = s.history.length;
        s = acceptOffer(s, o.clubId);
        expect(s.managedId).toBe(o.clubId);
        expect(s.money).toBe(o.budget);
        expect(s.offers).toBeUndefined();
        expect(s.history).toHaveLength(before);
        for (const t of s.teams) {
          expect(t.players).toHaveLength(10);
          expect(t.players.some((p) => p.retiring)).toBe(false);
          expect(t.lineup.every((id) => t.players.some((p) => p.id === id))).toBe(true);
        }
        accepted = true;
      }
      s = completeOffseason(s, autoPlan(s));
    }
    expect(accepted).toBe(true);
    expect(teamById(s, s.managedId).lineup).toHaveLength(ROLES.length);
    expect(overall(teamById(s, s.managedId).players[0])).toBeGreaterThan(0);
  }, 120_000);

  it("is deterministic from the save", () => {
    const a = run(5, 8, declineOffers).rounds.map((r) => [r.season, r.offers.map((o) => o.clubId)]);
    const b = run(5, 8, declineOffers).rounds.map((r) => [r.season, r.offers.map((o) => o.clubId)]);
    expect(a).toEqual(b);
  }, 120_000);
});
