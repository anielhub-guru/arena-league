export type Role = "Anchor" | "Bruiser" | "Pivot" | "Winger" | "Sweeper";
/** Starting-five slots, in lineup order. */
export const ROLES: readonly Role[] = ["Anchor", "Bruiser", "Pivot", "Winger", "Sweeper"];
export type Attr = "power" | "pace" | "handling" | "tackling" | "kicking" | "stamina";
export const ATTRS: readonly Attr[] = ["power", "pace", "handling", "tackling", "kicking", "stamina"];

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
}

export type TacticId = "balanced" | "attacking" | "defensive" | "territory";

export interface Team {
  id: string;
  name: string;
  short: string;
  /** Style used when the AI manages this club. */
  style: TacticId;
  /** Full squad of eight. */
  players: Player[];
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
}
