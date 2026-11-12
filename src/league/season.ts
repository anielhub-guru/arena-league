import { hashSeed, Rng } from "../engine/rng";
import { MatchSim, RED_BAN, SHAPE_BY_STYLE } from "../engine/match";
import { STAT_KEYS, emptyTotals, ROLES, type Attr, type Gender, type MatchLog, type Player, type PlayerTotals, type Role, type ShapeId, type TacticId, type Team } from "../engine/types";
import { describeLine, impact, playerOfTheMatch } from "./awards";
import { buildSchedule, type Fixture } from "./schedule";
import { computeStandings, standingsAt } from "./standings";
import { evolvePlayers, generateTeams, initialPotential, makeProspects, overall } from "./teams";

export { describeLine, impact };

export const SAVE_VERSION = 5;

export type TrainingFocus = "attack" | "defence" | "kicking" | "fitness";
export const TRAINING: Record<TrainingFocus, { label: string; description: string; attrs: Attr[] }> = {
  attack: { label: "Attack", description: "Power, pace and handling.", attrs: ["power", "pace", "handling"] },
  defence: { label: "Defence", description: "Tackling.", attrs: ["tackling"] },
  kicking: { label: "Kicking", description: "Goal-kicking and territory kicks.", attrs: ["kicking"] },
  fitness: { label: "Fitness", description: "Stamina, so players stay fresh late on.", attrs: ["stamina"] },
};

/** One offseason decision: pick a prospect for a vacancy. */
export interface IntakeSlot {
  role: Role;
  /** The squad member who retires (mandatory slot) or who you may replace (optional slot). */
  outId: string;
  optional: boolean;
  /** Prospects to choose from, with true potential hidden behind `scouted`. */
  options: Player[];
}

export interface Intake {
  slots: IntakeSlot[];
}

export interface SeasonRecord {
  season: number;
  championId: string;
  managedPosition: number;
}

export interface NewsItem {
  season: number;
  matchday: number;
  text: string;
}

/** Career totals include a count of seasons played. */
export type CareerTotals = PlayerTotals & { seasons: number };

export interface SeasonState {
  version: number;
  seed: number;
  /** Which league you are coaching in. */
  gender: Gender;
  season: number;
  managedId: string;
  /** Tactic chosen by the human manager. */
  tactic: TacticId;
  /** Defensive shape chosen by the human manager. */
  shape: ShapeId;
  training: TrainingFocus;
  teams: Team[];
  fixtures: Fixture[];
  /** Next matchday to play (1-based). Greater than totalMatchdays when the season is over. */
  matchday: number;
  totalMatchdays: number;
  history: SeasonRecord[];
  /** Newest first. */
  news: NewsItem[];
  /** This season's counting stats by player id (every club). */
  seasonStats: Record<string, PlayerTotals>;
  /** Completed seasons, by player id. Add the current season for a full career line. */
  careerStats: Record<string, CareerTotals>;
  /** Offseason decisions waiting on the manager. The new season cannot be played until resolved. */
  intake?: Intake;
}

/** Upgrades a saved season from an older version, or returns null if it cannot be upgraded. */
export function migrateSave(raw: SeasonState): SeasonState | null {
  let s = raw;
  if (s.version === 3) s = { ...s, version: 4, seasonStats: {}, careerStats: {} };
  if (s.version === 4) {
    s = structuredClone(s);
    for (const t of s.teams) for (const p of t.players) p.potential ??= initialPotential(p, new Rng(hashSeed(s.seed, p.id, "pot")));
    s.version = 5;
  }
  if (s.version !== SAVE_VERSION) return null;
  return { ...s, shape: s.shape ?? "sweeper" };
}

export function newGame(seed: number, managedId: string, gender: Gender = "men"): SeasonState {
  const teams = generateTeams(seed, gender);
  if (!teams.some((t) => t.id === managedId)) throw new Error(`Unknown team ${managedId}`);
  const fixtures = buildSchedule(teams.map((t) => t.id), 1);
  const me = teams.find((t) => t.id === managedId)!;
  return {
    version: SAVE_VERSION,
    seed,
    gender,
    season: 1,
    managedId,
    tactic: me.style,
    shape: "sweeper",
    training: "attack",
    teams,
    fixtures,
    matchday: 1,
    totalMatchdays: Math.max(...fixtures.map((f) => f.matchday)),
    history: [],
    news: [{ season: 1, matchday: 0, text: `Welcome to ${me.name}. Set your starting five, tactic and training focus, then play your first match.` }],
    seasonStats: {},
    careerStats: {},
  };
}

export const isSeasonOver = (s: SeasonState) => s.matchday > s.totalMatchdays;

export function teamById(s: SeasonState, id: string): Team {
  const t = s.teams.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

export function managedFixture(s: SeasonState): Fixture | undefined {
  return s.fixtures.find((f) => f.matchday === s.matchday && (f.homeId === s.managedId || f.awayId === s.managedId));
}

/** Builds a steppable simulation for a fixture, using the manager's tactic for their own club. */
export function buildSim(s: SeasonState, f: Fixture, live = false): MatchSim {
  const home = teamById(s, f.homeId);
  const away = teamById(s, f.awayId);
  return new MatchSim({
    id: f.id,
    season: s.season,
    matchday: f.matchday,
    home,
    away,
    homeTactic: home.id === s.managedId ? s.tactic : home.style,
    awayTactic: away.id === s.managedId ? s.tactic : away.style,
    homeShape: home.id === s.managedId ? s.shape : SHAPE_BY_STYLE[home.style],
    awayShape: away.id === s.managedId ? s.shape : SHAPE_BY_STYLE[away.style],
    // AI clubs always adapt after a card; the manager decides themselves when watching live.
    homeAuto: !(live && home.id === s.managedId),
    awayAuto: !(live && away.id === s.managedId),
    seed: hashSeed(s.seed, s.season, f.id),
  });
}

/**
 * Plays the next matchday. If the manager watched their match live, pass its log
 * and that result is used instead of simulating it. Returns the new state (the
 * input is untouched) and every match log for saving.
 */
export function playMatchday(prev: SeasonState, managedLog?: MatchLog): { state: SeasonState; logs: MatchLog[] } {
  if (isSeasonOver(prev)) throw new Error("Season is over");
  if (prev.intake) throw new Error("Choose your new signings before playing");
  const state = structuredClone(prev);
  const ids = state.teams.map((t) => t.id);
  const before = computeStandings(ids, state.fixtures);
  const logs: MatchLog[] = [];
  for (const f of state.fixtures.filter((x) => x.matchday === state.matchday)) {
    const log = managedLog && managedLog.id === f.id ? managedLog : buildSim(state, f).runToEnd().toLog();
    const best = playerOfTheMatch(log);
    f.result = {
      homeScore: log.homeScore,
      awayScore: log.awayScore,
      homeTries: log.homeTries,
      awayTries: log.awayTries,
      ...(best ? { potm: { id: best.line.id, name: best.line.name, club: best.club, rating: best.rating } } : {}),
    };
    logs.push(log);
  }

  const md = state.matchday;
  const news: string[] = [];
  const mine = logs.find((l) => l.homeId === state.managedId || l.awayId === state.managedId);
  if (mine) {
    const home = mine.homeId === state.managedId;
    const [pf, pa] = home ? [mine.homeScore, mine.awayScore] : [mine.awayScore, mine.homeScore];
    const opp = home ? mine.awayName : mine.homeName;
    const verb = pf > pa ? "Won" : pf === pa ? "Drew" : "Lost";
    const after = computeStandings(ids, state.fixtures);
    const was = before.findIndex((r) => r.teamId === state.managedId) + 1;
    const now = after.findIndex((r) => r.teamId === state.managedId) + 1;
    const move = md === 1 ? `Now ${ord(now)}.` : now < was ? `Up to ${ord(now)}.` : now > was ? `Down to ${ord(now)}.` : `Holding ${ord(now)}.`;
    news.push(`${verb} ${pf}-${pa} ${home ? "vs" : "at"} ${opp}. ${move}`);
    if (now === 1 && was !== 1) news.push("You have gone top of the table.");
  }
  news.push(...recordPlayers(state, logs));
  news.push(...train(state, md));
  state.news = [...news.map((text) => ({ season: state.season, matchday: md, text })), ...state.news].slice(0, 14);
  state.matchday++;
  return { state, logs };
}

/** The player's career: completed seasons plus the current one. */
export function careerLine(s: SeasonState, id: string): CareerTotals {
  const total: CareerTotals = { ...emptyTotals(), seasons: 0 };
  const prior = s.careerStats[id];
  if (prior) Object.assign(total, prior);
  const now = s.seasonStats[id];
  if (now) {
    for (const k of STAT_KEYS) total[k] += now[k];
    if (now.apps > 0) total.seasons++;
  }
  return total;
}

export const isSuspended = (p: { ban?: number }) => (p.ban ?? 0) > 0;

/** Best fit for a slot from players who are free to play: same natural role first, then overall rating. */
export function bestReplacement(team: Team, slot: Role, exclude: Set<string>) {
  return team.players
    .filter((p) => !exclude.has(p.id) && !isSuspended(p))
    .sort((a, b) => Number(b.role === slot) - Number(a.role === slot) || overall(b) - overall(a))[0];
}

/**
 * Adds the matchday's player stats to the season, serves bans, and applies new ones.
 * Bans are decremented before new red cards are applied, so a player sent off on matchday N
 * misses matchday N+1 and is available again on N+2.
 */
function recordPlayers(state: SeasonState, logs: MatchLog[]): string[] {
  const news: string[] = [];
  const everyone = new Map(state.teams.flatMap((t) => t.players.map((p) => [p.id, { p, t }] as const)));
  for (const { p } of everyone.values()) if ((p.ban ?? 0) > 0) p.ban = (p.ban ?? 0) - 1;
  for (const log of logs) {
    for (const l of log.players ?? []) {
      const tot = (state.seasonStats[l.id] ??= emptyTotals());
      for (const k of STAT_KEYS) tot[k] += l[k];
      if (l.reds > 0) {
        const who = everyone.get(l.id);
        if (who) who.p.ban = RED_BAN;
      }
    }
  }
  const mine = logs.find((l) => l.homeId === state.managedId || l.awayId === state.managedId);
  const team = teamById(state, state.managedId);
  if (mine?.players) {
    const lines = mine.players.filter((l) => team.players.some((p) => p.id === l.id));
    const star = [...lines].sort((a, b) => impact(b) - impact(a))[0];
    if (star && impact(star) > 3) news.push(`Standout: ${star.name} (${describeLine(star)}).`);
    for (const l of lines) {
      if (l.reds > 0) news.push(`${l.name} was sent off and is suspended for your next match.`);
      else if (l.yellows > 0) news.push(`${l.name} spent time in the sin bin.`);
    }
  }
  // Keep the manager's starting five legal: replace any suspended starter with the best available player.
  for (let i = 0; i < ROLES.length; i++) {
    const cur = team.players.find((p) => p.id === team.lineup[i]);
    if (!cur || !isSuspended(cur)) continue;
    const rep = bestReplacement(team, ROLES[i], new Set(team.lineup));
    if (!rep) continue;
    team.lineup[i] = rep.id;
    news.push(`${cur.name} is suspended, so ${rep.name} comes into the starting five at ${ROLES[i]}.`);
  }
  return news;
}

function ord(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Weekly training: a few squad members have a chance to gain a point in the focus area. */
function train(state: SeasonState, md: number): string[] {
  const rng = new Rng(hashSeed(state.seed, state.season, "train", md));
  const team = teamById(state, state.managedId);
  const focus = TRAINING[state.training];
  const out: string[] = [];
  for (const p of [...team.players].sort(() => rng.next() - 0.5).slice(0, 3)) {
    if (!rng.chance(0.8)) continue;
    const attr = rng.pick(focus.attrs);
    if (p[attr] >= 95 || overall(p) >= (p.potential ?? 99)) continue;
    p[attr]++;
    out.push(`Training: ${p.name} improved ${attr} to ${p[attr]}.`);
  }
  return out;
}

export function startNextSeason(prev: SeasonState): SeasonState {
  if (!isSeasonOver(prev)) throw new Error("Season is not over");
  const state = structuredClone(prev);
  const ids = state.teams.map((t) => t.id);
  const table = standingsAt(ids, state.fixtures, state.totalMatchdays);
  const finish = table.findIndex((r) => r.teamId === state.managedId) + 1;
  state.history.push({ season: state.season, championId: table[0].teamId, managedPosition: finish });
  for (const [id, now] of Object.entries(state.seasonStats)) {
    const career = (state.careerStats[id] ??= { ...emptyTotals(), seasons: 0 });
    for (const k of STAT_KEYS) career[k] += now[k];
    if (now.apps > 0) career.seasons++;
  }
  state.seasonStats = {};
  state.season++;
  const retirees = evolvePlayers(state.teams, hashSeed(state.seed, state.season));
  const news: string[] = [`Season ${state.season} begins. Squads have aged and ratings have shifted.`];
  let n = 0;
  for (const team of state.teams) {
    const out = retirees.get(team.id) ?? [];
    if (team.id === state.managedId) {
      const slots: IntakeSlot[] = out.map((r) => ({ role: r.role, outId: r.id, optional: false, options: makeProspects(team, `${state.season}.${n++}`, r.role, state.seed) }));
      for (const r of out) {
        r.retiring = true;
        news.push(`${r.name} (${r.age}) retires. Choose a replacement.`);
      }
      const oldest = team.players.filter((p) => !p.retiring).sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))[0];
      if (oldest && oldest.age >= 28) slots.push({ role: oldest.role, outId: oldest.id, optional: true, options: makeProspects(team, `${state.season}.${n++}`, oldest.role, state.seed) });
      if (slots.length) state.intake = { slots };
    } else {
      // AI clubs know their prospects' true potential and take the best one.
      for (const r of out) {
        const best = makeProspects(team, `${state.season}.${n++}`, r.role, state.seed).sort((a, b) => (b.potential ?? 0) - (a.potential ?? 0))[0];
        replacePlayer(team, r.id, best);
        delete state.careerStats[r.id];
      }
    }
  }
  state.fixtures = buildSchedule(ids, state.season);
  state.matchday = 1;
  if (state.intake) news.push("Your offseason decisions are on the Overview tab. The season starts once you confirm them.");
  state.news = [...news.map((text) => ({ season: state.season, matchday: 0, text })), ...state.news].slice(0, 14);
  return state;
}

/** Put a new player in an old one's squad place and starting slot. */
function replacePlayer(team: Team, oldId: string, next: Player) {
  const i = team.players.findIndex((p) => p.id === oldId);
  if (i < 0) throw new Error(`Unknown player ${oldId}`);
  team.players[i] = next;
  team.lineup = team.lineup.map((id) => (id === oldId ? next.id : id));
}

/** Sensible default picks: the best scouted prospect per slot, and only swap an optional slot if it is an upgrade. */
export function autoPicks(s: SeasonState): Record<number, string | null> {
  const picks: Record<number, string | null> = {};
  const team = teamById(s, s.managedId);
  (s.intake?.slots ?? []).forEach((slot, i) => {
    const best = [...slot.options].sort((a, b) => (b.scouted ?? 0) - (a.scouted ?? 0))[0];
    const out = team.players.find((p) => p.id === slot.outId);
    picks[i] = slot.optional && (!out || (best.scouted ?? 0) <= (out.potential ?? 0) + 2) ? null : best.id;
  });
  return picks;
}

/** Applies the manager's offseason choices. `picks[i]` is the chosen prospect id for slot i; optional slots may be null. */
export function signProspects(prev: SeasonState, picks: Record<number, string | null>): SeasonState {
  if (!prev.intake) throw new Error("Nothing to decide");
  const state = structuredClone(prev);
  const team = teamById(state, state.managedId);
  const news: string[] = [];
  state.intake!.slots.forEach((slot, i) => {
    const id = picks[i] ?? null;
    if (!id) {
      if (!slot.optional) throw new Error("Choose a replacement for every retiring player");
      return;
    }
    const prospect = slot.options.find((o) => o.id === id);
    if (!prospect) throw new Error("That prospect is not on the shortlist");
    const out = team.players.find((p) => p.id === slot.outId);
    replacePlayer(team, slot.outId, prospect);
    news.push(slot.optional ? `Signed ${prospect.name} (${prospect.role}, ${prospect.age}) to succeed ${out?.name ?? "a veteran"}.` : `Signed ${prospect.name} (${prospect.role}, ${prospect.age}) to replace ${out?.name ?? "a retiree"}.`);
  });
  delete state.intake;
  state.news = [...news.map((text) => ({ season: state.season, matchday: 0, text })), ...state.news].slice(0, 14);
  return state;
}
