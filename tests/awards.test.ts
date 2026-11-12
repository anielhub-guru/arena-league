import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import { playerOfTheMatch, ratedPlayers, teamBest } from "../src/league/awards";
import { newGame, playMatchday } from "../src/league/season";
import { generateTeams } from "../src/league/teams";
import { standoutLines } from "../src/viewer/text";

const teams = generateTeams(9);
const match = (n: number) =>
  simulateMatch({ id: "a", season: 1, matchday: 1, home: teams[n % 8], away: teams[(n + 3) % 8], homeTactic: "balanced", awayTactic: "attacking", seed: hashSeed("award", n) });

describe("player of the match", () => {
  it("picks one player with a sensible rating, and the standout list agrees", () => {
    for (let n = 0; n < 40; n++) {
      const m = match(n);
      const best = playerOfTheMatch(m)!;
      expect(best).not.toBeNull();
      expect(best.rating).toBeGreaterThanOrEqual(4);
      expect(best.rating).toBeLessThanOrEqual(10);
      const all = ratedPlayers(m);
      expect(all[0].line.id).toBe(best.line.id);
      for (let i = 1; i < all.length; i++) expect(all[i].rating).toBeLessThanOrEqual(all[0].rating);
      expect(standoutLines(m, 1)[0]).toContain(best.line.name);
    }
  });

  it("usually comes from the winning side, and the best on each side is the best of that side", () => {
    let fromWinner = 0;
    let decided = 0;
    for (let n = 0; n < 150; n++) {
      const m = match(n);
      const [h, a] = teamBest(m);
      expect(h!.line.team).toBe(0);
      expect(a!.line.team).toBe(1);
      if (m.homeScore === m.awayScore) continue;
      decided++;
      if (playerOfTheMatch(m)!.line.team === (m.homeScore > m.awayScore ? 0 : 1)) fromWinner++;
    }
    expect(fromWinner / decided).toBeGreaterThan(0.6);
  });

  it("is saved on every fixture result", () => {
    const r = playMatchday(newGame(4, "dun"));
    for (const f of r.state.fixtures.filter((x) => x.matchday === 1)) {
      expect(f.result?.potm?.name).toBeTruthy();
      expect(f.result!.potm!.rating).toBeGreaterThanOrEqual(4);
    }
  });

  it("returns nothing for old logs without player stats", () => {
    const m = match(1);
    delete (m as { players?: unknown }).players;
    expect(playerOfTheMatch(m)).toBeNull();
    expect(standoutLines(m)).toEqual([]);
  });
});
