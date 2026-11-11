import { hashSeed, Rng } from "../engine/rng";
import { MatchSim } from "../engine/match";
import { type Attr, type MatchLog, type TacticId, type Team } from "../engine/types";
import { buildSchedule, type Fixture } from "./schedule";
import { computeStandings, standingsAt } from "./standings";
import { evolvePlayers, generateTeams } from "./teams";

export const SAVE_VERSION = 2;

export type TrainingFocus = "attack" | "defence" | "kicking" | "fitness";
export const TRAINING: Record<TrainingFocus, { label: string; description: string; attrs: Attr[] }> = {
  attack: { label: "Attack", description: "Power, pace and handling.", attrs: ["power", "pace", "handling"] },
  defence: { label: "Defence", description: "Tackling.", attrs: ["tackling"] },
  kicking: { label: "Kicking", description: "Goal-kicking and territory kicks.", attrs: ["kicking"] },
  fitness: { label: "Fitness", description: "Stamina, so players stay fresh late on.", attrs: ["stamina"] },
};

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

export interface SeasonState {
  version: number;
  seed: number;
  season: number;
  managedId: string;
  /** Tactic chosen by the human manager. */
  tactic: TacticId;
  training: TrainingFocus;
  teams: Team[];
  fixtures: Fixture[];
  /** Next matchday to play (1-based). Greater than totalMatchdays when the season is over. */
  matchday: number;
  totalMatchdays: number;
  history: SeasonRecord[];
  /** Newest first. */
  news: NewsItem[];
}

export function newGame(seed: number, managedId: string): SeasonState {
  const teams = generateTeams(seed);
  if (!teams.some((t) => t.id === managedId)) throw new Error(`Unknown team ${managedId}`);
  const fixtures = buildSchedule(teams.map((t) => t.id), 1);
  const me = teams.find((t) => t.id === managedId)!;
  return {
    version: SAVE_VERSION,
    seed,
    season: 1,
    managedId,
    tactic: me.style,
    training: "attack",
    teams,
    fixtures,
    matchday: 1,
    totalMatchdays: Math.max(...fixtures.map((f) => f.matchday)),
    history: [],
    news: [{ season: 1, matchday: 0, text: `Welcome to ${me.name}. Set your starting five, tactic and training focus, then play your first match.` }],
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
export function buildSim(s: SeasonState, f: Fixture): MatchSim {
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
  const state = structuredClone(prev);
  const ids = state.teams.map((t) => t.id);
  const before = computeStandings(ids, state.fixtures);
  const logs: MatchLog[] = [];
  for (const f of state.fixtures.filter((x) => x.matchday === state.matchday)) {
    const log = managedLog && managedLog.id === f.id ? managedLog : buildSim(state, f).runToEnd().toLog();
    f.result = { homeScore: log.homeScore, awayScore: log.awayScore, homeTries: log.homeTries, awayTries: log.awayTries };
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
  news.push(...train(state, md));
  state.news = [...news.map((text) => ({ season: state.season, matchday: md, text })), ...state.news].slice(0, 14);
  state.matchday++;
  return { state, logs };
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
    if (p[attr] >= 95) continue;
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
  state.season++;
  evolvePlayers(state.teams, hashSeed(state.seed, state.season));
  state.fixtures = buildSchedule(ids, state.season);
  state.matchday = 1;
  state.news = [{ season: state.season, matchday: 0, text: `Season ${state.season} begins. Squads have aged and ratings have shifted.` }, ...state.news].slice(0, 14);
  return state;
}


