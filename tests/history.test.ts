import { describe, expect, it } from "vitest";
import { LEGENDS_PER_CLUB, LEGEND_MIN_SEASONS, RECORD_KEYS, defaultRecords, recordRetirement, type Legend } from "../src/league/history";
import { SAVE_VERSION, autoPlan, completeOffseason, isSeasonOver, migrateSave, newGame, playMatchday, seasonRecordFor, startNextSeason, type SeasonState } from "../src/league/season";
import { TEAM_DEFS } from "../src/league/teams";
import { emptyTotals } from "../src/engine/types";

function playSeason(s: SeasonState): SeasonState {
  while (!isSeasonOver(s)) s = playMatchday(s).state;
  return s;
}

describe("club records", () => {
  it("start higher for stronger clubs and are generated per club from the seed", () => {
    const sorted = [...TEAM_DEFS].sort((a, b) => b.strength - a.strength);
    const sum = (id: string) => { const r = defaultRecords(5, id, "men"); return RECORD_KEYS.reduce((t, k) => t + r[k].value, 0); };
    let top = 0, bottom = 0;
    for (let seed = 1; seed <= 10; seed++) {
      top += RECORD_KEYS.reduce((t, k) => t + defaultRecords(seed, sorted[0].id, "men")[k].value, 0);
      bottom += RECORD_KEYS.reduce((t, k) => t + defaultRecords(seed, sorted.at(-1)!.id, "men")[k].value, 0);
    }
    expect(top).toBeGreaterThan(bottom);
    expect(sum("ash")).toBe(sum("ash"));
    expect(defaultRecords(5, "ash", "men").playerTriesMatch.holder).not.toBe("");
    expect(defaultRecords(5, "ash", "men").biggestWin.holder).toBe("");
  });

  it("are only replaced by something bigger, and never fall", () => {
    let s = newGame(3, "ash");
    const start = structuredClone(s.records);
    for (let i = 0; i < 2; i++) {
      s = startNextSeason(playSeason(s));
      s = completeOffseason(s, autoPlan(s));
    }
    for (const club of Object.keys(start)) for (const k of RECORD_KEYS) {
      expect(s.records[club][k].value).toBeGreaterThanOrEqual(start[club][k].value);
      if (s.records[club][k].value > start[club][k].value) expect(s.records[club][k].season).toBeGreaterThan(0);
    }
  }, 120_000);
});

describe("history", () => {
  it("records champions, runners-up and the top scorer", () => {
    const s = playSeason(newGame(2, "ash"));
    const r = seasonRecordFor(s);
    expect(r.championId).not.toBe(r.runnerUpId);
    expect(r.championPoints).toBeGreaterThan(0);
    expect(r.topScorer?.points).toBeGreaterThan(0);
    const next = startNextSeason(s);
    expect(next.history).toHaveLength(1);
    expect(next.history[0].runnerUpId).toBe(r.runnerUpId);
  }, 60_000);

  it("migrates a version 8 save with founding records and no legends", () => {
    const old = { ...newGame(4, "ash"), version: 8 } as Partial<SeasonState> & { version: number };
    delete old.records;
    delete old.legends;
    const up = migrateSave(old as SeasonState)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(Object.keys(up.records)).toHaveLength(TEAM_DEFS.length);
    expect(up.legends).toEqual({});
  });
});

describe("retired legends", () => {
  const p = (i: number) => ({ id: `x${i}`, name: `Player ${i}`, role: "Anchor" as const, age: 33 });
  const career = (points: number, seasons: number) => ({ ...emptyTotals(), points, apps: seasons * 14, seasons });

  it("only keeps players with a real career", () => {
    const l: Record<string, Legend[]> = {};
    expect(recordRetirement(l, "ash", p(1), 60, career(100, LEGEND_MIN_SEASONS - 1), 5)).toBeNull();
    expect(recordRetirement(l, "ash", p(2), 60, undefined, 5)).toBeNull();
    expect(recordRetirement(l, "ash", p(3), 60, career(100, LEGEND_MIN_SEASONS), 5)?.name).toBe("Player 3");
    expect(l.ash).toHaveLength(1);
  });

  it("keeps the best few per club, and keeps clubs separate", () => {
    const l: Record<string, Legend[]> = {};
    for (let i = 0; i < LEGENDS_PER_CLUB + 3; i++) recordRetirement(l, "ash", p(i), 60, career(10 * (i + 1), 4), 5);
    recordRetirement(l, "bla", p(99), 60, career(5, 4), 5);
    expect(l.ash).toHaveLength(LEGENDS_PER_CLUB);
    expect(l.ash[0].points).toBe(10 * (LEGENDS_PER_CLUB + 3));
    expect(l.ash.some((x) => x.points === 10)).toBe(false);
    expect(l.bla).toHaveLength(1);
  });

  it("are remembered across a long career run", () => {
    let s = newGame(7, "ash");
    for (let i = 0; i < 8; i++) {
      s = startNextSeason(playSeason(s));
      s = completeOffseason(s, autoPlan(s));
    }
    const all = Object.values(s.legends).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) expect(l.seasons).toBeGreaterThanOrEqual(LEGEND_MIN_SEASONS);
  }, 180_000);
});
