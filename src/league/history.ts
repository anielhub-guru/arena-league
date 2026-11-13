import { Rng, hashSeed } from "../engine/rng";
import type { Gender, MatchLog, PlayerTotals, Role } from "../engine/types";
import { TEAM_DEFS, randomName } from "./teams";

/** Everything a club keeps a record of. Team records are for the club as a side, player records for one of its players. */
export const RECORD_KEYS = ["biggestWin", "highScore", "mostTries", "playerPointsMatch", "playerTriesMatch", "leaguePoints", "playerPointsSeason", "playerTriesSeason"] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];

export const RECORD_META: Record<RecordKey, { label: string; kind: "team" | "player" }> = {
  biggestWin: { label: "Biggest win (margin)", kind: "team" },
  highScore: { label: "Most points in a match", kind: "team" },
  mostTries: { label: "Most tries in a match", kind: "team" },
  leaguePoints: { label: "Most league points in a season", kind: "team" },
  playerPointsMatch: { label: "Most points by a player in a match", kind: "player" },
  playerTriesMatch: { label: "Most tries by a player in a match", kind: "player" },
  playerPointsSeason: { label: "Most points by a player in a season", kind: "player" },
  playerTriesSeason: { label: "Most tries by a player in a season", kind: "player" },
};

export interface ClubRecord {
  value: number;
  /** The player, for player records. Empty for team records. */
  holder: string;
  /** 0 means set before the league began (a generated founding record). */
  season: number;
  /** The opposition, for match records. */
  vs?: string;
}
export type ClubRecords = Record<RecordKey, ClubRecord>;
export type LeagueRecords = Record<string, ClubRecords>;

/** What a typical club's founding records look like, from watching simulated seasons. Strong clubs sit higher. */
const BASE: Record<RecordKey, number> = { biggestWin: 26, highScore: 34, mostTries: 5, playerPointsMatch: 13, playerTriesMatch: 3, leaguePoints: 44, playerPointsSeason: 80, playerTriesSeason: 12 };

/**
 * Founding records for a club. Follows the same ordering as the club goals: the strongest clubs by
 * strength start with the highest records, the weakest with the lowest, with a little noise.
 */
export function defaultRecords(seed: number, clubId: string, gender: Gender): ClubRecords {
  const order = TEAM_DEFS.map((d, i) => ({ id: d.id, strength: d.strength, i })).sort((a, b) => b.strength - a.strength || a.i - b.i);
  const rank = Math.max(0, order.findIndex((d) => d.id === clubId));
  const tilt = 1.1 - (rank / Math.max(1, order.length - 1)) * 0.22;
  const rng = new Rng(hashSeed(seed, "records", clubId, gender));
  const out = {} as ClubRecords;
  for (const key of RECORD_KEYS) {
    const value = Math.max(2, Math.round(BASE[key] * tilt * (0.92 + rng.next() * 0.16)));
    const vs = RECORD_META[key].kind === "team" || key.endsWith("Season") ? undefined : TEAM_DEFS[rng.int(0, TEAM_DEFS.length - 1)].name;
    out[key] = { value, holder: RECORD_META[key].kind === "player" ? randomName(rng, gender) : "", season: 0, ...(vs ? { vs } : {}) };
  }
  return out;
}

export function defaultLeagueRecords(seed: number, gender: Gender): LeagueRecords {
  return Object.fromEntries(TEAM_DEFS.map((d) => [d.id, defaultRecords(seed, d.id, gender)]));
}

export interface BrokenRecord {
  clubId: string;
  text: string;
}

function beat(recs: ClubRecords, key: RecordKey, value: number, holder: string, season: number, vs?: string): boolean {
  if (value <= recs[key].value) return false;
  recs[key] = { value, holder, season, ...(vs ? { vs } : {}) };
  return true;
}

/** Checks one finished match against both clubs' records. Mutates `all` and says what was broken. */
export function recordMatch(all: LeagueRecords, log: MatchLog): BrokenRecord[] {
  const broken: BrokenRecord[] = [];
  for (const side of [0, 1] as const) {
    const clubId = side === 0 ? log.homeId : log.awayId;
    const recs = all[clubId];
    if (!recs) continue;
    const [pf, pa, tries] = side === 0 ? [log.homeScore, log.awayScore, log.homeTries] : [log.awayScore, log.homeScore, log.awayTries];
    const vs = side === 0 ? log.awayName : log.homeName;
    const club = side === 0 ? log.homeName : log.awayName;
    const say = (what: string) => broken.push({ clubId, text: `New club record for ${club}: ${what}.` });
    if (beat(recs, "biggestWin", pf - pa, "", log.season, vs)) say(`biggest win, ${pf}-${pa} against ${vs}`);
    if (beat(recs, "highScore", pf, "", log.season, vs)) say(`${pf} points in a match against ${vs}`);
    if (beat(recs, "mostTries", tries, "", log.season, vs)) say(`${tries} tries in a match against ${vs}`);
    for (const l of log.players ?? []) {
      if (l.team !== side) continue;
      if (beat(recs, "playerPointsMatch", l.points, l.name, log.season, vs)) say(`${l.name} scores ${l.points} points against ${vs}`);
      if (beat(recs, "playerTriesMatch", l.tries, l.name, log.season, vs)) say(`${l.name} scores ${l.tries} tries against ${vs}`);
    }
  }
  return broken;
}

/** Checks the finished season: league points per club and each club's best scorers. Mutates `all`. */
export function recordSeasonEnd(all: LeagueRecords, season: number, table: { teamId: string; points: number }[], clubs: { id: string; name: string; players: { id: string; name: string }[] }[], stats: Record<string, PlayerTotals>): BrokenRecord[] {
  const broken: BrokenRecord[] = [];
  for (const club of clubs) {
    const recs = all[club.id];
    if (!recs) continue;
    const say = (what: string) => broken.push({ clubId: club.id, text: `New club record for ${club.name}: ${what}.` });
    const row = table.find((r) => r.teamId === club.id);
    if (row && beat(recs, "leaguePoints", row.points, "", season)) say(`${row.points} league points in a season`);
    for (const p of club.players) {
      const st = stats[p.id];
      if (!st) continue;
      if (beat(recs, "playerPointsSeason", st.points, p.name, season)) say(`${p.name} scores ${st.points} points in a season`);
      if (beat(recs, "playerTriesSeason", st.tries, p.name, season)) say(`${p.name} scores ${st.tries} tries in a season`);
    }
  }
  return broken;
}

// ------------------------------------------------------------------ retired legends

/** A long-serving player who has retired. Only players with a real career are kept. */
export interface Legend {
  id: string;
  name: string;
  role: Role;
  age: number;
  /** The season they retired after. */
  season: number;
  seasons: number;
  /** Overall rating at retirement. */
  rating: number;
  apps: number;
  points: number;
  tries: number;
  tackles: number;
  /** Ranking value: points, tackling and work-rate over the career. */
  score: number;
}

/** Seasons played before a retiree counts as a club legend. */
export const LEGEND_MIN_SEASONS = 3;
/** Legends kept per club. The lowest ranked drop off first. */
export const LEGENDS_PER_CLUB = 8;

export const legendScore = (t: PlayerTotals) => Math.round(t.points + t.tackles * 0.6 + t.lineBreaks * 1.5 + t.turnovers * 2);

/** Adds a retiree to their club's legends if they played long enough. Mutates `legends`. Returns the legend if kept. */
export function recordRetirement(legends: Record<string, Legend[]>, clubId: string, p: { id: string; name: string; role: Role; age: number }, rating: number, career: (PlayerTotals & { seasons: number }) | undefined, season: number): Legend | null {
  if (!career || career.seasons < LEGEND_MIN_SEASONS) return null;
  const legend: Legend = { id: p.id, name: p.name, role: p.role, age: p.age, season, seasons: career.seasons, rating, apps: career.apps, points: career.points, tries: career.tries, tackles: career.tackles, score: legendScore(career) };
  const list = (legends[clubId] ??= []);
  list.push(legend);
  list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  list.length = Math.min(list.length, LEGENDS_PER_CLUB);
  return list.includes(legend) ? legend : null;
}
