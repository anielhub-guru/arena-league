import { Rng } from "./rng";
import { ROLES } from "./types";
import type { Attr, EventType, MatchEvent, MatchLog, Player, Role, TacticId, Team, TeamStats } from "./types";

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
 * The engine is steppable (MatchSim.step) so a UI can play it live and let the
 * manager change tactics, substitute and give a half-time talk mid-match.
 */
export const PHASES = 80;
export const MAX_SUBS = 3;
const OUT_OF_POSITION_PENALTY = 5;

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
}

export const TACTICS: Record<TacticId, TacticProfile> = {
  balanced: { label: "Balanced", description: "Mix of carries and kicks. No extra risk.", kick: 0.12, gain: 0, error: 0, defence: 0 },
  attacking: { label: "Attacking", description: "Keep ball in hand. More metres, more errors, looser defence.", kick: 0.04, gain: 1.5, error: 0.02, defence: -2 },
  defensive: { label: "Defensive", description: "Compact line speed. Fewer errors, fewer metres.", kick: 0.16, gain: -1, error: -0.01, defence: 2 },
  territory: { label: "Territory", description: "Kick long and squeeze them. Tight defence, little ball in hand.", kick: 0.2, gain: -0.5, error: 0, defence: 1 },
};

export type TalkId = "fire" | "calm" | "gamble";
export const TALKS: Record<TalkId, { label: string; description: string }> = {
  fire: { label: "Fire them up", description: "More ambition, a few more mistakes." },
  calm: { label: "Stay calm", description: "Fewer errors, steady carries." },
  gamble: { label: "Gamble", description: "Could inspire a comeback, could backfire." },
};

const ROLE_CARRY: Record<Role, number> = { Anchor: 1, Bruiser: 1.3, Pivot: 0.8, Winger: 1, Sweeper: 0.7 };

export interface MatchInput {
  id: string;
  season: number;
  matchday: number;
  home: Team;
  away: Team;
  homeTactic: TacticId;
  awayTactic: TacticId;
  seed: number;
}

interface Info {
  hl?: boolean;
  variant?: string;
  ai?: number;
  di?: number;
  side?: -1 | 1;
}

type MissKind = "post" | "wide" | "short";

const sideName = (side: -1 | 1) => (side < 0 ? "left" : "right");

function missLine(kind: MissKind, kicker: string, what: string, dist: number, side: -1 | 1): string {
  if (kind === "post") return `${kicker} strikes the ${what} from ${dist}m and it smacks the ${sideName(side)} upright and bounces away! So close.`;
  if (kind === "short") return `${kicker} cannot get the distance on the ${what} from ${dist}m. It drops short of the bar.`;
  return `${kicker} sends the ${what} from ${dist}m wide of the ${sideName(side)} upright.`;
}

function postInLine(kicker: string, what: string, dist: number, side: -1 | 1): string {
  return `${kicker} strikes the ${what} from ${dist}m. It clips the ${sideName(side)} upright, bounces up and drops over the bar!`;
}

/** Misses are post-heavy so near misses are actually seen. */
const MISSES: MissKind[] = ["post", "post", "wide", "wide", "short"];

interface Side {
  team: Team;
  tactic: TacticId;
  score: number;
  stats: TeamStats;
  /** Five players in ROLES slot order (role = the slot they are playing). */
  field: Player[];
  bench: Player[];
  entered: Map<string, number>;
  subs: number;
  mod: { gain: number; error: number };
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

function makeSide(team: Team, tactic: TacticId): Side {
  const field = ROLES.map((slot, i) => {
    const p = team.players.find((x) => x.id === team.lineup[i]);
    if (!p) throw new Error(`Lineup slot ${slot} of ${team.name} is empty`);
    return slotPlayer(p, slot);
  });
  const bench = team.players.filter((p) => !team.lineup.includes(p.id));
  return { team, tactic, score: 0, stats: emptyStats(), field, bench, entered: new Map(), subs: 0, mod: { gain: 0, error: 0 } };
}

export class MatchSim {
  private rng: Rng;
  readonly sides: [Side, Side];
  private events: MatchEvent[] = [];
  private cursor = 0;
  private att: 0 | 1 = 0;
  private pos = 35;
  private tackles = 0;
  private phaseAtt: 0 | 1 = 0;
  private cA?: Side;
  private cD?: Side;
  private x0 = 35;
  private stepNo = 0;
  private htDone = false;
  phase = 0;
  finished = false;

  constructor(private input: MatchInput) {
    this.rng = new Rng(input.seed);
    this.sides = [makeSide(input.home, input.homeTactic), makeSide(input.away, input.awayTactic)];
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

  talk(side: 0 | 1, id: TalkId) {
    const s = this.sides[side];
    if (id === "fire") s.mod = { gain: 0.8, error: 0.01 };
    else if (id === "calm") s.mod = { gain: 0.2, error: -0.01 };
    else s.mod = this.rng.chance(0.5) ? { gain: 1.5, error: 0.015 } : { gain: -0.8, error: 0.01 };
    this.emit("talk", `${s.team.name} manager's team talk: "${TALKS[id].label}".`, false, side);
  }

  /** Returns false if the substitution is not allowed. */
  substitute(side: 0 | 1, outId: string, inId: string): boolean {
    const s = this.sides[side];
    const idx = s.field.findIndex((p) => p.id === outId);
    const bIdx = s.bench.findIndex((p) => p.id === inId);
    if (idx < 0 || bIdx < 0 || s.subs >= MAX_SUBS) return false;
    const out = s.field[idx];
    const incoming = s.bench[bIdx];
    s.field[idx] = slotPlayer(incoming, out.role);
    s.bench.splice(bIdx, 1);
    s.entered.set(incoming.id, this.phase);
    s.subs++;
    this.emit("sub", `${s.team.short} substitution: ${incoming.name} replaces ${out.name} at ${out.role}.`, false, side, incoming.name);
    return true;
  }

  /** 0-100 freshness shown to the manager (the engine applies a milder version of the same curve). */
  energy(side: 0 | 1, p: Player): number {
    const played = this.phase - (this.sides[side].entered.get(p.id) ?? 0);
    return Math.round(clamp(100 * (1 - (played / PHASES) * (1 - p.stamina / 100) * 1.5), 0, 100));
  }

  toLog(): MatchLog {
    const [h, a] = this.sides;
    const i = this.input;
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
    };
  }

  // ------------------------------------------------------------------ internals

  private emit(type: EventType, text: string, key: boolean, team?: 0 | 1, player?: string, x1?: number, info?: Info) {
    this.events.push({
      sec: this.phase * (2400 / PHASES),
      highlight: info?.hl || undefined,
      variant: info?.variant,
      side: info?.side,
      cast: info?.hl && this.cA && this.cD ? { a: this.cA.field.map((p) => p.name), d: this.cD.field.map((p) => p.name), ai: info.ai ?? -1, di: info.di ?? -1 } : undefined,
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
      homeScore: this.sides[0].score,
      awayScore: this.sides[1].score,
    });
  }

  private give(newPos: number) {
    this.att = this.att === 0 ? 1 : 0;
    this.pos = newPos;
    this.tackles = 0;
  }

  private eff(side: Side, p: Player, k: Attr): number {
    const played = this.phase - (side.entered.get(p.id) ?? 0);
    return p[k] * (1 - (played / PHASES) * (1 - p.stamina / 100) * 0.45);
  }

  private bestKicker(side: Side): Player {
    return side.field.reduce((a, b) => (this.eff(side, b, "kicking") > this.eff(side, a, "kicking") ? b : a));
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

  /** The defence has infringed: the attackers kick at goal if in range, otherwise kick to the corner. */
  private awardPenalty(A: Side, D: Side, att: 0 | 1, culprit: Player, pos: number) {
    const rng = this.rng;
    const eA = (p: Player, k: Attr) => this.eff(A, p, k);
    D.stats.penaltiesConceded++;
    if (pos >= 55 && rng.chance(0.6)) {
      const k = this.bestKicker(A);
      const p = clamp(0.4 + eA(k, "kicking") / 250 - (100 - pos) / 250, 0.2, 0.9);
      const goalX = absX(att, 100);
      const side: -1 | 1 = rng.chance(0.5) ? -1 : 1;
      if (rng.chance(p)) {
        const postIn = rng.chance(0.12);
        A.score += 3;
        A.stats.penaltyGoals++;
        const lead = `${surname(culprit)} (${D.team.short}) is penalised at the breakdown.`;
        this.emit("penalty-goal", postIn ? `${lead} ${postInLine(k.name, "penalty", 100 - pos, side)} Three points to ${A.team.short}.` : `${lead} ${k.name} slots the penalty from ${100 - pos}m out, straight between the posts. Three points to ${A.team.short}.`, true, att, k.name, goalX, { hl: true, variant: postIn ? "post-in" : "good", ai: A.field.indexOf(k), side });
        this.give(35);
      } else {
        const kind = rng.pick(MISSES);
        this.emit("penalty-miss", `Penalty to ${A.team.short}. ${missLine(kind, k.name, "penalty", 100 - pos, side)} Relief for ${D.team.short}.`, true, att, k.name, goalX, { hl: true, variant: kind, ai: A.field.indexOf(k), side });
        this.give(22);
      }
    } else {
      this.pos = Math.min(95, pos + 25);
      this.tackles = 0;
      this.emit("penalty", `${surname(culprit)} gives away a penalty and ${A.team.short} kick to the corner, now ${place(this.pos)}.`, false, att);
    }
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
    A.stats.possession++;
    const pos = this.pos;

    // --- Penalty against the defence -------------------------------------
    if (rng.chance(0.03)) {
      this.awardPenalty(A, D, att, rng.pick(D.field), pos);
      return;
    }

    // --- Drop goal attempt -------------------------------------------------
    if (pos >= 70 && pos < 95 && rng.chance(0.04 + (A.tactic === "territory" ? 0.03 : 0))) {
      const k = this.bestKicker(A);
      const p = clamp(0.2 + eA(k, "kicking") / 300 - (100 - pos) / 400, 0.15, 0.6);
      const goalX = absX(att, 100);
      const side: -1 | 1 = rng.chance(0.5) ? -1 : 1;
      if (rng.chance(p)) {
        const postIn = rng.chance(0.12);
        A.score += 3;
        A.stats.dropGoals++;
        this.emit("drop-goal", postIn ? `DROP GOAL! ${postInLine(k.name, "drop goal", 100 - pos, side)} ${A.team.short} take three.` : `DROP GOAL! ${k.name} steadies and strikes it sweetly from ${100 - pos}m, right between the posts. ${A.team.short} take three.`, true, att, k.name, goalX, { hl: true, variant: postIn ? "post-in" : "good", ai: A.field.indexOf(k), side });
        this.give(35);
      } else {
        const kind = rng.pick(MISSES);
        this.emit("drop-miss", `${missLine(kind, k.name, "drop goal", 100 - pos, side)} ${D.team.short} restart from their 22.`, true, att, k.name, goalX, { hl: true, variant: kind, ai: A.field.indexOf(k), side });
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
        this.emit("kick", `${k.name} puts up a huge kick that runs dead. ${D.team.short} drop out from their 22.`, true, att, k.name, absX(att, 100), { hl: true, variant: "dead", ai: A.field.indexOf(k) });
        this.give(22);
      } else {
        this.emit("kick", `${k.name} kicks for territory, ${Math.round(dist)}m downfield. ${D.team.short} gather it ${place(100 - landed)}.`, landed >= 88, att, k.name, absX(att, landed), { hl: landed >= 88, variant: "live", ai: A.field.indexOf(k) });
        this.give(Math.round(100 - landed));
      }
      return;
    }

    // --- Carry ---------------------------------------------------------------
    const carrier = rng.weighted(A.field, (p) => {
      const nearLine = pos >= 80 && (p.role === "Anchor" || p.role === "Bruiser") ? 1.8 : 1;
      return (ROLE_CARRY[p.role] * nearLine * (eA(p, "power") + eA(p, "pace"))) / 100;
    });
    const tackler = rng.weighted(D.field, (p) => eD(p, "tackling") / 100 + 0.2);
    A.stats.carries++;

    if (carrier.role !== "Pivot") {
      const icp = rng.weighted(D.field, (p) => eD(p, "handling") + eD(p, "pace"));
      const pI = clamp(0.015 + (eD(icp, "handling") - eA(carrier, "handling")) / 1500 + (A.tactic === "attacking" ? 0.008 : 0), 0.004, 0.045);
      if (rng.chance(pI)) {
        const run = rng.int(8, 35);
        A.stats.errors++;
        D.stats.turnoversWon++;
        this.give(100 - pos);
        this.pos = Math.min(95, this.pos + run);
        this.emit("intercept", `${icp.name} reads the pass intended for ${carrier.name}, steps in and intercepts! ${D.team.short} counter for ${run}m.`, true, di, icp.name, undefined, { hl: true, ai: A.field.indexOf(carrier), di: D.field.indexOf(icp) });
        return;
      }
    }

    const errP = clamp(0.02 + (70 - eA(carrier, "handling")) / 600 + aT.error + A.mod.error, 0.01, 0.15);
    if (rng.chance(errP)) {
      A.stats.errors++;
      D.stats.turnoversWon++;
      this.emit("knock-on", `${carrier.name} spills it forward under pressure from ${surname(tackler)}. Knock-on, ${D.team.short} get the put-in.`, pos >= 68, att, carrier.name, undefined, { hl: pos >= 68, ai: A.field.indexOf(carrier), di: D.field.indexOf(tackler) });
      this.give(100 - pos);
      return;
    }

    const w = carrier.role === "Winger" ? 0.7 : 0.5;
    const atk = w * eA(carrier, "pace") + (1 - w) * eA(carrier, "power");
    const defAvg = avg(D.field.map((p) => eD(p, "tackling"))) + dT.defence;
    const defRating = 0.5 * defAvg + 0.5 * (eD(tackler, "tackling") + dT.defence);
    let gain = 8.5 + (atk - defRating) / 12 + aT.gain + A.mod.gain + rng.signed() * 8;
    let broke = false;
    let covered = false;
    const breakP = clamp(0.08 + (eA(carrier, "pace") - eD(tackler, "pace")) / 500, 0.02, 0.16);
    if (rng.chance(breakP)) {
      broke = true;
      gain += 12 + rng.next() * 24;
      const sweeper = D.field.find((p) => p.role === "Sweeper");
      if (sweeper && rng.chance(eD(sweeper, "tackling") / 170)) {
        gain = Math.min(gain, 14 + rng.next() * 8);
        covered = true;
      }
    }
    if (pos > 80 && !broke) gain *= 0.85;
    gain = Math.round(Math.max(-3, gain));
    this.pos = pos + gain;
    A.stats.metres += Math.max(0, gain);

    if (this.pos >= 100) {
      this.pos = 100;
      A.score += 5;
      A.stats.tries++;
      if (broke) A.stats.lineBreaks++;
      this.emit(
        "try",
        broke
          ? `TRY! ${carrier.name} breaks the line and races clear. ${A.team.short} are over!`
          : `TRY! ${carrier.name} powers through ${surname(tackler)} and grounds it. ${A.team.short} score!`,
        true,
        att,
        carrier.name,
        undefined,
        { hl: true, variant: broke ? "break" : "power", ai: A.field.indexOf(carrier), di: D.field.indexOf(tackler) },
      );
      const k = this.bestKicker(A);
      const side: -1 | 1 = rng.chance(0.5) ? -1 : 1;
      const score = () => `${this.input.home.short} ${this.sides[0].score} - ${this.sides[1].score} ${this.input.away.short}.`;
      if (rng.chance(clamp(0.5 + eA(k, "kicking") / 220, 0.4, 0.92))) {
        const postIn = rng.chance(0.12);
        A.score += 2;
        A.stats.conversions++;
        this.emit("conversion", postIn ? `${postInLine(k.name, "conversion", 12, side)} ${score()}` : `${k.name} splits the posts with the conversion. ${score()}`, true, att, k.name, undefined, { hl: true, variant: postIn ? "post-in" : "good", ai: A.field.indexOf(k), side });
      } else {
        const kind = rng.pick(MISSES);
        this.emit("conversion-miss", `${missLine(kind, k.name, "conversion", 12, side)} ${score()}`, true, att, k.name, undefined, { hl: true, variant: kind, ai: A.field.indexOf(k), side });
      }
      this.give(35);
      return;
    }

    D.stats.tackles++;
    this.tackles++;
    if (broke) A.stats.lineBreaks++;

    if (gain <= 2 && rng.chance(0.07 + (eD(tackler, "tackling") - eA(carrier, "power")) / 1000)) {
      D.stats.turnoversWon++;
      this.emit("turnover", `${tackler.name} gets over the ball and wins the jackal turnover! ${D.team.short} counter from ${place(100 - this.pos)}.`, true, di, tackler.name, undefined, { hl: true, ai: A.field.indexOf(carrier), di: D.field.indexOf(tackler) });
      this.give(100 - this.pos);
      return;
    }
    if (this.tackles >= 6) {
      this.emit("turnover", `Sixth tackle and ${A.team.short} run out of ideas ${place(this.pos)}. Turnover to ${D.team.short}.`, false, att);
      this.give(100 - this.pos);
      return;
    }
    if (broke) {
      const ai = A.field.indexOf(carrier);
      const sweeper = D.field.find((p) => p.role === "Sweeper")!;
      // How a line break ends: covered, caught, forced out of play, or a foul by the defence.
      const roll = rng.next();
      const variant = covered ? "covered" : roll < 0.13 ? "touch" : roll < 0.24 ? "foul" : "caught";
      const run = `${carrier.name} bursts through for ${gain}m`;
      if (variant === "touch") {
        this.emit("break", `${run} but ${surname(tackler)} bundles him into touch! The ball is out of play and ${D.team.short} take the line-out.`, true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(tackler) });
        this.give(100 - this.pos);
      } else if (variant === "foul") {
        this.emit("break", `${run} but ${surname(tackler)} brings him down with a high tackle! The referee blows for a penalty to ${A.team.short}.`, true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(tackler) });
        this.tackles = 0;
        this.x0 = absX(att, this.pos);
        this.awardPenalty(A, D, att, tackler, this.pos);
      } else if (variant === "covered") {
        this.emit("break", `${carrier.name} cuts a line for ${gain}m but ${sweeper.name} scrambles across and makes the tackle. Tackle ${this.tackles}, ${place(this.pos)}.`, true, att, carrier.name, undefined, { hl: true, variant, ai, di: 4 });
      } else {
        this.emit("break", `${run} before ${surname(tackler)} drags him down from behind. Tackle ${this.tackles}, ${place(this.pos)}.`, true, att, carrier.name, undefined, { hl: true, variant, ai, di: D.field.indexOf(tackler) });
      }
    } else if (gain >= 8) {
      this.emit("carry", `${carrier.name} carries hard for ${gain}m, brought down by ${surname(tackler)}. Tackle ${this.tackles}, ${place(this.pos)}.`, false, att, carrier.name);
    } else if (gain <= 0) {
      this.emit("carry", `${surname(tackler)} stops ${carrier.name} behind the gain line. Tackle ${this.tackles}.`, false, att, carrier.name);
    } else {
      this.emit("carry", `${carrier.name} picks up ${gain}m before ${surname(tackler)} wraps him up. Tackle ${this.tackles}.`, false, att, carrier.name);
    }
  }
}

export function simulateMatch(input: MatchInput): MatchLog {
  return new MatchSim(input).runToEnd().toLog();
}
