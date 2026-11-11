import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import { generateTeams } from "../src/league/teams";
import { buildSchedule } from "../src/league/schedule";
import { computeStandings } from "../src/league/standings";
import { playMatchday, isSeasonOver, newGame, startNextSeason } from "../src/league/season";

const teams = generateTeams(7);
const play = (i: number, j: number, seed: number) =>
  simulateMatch({ id: "t", season: 1, matchday: 1, home: teams[i], away: teams[j], homeTactic: "balanced", awayTactic: "balanced", seed });

describe("match engine", () => {
  it("is deterministic for a seed", () => {
    expect(play(0, 1, 42)).toEqual(play(0, 1, 42));
  });
  it("scores are consistent with events", () => {
    const m = play(2, 3, 5);
    const last = m.events[m.events.length - 1];
    expect(last.type).toBe("fulltime");
    expect(last.homeScore).toBe(m.homeScore);
    expect(m.homeScore).toBe(m.stats[0].tries * 5 + m.stats[0].conversions * 2 + m.stats[0].penaltyGoals * 3 + m.stats[0].dropGoals * 3);
  });
  it("produces sane scorelines and a stronger side wins more", () => {
    let total = 0, draws = 0, strongWins = 0, tries = 0;
    const N = 400;
    for (let n = 0; n < N; n++) {
      const m = simulateMatch({ id: "b", season: 1, matchday: 1, home: teams[3], away: teams[5], homeTactic: "balanced", awayTactic: "balanced", seed: hashSeed("bal", n) });
      total += m.homeScore + m.awayScore;
      tries += m.homeTries + m.awayTries;
      if (m.homeScore === m.awayScore) draws++;
      if (m.homeScore > m.awayScore) strongWins++;
    }
    console.log({ avgPoints: total / N, avgTries: tries / N, drawPct: draws / N, strongWinPct: strongWins / N });
    expect(total / N).toBeGreaterThan(25);
    expect(total / N).toBeLessThan(70);
    expect(draws / N).toBeLessThan(0.1);
    expect(strongWins / N).toBeGreaterThan(0.55);
    expect(strongWins / N).toBeLessThan(0.95);
  });
});

describe("highlights", () => {
  it("has a watchable number of highlights, each with a cast", () => {
    let hl = 0, inter = 0;
    const N = 200;
    for (let n = 0; n < N; n++) {
      const m = simulateMatch({ id: "h", season: 1, matchday: 1, home: teams[0], away: teams[1], homeTactic: "balanced", awayTactic: "balanced", seed: hashSeed("hl", n) });
      for (const e of m.events) {
        if (e.highlight) {
          hl++;
          expect(e.cast?.a).toHaveLength(5);
          expect(e.cast?.d).toHaveLength(5);
        }
        if (e.type === "intercept") inter++;
      }
    }
    const m0 = play(0, 1, 9);
    let prev = 0;
    for (const e of m0.events) {
      expect(e.sec).toBeGreaterThanOrEqual(prev);
      prev = e.sec;
    }
    expect(m0.events[m0.events.length - 1].sec).toBe(2400);
    console.log({ highlightsPerMatch: hl / N, interceptsPerMatch: inter / N });
    expect(hl / N).toBeGreaterThan(7);
    expect(hl / N).toBeLessThan(20);
    expect(inter / N).toBeGreaterThan(0.2);
  });
});

describe("league", () => {
  it("schedules a valid double round robin", () => {
    const ids = teams.map((t) => t.id);
    const fx = buildSchedule(ids, 1);
    expect(fx).toHaveLength(56);
    for (let md = 1; md <= 14; md++) {
      const day = fx.filter((f) => f.matchday === md);
      expect(new Set(day.flatMap((f) => [f.homeId, f.awayId])).size).toBe(8);
    }
    const pairs = new Set(fx.map((f) => `${f.homeId}>${f.awayId}`));
    expect(pairs.size).toBe(56);
  });
  it("plays a full season and rolls over", () => {
    let s = newGame(11, "dun");
    while (!isSeasonOver(s)) {
      const r = playMatchday(s);
      expect(r.logs).toHaveLength(4);
      s = r.state;
    }
    const table = computeStandings(s.teams.map((t) => t.id), s.fixtures);
    expect(table.every((r) => r.played === 14)).toBe(true);
    const s2 = startNextSeason(JSON.parse(JSON.stringify(s)));
    expect(s2.season).toBe(2);
    expect(s2.matchday).toBe(1);
    expect(s2.history).toHaveLength(1);
    expect(s2.fixtures.every((f) => !f.result)).toBe(true);
  });
});
