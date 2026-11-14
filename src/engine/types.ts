export type Role = "Anchor" | "Bruiser" | "Pivot" | "Winger" | "Sweeper";
/** Starting-five slots, in lineup order. */
export const ROLES: readonly Role[] = ["Anchor", "Bruiser", "Pivot", "Winger", "Sweeper"];
export type Attr = "power" | "pace" | "handling" | "tackling" | "kicking" | "stamina";
export const ATTRS: readonly Attr[] = ["power", "pace", "handling", "tackling", "kicking", "stamina"];

/** Avatar appearance. Indices into the lists in league/look.ts. */
export interface Look {
  /** Hairstyle / portrait crop, one of the visible hairstyles. */
  portrait: number;
  build: number;
  /** Which of the two base faces. */
  face: number;
  eyes: number;
  nose: number;
  lips: number;
  jaw: number;
}

export interface Player {
  id: string;
  name: string;
  role: Role;
  age: number;
  power: number;
  pace: number;
  handling: number;
  tackling: number;
  kicking: number;
  stamina: number;
  /** Carried-over tiredness from recent matches, 0 to 100 (0 or missing = fresh). High stamina builds less and recovers faster. */
  tired?: number;
  /** Matches still to miss after a red card (0 or missing = available). */
  ban?: number;
  /** Ceiling for overall rating. Growth and training stop here. Missing on very old saves until migrated. */
  potential?: number;
  /** Noisy scouting estimate of potential, set on prospects so the true value stays hidden until signed. */
  scouted?: number;
  /** Retires when the offseason decision is confirmed. */
  retiring?: boolean;
  /** Avatar look, generated when the player is created. Missing on older saves: see lookOf. */
  look?: Look;
}

export type TacticId = "balanced" | "attacking" | "defensive" | "territory";
/** Defensive shape: where the defence puts its weight. */
export type ShapeId = "sweeper" | "flat" | "narrow";

export type Gender = "men" | "women";

export interface Team {
  id: string;
  gender: Gender;
  name: string;
  short: string;
  /** Style used when the AI manages this club. */
  style: TacticId;
  /** Full squad of ten: five starters, three on the bench and two reserves. */
  players: Player[];
  /** Ids of the two reserves. They are outside the matchday eight and can only be swapped in between matches. */
  reserves?: string[];
  /** Ids of the starting five, in ROLES slot order. */
  lineup: string[];
}

export type EventType =
  | "kickoff"
  | "sub"
  | "talk"
  | "carry"
  | "break"
  | "kick"
  | "knock-on"
  | "turnover"
  | "intercept"
  | "penalty"
  | "penalty-goal"
  | "penalty-miss"
  | "yellow"
  | "red"
  | "return"
  | "drop-goal"
  | "drop-miss"
  | "try"
  | "conversion"
  | "conversion-miss"
  | "halftime"
  | "fulltime";

/** Who is involved in a highlight, used to choreograph it. Indices are lineup slots (ROLES order). */
export interface HighlightCast {
  a: string[];
  d: string[];
  /** Main attacking player (carrier or kicker), -1 if none. */
  ai: number;
  /** Main defending player (tackler or interceptor), -1 if none. */
  di: number;
  /** Kicker's slot for a grubber or chip and chase (then `ai` is the chaser). */
  ki?: number;
  /** Lineup slots of attackers who are in the sin bin or sent off, so not on the pitch. */
  offA?: number[];
  /** Lineup slots of defenders who are in the sin bin or sent off. */
  offD?: number[];
  /** Attacking and defending tactic and defensive shape, so the animation can show them. */
  ta?: TacticId;
  td?: TacticId;
  sa?: ShapeId;
  sd?: ShapeId;
}

export interface MatchEvent {
  /** Match time in seconds (0-2400) at which this event happens. */
  sec: number;
  /** True for action moments worth animating. */
  highlight?: boolean;
  /** Outcome detail for the animation, e.g. "post" for a kick off the upright. */
  variant?: string;
  /** Which way a kick at goal went: -1 left of centre, 1 right (from the kicker's view). */
  side?: -1 | 1;
  cast?: HighlightCast;
  /** Sim step that produced this event (events in one step are shown together). */
  step: number;
  minute: number;
  /** Side in possession when the phase began (drives the arena animation). */
  att?: 0 | 1;
  /** Ball position in absolute metres (0 = home try line, 100 = away try line) before and after. */
  x0: number;
  x1: number;
  type: EventType;
  text: string;
  /** Highlights shown in "key events" mode. */
  key: boolean;
  /** 0 = home, 1 = away. */
  team?: 0 | 1;
  player?: string;
  /** Id of the player involved, set for card events. */
  pid?: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamStats {
  possession: number;
  carries: number;
  metres: number;
  tackles: number;
  lineBreaks: number;
  kicks: number;
  errors: number;
  turnoversWon: number;
  penaltiesConceded: number;
  tries: number;
  conversions: number;
  penaltyGoals: number;
  dropGoals: number;
  /** Optional so match logs saved before cards existed still load. */
  yellows?: number;
  reds?: number;
}

/** Counting stats for a player, over one match, a season or a career. */
export const STAT_KEYS = ["apps", "points", "tries", "conversions", "penaltyGoals", "dropGoals", "carries", "metres", "lineBreaks", "tackles", "turnovers", "yellows", "reds"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type PlayerTotals = Record<StatKey, number>;
export const emptyTotals = (): PlayerTotals => Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as PlayerTotals;

/** One player's match: who they were and what they did. */
export interface PlayerLine extends PlayerTotals {
  id: string;
  name: string;
  /** 0 = home, 1 = away. */
  team: 0 | 1;
}

export interface MatchLog {
  id: string;
  season: number;
  matchday: number;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeTactic: TacticId;
  awayTactic: TacticId;
  homeScore: number;
  awayScore: number;
  homeTries: number;
  awayTries: number;
  events: MatchEvent[];
  stats: [TeamStats, TeamStats];
  /** Per-player match lines. Missing on logs saved before player stats existed. */
  players?: PlayerLine[];
  /** Share of the match each player was on the pitch (0 to 1), by player id. Missing on older logs. */
  load?: Record<string, number>;
}
