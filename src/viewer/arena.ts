import { sceneMs, type Ball, type Hit, type KickView, type Scene } from "./scenes";

/**
 * Top-down arena renderer. It only draws while a highlight scene is playing; the live
 * screen hides the canvas the rest of the time.
 *
 * Players are agents with momentum, not keyframes. A beat gives each player a destination
 * and the time the beat ends; each agent accelerates, cruises and brakes towards it with a
 * limited top speed and acceleration, starts after its own reaction delay, turns smoothly
 * and is nudged away from others. Tackles are collisions with mass: players can be knocked
 * down, driven back or run through, and defenders can lunge and miss.
 *
 * The ball has a ground position and a height. Flights follow a parabola (launch speeds
 * from distance and flight time), the renderer draws a shadow on the ground and lifts the
 * ball above it, and on landing the ball bounces and rolls to a stop.
 *
 * Goal kicks cut to a view from behind the kicker so you can see exactly why the kick
 * scored or missed (over the bar, wide, off the post, or short).
 *
 * Units are metres: x along the pitch (attacker's frame), y across (lane * 40m), z up.
 */
const ROLE_LETTER = ["A", "B", "P", "W", "S"];
const VIEW_M = 46;
const WIDTH_M = 40;
const STEP_MS = 16;
/** Screen pixels of lift per metre of ball height (exaggerated for readability). */
const LIFT_PX = 10;
const BOUNCE = 0.45;
const ROLL_DECEL = 9;

/** Top speed (m/s), acceleration (m/s^2) and mass per lineup slot: Anchor, Bruiser, Pivot, Winger, Sweeper. */
const VMAX = [17, 18, 19, 23, 20];
const ACCEL = [26, 28, 34, 44, 38];
const MASS = [1.25, 1.2, 0.95, 0.85, 1.0];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const surname = (n: string) => n.split(" ").slice(1).join(" ") || n;

/** Deterministic 0..1 from a string and number so reaction delays are stable. */
function hash01(s: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

interface Agent {
  x: number;
  y: number; // metres across
  vx: number;
  vy: number;
  hx: number; // heading
  hy: number;
  /** Milliseconds left lying on the ground after a tackle or dive. */
  down: number;
  trail: { x: number; y: number }[];
}

interface Ring {
  x: number;
  y: number;
  age: number;
  color: string;
  max: number;
}
interface Floater {
  x: number;
  y: number;
  text: string;
  age: number;
}

interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** True while the ball is bouncing and rolling under its own physics. */
  free: boolean;
}

interface Sim {
  agents: Record<string, Agent>;
  ball: BallState;
  holder: string | null;
  t: number;
  beat: number;
  beatStart: number;
  ballFrom: { x: number; y: number };
  /** Per-player reaction delay for the current beat (ms). */
  delay: Record<string, number>;
  trailClock: number;
  shake: number;
  rings: Ring[];
  floaters: Floater[];
  hitsDone: Set<string>;
  /** How long the ball takes to travel into a holder's hands at the start of a "held" beat. */
  glideMs: number;
}

export class ArenaView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private scene: Scene | null = null;
  private total = 0;
  private sim: Sim | null = null;
  private acc = 0;
  private cam = 50;
  private resolve: (() => void) | null = null;
  private rate: () => number = () => 1;

  constructor(private homeShort: string, private awayShort: string, private homeCol = "#8fe3a6", private awayCol = "#f0b35a") {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "arena";
    this.ctx = this.canvas.getContext("2d")!;
    const loop = (now: number) => {
      const dt = this.last ? Math.min(100, now - this.last) : 16;
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cancel();
  }

  /** Stop the current scene (e.g. on skip). The promise from play() resolves. */
  cancel() {
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  /** Draws a scene at a given time without playing it (used for previews and checks). */
  seek(scene: Scene, t: number) {
    this.cancel();
    this.load(scene);
    const target = Math.min(t, this.total);
    while (this.sim!.t < target) this.step(Math.min(STEP_MS, target - this.sim!.t));
    this.cam = this.abs(this.sim!.ball.x);
    if (this.fit()) this.draw(1000);
  }

  /** Remove the last frame so the next scene starts clean. */
  clear() {
    this.cancel();
    this.scene = null;
    this.sim = null;
  }

  /** Plays a scene. `rate()` returns the playback speed, 0 while paused. Resolves when the scene ends. */
  play(scene: Scene, rate: () => number): Promise<void> {
    this.cancel();
    this.load(scene);
    this.rate = rate;
    this.cam = this.abs(this.sim!.ball.x);
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  // ---------------------------------------------------------------- simulation

  private abs(u: number): number {
    return this.scene && this.scene.att === 0 ? u : 100 - u;
  }

  private load(scene: Scene) {
    this.scene = scene;
    this.total = sceneMs(scene);
    this.acc = 0;
    const agents: Record<string, Agent> = {};
    for (const [id, p] of Object.entries(scene.init)) {
      const dir = id[0] === "a" ? 1 : -1;
      agents[id] = { x: p.x, y: p.y * WIDTH_M, vx: 0, vy: 0, hx: dir, hy: 0, down: 0, trail: [] };
    }
    const b = scene.initBall;
    const start =
      b.k === "held" ? agents[b.by] : b.k === "at" ? { x: b.p.x, y: b.p.y * WIDTH_M } : typeof b.from === "string" ? agents[b.from] : { x: b.from.x, y: b.from.y * WIDTH_M };
    this.sim = {
      agents,
      ball: { x: start.x, y: start.y, z: 0, vx: 0, vy: 0, vz: 0, free: false },
      holder: b.k === "held" ? b.by : null,
      t: 0,
      beat: -1,
      beatStart: 0,
      ballFrom: { x: start.x, y: start.y },
      delay: {},
      trailClock: 0,
      shake: 0,
      rings: [],
      floaters: [],
      hitsDone: new Set(),
      glideMs: 140,
    };
    this.enterBeat(0);
  }

  private enterBeat(i: number) {
    const s = this.scene!;
    const sim = this.sim!;
    if (i >= s.beats.length) return;
    const prev = i > 0 ? s.beats[i - 1] : null;
    const beat = s.beats[i];
    // A flight that ends with the ball loose keeps going: it bounces and rolls on landing.
    if (prev && (prev.ball.k === "fly" || prev.ball.k === "pass") && beat.ball.k === "at") {
      const T = Math.max(0.2, prev.ms / 1000);
      const apex = (prev.ball.arc ?? 8) / LIFT_PX;
      const to = prev.ball.k === "fly" ? { x: prev.ball.to.x, y: prev.ball.to.y * WIDTH_M } : { x: sim.ball.x, y: sim.ball.y };
      sim.ball.vx = (to.x - sim.ballFrom.x) / T;
      sim.ball.vy = (to.y - sim.ballFrom.y) / T;
      sim.ball.vz = -(4 * apex) / T; // downwards at the moment of landing
      sim.ball.z = 0.01;
      sim.ball.free = true;
    } else if (beat.ball.k !== "at") {
      sim.ball.free = false;
    }
    sim.beat = i;
    sim.beatStart = s.beats.slice(0, i).reduce((a, b) => a + b.ms, 0);
    sim.ballFrom = { x: sim.ball.x, y: sim.ball.y };
    if (beat.ball.k === "held") {
      const a = sim.agents[beat.ball.by];
      sim.glideMs = clamp(Math.hypot(sim.ballFrom.x - a.x, sim.ballFrom.y - a.y) * 35, 140, 800);
    }
    for (const id of Object.keys(sim.agents)) {
      // Attackers react quickly, defenders a beat later; everyone differs a little.
      const base = id[0] === "a" ? 30 : 170;
      sim.delay[id] = base + hash01(id, i) * (id[0] === "a" ? 140 : 190);
    }
    const fx = beat.fx;
    if (fx && fx.kind !== "flash") {
      const at = typeof fx.at === "string" ? sim.agents[fx.at] : { x: fx.at.x, y: fx.at.y * WIDTH_M };
      sim.rings.push({ x: at.x, y: at.y, age: 0, color: fx.color ?? "#ffffff", max: fx.kind === "kick" ? 18 : 34 });
    }
  }

  /** Advance the simulation by dt ms (<= one step). */
  private step(dt: number) {
    const s = this.scene!;
    const sim = this.sim!;
    const sec = dt / 1000;
    sim.t += dt;
    // Move to the next beat when the current one has run its course.
    while (sim.beat < s.beats.length - 1 && sim.t >= sim.beatStart + s.beats[sim.beat].ms) this.enterBeat(sim.beat + 1);
    const beat = s.beats[sim.beat];
    const since = sim.t - sim.beatStart;
    const beatEnd = sim.beatStart + beat.ms;
    const holder = beat.ball.k === "held" ? beat.ball.by : null;

    const ids = Object.keys(sim.agents);
    for (const id of ids) {
      const a = sim.agents[id];
      if (a.down > 0) {
        // Lying on the ground after contact: slide to a stop, then get up.
        a.down -= dt;
        const damp = Math.exp(-5 * sec);
        a.vx *= damp;
        a.vy *= damp;
        continue;
      }
      const slot = Number(id[1]);
      const tgt = beat.to[id];
      let dx = tgt.x - a.x;
      let dy = tgt.y * WIDTH_M - a.y;
      const dist = Math.hypot(dx, dy);
      let desiredSpeed = 0;
      if (since >= sim.delay[id] && dist > 0.15) {
        // Aim to arrive as the beat ends; never faster than the player can run, ease off when close.
        const remaining = Math.max(0.2, (beatEnd - sim.t) / 1000);
        const brake = Math.sqrt(2 * ACCEL[slot] * 0.7 * dist);
        desiredSpeed = Math.min(VMAX[slot], dist / remaining, brake);
        if (dist < 0.6) desiredSpeed = Math.min(desiredSpeed, dist * 4);
      }
      const inv = dist > 0.0001 ? 1 / dist : 0;
      dx *= inv;
      dy *= inv;
      // Steer: change velocity towards the desired one, limited by acceleration.
      let ax = dx * desiredSpeed - a.vx;
      let ay = dy * desiredSpeed - a.vy;
      const am = Math.hypot(ax, ay);
      const maxDv = ACCEL[slot] * sec;
      if (am > maxDv) {
        ax = (ax / am) * maxDv;
        ay = (ay / am) * maxDv;
      }
      a.vx += ax;
      a.vy += ay;
    }

    // Scripted collisions fire when the two players actually meet.
    beat.hits?.forEach((hit, i) => {
      const key = `${sim.beat}:${i}`;
      if (sim.hitsDone.has(key) || since < (hit.at ?? 0.4) * beat.ms) return;
      const R = sim.agents[hit.runner];
      const O = sim.agents[hit.other];
      if (Math.hypot(O.x - R.x, O.y - R.y) > 2.1 && since < beat.ms - 40) return;
      sim.hitsDone.add(key);
      this.applyHit(hit, R, O);
    });

    // Personal space: nudge players apart (but let the ball carrier and tacklers collide).
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = sim.agents[ids[i]];
        const B = sim.agents[ids[j]];
        if (A.down > 0 || B.down > 0) continue;
        if (holder && ((ids[i] === holder && ids[j][0] !== holder[0]) || (ids[j] === holder && ids[i][0] !== holder[0]))) continue;
        const ddx = B.x - A.x;
        const ddy = B.y - A.y;
        const d = Math.hypot(ddx, ddy);
        if (d < 1.7 && d > 0.001) {
          const push = (1.7 - d) * 14 * sec;
          A.vx -= (ddx / d) * push;
          A.vy -= (ddy / d) * push;
          B.vx += (ddx / d) * push;
          B.vy += (ddy / d) * push;
        }
      }
    }

    sim.trailClock += dt;
    const sample = sim.trailClock >= 45;
    if (sample) sim.trailClock = 0;
    for (const id of ids) {
      const a = sim.agents[id];
      a.x += a.vx * sec;
      a.y = clamp(a.y + a.vy * sec, 1.5, WIDTH_M - 1.5);
      const sp = Math.hypot(a.vx, a.vy);
      if (sp > 1.5 && a.down <= 0) {
        // Turn gradually towards the direction of travel.
        const k = Math.min(1, sec * 9);
        a.hx = lerp(a.hx, a.vx / sp, k);
        a.hy = lerp(a.hy, a.vy / sp, k);
        const hl = Math.hypot(a.hx, a.hy) || 1;
        a.hx /= hl;
        a.hy /= hl;
      }
      if (sample) {
        a.trail.push({ x: a.x, y: a.y });
        if (a.trail.length > 6) a.trail.shift();
      }
    }

    sim.shake *= Math.exp(-7 * sec);
    for (const r of sim.rings) r.age += dt;
    for (const f of sim.floaters) f.age += dt;
    sim.rings = sim.rings.filter((r) => r.age < 700);
    sim.floaters = sim.floaters.filter((f) => f.age < 900);

    this.stepBall(beat.ball, since, beat.ms, sec);
    sim.holder = beat.ball.k === "held" ? beat.ball.by : beat.ball.k === "pass" && since >= beat.ms ? beat.ball.to : null;
  }

  /** Momentum exchange for a tackle, or a lunge for a missed tackle. */
  private applyHit(hit: Hit, R: Agent, O: Agent) {
    const sim = this.sim!;
    const mr = MASS[Number(hit.runner[1])];
    const mo = MASS[Number(hit.other[1])];
    if (hit.kind === "miss") {
      const tx = R.x - O.x;
      const ty = R.y - O.y;
      const tl = Math.hypot(tx, ty) || 1;
      O.vx = (tx / tl) * 10;
      O.vy = (ty / tl) * 10;
      O.down = 700;
      R.vy += (R.y < WIDTH_M / 2 ? 1 : -1) * 3; // a sidestep as the tackler dives past
      sim.floaters.push({ x: O.x, y: O.y, text: "MISSED!", age: 0 });
      return;
    }
    let dx = R.vx;
    let dy = R.vy;
    const dl = Math.hypot(dx, dy);
    if (dl > 0.5) {
      dx /= dl;
      dy /= dl;
    } else {
      dx = Math.sign(R.x - O.x) || 1;
      dy = 0;
    }
    const closing = Math.max(3, Math.hypot(R.vx - O.vx, R.vy - O.vy));
    sim.shake = Math.min(14, 5 + closing * 0.45);
    sim.rings.push({ x: (R.x + O.x) / 2, y: (R.y + O.y) / 2, age: 0, color: "#ffffff", max: 34 });
    const res = hit.result ?? "down";
    if (res === "through") {
      R.vx *= 0.55;
      R.vy *= 0.55;
      O.down = 900;
      O.vx = dx * 3 * (mr / mo);
      O.vy = dy * 3 * (mr / mo);
      sim.floaters.push({ x: R.x, y: R.y, text: "BROKE THE TACKLE", age: 0 });
    } else if (res === "driven") {
      R.vx = -dx * 5;
      R.vy = -dy * 5;
      R.down = 1000;
      O.down = 500;
      O.vx = dx * 2;
      O.vy = dy * 2;
    } else {
      const vcx = ((mr * R.vx + mo * O.vx) / (mr + mo)) * 0.3;
      const vcy = ((mr * R.vy + mo * O.vy) / (mr + mo)) * 0.3;
      R.vx = O.vx = vcx;
      R.vy = O.vy = vcy;
      R.down = 1150;
      O.down = 750;
    }
  }

  private stepBall(b: Ball, since: number, ms: number, sec: number) {
    const sim = this.sim!;
    const u = clamp(since / Math.max(1, ms), 0, 1);
    const ball = sim.ball;
    const from = sim.ballFrom;
    switch (b.k) {
      case "held": {
        const a = sim.agents[b.by];
        const k = Math.min(1, since / sim.glideMs); // glide into the hands rather than jump
        ball.x = lerp(from.x, a.x + a.hx * 1.1, k);
        ball.y = lerp(from.y, a.y + a.hy * 1.1, k);
        ball.z = lerp(ball.z, 0.6, k) * (a.down > 0 ? 0.3 : 1);
        break;
      }
      case "at": {
        if (ball.free) {
          this.physics(sec);
        } else {
          const k = Math.min(1, since / 120);
          ball.x = lerp(from.x, b.p.x, k);
          ball.y = lerp(from.y, b.p.y * WIDTH_M, k);
          ball.z = 0;
        }
        break;
      }
      case "pass": {
        const r = sim.agents[b.to];
        // Lead the receiver slightly so the ball arrives in front of him.
        ball.x = lerp(from.x, r.x + r.vx * 0.12, u);
        ball.y = lerp(from.y, r.y + r.vy * 0.12, u);
        ball.z = (4 * (b.arc ?? 8) * u * (1 - u)) / LIFT_PX; // parabola: apex height in metres
        break;
      }
      case "fly": {
        ball.x = lerp(from.x, b.to.x, u);
        ball.y = lerp(from.y, b.to.y * WIDTH_M, u);
        ball.z = (4 * b.arc * u * (1 - u)) / LIFT_PX;
        break;
      }
    }
  }

  /** Free ball: gravity, bounce with energy loss, then rolling friction until it stops. */
  private physics(sec: number) {
    const ball = this.sim!.ball;
    ball.vz -= 9.81 * 2.4 * sec; // a stylised, slightly heavy gravity so bounces read at this scale
    ball.z += ball.vz * sec;
    if (ball.z <= 0) {
      ball.z = 0;
      if (ball.vz < -1.2) {
        ball.vz = -ball.vz * BOUNCE;
        ball.vx *= 0.6;
        ball.vy *= 0.6;
      } else {
        ball.vz = 0;
      }
    }
    if (ball.z === 0) {
      const sp = Math.hypot(ball.vx, ball.vy);
      const k = sp > 0.01 ? Math.max(0, sp - ROLL_DECEL * sec) / sp : 0;
      ball.vx *= k;
      ball.vy *= k;
    }
    ball.x += ball.vx * sec;
    ball.y = clamp(ball.y + ball.vy * sec, -3, WIDTH_M + 3);
  }

  // ---------------------------------------------------------------- drawing

  private fit(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (cw < 10 || ch < 10) return false;
    if (cw !== this.w || ch !== this.h) {
      this.w = cw;
      this.h = ch;
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  private frame(dt: number) {
    if (!this.scene || !this.sim) return;
    const speed = this.rate();
    if (speed > 0 && this.sim.t < this.total) {
      this.acc += dt * speed;
      let guard = 0;
      while (this.acc >= STEP_MS && this.sim.t < this.total && guard++ < 40) {
        this.step(STEP_MS);
        this.acc -= STEP_MS;
      }
      if (this.sim.t >= this.total && this.resolve) {
        const r = this.resolve;
        this.resolve = null;
        r();
      }
    }
    if (!this.fit()) return;
    this.draw(dt);
  }

  private draw(dt: number) {
    const s = this.scene!;
    const sim = this.sim!;
    const { ctx, w, h } = this;
    const STRIP = 74; // header strip for banner + caption keeps the pitch clear
    ctx.fillStyle = "#0b100e";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#0a0f0d";
    ctx.fillRect(0, 0, w, STRIP);

    // Goal kicks cut to the view from behind the kicker.
    if (s.kick && sim.t >= s.kick.start) {
      this.drawKickCam(s.kick, STRIP, w, h, sim.t - s.kick.start);
      this.drawOverlay(STRIP);
      return;
    }

    const beat = s.beats[Math.max(0, sim.beat)];
    // Camera follows the ball with smoothing.
    const target = clamp(this.abs(sim.ball.x), VIEW_M / 2 - 6, 100 + 6 - VIEW_M / 2);
    this.cam += (target - this.cam) * Math.min(1, dt / 260);
    const left = this.cam - VIEW_M / 2;
    const px = w / VIEW_M;
    const fx = (m: number) => (m - left) * px;
    const top = STRIP;
    const bottom = h - 14;
    const fy = (metres: number) => lerp(top + 18, bottom - 14, metres / WIDTH_M);
    const att = s.att;
    const aCol = att === 0 ? this.homeCol : this.awayCol;
    const dCol = att === 0 ? this.awayCol : this.homeCol;
    const R = Math.max(7, Math.min(13, px * 0.6));

    // Camera shake from big tackles.
    ctx.save();
    if (sim.shake > 0.3) ctx.translate(Math.sin(sim.t * 0.13) * sim.shake, Math.cos(sim.t * 0.17) * sim.shake * 0.6);

    // Pitch.
    for (let m = Math.floor(left / 5) * 5; m < left + VIEW_M + 5; m += 5) {
      const inGoal = m < 0 || m >= 100;
      ctx.fillStyle = inGoal ? "#0e1a14" : Math.floor(m / 5) % 2 ? "#13211a" : "#112019";
      ctx.fillRect(fx(m), top, 5 * px + 1, bottom - top);
    }
    ctx.lineWidth = 1;
    for (const m of [0, 22, 50, 78, 100]) {
      ctx.strokeStyle = m === 0 || m === 100 ? "#6aa380" : "#2f4a3a";
      ctx.beginPath();
      ctx.moveTo(fx(m), top);
      ctx.lineTo(fx(m), bottom);
      ctx.stroke();
    }
    // Touchlines: if the ball or a player crosses these, play is out.
    ctx.strokeStyle = "#8fb59f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, top + 1);
    ctx.lineTo(w, top + 1);
    ctx.moveTo(0, bottom - 1);
    ctx.lineTo(w, bottom - 1);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.font = "bold 14px ui-monospace, Menlo, Consolas, monospace";
    for (const [m, txt, col] of [[-4, this.homeShort, this.homeCol], [104, this.awayShort, this.awayCol]] as const) {
      ctx.save();
      ctx.translate(fx(m), (top + bottom) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = col + "55";
      ctx.fillText(txt, 0, 5);
      ctx.restore();
    }
    ctx.fillStyle = "#4d6b5a";
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    for (const [m, txt] of [[22, "22"], [50, "HALF"], [78, "22"]] as const) ctx.fillText(txt, fx(m), bottom + 11);
    // Goal posts: two uprights with the goal mouth between them.
    for (const m of [0, 100]) {
      const x = fx(m);
      const dirX = m === 0 ? -1 : 1;
      ctx.strokeStyle = "#2f5b43";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, fy(WIDTH_M * 0.42));
      ctx.lineTo(x, fy(WIDTH_M * 0.58));
      ctx.stroke();
      ctx.fillStyle = "#e8f1ec";
      for (const l of [0.42, 0.58]) {
        ctx.beginPath();
        ctx.arc(x, fy(WIDTH_M * l), 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      void dirX;
    }

    // Players: faint motion trails, body (flattened when on the ground), heading nose, role letter.
    const mapX = (u: number) => fx(this.abs(u));
    const dirSign = att === 0 ? 1 : -1;
    const drawAgent = (id: string, col: string) => {
      const a = sim.agents[id];
      if (!a) return; // in the sin bin or sent off: not on the pitch
      const speed = Math.hypot(a.vx, a.vy);
      if (speed > 5 && a.down <= 0) {
        a.trail.forEach((p, i) => {
          ctx.globalAlpha = (i / a.trail.length) * 0.22;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(mapX(p.x), fy(p.y), R * (0.55 + 0.4 * (i / a.trail.length)), 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
      const x = mapX(a.x);
      const y = fy(a.y);
      const hx = a.hx * dirSign;
      if (a.down > 0) {
        // Down after contact: the same round body, dimmed with a dashed outline and dizzy dots,
        // so players never change shape.
        ctx.fillStyle = "#00000044";
        ctx.beginPath();
        ctx.ellipse(x + 1.5, y + R * 0.55, R, R * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#0b100e";
        ctx.font = `bold ${Math.round(R)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.fillText(ROLE_LETTER[Number(id[1])], x, y + R * 0.35);
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < 3; i++) {
          const ang = sim.t / 140 + i * 2.1;
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * R * 0.9, y - R * 1.25 + Math.sin(ang) * R * 0.28, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      const lean = Math.min(1, speed / 20);
      ctx.fillStyle = "#00000066";
      ctx.beginPath();
      ctx.ellipse(x + 1.5, y + R * 0.55, R * (1 + lean * 0.25), R * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = id === sim.holder ? 3 : 1.5;
      ctx.strokeStyle = id === sim.holder ? "#ffffff" : "#0b100e";
      ctx.stroke();
      ctx.fillStyle = "#0b100e";
      ctx.beginPath();
      ctx.arc(x + hx * R * 1.05, y + a.hy * R * 1.05, R * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${Math.round(R)}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText(ROLE_LETTER[Number(id[1])], x - hx * R * 0.12, y - a.hy * R * 0.12 + R * 0.35);
    };
    for (let i = 0; i < 5; i++) drawAgent(`d${i}`, dCol);
    for (let i = 0; i < 5; i++) drawAgent(`a${i}`, aCol);

    // Name tag on whoever has the ball.
    const holder = sim.holder ?? this.nearestHolder();
    if (holder) {
      const names = holder[0] === "a" ? s.names.a : s.names.d;
      const name = names[Number(holder[1])];
      const a = sim.agents[holder];
      if (name && a) {
        const x = mapX(a.x);
        const y = fy(a.y);
        ctx.font = "bold 12px ui-monospace, Menlo, Consolas, monospace";
        const tw = ctx.measureText(surname(name)).width + 10;
        ctx.fillStyle = "#0e1412dd";
        ctx.fillRect(x - tw / 2, y - R - 24, tw, 17);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(surname(name), x, y - R - 11);
      }
    }

    // Ball: shadow stays on the ground, the ball is lifted by its height.
    const bxp = mapX(sim.ball.x);
    const byp = fy(sim.ball.y);
    const lift = sim.ball.z * LIFT_PX;
    ctx.fillStyle = `rgba(0,0,0,${0.35 - Math.min(0.2, lift / 120)})`;
    ctx.beginPath();
    ctx.ellipse(bxp, byp + 3, 6 + lift * 0.05, 2.5 + lift * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(bxp, byp - 7 - lift);
    ctx.rotate(lift > 1 ? sim.t / 110 : 0);
    const bs = 1 + Math.min(0.5, lift / 90);
    ctx.scale(bs, bs);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#7a5b3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(3, 0);
    ctx.stroke();
    ctx.restore();

    // Impact rings and floating labels.
    for (const r of sim.rings) {
      const k = r.age / 700;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mapX(r.x), fy(r.y), R + k * r.max, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = "bold 12px ui-monospace, Menlo, Consolas, monospace";
    for (const f of sim.floaters) {
      const k = f.age / 900;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = "#ffd98a";
      ctx.fillText(f.text, mapX(f.x), fy(f.y) - R - 8 - k * 18);
      ctx.globalAlpha = 1;
    }
    const since = sim.t - sim.beatStart;
    if (beat.fx?.kind === "flash" && since < 500) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - since / 500)})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    this.drawOverlay(STRIP);
  }

  /** Banner and caption in the header strip: the most recent beat that set one stays up. */
  private drawOverlay(STRIP: number) {
    const s = this.scene!;
    const sim = this.sim!;
    const { ctx, w } = this;
    let banner = null as Scene["beats"][number]["banner"] | null;
    let cap: string | undefined;
    let bannerAt = 0;
    let acc = 0;
    for (let i = 0; i <= sim.beat; i++) {
      if (s.beats[i].banner) {
        banner = s.beats[i].banner;
        bannerAt = acc;
      }
      if (s.beats[i].cap) cap = s.beats[i].cap;
      acc += s.beats[i].ms;
    }
    ctx.textAlign = "center";
    if (cap) {
      ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#9db8a5";
      ctx.fillText(cap, w / 2, STRIP - 8);
    }
    if (banner) {
      const pop = Math.min(1, (sim.t - bannerAt) / 180);
      ctx.globalAlpha = pop;
      ctx.fillStyle = banner.color;
      ctx.font = "bold 22px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText(banner.text, w / 2, 24 + (1 - pop) * -8);
      if (banner.sub) {
        ctx.fillStyle = "#cfe8d5";
        ctx.font = "13px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(banner.sub, w / 2, 42 + (1 - pop) * -8);
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Behind-the-kicker view of a kick at goal. The posts are drawn large, the ball flies on a
   * parabola from the kicker to the posts and the aftermath is shown: flags for a score, a
   * red cross and the ball passing outside the upright for a wide kick, a flash and rebound for
   * the post, or a short drop with bounces.
   */
  private drawKickCam(k: KickView, top: number, w: number, h: number, tt: number) {
    const ctx = this.ctx;
    const H = h - top;
    const cx = w / 2;
    const ground = top + H * 0.72;
    const gap = Math.min(76, w * 0.085);
    const barY = top + H * 0.46;
    const topY = top + H * 0.08;
    const sx = k.side;

    const sky = ctx.createLinearGradient(0, top, 0, h);
    sky.addColorStop(0, "#0a0f0d");
    sky.addColorStop(0.7, "#112019");
    sky.addColorStop(1, "#0d1813");
    ctx.fillStyle = sky;
    ctx.fillRect(0, top, w, H);
    ctx.fillStyle = "#13241b";
    ctx.fillRect(0, ground, w, h - ground);
    ctx.strokeStyle = "#244034";
    ctx.lineWidth = 1.5;
    for (const f of [-1.8, -0.9, 0, 0.9, 1.8]) {
      ctx.beginPath();
      ctx.moveTo(cx + f * w * 0.45, h);
      ctx.lineTo(cx + f * 70, ground);
      ctx.stroke();
    }
    ctx.strokeStyle = "#6aa380";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ground);
    ctx.lineTo(w, ground);
    ctx.stroke();
    ctx.fillStyle = "#4d6b5a";
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText("KICKER'S VIEW", 10, top + 14);
    ctx.textAlign = "center";

    // Ball path. Heights are screen y: smaller y means higher. The plane of the posts is at u = 1.
    const plane = {
      good: { x: cx + sx * 10, y: top + H * 0.24 },
      "post-in": { x: cx + sx * (gap - 3), y: top + H * 0.28 },
      post: { x: cx + sx * gap, y: top + H * 0.3 },
      wide: { x: cx + sx * (gap + 95), y: top + H * 0.27 },
      short: { x: cx - sx * 14, y: ground + H * 0.1 },
    }[k.outcome];
    const start = { x: cx, y: h - 30 };
    const easeU = (u: number) => u * u * (3 - 2 * u);
    const flightU = clamp(tt / k.flight, 0, 1);
    const ta = Math.max(0, tt - k.flight);
    const groundAt = (u: number) => lerp(h - 14, ground + 6, u);

    const pathAt = (uu: number) => {
      if (k.outcome === "short") {
        const u2 = Math.min(uu / 0.8, 1);
        return { x: lerp(start.x, plane.x, easeU(u2)), y: lerp(start.y, plane.y, u2) - Math.sin(Math.PI * u2) * H * 0.2, r: lerp(18, 9, u2), depth: u2 };
      }
      return { x: lerp(start.x, plane.x, easeU(uu)), y: lerp(start.y, plane.y, uu) - Math.sin(Math.PI * uu) * H * 0.36, r: lerp(18, 7, uu), depth: uu };
    };

    let bx: number;
    let by: number;
    let br: number;
    let shadowY = groundAt(flightU);
    let alpha = 1;
    if (ta <= 0) {
      const p = pathAt(flightU);
      bx = p.x;
      by = p.y;
      br = p.r;
      if (k.outcome === "short" && flightU > 0.8) {
        // Landing short: bounces and rolls on.
        const tb = tt - k.flight * 0.8;
        const hop = Math.abs(Math.sin((tb / 420) * Math.PI)) * 22 * Math.exp(-tb / 600);
        by = plane.y - hop;
        shadowY = plane.y + 4;
      }
    } else {
      const u2 = Math.min(1, ta / 800);
      br = 7;
      bx = plane.x;
      by = plane.y;
      shadowY = ground + 6;
      if (k.outcome === "good") {
        bx += sx * 8 * u2;
        by -= 26 * u2;
        br = 7 - 3 * u2;
        alpha = 1 - 0.5 * u2;
      } else if (k.outcome === "post-in") {
        const d = Math.min(1, ta / 600);
        bx = lerp(plane.x, cx + sx * (gap - 44), d);
        by = plane.y - 24 * d;
        br = 7 - 3 * d;
        alpha = 1 - 0.4 * d;
      } else if (k.outcome === "post") {
        bx = plane.x + sx * 55 * u2;
        by = lerp(plane.y, ground + H * 0.12, u2 * u2);
        br = 7 + 4 * u2;
        shadowY = ground + H * 0.12 + 4;
      } else if (k.outcome === "wide") {
        bx += sx * 34 * u2;
        by -= 12 * u2;
        br = 7 - 3 * u2;
        alpha = 1 - 0.5 * u2;
      } else {
        const tb = tt - k.flight * 0.8;
        const hop = Math.abs(Math.sin((tb / 420) * Math.PI)) * 22 * Math.exp(-tb / 600);
        by = plane.y - hop;
        bx = plane.x + sx * -10 * Math.min(1, tb / 900);
        br = 9;
        shadowY = plane.y + 4;
      }
    }

    // Posts (drawn after the ball for the far side when it passes behind them).
    const drawPosts = () => {
      ctx.fillStyle = "#e8f1ec";
      ctx.fillRect(cx - gap - 3, topY, 6, ground - topY);
      ctx.fillRect(cx + gap - 3, topY, 6, ground - topY);
      ctx.fillRect(cx - gap, barY - 3, gap * 2, 6);
    };
    drawPosts();
    // Faint goal mouth so "between the posts and over the bar" is easy to see.
    ctx.fillStyle = "rgba(143,227,166,0.06)";
    ctx.fillRect(cx - gap + 3, topY, gap * 2 - 6, barY - topY - 3);

    // Trail, shadow and ball.
    for (let i = 8; i >= 1; i--) {
      const uu = Math.max(0, flightU - i * 0.035);
      if (ta > 0 || uu <= 0) continue;
      const p = pathAt(uu);
      ctx.globalAlpha = 0.07 * (9 - i);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(bx, shadowY, br * 1.1, br * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(bx, by, br, br * 0.68, tt / 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Hitting the upright: a starburst at the contact point.
    if ((k.outcome === "post" || k.outcome === "post-in") && ta > 0 && ta < 420) {
      const f = ta / 420;
      ctx.strokeStyle = `rgba(255,236,170,${1 - f})`;
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(plane.x + Math.cos(a) * 8, plane.y + Math.sin(a) * 8);
        ctx.lineTo(plane.x + Math.cos(a) * (14 + f * 22), plane.y + Math.sin(a) * (14 + f * 22));
        ctx.stroke();
      }
    }
    // Scored: officials raise flags. Missed: a red cross over the goal mouth.
    const scored = k.outcome === "good" || k.outcome === "post-in";
    if (scored && ta > (k.outcome === "post-in" ? 500 : 250)) {
      for (const side of [-1, 1]) {
        const fxp = cx + side * gap;
        const wave = Math.sin(tt / 110 + side) * 4;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(fxp, topY - 2);
        ctx.lineTo(fxp + side * (26 + wave), topY + 6);
        ctx.lineTo(fxp, topY + 14);
        ctx.fill();
      }
    }
    if (!scored && ta > 350) {
      const f = Math.min(1, (ta - 350) / 300);
      ctx.globalAlpha = f;
      ctx.strokeStyle = "#ff9a8a";
      ctx.lineWidth = 6;
      const mx = cx;
      const my = (topY + barY) / 2;
      ctx.beginPath();
      ctx.moveTo(mx - 22, my - 22);
      ctx.lineTo(mx + 22, my + 22);
      ctx.moveTo(mx + 22, my - 22);
      ctx.lineTo(mx - 22, my + 22);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // A short white flash on the cut to this camera.
    if (tt < 160) {
      ctx.fillStyle = `rgba(255,255,255,${0.4 * (1 - tt / 160)})`;
      ctx.fillRect(0, top, w, H);
    }
  }

  /** When the ball is loose, tag the nearest player so you can see who is going for it. */
  private nearestHolder(): string | null {
    const sim = this.sim!;
    if (sim.ball.z > 0.3) return null;
    let best: string | null = null;
    let bd = 2.4;
    for (const [id, p] of Object.entries(sim.agents)) {
      const d = Math.hypot(p.x - sim.ball.x, p.y - sim.ball.y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }
}
