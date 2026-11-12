import type { MatchEvent, ShapeId, TacticId } from "../engine/types";

/**
 * Highlight choreography.
 *
 * A scene is a list of beats. Each beat gives every player a target position and says what
 * the ball is doing. The renderer interpolates between beats. Coordinates are in the
 * ATTACKER's frame: x runs 0 (their own line) to 100 (the line they are attacking), y is
 * 0..1 across the arena. Attackers are a0..a4 and defenders d0..d4 in lineup order:
 * Anchor, Bruiser, Pivot, Winger, Sweeper.
 *
 * Shapes follow rugby: attackers stand deep in an echelon behind the ball, the Pivot
 * distributes, passes go backwards or flat while the receiver runs onto the ball, and
 * the defence holds a line with the Sweeper covering behind. Set plays: crash ball,
 * dummy run, loop, switch and skip pass, each designed to draw a defender out of position.
 */
export interface Pt {
  x: number;
  y: number;
}
/**
 * How a ball in flight moves, so a pass and a kick look different. Passes always spiral (long axis
 * along the flight, laces turning). "punt" tumbles end over end, "chip" turns slowly over a short
 * high arc, "grubber" skips and wobbles along the ground, "loose" is a ball nobody is controlling.
 */
export type BallStyle = "punt" | "chip" | "grubber" | "loose";
export type Ball =
  | { k: "held"; by: string }
  | { k: "pass"; from: string; to: string; arc?: number }
  | { k: "fly"; from: string | Pt; to: Pt; arc: number; style?: BallStyle }
  | { k: "at"; p: Pt };
export interface Banner {
  text: string;
  color: string;
  sub?: string;
}
/** A collision to play during a beat. It fires when the two players actually meet. */
export interface Hit {
  kind: "tackle" | "miss";
  runner: string;
  other: string;
  /** Earliest moment within the beat, 0..1. */
  at?: number;
  /** tackle: both go down (default), the runner drives through, or the runner is driven backwards. */
  result?: "down" | "through" | "driven";
}
export interface Beat {
  ms: number;
  to: Record<string, Pt>;
  ball: Ball;
  banner?: Banner;
  /** Small play-by-play caption shown at the bottom of the arena. */
  cap?: string;
  fx?: { kind: "impact" | "flash" | "ring" | "kick"; at: string | Pt; color?: string };
  hits?: Hit[];
}
/** A kick at goal is shown from behind the kicker so the outcome is unmistakable. */
export interface KickView {
  outcome: "good" | "post-in" | "post" | "wide" | "short";
  /** -1 = the left of the posts, 1 = the right (kicker's view). */
  side: -1 | 1;
  /** Scene time (ms) at which the ball is struck, and how long the flight lasts. */
  start: number;
  flight: number;
  /** Sideways bend of the ball in flight, -1..1 (screen direction), peaking mid-flight. */
  curve: number;
  /** Multiplier on the height of the arc (1 = default). */
  lift: number;
  /** Where a successful kick crosses the plane of the posts, -1..1 across the goal mouth. */
  aim: number;
}
export interface Scene {
  kick?: KickView;
  att: 0 | 1;
  init: Record<string, Pt>;
  initBall: Ball;
  beats: Beat[];
  names: { a: string[]; d: string[] };
}

export const sceneMs = (s: Scene) => s.beats.reduce((t, b) => t + b.ms, 0);

const GREEN = "#8fe3a6";
const AMBER = "#f0b35a";
const RED = "#ff9a8a";
const WHITE = "#ffffff";

const LANE_A = [0.3, 0.66, 0.5, 0.9, 0.5];
const LANE_D = [0.32, 0.68, 0.5, 0.9, 0.5];
const BACK_A = [4, 4, 0, 5, 16];
const FRONT_D = [7, 7, 7.5, 7, 19];
const MS_PER_M = 55;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const A = (i: number) => `a${i}`;
const D = (i: number) => `d${i}`;
const surname = (n: string) => n.split(" ").slice(1).join(" ") || n;

/** Cheap deterministic 0..1 per event, so replays choreograph identically. */
export function rand(ev: MatchEvent, salt: number): number {
  let x = (ev.step * 9301 + ev.minute * 49297 + salt * 233280 + ev.x0 * 17) % 233280;
  x = (x * 9301 + 49297) % 233280;
  x = (x * 9301 + 49297) % 233280;
  return x / 233280;
}

/** Lane where a try is grounded; the conversion is lined up on the same lane. */
export function tryLane(ev: MatchEvent): number {
  let x = (ev.step * 7919 + ev.minute * 104729) % 233280;
  x = (x * 9301 + 49297) % 233280;
  return 0.3 + (x / 233280) * 0.4;
}

type Pos = Record<string, Pt>;

class SceneBuilder {
  beats: Beat[] = [];
  pos: Pos;
  constructor(public init: Pos) {
    this.pos = init;
  }
  go(ms: number, f: (p: Pos) => void, ball: Ball, extra: Partial<Beat> = {}) {
    const p: Pos = {};
    for (const [k, v] of Object.entries(this.pos)) p[k] = { ...v };
    f(p);
    this.pos = p;
    this.beats.push({ ms, to: p, ball, ...extra });
  }
}

/** Attackers in echelon around the holder; the Pivot stays close behind when someone else has it. */
/**
 * How the two sides are set up for the scene being built: the attacking and defending tactic
 * and the defence's shape. buildScene sets this before it lays out a scene (it is synchronous),
 * so formation() and line() can show the tactic and shape without threading them everywhere.
 */
interface Style {
  ta: TacticId;
  td: TacticId;
  sd: ShapeId;
  /** Lineup slots of defenders who are not on the pitch (sin bin or sent off). */
  offD: number[];
}
const DEFAULT_STYLE: Style = { ta: "balanced", td: "balanced", sd: "sweeper", offD: [] };
let STYLE: Style = DEFAULT_STYLE;

/** Attackers: how deep they stand behind the ball and how widely they spread. */
const ATTACK_DEPTH: Record<TacticId, number> = { attacking: 0.7, balanced: 1, defensive: 1.4, territory: 1 };
const ATTACK_SPREAD: Record<TacticId, number> = { attacking: 1.2, balanced: 1, defensive: 0.85, territory: 1 };
/** Defence: metres added to the depth of the defensive line (negative = a higher, more aggressive line). */
const LINE_DEPTH: Record<TacticId, number> = { attacking: -1.5, balanced: 0, defensive: 2.5, territory: 1 };

function formation(p: Pos, bx: number, by: number, holder: number) {
  const depth = ATTACK_DEPTH[STYLE.ta];
  const spread = ATTACK_SPREAD[STYLE.ta];
  const lane = (i: number) => clamp(0.5 + (LANE_A[i] - 0.5) * spread, 0.06, 0.94);
  for (let i = 0; i < 5; i++) {
    if (i === holder) p[A(i)] = { x: bx, y: by };
    // The Pivot stands deeper when the plan is to kick for territory.
    else if (i === 2) p[A(i)] = { x: bx - (STYLE.ta === "territory" ? 4.5 : 2.5), y: lerp(0.5, by, 0.5) };
    else p[A(i)] = { x: bx - BACK_A[i] * depth, y: lerp(lane(i), by, 0.2) };
  }
}

/** Lane and depth of each defender for a shape; the line members are spaced out evenly. */
function defenceLanes(): Record<number, number> {
  const shape = STYLE.sd;
  // Who stands in the line for this shape, and across what width.
  const members = shape === "flat" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3];
  const [lo, hi] = shape === "narrow" ? [0.33, 0.77] : [0.14, 0.9];
  const present = members.filter((i) => !STYLE.offD.includes(i));
  const lanes: Record<number, number> = {};
  present.forEach((slot, k) => (lanes[slot] = present.length === 1 ? 0.5 : lerp(lo, hi, k / (present.length - 1))));
  if (shape !== "flat" && !STYLE.offD.includes(4)) lanes[4] = 0.5;
  return lanes;
}

/** Defensive line of four with the Sweeper behind. `bite` pulls one defender sideways. */
function line(p: Pos, bx: number, by: number, depth: number, bite?: { i: number; toY: number }) {
  const lanes = defenceLanes();
  const flat = STYLE.sd === "flat";
  const d = depth - 7 + LINE_DEPTH[STYLE.td];
  for (let i = 0; i < 5; i++) {
    const deep = i === 4 && !flat; // the Sweeper only stands behind the line when the shape says so
    const x = deep ? bx + FRONT_D[4] + d * 0.3 : bx + (i === 4 ? 7 : FRONT_D[i]) + d;
    p[D(i)] = { x, y: lerp(lanes[i] ?? LANE_D[i], by, 0.2) };
  }
  if (bite) p[D(bite.i)] = { x: p[D(bite.i)].x - 0.8, y: bite.toY };
}

interface Ctx {
  ev: MatchEvent;
  sb: SceneBuilder;
  r: (salt: number) => number;
  ai: number;
  di: number;
  names: { a: string[]; d: string[] };
}

interface RunOpts {
  depth?: number;
  beaten?: boolean;
  tackler?: string;
  chase?: number;
  bite?: { i: number; toY: number };
  extra?: Partial<Beat>;
}

function run(c: Ctx, ai: number, to: number, y: number, ms: number, o: RunOpts = {}) {
  c.sb.go(
    ms,
    (p) => {
      formation(p, to, y, ai);
      line(p, to, y, o.depth ?? 7, o.bite);
      if (o.beaten) for (let i = 0; i < 4; i++) p[D(i)] = { x: to - 2 - i * 1.5, y: lerp(LANE_D[i], y, 0.5) };
      if (o.tackler) p[o.tackler] = { x: to + 1.3, y: y + 0.03 };
      if (o.chase !== undefined) p[D(4)] = { x: to - o.chase, y: lerp(0.5, y, 0.7) };
    },
    { k: "held", by: A(ai) },
    o.extra,
  );
}

function initShape(x0: number): Pos {
  const p: Pos = {};
  formation(p, x0, 0.5, 2);
  line(p, x0, 0.5, 8);
  return p;
}

/** Index of the defender standing nearest a lane. */
function nearestDef(y: number): number {
  // The defender standing nearest this lane in the current shape (never the deep Sweeper).
  const lanes = defenceLanes();
  const slots = Object.keys(lanes).map(Number).filter((i) => i < 4 || STYLE.sd === "flat");
  const pool = slots.length ? slots : [0];
  return pool.reduce((best, i) => (Math.abs(lanes[i] - y) < Math.abs(lanes[best] - y) ? i : best));
}

interface PlayResult {
  bx: number;
  by: number;
  bite?: { i: number; toY: number };
  name: string;
}

/**
 * Chooses a set play for the carrier and lays out the build-up. On return the carrier holds
 * the ball at (bx, by) with the defence still reacting.
 */
function setPlay(c: Ctx, x0: number): PlayResult {
  const { sb, r, ai } = c;
  const a = A(ai);
  const roll = r(21);
  let kind: "crash" | "dummy" | "loop" | "switch" | "skip" | "chain" | "direct";
  // A side set up to attack moves the ball through many hands before it commits to a runner.
  const chainP = STYLE.ta === "attacking" ? 0.6 : STYLE.ta === "balanced" ? 0.1 : 0;
  if (r(23) < chainP) kind = "chain";
  else if (ai === 3) kind = roll < 0.5 ? "skip" : "loop";
  else if (ai === 2) kind = "dummy";
  else kind = roll < 0.4 ? "crash" : roll < 0.75 ? "dummy" : "switch";
  // The nearer the line, the fewer passes: there is no law that says the ball must go through hands first.
  const toGo = 100 - x0;
  if (toGo < 12) kind = ai === 2 ? "direct" : "crash";
  else if (toGo < 25 && (kind === "chain" || kind === "loop" || kind === "switch")) kind = ai === 2 ? "dummy" : "crash";
  let bx = x0;

  if (kind === "direct") {
    // Right by the line: the player simply takes it and goes, no pass.
    sb.go(600, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 6); }, { k: "held", by: A(2) }, { cap: "So close to the line there is no need to pass: the Pivot takes it himself" });
    bx += 1;
    return { bx, by: 0.5, name: "Direct" };
  }

  if (kind === "chain") {
    // Pivot -> hands -> hands -> hands -> runner, the defence sliding to follow the ball.
    const others = [0, 1, 3, 4].filter((i) => i !== ai);
    const order = [2];
    const n = 1 + Math.floor(r(24) * 3); // one to three middle men before the final pass, never a fixed number
    let pool = others.slice();
    while (order.length <= n && pool.length) {
      const i = pool.splice(Math.floor(r(25 + order.length) * pool.length), 1)[0];
      order.push(i);
    }
    order.push(ai);
    sb.go(650, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 8); }, { k: "held", by: A(2) }, { cap: "Attacking shape: the ball goes through many hands before anyone runs" });
    for (let s = 1; s < order.length; s++) {
      const from = order[s - 1];
      const to = order[s];
      bx += 1.8;
      const y = to === ai ? LANE_A[ai] : clamp(LANE_A[to] + (s % 2 ? 0.06 : -0.06), 0.12, 0.88);
      sb.go(480, (p) => {
        formation(p, bx, y, to);
        p[A(from)] = { x: bx - 1.2, y: lerp(p[A(from)].y, y, 0.5) };
        line(p, bx, y, 6.5 - s * 0.3, s >= 2 ? { i: nearestDef(y), toY: y } : undefined);
      }, { k: "pass", from: A(from), to: A(to), arc: 6 }, { cap: s === order.length - 1 ? "Final pass: the ball is in the hands of the runner with the defence stretched" : ["Quick hands: pass one", "Pass two: the defence slides across", "Pass three: players run lines off the ball"][s - 1] });
    }
    return { bx, by: LANE_A[ai], name: "Passing chain" };
  }

  if (kind === "crash") {
    const y = LANE_A[ai];
    sb.go(850, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 8); p[D(nearestDef(y))].y += 0.02; }, { k: "held", by: A(2) }, { cap: "Crash ball: the Pivot holds, looking for the heavy runner" });
    bx += 2.5;
    sb.go(560, (p) => { formation(p, bx, y, ai); line(p, bx, y, 5.5); }, { k: "pass", from: A(2), to: a, arc: 6 }, { cap: "Short pass, taken at pace" });
    return { bx, by: y, name: "Crash ball" };
  }

  if (kind === "dummy") {
    const decoy = ai === 0 ? 1 : ai === 1 ? 0 : r(5) < 0.5 ? 0 : 1;
    const dir = LANE_A[decoy] < 0.5 ? 1 : -1;
    const bi = nearestDef(LANE_A[decoy] + dir * 0.15);
    const toY = LANE_A[decoy] + dir * 0.22;
    sb.go(750, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 8); }, { k: "held", by: A(2) }, { cap: "Dummy run: a decoy sprints across to drag a defender across" });
    bx += 2;
    sb.go(700, (p) => {
      formation(p, bx, 0.5, 2);
      p[A(decoy)] = { x: bx + 2, y: toY };
      line(p, bx, 0.5, 7, { i: bi, toY: toY + dir * 0.04 });
    }, { k: "held", by: A(2) }, { cap: "The Pivot sells the pass. The defender bites." });
    bx += 2;
    if (ai === 2) {
      // The Pivot keeps it and goes through the hole.
      const by = clamp(0.5 - dir * 0.14, 0.25, 0.75);
      sb.go(550, (p) => { formation(p, bx, by, 2); p[A(decoy)] = { x: bx + 3, y: toY }; line(p, bx, by, 6, { i: bi, toY: toY + dir * 0.06 }); }, { k: "held", by: A(2) }, { cap: "The Pivot keeps the ball and steps into the gap" });
      return { bx, by, bite: { i: bi, toY: toY + dir * 0.06 }, name: "Dummy" };
    }
    const y = LANE_A[ai];
    sb.go(560, (p) => {
      formation(p, bx, y, ai);
      p[A(decoy)] = { x: bx + 3, y: toY };
      line(p, bx, y, 6, { i: bi, toY: toY + dir * 0.06 });
    }, { k: "pass", from: A(2), to: a, arc: 6 }, { cap: "Pass goes behind the decoy, into the space the decoy created" });
    return { bx, by: y, bite: { i: bi, toY: toY + dir * 0.06 }, name: "Dummy" };
  }

  if (kind === "loop") {
    const mid = 1;
    const y = LANE_A[ai];
    sb.go(700, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 8); }, { k: "held", by: A(2) }, { cap: "Loop: pass inside, then run around the receiver to create an overlap" });
    bx += 2.5;
    sb.go(520, (p) => { formation(p, bx, 0.62, mid); p[A(2)] = { x: bx - 1, y: 0.56 }; line(p, bx, 0.62, 7); }, { k: "pass", from: A(2), to: A(mid), arc: 6 });
    bx += 3;
    sb.go(620, (p) => {
      formation(p, bx, 0.62, mid);
      p[A(2)] = { x: bx + 1.5, y: 0.82 };
      p[A(ai)] = { x: bx - 1.5, y: Math.max(y, 0.88) };
      line(p, bx, 0.62, 6, { i: 2, toY: 0.6 });
    }, { k: "held", by: A(mid) }, { cap: "The looper is round the outside. Defenders must pick a man." });
    bx += 2;
    sb.go(560, (p) => {
      formation(p, bx, 0.86, ai);
      p[A(mid)] = { x: bx - 2, y: 0.64 };
      p[A(2)] = { x: bx + 0.5, y: 0.78 };
      line(p, bx, 0.86, 6, { i: 2, toY: 0.62 });
    }, { k: "pass", from: A(mid), to: a, arc: 8 });
    return { bx, by: 0.86, name: "Loop" };
  }

  if (kind === "switch") {
    const first = ai === 0 ? 1 : 0;
    const y = LANE_A[ai];
    sb.go(700, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 8); }, { k: "held", by: A(2) }, { cap: "Switch: carry across the field, then pass back the other way" });
    bx += 2.5;
    const fy = LANE_A[first];
    sb.go(520, (p) => { formation(p, bx, fy, first); line(p, bx, fy, 7); }, { k: "pass", from: A(2), to: A(first), arc: 6 });
    bx += 3;
    const cross = lerp(fy, 1 - fy, 0.55);
    sb.go(700, (p) => {
      formation(p, bx, cross, first);
      p[a] = { x: bx - 2, y: lerp(y, 1 - y, 0.1) };
      line(p, bx, cross, 6.5);
      p[D(nearestDef(cross))].y = cross + (cross > 0.5 ? 0.05 : -0.05);
    }, { k: "held", by: A(first) }, { cap: "Defence slides across to follow the ball" });
    bx += 1.5;
    sb.go(560, (p) => {
      formation(p, bx, y, ai);
      p[A(first)] = { x: bx - 1.5, y: cross };
      line(p, bx, y, 6, { i: nearestDef(cross), toY: cross });
    }, { k: "pass", from: A(first), to: a, arc: 8 });
    return { bx, by: y, bite: { i: nearestDef(cross), toY: cross }, name: "Switch" };
  }

  // skip pass to the wing
  sb.go(800, (p) => { formation(p, bx, 0.5, 2); line(p, bx, 0.5, 8); }, { k: "held", by: A(2) }, { cap: "Skip pass: forwards run hard inside while the ball goes wide" });
  bx += 2;
  sb.go(700, (p) => {
    formation(p, bx, 0.5, 2);
    p[A(0)] = { x: bx + 1.5, y: 0.4 };
    p[A(1)] = { x: bx + 1.5, y: 0.6 };
    line(p, bx, 0.5, 6);
    p[D(0)].y = 0.38;
    p[D(1)].y = 0.62;
    p[D(2)].x -= 1;
  }, { k: "held", by: A(2) }, { cap: "Defenders are pulled in by the decoy runners" });
  bx += 2;
  sb.go(700, (p) => {
    formation(p, bx, 0.9, 3);
    p[A(0)] = { x: bx + 2, y: 0.4 };
    p[A(1)] = { x: bx + 2, y: 0.6 };
    line(p, bx, 0.9, 6);
    p[D(3)] = { x: bx + 4, y: 0.84 };
    p[D(0)].y = 0.4;
    p[D(1)].y = 0.6;
  }, { k: "pass", from: A(2), to: a, arc: 22 }, { cap: "Long skip pass over the top finds the winger in space" });
  return { bx, by: 0.9, name: "Skip pass" };
}

function burstTo(c: Ctx, ai: number, from: number, to: number, y: number, o: RunOpts = {}) {
  run(c, ai, to, y, clamp(450 + (to - from) * MS_PER_M, 900, 3000), o);
}

function trySceneEnd(c: Ctx, cid: string, did: string, ty: number) {
  const { sb, ev } = c;
  sb.go(
    850,
    (p) => {
      p[cid] = { x: 101.8, y: ty };
      p[did] = { x: 98.8, y: ty + 0.05 };
      for (let i = 0; i < 5; i++) {
        const id = A(i);
        if (id !== cid) p[id] = { x: Math.min(p[id].x + 3, 97), y: p[id].y };
      }
    },
    { k: "held", by: cid },
    { banner: { text: "TRY!", color: WHITE, sub: ev.player }, fx: { kind: "flash", at: { x: 101, y: ty } }, cap: "Dives over the line and grounds the ball" },
  );
  sb.go(
    900,
    (p) => {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const id = A(i);
        if (id === cid) continue;
        p[id] = { x: 99.5 + (n % 2) * 1.6, y: clamp(ty + (n - 1.5) * 0.09, 0.1, 0.9) };
        n++;
      }
      for (let i = 0; i < 5; i++) p[D(i)] = { x: p[D(i)].x - 1.2, y: p[D(i)].y };
    },
    { k: "at", p: { x: 102.6, y: ty } },
  );
}


/**
 * Grubber (a low kick that skips and rolls along the ground) or chip (a short, high kick over the
 * rushing defence), then a chase for the ball in-goal. The caption and banner say which one it is.
 */
function kickAheadScene(c: Ctx, x0: number, ki: number, kind: "grubber" | "chip", outcome: "try" | "lost" | "dead") {
  const { sb, ev, r, ai, di, names } = c;
  const cid = A(ai);
  const did = D(di);
  const kid = A(ki);
  const ty = outcome === "try" ? tryLane(ev) : 0.3 + r(31) * 0.4;
  const bx = x0;
  const label = kind === "grubber" ? "GRUBBER!" : "CHIP & CHASE!";
  if (ki !== 2) {
    sb.go(520, (q) => {
      formation(q, bx, LANE_A[ki], ki);
      line(q, bx, 0.5, 8);
    }, { k: "pass", from: A(2), to: kid, arc: 6 }, { cap: "Pass to the kicker" });
  }
  sb.go(700, (q) => {
    formation(q, bx, LANE_A[ki], ki);
    q[cid] = { x: bx + 1.5, y: clamp(ty + (ty > 0.5 ? -0.14 : 0.14), 0.1, 0.9) };
    line(q, bx, 0.5, 4);
  }, { k: "held", by: kid }, {
    cap: kind === "grubber" ? "The defence rushes up. The kicker will poke the ball low through the gap." : "The defence rushes up flat. The kicker spots the space over the top.",
  });
  const landX = outcome === "dead" ? 103.5 : 102;
  const ms = clamp(600 + (landX - bx) * MS_PER_M, 1200, 2800);
  sb.go(ms, (q) => {
    q[kid] = { x: bx + 1, y: q[kid].y };
    q[cid] = { x: outcome === "try" ? landX - 0.8 : landX - 2.4, y: ty };
    q[did] = { x: outcome === "try" ? landX - 3.5 : landX - 0.8, y: clamp(ty + (outcome === "try" ? 0.07 : 0.02), 0.1, 0.9) };
    for (let i = 0; i < 5; i++) if (D(i) !== did) q[D(i)] = { x: bx + 5 + i * 0.4, y: LANE_D[i] };
    for (let i = 0; i < 5; i++) if (A(i) !== cid && A(i) !== kid) q[A(i)] = { x: bx + 3 + i, y: q[A(i)].y };
  }, { k: "fly", from: kid, to: { x: landX, y: ty }, arc: kind === "grubber" ? 8 : 42, style: kind }, {
    banner: { text: label, color: GREEN, sub: surname(names.a[ki]) },
    cap: kind === "grubber" ? "Grubber: a low kick that skips and rolls along the ground, in behind the defence" : "Chip and chase: a short, high kick over the defence, then the chaser sprints after it",
    fx: { kind: "kick", at: kid },
  });
  if (outcome === "dead") {
    sb.go(900, () => {}, { k: "fly", from: { x: landX, y: ty }, to: { x: 106, y: ty }, arc: 6, style: "loose" }, { banner: { text: "DEAD BALL", color: AMBER }, cap: "Too firm: it runs over the dead-ball line. Drop-out for the defence." });
  } else if (outcome === "lost") {
    sb.go(750, (q) => {
      q[did] = { x: landX - 0.4, y: ty };
    }, { k: "held", by: did }, { hits: [{ kind: "miss", runner: cid, other: did, at: 0.4 }], banner: { text: "COVERED!", color: AMBER, sub: surname(names.d[di]) }, cap: "The defender gets there first and grounds it. Drop-out." });
    sb.go(800, () => {}, { k: "held", by: did });
  } else {
    sb.go(750, (q) => {
      q[cid] = { x: 101.2, y: ty };
    }, { k: "held", by: cid }, { hits: [{ kind: "miss", runner: cid, other: did, at: 0.5 }], cap: kind === "grubber" ? "The chaser wins the race and dives on the bouncing ball" : "The chaser beats the defender and gathers it on the bounce" });
    trySceneEnd(c, cid, did, ty);
  }
}

/**
 * Builds the choreography for a highlight event, or null if the event is not animated.
 * Players in the sin bin or sent off are not on the pitch, so they are left out of the scene.
 */
export function buildScene(ev: MatchEvent): Scene | null {
  const c = ev.cast;
  STYLE = { ta: c?.ta ?? "balanced", td: c?.td ?? "balanced", sd: c?.sd ?? "sweeper", offD: c?.offD ?? [] };
  let scene: Scene | null;
  try {
    scene = buildFullScene(ev);
  } finally {
    STYLE = DEFAULT_STYLE;
  }
  const cast = ev.cast;
  if (!scene || !cast || (!cast.offA?.length && !cast.offD?.length)) return scene;
  return withoutOffPlayers(scene, [...(cast.offA ?? []).map(A), ...(cast.offD ?? []).map(D)]);
}

/** Removes the given players (ids like "d4") and hands anything they were doing to a teammate. */
function withoutOffPlayers(sc: Scene, offIds: string[]): Scene {
  const off = new Set(offIds);
  const standIn = (id: string): string => {
    if (!off.has(id)) return id;
    for (let i = 0; i < 5; i++) if (!off.has(`${id[0]}${i}`)) return `${id[0]}${i}`;
    return id;
  };
  const surnameOfOff = new Map<string, string>();
  for (const id of off) {
    const names = id[0] === "a" ? sc.names.a : sc.names.d;
    const sub = names[Number(id[1])];
    const repl = names[Number(standIn(id)[1])];
    if (sub && repl) surnameOfOff.set(surname(sub), surname(repl));
  }
  // Captions that name a role must not mention a player who is not on the pitch.
  const gone = (slot: number) => off.has(A(slot)) || off.has(D(slot));
  const fixCap = (t: string) => {
    let out = t;
    if (gone(4)) out = out.replace(/The Sweeper/g, "A covering player").replace(/the Sweeper/g, "a covering player");
    if (gone(2)) out = out.replace(/The Pivot/g, "A runner").replace(/the Pivot/g, "a runner");
    if (gone(3)) out = out.replace(/the winger/g, "a runner");
    return out;
  };
  const keep = (m: Record<string, Pt>) => Object.fromEntries(Object.entries(m).filter(([id]) => !off.has(id)));
  const ball = (b: Ball): Ball => {
    if (b.k === "held") return { k: "held", by: standIn(b.by) };
    if (b.k === "pass") {
      const from = standIn(b.from);
      const to = standIn(b.to);
      return from === to ? { k: "held", by: from } : { ...b, from, to };
    }
    if (b.k === "fly") return { ...b, from: typeof b.from === "string" ? standIn(b.from) : b.from };
    return b;
  };
  return {
    ...sc,
    init: keep(sc.init),
    initBall: ball(sc.initBall),
    beats: sc.beats.map((b) => ({
      ...b,
      to: keep(b.to),
      ball: ball(b.ball),
      cap: b.cap === undefined ? undefined : fixCap(b.cap),
      banner: b.banner ? { ...b.banner, sub: b.banner.sub === undefined ? undefined : (surnameOfOff.get(b.banner.sub) ?? b.banner.sub), text: b.banner.text } : undefined,
      fx: b.fx && typeof b.fx.at === "string" ? { ...b.fx, at: standIn(b.fx.at) } : b.fx,
      hits: b.hits?.map((h) => ({ ...h, runner: standIn(h.runner), other: standIn(h.other) })).filter((h) => h.runner !== h.other),
    })),
  };
}

function buildFullScene(ev: MatchEvent): Scene | null {
  if (!ev.highlight || !ev.cast || ev.att === undefined) return null;
  const att = ev.att;
  const toU = (x: number) => (att === 0 ? x : 100 - x);
  const x0 = clamp(toU(ev.x0), 4, 92);
  const u1 = toU(ev.x1);
  const names = { a: ev.cast.a, d: ev.cast.d };
  const ai = ev.cast.ai >= 0 ? ev.cast.ai : 2;
  const di = ev.cast.di >= 0 ? ev.cast.di : 1;
  const sb = new SceneBuilder(initShape(x0));
  const r = (salt: number) => rand(ev, salt);
  const c: Ctx = { ev, sb, r, ai, di, names };
  const cid = A(ai);
  const did = D(di);
  let initBall: Ball = { k: "held", by: A(2) };
  const type = ev.type;

  if ((type === "try" || type === "kick") && (ev.variant?.startsWith("grubber") || ev.variant?.startsWith("chip"))) {
    const kind = ev.variant.startsWith("grubber") ? "grubber" : "chip";
    const outcome = type === "try" ? "try" : ev.variant.endsWith("dead") ? "dead" : "lost";
    kickAheadScene(c, x0, ev.cast.ki ?? 2, kind, outcome);
    initBall = { k: "held", by: A(2) };
  } else if (type === "try") {
    const ty = tryLane(ev);
    const p = setPlay(c, x0);
    if (ev.variant === "break") {
      const mid = p.bx + Math.max(4, (100 - p.bx) * 0.35);
      burstTo(c, ai, p.bx, mid, ty, { depth: 4, bite: p.bite, extra: { cap: "Into the gap! A defender dives and misses.", banner: { text: "BREAK!", color: GREEN }, hits: [{ kind: "miss", runner: cid, other: D(nearestDef(ty)), at: 0.55 }] } });
      burstTo(c, ai, mid, 98, ty, { beaten: true, chase: 4, extra: { cap: STYLE.sd === "flat" ? "Clear of a flat line: there is no Sweeper behind it to stop the try" : "Clear of the defence. The Sweeper dives, but too late.", hits: [{ kind: "miss", runner: cid, other: D(4), at: 0.75 }] } });
    } else {
      const tx = Math.min(95, p.bx + Math.max(4, (100 - p.bx) * 0.6));
      burstTo(c, ai, p.bx, tx, ty, { depth: 3, tackler: did, bite: p.bite, extra: { cap: "Head down, straight at the defender" } });
      sb.go(650, (q) => {
        formation(q, 97.4, ty, ai);
        line(q, 97.4, ty, 3);
        q[did] = { x: 97.9, y: ty + 0.02 };
      }, { k: "held", by: cid }, { hits: [{ kind: "tackle", runner: cid, other: did, result: "through", at: 0.2 }], cap: "Big hit, but the runner drives straight through the tackle" });
    }
    trySceneEnd(c, cid, did, ty);
  } else if (type === "break") {
    const p = setPlay(c, x0);
    const y = p.by < 0.5 ? 0.62 : 0.36;
    const end = clamp(u1, p.bx + 8, 94);
    const mid = p.bx + (end - p.bx) * 0.4;
    const v = ev.variant ?? "caught";
    burstTo(c, ai, p.bx, mid, y, { depth: 4, bite: p.bite, extra: { banner: { text: "LINE BREAK", color: GREEN, sub: ev.player }, cap: "Beats the first defender, who dives and misses", hits: [{ kind: "miss", runner: cid, other: D(nearestDef(y)), at: 0.5 }] } });
    burstTo(c, ai, mid, end - 3, y, { beaten: true, chase: 10, extra: { cap: "Another defender is left grasping at air", hits: [{ kind: "miss", runner: cid, other: D((nearestDef(y) + 1) % 4), at: 0.6 }] } });
    const cover = v === "covered" ? D(4) : did;
    if (v === "touch") {
      sb.go(800, (q) => {
        formation(q, end, 0.95, ai);
        for (let i = 0; i < 5; i++) q[D(i)] = { x: end - 3.5 - i * 1.7, y: lerp(LANE_D[i], 0.9, 0.5) };
        q[A(ai)] = { x: end, y: 0.95 };
        q[did] = { x: end + 0.4, y: 0.86 };
      }, { k: "held", by: cid }, { cap: "Forced out towards the touchline", hits: [{ kind: "tackle", runner: cid, other: did, result: "driven", at: 0.4 }] });
      sb.go(700, () => {}, { k: "fly", from: cid, to: { x: end + 2, y: 1.12 }, arc: 16, style: "loose" }, { banner: { text: "OUT OF PLAY!", color: AMBER, sub: "Line-out to the defence" }, cap: "The ball crosses the touchline. Possession switches." });
      sb.go(1100, (q) => {
        const sideY = 0.93;
        q[D(2)] = { x: end + 0.5, y: 1.0 };
        const att = [0, 1, 3];
        att.forEach((i, n) => (q[A(i)] = { x: end - 1 + n * 2.1, y: sideY - 0.1 }));
        const def = [0, 1, 3];
        def.forEach((i, n) => (q[D(i)] = { x: end - 1 + n * 2.1, y: sideY - 0.2 }));
        q[A(2)] = { x: end - 4, y: 0.7 };
        q[A(4)] = { x: end - 7, y: 0.6 };
        q[D(4)] = { x: end + 6, y: 0.7 };
      }, { k: "held", by: D(2) }, { cap: "Line-out: the defending side throws it in" });
    } else if (v === "foul") {
      sb.go(800, (q) => {
        formation(q, end, y, ai);
        for (let i = 0; i < 5; i++) q[D(i)] = { x: end - 3.5 - i * 1.7, y: lerp(LANE_D[i], y, 0.6) };
        q[did] = { x: end + 0.9, y: y + 0.02 };
      }, { k: "held", by: cid }, { banner: { text: "HIGH TACKLE!", color: RED, sub: surname(names.d[di]) }, cap: "Caught around the neck. The referee is blowing the whistle.", hits: [{ kind: "tackle", runner: cid, other: did, result: "down", at: 0.3 }] });
      sb.go(1000, (q) => {
        for (let i = 0; i < 5; i++) if (D(i) !== did) q[D(i)] = { x: end + 8 + i * 0.6, y: LANE_D[i] };
      }, { k: "held", by: cid }, { banner: { text: "PENALTY!", color: AMBER, sub: "Defence retreats 10 metres" }, cap: "Penalty to the attackers", fx: { kind: "ring", at: did, color: RED } });
    } else {
      sb.go(800, (q) => {
        formation(q, end, y, ai);
        // Beaten defenders arrive late, from behind; only the covering man is at the contact.
        for (let i = 0; i < 5; i++) q[D(i)] = { x: end - 3.5 - i * 1.7, y: lerp(LANE_D[i], y, 0.6) };
        q[cover] = { x: end + 0.9, y: y + 0.02 };
      }, { k: "held", by: cid }, {
        hits: [{ kind: "tackle", runner: cid, other: cover, result: "down", at: 0.3 }],
        banner: { text: v === "covered" ? "COVERED!" : "CAUGHT!", color: AMBER, sub: surname(names.d[v === "covered" ? 4 : di]) },
        cap: v === "covered" ? "The Sweeper scrambles across and saves the try" : "Dragged down from behind",
      });
      sb.go(1000, (q) => {
        for (let i = 0; i < 5; i++) if (A(i) !== cid) q[A(i)] = { x: Math.max(q[A(i)].x, end - 5 + i), y: q[A(i)].y };
      }, { k: "held", by: cid }, { cap: "Support arrives. Play goes on from here." });
    }
  } else if (type === "turnover") {
    const p = setPlay(c, x0);
    const end = clamp(u1, p.bx + 1, 95);
    burstTo(c, ai, p.bx, end, p.by, { depth: 4, tackler: did, bite: p.bite, extra: { cap: "Tackled. The ball stays loose in the contact area." } });
    sb.go(700, (q) => {
      formation(q, end, p.by, ai);
      line(q, end, p.by, 3.5);
      q[D(4)] = { x: end + 9, y: 0.5 };
      q[did] = { x: end + 0.8, y: p.by + 0.02 };
      q[D((di + 1) % 4)] = { x: end + 1.6, y: p.by - 0.05 };
    }, { k: "held", by: cid }, { hits: [{ kind: "tackle", runner: cid, other: did, result: "down", at: 0.3 }], cap: "Wrapped up and put on the floor" });
    sb.go(800, (q) => {
      q[did] = { x: end + 1.4, y: p.by };
    }, { k: "fly", from: cid, to: { x: end + 1.4, y: p.by }, arc: 12, style: "loose" }, { banner: { text: "TURNOVER!", color: AMBER, sub: ev.player }, cap: "Jackal! The tackler gets over the ball and rips it free" });
    sb.go(900, (q) => {
      q[did] = { x: end - 2, y: p.by + 0.1 };
      for (let i = 0; i < 5; i++) if (D(i) !== did) q[D(i)] = { x: end - 1 + i * 0.8, y: LANE_D[i] };
    }, { k: "held", by: did });
  } else if (type === "knock-on") {
    const p = setPlay(c, x0);
    const ball = { x: p.bx + 4, y: clamp(p.by + (r(4) - 0.5) * 0.2, 0.15, 0.85) };
    sb.go(700, (q) => {
      q[did] = { x: p.bx + 5, y: p.by };
    }, { k: "fly", from: cid, to: ball, arc: 14, style: "loose" }, { banner: { text: "KNOCK-ON!", color: RED, sub: ev.player }, cap: "It slips out of the carrier's hands and goes forward" });
    sb.go(750, (q) => {
      q[did] = { ...ball };
    }, { k: "held", by: did }, { cap: "The defence scoops it up" });
  } else if (type === "intercept") {
    // Build the normal set play but skip its final pass: the defender steps into the lane.
    const p = setPlay(c, x0);
    const dropped = sb.beats.pop();
    const prev = sb.beats[sb.beats.length - 1];
    sb.pos = prev ? prev.to : sb.init;
    const lane = { x: p.bx + 2.5, y: lerp(0.5, p.by, 0.5) };
    const fromId = dropped && dropped.ball.k === "pass" ? dropped.ball.from : A(2);
    sb.go(560, (q) => {
      formation(q, p.bx, p.by, ai);
      q[A(ai)] = { x: p.bx + 1, y: p.by };
      q[did] = { ...lane };
    }, { k: "pass", from: fromId, to: did, arc: 6 }, { banner: { text: "INTERCEPTED!", color: RED, sub: ev.player }, cap: "A perfectly read pass: the defender jumps it" });
    const end = clamp(u1, 4, p.bx - 4);
    const ms = clamp(500 + (lane.x - end) * MS_PER_M, 900, 2600);
    sb.go(ms, (q) => {
      q[did] = { x: end, y: lane.y + 0.1 };
      for (let i = 0; i < 5; i++) {
        if (A(i) !== did) q[A(i)] = { x: Math.max(end + 3 + i * 1.5, lane.x - 6 + i), y: LANE_A[i] };
        if (D(i) !== did) q[D(i)] = { x: end - 3 - i * 1.4, y: lerp(LANE_D[i], lane.y, 0.4) };
      }
      q[A(4)] = { x: end + 4, y: lane.y + 0.05 };
    }, { k: "held", by: did }, { cap: "Counter attack! The Sweeper is the last man back." });
    sb.go(700, (q) => {
      q[A(4)] = { x: end + 0.7, y: lane.y + 0.1 };
    }, { k: "held", by: did }, { hits: [{ kind: "tackle", runner: did, other: A(4), result: "down", at: 0.3 }], cap: "The Sweeper finally brings the runner down" });
  } else if (type === "kick") {
    const kid = A(ai);
    initBall = { k: "held", by: A(2) };
    const bx = x0;
    if (ai !== 2) {
      sb.go(520, (q) => {
        formation(q, bx, LANE_A[ai], ai);
        line(q, bx, 0.5, 8);
      }, { k: "pass", from: A(2), to: kid, arc: 6 }, { cap: "Pass back to the kicker" });
    }
    const dead = ev.variant === "dead";
    const land = dead ? { x: 103, y: 0.5 } : { x: clamp(u1, bx + 20, 98), y: 0.5 };
    sb.go(750, (q) => {
      q[kid] = { x: bx - 2, y: q[kid].y };
      q[A(1)] = { x: bx - 1, y: 0.66 };
      q[A(3)] = { x: bx - 1, y: 0.9 };
      q[D(4)] = { x: Math.min(land.x, 97), y: 0.5 };
      for (let i = 0; i < 4; i++) q[D(i)] = { x: bx + 9 + i, y: LANE_D[i] };
    }, { k: "held", by: kid }, { cap: "The kicker takes a step back. Chasers line up." });
    sb.go(1500, (q) => {
      q[kid] = { x: bx + 1, y: q[kid].y };
      q[A(1)] = { x: land.x - 8, y: 0.62 };
      q[A(3)] = { x: land.x - 6, y: 0.85 };
      q[A(0)] = { x: land.x - 12, y: 0.4 };
      for (let i = 0; i < 4; i++) q[D(i)] = { x: land.x - 18 + i * 2, y: LANE_D[i] };
      q[D(4)] = { x: Math.min(land.x, 97), y: 0.5 };
    }, { k: "fly", from: kid, to: land, arc: 80, style: "punt" }, { banner: dead ? undefined : { text: "KICK!", color: GREEN, sub: ev.player }, cap: dead ? "Too long. It is going to run dead." : "A towering kick for territory" });
    if (dead) {
      sb.go(900, () => {}, { k: "fly", from: land, to: { x: 106, y: 0.5 }, arc: 10, style: "loose" }, { banner: { text: "DEAD BALL", color: AMBER }, cap: "Over the dead-ball line. Drop-out for the defence." });
    } else {
      sb.go(850, () => {}, { k: "held", by: D(4) }, { banner: { text: "CAUGHT", color: AMBER, sub: surname(names.d[4]) }, cap: "The Sweeper gathers it under pressure" });
      sb.go(1000, (q) => {
        q[A(1)] = { x: land.x - 1.2, y: 0.55 };
        q[A(3)] = { x: land.x - 3.5, y: 0.7 };
      }, { k: "held", by: D(4) }, { hits: [{ kind: "tackle", runner: D(4), other: A(1), result: "down", at: 0.3 }], cap: "Flattened by the chaser the moment the ball lands" });
    }
  } else if (
    type === "conversion" || type === "conversion-miss" || type === "penalty-goal" || type === "penalty-miss" || type === "drop-goal" || type === "drop-miss"
  ) {
    const kid = A(ai);
    const isConv = type.startsWith("conversion");
    const isDrop = type.startsWith("drop");
    const ty = isConv ? tryLane(ev) : 0.5;
    const spot = isConv ? { x: 88, y: ty } : { x: x0, y: 0.5 };
    const variant = (ev.variant ?? (type.endsWith("miss") ? "wide" : "good")) as KickView["outcome"];
    const good = variant === "good" || variant === "post-in";
    const side: -1 | 1 = ev.side ?? (r(7) < 0.5 ? -1 : 1);
    const dist = isConv ? 12 : Math.round(100 - x0);
    // Rebuild the starting shape around the kick spot.
    const base: Pos = {};
    formation(base, spot.x, spot.y, ai);
    base[kid] = { ...spot };
    for (let i = 0; i < 5; i++) if (A(i) !== kid) base[A(i)] = { x: spot.x - 7 - i, y: 0.25 + i * 0.12 };
    for (let i = 0; i < 5; i++) base[D(i)] = isConv ? { x: 100 - (i === 4 ? 0 : 0.5), y: 0.2 + i * 0.15 } : { x: spot.x + 10, y: 0.2 + i * 0.15 };
    const s2 = new SceneBuilder(base);
    const rest: Ball = isDrop ? { k: "held", by: kid } : { k: "at", p: { ...spot } };
    initBall = rest;
    const what = isConv ? "Conversion" : isDrop ? "Drop goal" : "Penalty";
    // Deterministic per-kick variation: approach angle, routine length, strike style and flight shape.
    const routine = (["quick", "standard", "deliberate", "angled"] as const)[Math.floor(r(11) * 4)];
    const stepBack = routine === "quick" ? 1.5 : routine === "deliberate" ? 4 : 2.5 + r(12) * 1.5;
    const lean = routine === "angled" ? (r(13) < 0.5 ? -1 : 1) * (0.07 + r(14) * 0.05) : (r(14) - 0.5) * 0.04;
    const settleMs = routine === "quick" ? 450 : routine === "deliberate" ? 1100 : 900;
    const stepMs = routine === "quick" ? 260 : routine === "deliberate" ? 520 : 350;
    const runMs = routine === "quick" ? 300 : routine === "angled" ? 440 : 380;
    const flightMs = Math.round(1250 + r(15) * 500);
    const lift = 0.8 + r(16) * 0.45;
    const curve = variant === "wide" ? side * (0.4 + r(17) * 0.6) : (r(17) - 0.5) * 0.9;
    const aim = variant === "good" ? (r(18) - 0.5) * 1.3 : 0;
    const routineCap: Record<typeof routine, string> = {
      quick: `${what} from ${dist}m. No fuss, the kicker takes one step back and goes.`,
      standard: `${what} from ${dist}m. The kicker steps back and lines it up.`,
      deliberate: `${what} from ${dist}m. The kicker takes a long, careful look at the posts.`,
      angled: `${what} from ${dist}m. The kicker marks out an angled run-up.`,
    };
    s2.go(settleMs, () => {}, rest, {
      cap: isConv
        ? "Conversion: the kick must go over the crossbar and between the posts for 2 points"
        : isDrop
          ? "Drop goal: kicked from open play, over the bar and between the posts, 3 points"
          : "Penalty kick at goal: over the bar and between the posts for 3 points",
    });
    s2.go(stepMs, (q) => { q[kid] = { x: spot.x - stepBack, y: spot.y + lean }; }, rest, { cap: routineCap[routine] });
    if (routine === "deliberate") {
      s2.go(380, (q) => { q[kid] = { x: spot.x - stepBack, y: spot.y + lean }; }, rest, { cap: "Deep breath. The stadium goes quiet." });
    }
    s2.go(runMs, (q) => {
      q[kid] = { x: spot.x - 0.6, y: spot.y };
      if (isDrop) for (let i = 0; i < 3; i++) q[D(i)] = { x: spot.x + 3.5, y: lerp(LANE_D[i], spot.y, 0.5) };
      else if (!isConv && routine !== "quick") for (let i = 0; i < 5; i++) q[D(i)] = { x: spot.x + 10, y: 0.2 + i * 0.15 };
    }, rest);
    const flightStart = s2.beats.reduce((t, b) => t + b.ms, 0);
    const target: Pt =
      variant === "short" ? { x: spot.x + (100 - spot.x) * 0.72, y: 0.5 } :
      variant === "wide" ? { x: 105, y: 0.5 + side * 0.24 } :
      { x: 105, y: 0.5 };
    const outcomeCap: Record<KickView["outcome"], string> = {
      good: "Straight between the posts and over the bar. It's good!",
      "post-in": "It clips the upright, bounces up and drops over the bar. It counts!",
      post: `It smacks the ${side < 0 ? "left" : "right"} upright and bounces back into play. No score.`,
      wide: `It drifts outside the ${side < 0 ? "left" : "right"} upright. No score.`,
      short: "It drops short, under the crossbar. No score.",
    };
    const bannerOf: Record<KickView["outcome"], Banner> = {
      good: { text: type === "conversion" ? "CONVERSION!" : type === "penalty-goal" ? "PENALTY GOAL!" : "DROP GOAL!", color: GREEN, sub: ev.player },
      "post-in": { text: "OFF THE POST AND IN!", color: GREEN, sub: ev.player },
      post: { text: "OFF THE POST!", color: RED, sub: ev.player },
      wide: { text: `WIDE ${side < 0 ? "LEFT" : "RIGHT"}!`, color: RED, sub: ev.player },
      short: { text: "SHORT!", color: RED, sub: ev.player },
    };
    s2.go(flightMs, (q) => { q[kid] = { x: spot.x + 0.9, y: spot.y }; }, { k: "fly", from: isDrop ? kid : spot, to: target, arc: (variant === "short" ? 50 : 76) * lift, style: "punt" }, { cap: "Struck cleanly...", fx: { kind: "kick", at: kid } });
    s2.go(1300, () => {}, { k: "at", p: target }, { banner: bannerOf[variant], cap: outcomeCap[variant], fx: { kind: "ring", at: { x: 100, y: 0.5 }, color: good ? GREEN : RED } });
    s2.go(500, () => {}, { k: "at", p: target });
    return { att, init: base, initBall, beats: s2.beats, names, kick: { outcome: variant, side, start: flightStart, flight: flightMs, curve, lift, aim } };
  } else {
    return null;
  }
  return { att, init: sb.init, initBall, beats: sb.beats, names };
}
