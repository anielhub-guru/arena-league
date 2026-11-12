import { Narrator, type CardFacts, type Facts } from "./commentary";
import { Rng } from "./rng";
import { ROLES, emptyTotals } from "./types";
import type { Attr, EventType, MatchEvent, MatchLog, Player, PlayerLine, Role, ShapeId, TacticId, Team, TeamStats } from "./types";

/**
 * "Dominion": a rugby-inspired territory game, 5v5 on a 100m arena.
 *
 * The match is 40 minutes of 80 phases (30s each). The side in possession
 * sits at `pos` metres from its own line (100 = the opposition try line) and
 * works through a set of six tackles. Territory is won by carries and kicks;
 * the set is lost on a knock-on, a jackal turnover, a sixth tackle, or a kick.
 *
 * Scoring: try 5, conversion 2, penalty goal 3, drop goal 3.
 *
 * Discipline: penalties can bring a yellow card (10 minutes in the sin bin, so the side
 * plays a man down) or a red card (off for the rest of the match, and a one-match ban).
 * A second yellow in the same match is a red.
 *
 * The engine is steppable (MatchSim.step) so a UI can play it live and let the
 * manager change tactics, substitute and give a half-time talk mid-match.
 */
export const PHASES = 80;
export const MAX_SUBS = 3;
export const OUT_OF_POSITION_PENALTY = 5;
/** A sin bin lasts 10 minutes = 20 phases. */
export const BIN_PHASES = 20;
/** Matches a sent-off player misses. */
export const RED_BAN = 1;
/** A side never drops below this many players on the pitch through cards. */
const MIN_ON_PITCH = 3;

export interface TacticProfile {
  label: string;
  description: string;
  /** Base chance to kick for territory each phase. */
  kick: number;
  /** Metres added to every carry. */
  gain: number;
  /** Added to the knock-on probability. */
  error: number;
  /** Added to tackling ratings. */
  defence: number;
  /** Multiplies the chance that a penalty against this side becomes a card. */
  card: number;
}

export const TACTICS: Record<TacticId, TacticProfile> = {
  balanced: { label: "Balanced", description: "Mix of carries and kicks. No extra risk.", kick: 0.12, gain: 0, error: 0, defence: 0, card: 1 },
  attacking: { label: "Attacking", description: "Keep ball in hand. Strong for a side with pace and handling: more metres and fewer cards. A side without them makes errors and gets countered. Looser defence.", kick: 0.04, gain: 1.5, error: 0.02, defence: -2, card: 0.8 },
  defensive: { label: "Defensive", description: "Compact line speed. Fewer errors, fewer metres. Hard tackling means more cards.", kick: 0.16, gain: -1, error: -0.01, defence: 2, card: 1.5 },
  territory: { label: "Territory", description: "Kick long and squeeze them. Tight defence, little ball in hand. Slightly more cards.", kick: 0.2, gain: -0.5, error: 0, defence: 1, card: 1.25 },
};

/**
 * Attacking needs the tools to play with the ball in hand. How well a lineup suits it ("fit", -1 to 1)
 * comes from the average of pace and handling: at about 62 it is neutral, at 72 or more it is full marks,
 * and at 52 or less the side is reckless. Fit scales the metres gained and the knock-on rate, and decides
 * how hard the other side counters when the ball is lost.
 */
export const ATTACK = { centre: 62, spread: 10, gain0: 0.3, gain1: 0.6, error0: 0.011, error1: 0.003, counter0: 0.5, counter1: 1.2 };

export function attackFit(players: Player[], rating: (p: Player, k: Attr) => number = (p, k) => p[k]): number {
  if (!players.length) return 0;
  const skill = players.reduce((t, p) => t + (rating(p, "pace") + rating(p, "handling")) / 2, 0) / players.length;
  return clamp((skill - ATTACK.centre) / ATTACK.spread, -1, 1);
}

export type TalkId = "fire" | "calm" | "gamble";
export const TALKS: Record<TalkId, { label: string; description: string }> = {
  fire: { label: "Fire them up", description: "More ambition, a few more mistakes." },
  calm: { label: "Stay calm", description: "Fewer errors, steady carries." },
  gamble: { label: "Gamble", description: "Could inspire a comeback, could backfire." },
};

export interface ShapeProfile {
  label: string;
  description: string;
  /** Metres the opposition gain per carry: through the middle, and out wide (Winger carries). */
  mid: number;
  wide: number;
  /** Added to the opposition's line-break chance, middle and wide. */
  brkMid: number;
  brkWide: number;
  /** Multiplier on the Sweeper's chance to cover a break. */
  cover: number;
  /** Multiplier on the penalty for playing a man down (a flat or narrow line hides the gap better). */
  manDown: number;
  /** Extra metres on a break that is not covered: nobody behind the line to stop it. */
  open: number;
}

/**
 * Defensive shape. Each option trades something: the Sweeper deep covers breaks but leaves the
 * middle softer, a flat line stops metres but has nobody behind, a narrow line squeezes the middle
 * but gives up the wing.
 */
export const SHAPES: Record<ShapeId, ShapeProfile> = {
  sweeper: { label: "Sweeper back", description: "Your Sweeper stays deep and covers the edges and line breaks. The best answer to a quick Winger. A little open to power runners through the middle.", mid: 0.3, wide: -1.2, brkMid: 0, brkWide: -0.01, cover: 1, manDown: 1, open: 0 },
  flat: { label: "Flat line", description: "Your Sweeper steps into the line. Power runners gain far fewer metres, and it is the best cover when you are a man down against forwards. But nobody is left behind: a quick Winger or a line break usually means a try.", mid: -1.8, wide: 2, brkMid: -0.025, brkWide: 0.02, cover: 0.2, manDown: 0.75, open: 11 },
  narrow: { label: "Narrow", description: "Defenders squeeze towards the middle, which hides a gap well. The best all-round choice against a balanced attack, but the wing is left open for a quick Winger.", mid: -1.1, wide: 3.6, brkMid: -0.015, brkWide: 0.07, cover: 0.9, manDown: 0.85, open: 0 },
};

/** The shape AI clubs use, following their style. */
export const SHAPE_BY_STYLE: Record<TacticId, ShapeId> = { balanced: "sweeper", attacking: "flat", defensive: "sweeper", territory: "narrow" };

/**
 * Scouting advice: the best defensive shape against a given attack. `attackers` is the opposition
 * lineup in slot order (Anchor, Bruiser, Pivot, Winger, Sweeper).
 */
export function adviseShape(attackers: Player[]): { best: ShapeId; why: string } {
  const [anchor, bruiser, , winger] = attackers;
  const forwards = (anchor.power + bruiser.power) / 2;
  if (winger.pace - forwards >= 4) return { best: "sweeper", why: `Their Winger ${winger.name} is quick (pace ${winger.pace}). Keep the Sweeper back to cover breaks; a narrow shape would leave the wing open.` };
  if (forwards - winger.pace >= 4) return { best: "flat", why: `Their forwards are powerful (power ${Math.round(forwards)}). A flat line stops them gaining metres through the middle.` };
  return { best: "narrow", why: "Their attack is balanced and they have no standout Winger. Squeezing the middle is safe." };
}

const ROLE_CARRY: Record<Role, number> = { Anchor: 1, Bruiser: 1.3, Pivot: 0.8, Winger: 1, Sweeper: 0.7 };

export interface MatchInput {
  id: string;
  season: number;
  matchday: number;
  home: Team;
  away: Team;
  homeTactic: TacticId;
  awayTactic: TacticId;
  /** Defensive shape; defaults to the one that suits the tactic. */
  homeShape?: ShapeId;
  awayShape?: ShapeId;
  /** True when the game chooses the shape (AI clubs, and quick sim), including after a card. */
  homeAuto?: boolean;
  awayAuto?: boolean;
  seed: number;
}

interface Info {
  hl?: boolean;
  variant?: string;
  ai?: number;
  di?: number;
  side?: -1 | 1;
  pid?: string;
}

type MissKind = "post" | "wide" | "short";

const sideName = (side: -1 | 1): "left" | "right" => (side < 0 ? "left" : "right");

/** Misses are post-heavy so near misses are actually seen. */
const MISSES: MissKind[] = ["post", "post", "wide", "wide", "short"];

interface Side {
  team: Team;
  tactic: TacticId;
  shape: ShapeId;
  /** The game picks this side's shape after a card instead of asking the manager. */
  auto: boolean;
  score: number;
  stats: TeamStats;
  /** Five players in ROLES slot order (role = the slot they are playing). */
  field: Player[];
  bench: Player[];
  entered: Map<string, number>;
  subs: number;
  mod: { gain: number; error: number };
  /** Sin bin: player id to the phase at which they come back. */
  bin: Map<string, number>;
  /** Players sent off (they stay off for the rest of the match). */
  sentOff: Set<string>;
  yellowCount: Map<string, number>;
  lines: Map<string, PlayerLine>;
}

const emptyStats = (): TeamStats => ({
  possession: 0,
  carries: 0,
  metres: 0,
  tackles: 0,
  lineBreaks: 0,
  kicks: 0,
  errors: 0,
  turnoversWon: 0,
  penaltiesConceded: 0,
  tries: 0,
  conversions: 0,
  penaltyGoals: 0,
  dropGoals: 0,
  yellows: 0,
  reds: 0,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const surname = (p: Player) => p.name.split(" ").slice(1).join(" ") || p.name;
const absX = (side: 0 | 1, pos: number) => (side === 0 ? pos : 100 - pos);

/** A player in a lineup slot; playing out of position costs a few points on every attribute. */
export function slotPlayer(p: Player, slot: Role): Player {
  const pen = p.role === slot ? 0 : OUT_OF_POSITION_PENALTY;
  return { ...p, role: slot, power: p.power - pen, pace: p.pace - pen, handling: p.handling - pen, tackling: p.tackling - pen, kicking: p.kicking - pen, stamina: p.stamina - pen };
}

/** Where the attacker is, described from their point of view. */
function place(pos: number): string {
  if (pos < 22) return "pinned deep in their own 22";
  if (pos < 45) return "in their own half";
  if (pos < 55) return "around halfway";
  if (pos < 78) return "in the opposition half";
  return "inside the opposition 22";
}

const ovr = (p: Player) => (p.power + p.pace + p.handling + p.tackling + p.kicking + p.stamina) / 6;
const isBanned = (p: Player) => (p.ban ?? 0) > 0;

/**
 * Builds the five on the pitch. A suspended starter is replaced by the best available
 * player from the squad (same natural role first, then the highest overall rating), so a
 * ban never has to be handled by the AI or the UI to keep a match valid.
 */
function makeSide(team: Team, tactic: TacticId, shape: ShapeId, auto: boolean): Side {
  const starters = ROLES.map((slot, i) => {
    const p = team.players.find((x) => x.id === team.lineup[i]);
    if (!p) throw new Error(`Lineup slot ${slot} of ${team.name} is empty`);
    return p;
  });
  const spare = team.players.filter((p) => !team.lineup.includes(p.id) && !isBanned(p));
  const field = ROLES.map((slot, i) => {
    let p = starters[i];
    if (isBanned(p) && spare.length) {
      const best = [...spare].sort((a, b) => Number(b.role === slot) - Number(a.role === slot) || ovr(b) - ovr(a))[0];
      spare.splice(spare.indexOf(best), 1);
      p = best;
    }
    return slotPlayer(p, slot);
  });
  const side: Side = { team, tactic, shape, auto, score: 0, stats: emptyStats(), field, bench: spare, entered: new Map(), subs: 0, mod: { gain: 0, error: 0 }, bin: new Map(), sentOff: new Set(), yellowCount: new Map(), lines: new Map() };
  return side;
}

export type CardState = { kind: "bin"; minutesLeft: number } | { kind: "off" } | null;

export class MatchSim {
  private rng: Rng;
  private narrator: Narrator;
  readonly sides: [Side, Side];
  private events: MatchEvent[] = [];
  private cursor = 0;
  private att: 0 | 1 = 0;
  private pos = 35;
  private tackles = 0;
  /** After an attacking side loses the ball, the side that won it counters: extra metres on its next carry. */
  private counterSide: -1 | 0 | 1 = -1;
  private counterBonus = 0;
  private phaseAtt: 0 | 1 = 0;
  private cA?: Side;
  private cD?: Side;
  private x0 = 35;
  private stepNo = 0;
  /** "him" or "her" in commentary, following the league being played. */
  private him: string;
  private htDone = false;
  phase = 0;
  finished = false;

  constructor(private input: MatchInput) {
    this.rng = new Rng(input.seed);
    // Wording has its own random stream so changing the commentary never changes what happens.
    this.narrator = new Narrator(new Rng((input.seed ^ 0x9e3779b9) >>> 0));
    this.him = input.home.gender === "women" ? "her" : "him";
    this.sides = [
      makeSide(input.home, input.homeTactic, input.homeShape ?? SHAPE_BY_STYLE[input.homeTactic], !!input.homeAuto),
      makeSide(input.away, input.awayTactic, input.awayShape ?? SHAPE_BY_STYLE[input.awayTactic], !!input.awayAuto),
    ];
    this.sides.forEach((s, i) => s.field.forEach((p) => this.line(s, i as 0 | 1, p)));
    this.emit("kickoff", `${input.home.name} get us under way against ${input.away.name}. The ball is in play at the Dominion Arena.`, true, 0);
  }

  get minute(): number {
    return Math.min(40, Math.floor(this.phase / 2) + 1);
  }

  /** Advance one step and return the events it produced (plus anything queued by manager actions). */
  step(): MatchEvent[] {
    this.stepNo++;
    if (!this.finished) this.advance();
    return this.drain();
  }

  /** Events produced since the last step()/drain() (e.g. substitutions made while paused). */
  drain(): MatchEvent[] {
    const out = this.events.slice(this.cursor);
    this.cursor = this.events.length;
    return out;
  }

  runToEnd(): this {
    while (!this.finished) this.step();
    return this;
  }

  setTactic(side: 0 | 1, tactic: TacticId) {
    this.sides[side].tactic = tactic;
  }

  setShape(side: 0 | 1, shape: ShapeId) {
    this.sides[side].shape = shape;
  }

  /** When the game is in charge (AI, quick sim), pick the shape that best suits the opposition after a card. */
  private autoCover(side: Side, idx: 0 | 1) {
    if (!side.auto) return;
    side.shape = adviseShape(this.sides[idx === 0 ? 1 : 0].field).best;
  }

  talk(side: 0 | 1, id: TalkId) {
    const s = this.sides[side];
    if (id === "fire") s.mod = { gain: 0.8, error: 0.01 };
    else if (id === "calm") s.mod = { gain: 0.2, error: -0.01 };
    else s.mod = this.rng.chance(0.5) ? { gain: 1.5, error: 0.015 } : { gain: -0.8, error: 0.01 };
    this.emit("talk", `${s.team.name} manager's team talk: "${TALKS[id].label}".`, false, side);
  }

  /** Returns false if the substitution is not allowed (a carded player cannot be replaced). */
  substitute(side: 0 | 1, outId: string, inId: string): boolean {
    const s = this.sides[side];
    const idx = s.field.findIndex((p) => p.id === outId);
    const bIdx = s.bench.findIndex((p) => p.id === inId);
    if (idx < 0 || bIdx < 0 || s.subs >= MAX_SUBS) return false;
    if (this.isOff(s, s.field[idx])) return false;
    const out = s.field[idx];
    const incoming = s.bench[bIdx];
    s.field[idx] = slotPlayer(incoming, out.role);
    s.bench.splice(bIdx, 1);
    s.entered.set(incoming.id, this.phase);
    s.subs++;
    this.line(s, side, s.field[idx]);
    this.emit("sub", `${s.team.short} substitution: ${incoming.name} replaces ${out.name} at ${out.role}.`, false, side, incoming.name);
    return true;
  }

  /** 0-100 freshness shown to the manager (the engine applies a milder version of the same curve). */
  energy(side: 0 | 1, p: Player): number {
    const played = this.phase - (this.sides[side].entered.get(p.id) ?? 0);
    return Math.round(clamp(100 * (1 - (played / PHASES) * (1 - p.stamina / 100) * 1.5), 0, 100));
  }

  /** Whether a player is in the sin bin (with minutes left) or sent off. */
  cardState(side: 0 | 1, p: Player): CardState {
    const s = this.sides[side];
    if (s.sentOff.has(p.id)) return { kind: "off" };
    const back = s.bin.get(p.id);
    return back === undefined ? null : { kind: "bin", minutesLeft: Math.max(1, Math.ceil((back - this.phase) / 2)) };
  }

  /** Number of players currently on the pitch for a side. */
  onPitch(side: 0 | 1): number {
    return this.avail(this.sides[side]).length;
  }

  toLog(): MatchLog {
    const [h, a] = this.sides;
    const i = this.input;
    const players = [...h.lines.values(), ...a.lines.values()].map((l) => ({ ...l, points: l.tries * 5 + l.conversions * 2 + l.penaltyGoals * 3 + l.dropGoals * 3 }));
    return {
      id: i.id,
      season: i.season,
      matchday: i.matchday,
      homeId: i.home.id,
      awayId: i.away.id,
      homeName: i.home.name,
      awayName: i.away.name,
      homeTactic: h.tactic,
      awayTactic: a.tactic,
      homeScore: h.score,
      awayScore: a.score,
      homeTries: h.stats.tries,
      awayTries: a.stats.tries,
      events: this.events,
      stats: [h.stats, a.stats],
      players,
    };
  }

  // ------------------------------------------------------------------ internals

  private isOff(s: Side, p: Player): boolean {
    return s.sentOff.has(p.id) || s.bin.has(p.id);
  }

  /** Players actually on the pitch (not in the sin bin, not sent off). */
  private avail(s: Side): Player[] {
    return s.field.filter((p) => !this.isOff(s, p));
  }

  private offSlots(s: Side): number[] {
    return s.field.map((p, i) => (this.isOff(s, p) ? i : -1)).filter((i) => i >= 0);
  }

  /** The player's match line, created the first time they take the field. */
  private line(s: Side, idx: 0 | 1, p: Player): PlayerLine {
    let l = s.lines.get(p.id);
    if (!l) {
      l = { ...emptyTotals(), id: p.id, name: p.name, team: idx, apps: 1 };
      s.lines.set(p.id, l);
    }
    return l;
  }
  private lineOf(s: Side, p: Player): PlayerLine {
    return this.line(s, s === this.sides[0] ? 0 : 1, p);
  }

  private emit(type: EventType, text: string, key: boolean, team?: 0 | 1, player?: string, x1?: number, info?: Info) {
    const offA = info?.hl && this.cA ? this.offSlots(this.cA) : [];
    const offD = info?.hl && this.cD ? this.offSlots(this.cD) : [];
    this.events.push({
      sec: this.phase * (2400 / PHASES),
      highlight: info?.hl || undefined,
      variant: info?.variant,
      side: info?.side,
      cast:
        info?.hl && this.cA && this.cD
          ? { a: this.cA.field.map((p) => p.name), d: this.cD.field.map((p) => p.name), ai: info.ai ?? -1, di: info.di ?? -1, ta: this.cA.tactic, td: this.cD.tactic, sa: this.cA.shape, sd: this.cD.shape, ...(offA.length ? { offA } : {}), ...(offD.length ? { offD } : {}) }
          : undefined,
      step: this.stepNo,
      minute: this.minute,
      att: this.phaseAtt,
      x0: this.x0,
      x1: x1 ?? absX(this.att, this.pos),
      type,
      text,
      key,
      team,
      player,
      pid: info?.pid,
      homeScore: this.sides[0].score,
      awayScore: this.sides[1].score,
    });
  }

  private give(newPos: number) {
    this.att = this.att === 0 ? 1 : 0;
    this.pos = newPos;
    this.tackles = 0;
  }

  /** The side that has just won the ball back from an attacking side hits it while it is stretched. */
  private startCounter(fit: number) {
    this.counterSide = this.att;
    this.counterBonus = ATTACK.counter0 + ATTACK.counter1 * (1 - fit);
  }

  private eff(side: Side, p: Player, k: Attr): number {
    const played = this.phase - (side.entered.get(p.id) ?? 0);
    return p[k] * (1 - (played / PHASES) * (1 - p.stamina / 100) * 0.45);
  }

  private bestKicker(side: Side): Player {
    return this.avail(side).reduce((a, b) => (this.eff(side, b, "kicking") > this.eff(side, a, "kicking") ? b : a));
  }

  private advance() {
    const { home, away } = this.input;
    if (this.phase >= PHASES) {
      const [h, a] = this.sides;
      const verdict = h.score === a.score ? "It finishes level" : `${h.score > a.score ? home.name : away.name} take the win`;
      this.x0 = absX(this.att, this.pos);
      this.emit("fulltime", `FULL TIME. ${home.name} ${h.score} - ${a.score} ${away.name}. ${verdict}.`, true);
      this.finished = true;
      return;
    }
    if (this.phase === PHASES / 2 && !this.htDone) {
      this.htDone = true;
      this.x0 = absX(this.att, this.pos);
      this.emit("halftime", `HALF TIME. ${home.name} ${this.sides[0].score} - ${this.sides[1].score} ${away.name}.`, true);
      this.att = 1;
      this.pos = 35;
      this.tackles = 0;
      return;
    }
    this.playPhase();
    this.phase++;
  }

  /** Sin-binned players whose ten minutes are up rejoin before the next phase is played. */
  private releaseBin() {
    this.sides.forEach((s, idx) => {
      for (const [id, back] of [...s.bin]) {
        if (this.phase < back) continue;
        s.bin.delete(id);
        const p = s.field.find((x) => x.id === id);
        if (!p) continue;
        this.emit("return", this.narrator.back(p.name, s.team.short, this.avail(s).length), true, idx as 0 | 1, p.name, undefined, { pid: p.id });
      }
    });
  }

  private cardFacts(D: Side, p: Player, high: boolean): CardFacts {
    return { player: p.name, surname: surname(p), team: D.team.short, left: this.avail(D).length, high };
  }

  /**
   * A penalty may bring a card. The risk rises with a hard-tackling tactic and with fatigue
   * (tired players mistime tackles), so the manager's choices change how often it happens.
   * A side never drops below three players on the pitch.
   */
  private maybeCard(D: Side, culprit: Player, high: boolean) {
    const rng = this.rng;
    const idx: 0 | 1 = D === this.sides[0] ? 0 : 1;
    if (this.isOff(D, culprit) || this.avail(D).length <= MIN_ON_PITCH) return;
    const played = this.phase - (D.entered.get(culprit.id) ?? 0);
    const risk = TACTICS[D.tactic].card * (1 + (played / PHASES) * (1 - culprit.stamina / 100) * 1.5);
    const redP = clamp((high ? 0.09 : 0.012) * risk, 0, 0.5);
    const yellowP = clamp((high ? 0.3 : 0.16) * risk, 0, 0.9);
    const roll = rng.next();
    if (roll >= redP + yellowP) return;
    const l = this.lineOf(D, culprit);
    const prior = D.yellowCount.get(culprit.id) ?? 0;
    if (roll < redP) return this.sendOff(D, idx, culprit, l, high, false);
    D.yellowCount.set(culprit.id, prior + 1);
    D.stats.yellows = (D.stats.yellows ?? 0) + 1;
    l.yellows++;
    if (prior + 1 >= 2) return this.sendOff(D, idx, culprit, l, high, true);
    D.bin.set(culprit.id, this.phase + BIN_PHASES);
    const c = this.cardFacts(D, culprit, high);
    c.backAt = Math.min(40, this.minute + BIN_PHASES / 2);
    this.emit("yellow", this.narrator.yellow(c), true, idx, culprit.name, undefined, { pid: culprit.id });
    this.autoCover(D, idx);
  }

  private sendOff(D: Side, idx: 0 | 1, culprit: Player, l: PlayerLine, high: boolean, second: boolean) {
    D.bin.delete(culprit.id);
    D.sentOff.add(culprit.id);
    D.stats.reds = (D.stats.reds ?? 0) + 1;
    l.reds++;
    const c = this.cardFacts(D, culprit, high);
    this.emit("red", second ? this.narrator.secondYellow(c) : this.narrator.red(c), true, idx, culprit.name, undefined, { pid: culprit.id });
    this.autoCover(D, idx);
  }

  private facts(A: Side, D: Side, extra: Partial<Facts> = {}): Facts {
    return { team: A.team.short, opp: D.team.short, him: this.him, ...extra };
  }

  /** The defence has infringed: the attackers kick at goal if in range, otherwise kick to the corner. */
  private awardPenalty(A: Side, D: Side, att: 0 | 1, culprit: Player, pos: number, high: boolean) {
    const rng = this.rng;
    const eA = (p: Player, k: Attr) => this.eff(A, p, k);
    D.stats.penaltiesConceded++;
    const base = { ts: surname(culprit), t: culprit.name };
    if (pos >= 55 && rng.chance(0.6)) {
      const k = this.bestKicker(A);
      const p = clamp(0.4 + eA(k, "kicking") / 250 - (100 - pos) / 250, 0.2, 0.9);
      const goalX = absX(att, 100);
      const side: -1 | 1 = rng.chance(0.5) ? -1 : 1;
      const f = this.facts(A, D, { ...base, k: k.name, dist: 100 - pos, side: sideName(side), what: "penalty" });
      if (rng.chance(p)) {
        const postIn = rng.chance(0.12);
        A.score += 3;
        A.stats.penaltyGoals++;
        this.lineOf(A, k).penaltyGoals++;
        this.emit("penalty-goal", this.narrator.penaltyGoal(f, high, postIn), true, att, k.name, goalX, { hl: true, variant: postIn ? "post-in" : "good", ai: A.field.indexOf(k), side });
        this.give(35);
      } else {
        const kind = rng.pick(MISSES);
        this.emit("penalty-miss", this.narrator.penaltyMiss(f, kind), true, att, k.name, goalX, { hl: true, variant: kind, ai: A.field.indexOf(k), side });
        this.give(22);
      }
    } else {
      this.pos = Math.min(95, pos + 25);
      this.tackles = 0;
      this.emit("penalty", this.narrator.penaltyCorner(this.facts(A, D, { ...base, where: place(this.pos) })), false, att);
    }
    this.maybeCard(D, culprit, high);
  }

  private playPhase() {
    const rng = this.rng;
    const att = this.att;
    const A = this.sides[att];
    const D = this.sides[att === 0 ? 1 : 0];
    const di = att === 0 ? 1 : 0;
    const aT = TACTICS[A.tactic];
    const dT = TACTICS[D.tactic];
    const eA = (p: Player, k: Attr) => this.eff(A, p, k);
    const eD = (p: Player, k: Attr) => this.eff(D, p, k);
    this.phaseAtt = att;
    this.cA = A;
    this.cD = D;
    this.x0 = absX(att, this.pos);
    this.releaseBin();
    const aOn = this.avail(A);
    const dOn = this.avail(D);
    const attacking = A.tactic === "attacking";
    const fit = attacking ? attackFit(aOn, (p, k) => this.eff(A, p, k)) : 0;
    const tactGain = attacking ? ATTACK.gain0 + ATTACK.gain1 * fit : aT.gain;
    const tactError = attacking ? ATTACK.error0 - ATTACK.error1 * fit : aT.error;
    const counter = this.counterSide === att ? this.counterBonus : 0;
    this.counterSide = -1;
    const downA = A.field.length - aOn.length;
    const downD = D.field.length - dOn.length;
    A.stats.possession++;
    const pos = this.pos;

    // --- Penalty against the defence -------------------------------------
    if (rng.chance(0.03)) {
      this.awardPenalty(A, D, att, rng.pick(dOn), pos, false);
      return;
    }

    // --- Drop goal attempt -------------------------------------------------
    if (pos >= 70 && pos < 95 && rng.chance(0.04 + (A.tactic === "territory" ? 0.03 : 0))) {
      const k = this.bestKicker(A);
      const p = clamp(0.2 + eA(k, "kicking") / 300 - (100 - pos) / 400, 0.15, 0.6);
      const goalX = absX(att, 100);
      const side: -1 | 1 = rng.chance(0.5) ? -1 : 1;
      const f = this.facts(A, D, { k: k.name, dist: 100 - pos, side: sideName(side), what: "drop goal" });
      if (rng.chance(p)) {
        const postIn = rng.chance(0.12);
        A.score += 3;
        A.stats.dropGoals++;
        this.lineOf(A, k).dropGoals++;
        this.emit("drop-goal", this.narrator.dropGoal(f, postIn), true, att, k.name, goalX, { hl: true, variant: postIn ? "post-in" : "good", ai: A.field.indexOf(k), side });
        this.give(35);
      } else {
        const kind = rng.pick(MISSES);
        this.emit("drop-miss", this.narrator.dropMiss(f, kind), true, att, k.name, goalX, { hl: true, variant: kind, ai: A.field.indexOf(k), side });
        this.give(22);
      }
      return;
    }

    // --- Kick for territory -------------------------------------------------
    const kickMult = pos < 40 ? 1.5 : pos < 70 ? 0.8 : 0.2;
    if (rng.chance(aT.kick * kickMult)) {
      const k = this.bestKicker(A);
      const dist = 28 + (eA(k, "kicking") / 100) * 22 + rng.next() * 10;
      A.stats.kicks++;
      const landed = pos + dist;
      if (landed >= 100) {
        this.emit("kick", this.narrator.kickDead(this.facts(A, D, { k: k.name })), true, att, k.name, absX(att, 100), { hl: true, variant: "dead", ai: A.field.indexOf(k) });
        this.give(22);
      } else {
        this.emit("kick", this.narrator.kickLive(this.facts(A, D, { k: k.name, dist: Math.round(dist), where: place(100 - landed) })), landed >= 88, att, k.name, absX(att, landed), { hl: landed >= 88, variant: "live", ai: A.field.indexOf(k) });
        this.give(Math.round(100 - landed));
      }
      return;
    }

    // --- Carry ---------------------------------------------------------------
    const carrier = rng.weighted(aOn, (p) => {
      const nearLine = pos >= 80 && (p.role === "Anchor" || p.role === "Bruiser") ? 1.8 : 1;
      return (ROLE_CARRY[p.role] * nearLine * (eA(p, "power") + eA(p, "pace"))) / 100;
    });
    const tackler = rng.weighted(dOn, (p) => eD(p, "tackling") / 100 + 0.2);
    A.stats.carries++;
    const cl = this.lineOf(A, carrier);
    cl.carries++;
    const names = { c: carrier.name, cs: surname(carrier), t: tackler.name, ts: surname(tackler) };

    if (carrier.role !== "Pivot") {
      const icp = rng.weighted(dOn, (p) => eD(p, "handling") + eD(p, "pace"));
      const pI = clamp(0.015 + (eD(icp, "handling") - eA(carrier, "handling")) / 1500 + (attacking ? 0.004 * (1 - fit) : 0), 0.004, 0.045);
      if (rng.chance(pI)) {
        const run = rng.int(8, 35);
        A.stats.errors++;
        D.stats.turnoversWon++;
        this.lineOf(D, icp).turnovers++;
        this.give(100 - pos);
        this.pos = Math.min(95, this.pos + run);
        if (attacking) this.startCounter(fit);
        this.emit("intercept", this.narrator.intercept(this.facts(A, D, { ...names, t: icp.name, run })), true, di, icp.name, undefined, { hl: true, ai: A.field.indexOf(carrier), di: D.field.indexOf(icp) });
        return;
      }
    }

    const errP = clamp(0.02 + (70 - eA(carrier, "handling")) / 600 + tactError + A.mod.error, 0.01, 0.15);
    if (rng.chance(errP)) {
      A.stats.errors++;
      D.stats.turnoversWon++;
      this.emit("knock-on", this.narrator.knockOn(this.facts(A, D, names)), pos >= 68, att, carrier.name, undefined, { hl: pos >= 68, ai: A.field.indexOf(carrier), di: D.field.indexOf(tackler) });
      this.give(100 - pos);
      if (attacking) this.startCounter(fit);
      return;
    }

    const w = carrier.role === "Winger" ? 0.7 : 0.5;
    const atk = w * eA(carrier, "pace") + (1 - w) * eA(carrier, "power");
    // A side with a player in the bin or sent off has a gap in its line and one fewer runner.
    const defAvg = avg(dOn.map((p) => eD(p, "tackling"))) + dT.defence;
    const dS = SHAPES[D.shape];
    const wide = carrier.role === "Winger";
    const dm = downD * dS.manDown; // the shape decides how badly a man down hurts
    const defRating = 0.5 * defAvg + 0.5 * (eD(tackler, "tackling") + dT.defence) - 5 * dm;
    let gain = 8.5 + (atk - defRating) / 12 + tactGain + counter + A.mod.gain + 1.5 * dm - 1.2 * downA + (wide ? dS.wide : dS.mid) + rng.signed() * 8;
    let broke = false;
    let covered = false;
    const sweeper = dOn.find((p) => p.role === "Sweeper");
    const breakP = clamp(0.08 + (eA(carrier, "pace") - eD(tackler, "pace")) / 500 + 0.02 * dm + (wide ? dS.brkWide : dS.brkMid), 0.02, 0.18);
    if (rng.chance(breakP)) {
      broke = true;
      gain += 12 + rng.next() * 24;
      if (sweeper && rng.chance((eD(sweeper, "tackling") / 170) * dS.cover)) {
        gain = Math.min(gain, 14 + rng.next() * 8);
        covered = true;
      } else {
        gain += dS.open; // nobody behind the line to stop it
      }
    }
    if (pos > 80 && !broke) gain *= 0.85;
    gain = Math.round(Math.max(-3, gain));
    this.pos = pos + gain;
    A.stats.metres += Math.max(0, gain);
    cl.metres += Math.max(0, gain);

    if (this.pos >= 100) {
      this.pos = 100;
      A.score += 5;
      A.stats.tries++;
      cl.tries++;
      if (broke) {
        A.stats.lineBreaks++;
        cl.lineBreaks++;
      }
      const kind = broke ? "break" : "power";
      this.emit("try", this.narrator.try(this.facts(A, D, names), kind, A.score, D.score, this.minute), true, att, carrier.name, undefined, { hl: true, variant: kind, ai: A.field.indexOf(carrier), di: D.field.indexOf(tackler) });
      const k = this.bestKicker(A);
      const side: -1 | 1 = rng.chance(0.5) ? -1 : 1;
      const score = `${this.input.home.short} ${this.sides[0].score} - ${this.sides[1].score} ${this.input.away.short}.`;
      const kf = this.facts(A, D, { k: k.name, dist: 12, side: sideName(side), what: "conversion" });
      if (rng.chance(clamp(0.5 + eA(k, "kicking") / 220, 0.4, 0.92))) {
        const postIn = rng.chance(0.12);
        A.score += 2;
        A.stats.conversions++;
        this.lineOf(A, k).conversions++;
        const text = this.narrator.conversion(kf, `${this.input.home.short} ${this.sides[0].score} - ${this.sides[1].score} ${this.input.away.short}.`, postIn);
        this.emit("conversion", text, true, att, k.name, undefined, { hl: true, variant: postIn ? "post-in" : "good", ai: A.field.indexOf(k), side });
      } else {
        const kindMiss = rng.pick(MISSES);
        this.emit("conversion-miss", this.narrator.conversionMiss(kf, score, kindMiss), true, att, k.name, undefined, { hl: true, variant: kindMiss, ai: A.field.indexOf(k), side });
      }
      this.give(35);
      return;
    }

    D.stats.tackles++;
    this.lineOf(D, tackler).tackles++;
    this.tackles++;
    if (broke) {
      A.stats.lineBreaks++;
      cl.lineBreaks++;
    }
    const where = place(this.pos);

    if (gain <= 2 && rng.chance(0.07 + (eD(tackler, "tackling") - eA(carrier, "power")) / 1000)) {
      D.stats.turnoversWon++;
      this.lineOf(D, tackler).turnovers++;
      this.emit("turnover", this.narrator.jackal(this.facts(A, D, { ...names, where: place(100 - this.pos) })), true, di, tackler.name, undefined, { hl: true, ai: A.field.indexOf(carrier), di: D.field.indexOf(tackler) });
      this.give(100 - this.pos);
      return;
    }
    if (this.tackles >= 6) {
      this.emit("turnover", this.narrator.sixth(this.facts(A, D, { where })), false, att);
      this.give(100 - this.pos);
      return;
    }
    const f = this.facts(A, D, { ...names, gain, n: this.tackles, where });
    if (broke) {
      const ai = A.field.indexOf(carrier);
      // How a line break ends: covered, caught, forced out of play, or a foul by the defence.
      const roll = rng.next();
      const variant = covered ? "covered" : roll < 0.13 ? "touch" : roll < 0.24 ? "foul" : "caught";
      if (variant === "touch") {
        this.emit("break", this.narrator.breakEnd("touch", f), true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(tackler) });
        this.give(100 - this.pos);
      } else if (variant === "foul") {
        this.emit("break", this.narrator.breakEnd("foul", f), true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(tackler) });
        this.tackles = 0;
        this.x0 = absX(att, this.pos);
        this.awardPenalty(A, D, att, tackler, this.pos, true);
      } else if (variant === "covered") {
        this.emit("break", this.narrator.breakEnd("covered", { ...f, sweeper: sweeper!.name }), true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(sweeper!) });
      } else {
        this.emit("break", this.narrator.breakEnd("caught", f), true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(tackler) });
      }
    } else {
      this.emit("carry", this.narrator.carry(f), false, att, carrier.name);
    }
  }
}

export function simulateMatch(input: MatchInput): MatchLog {
  return new MatchSim(input).runToEnd().toLog();
}
