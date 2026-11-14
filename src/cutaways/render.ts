import { BRAID_LINES, HAIR_PARTS, HEAD_CLEAR, SCALP, STORY, TIMING, type Kind, type StoryKind, type Transition } from "./data";

/** Artwork files (URLs only: an image is not fetched until a cutaway needs it). */
const URLS = import.meta.glob("./art/*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const urlOf = (name: string) => URLS[`./art/${name}.webp`];

/** One athlete: lab hairstyle 0-4 and the width scale for her build. */
export interface Athlete {
  hair: number;
  build: number;
}
export interface CutawayRequest {
  kind: Kind;
  /** The main player: carrier, scorer, carded player. */
  a: Athlete;
  /** The second player, if the pose has one. */
  b?: Athlete;
  /** Grounding pose, 0-2. */
  pose?: number;
  mode: Transition;
  shake: boolean;
}

// The cutaway is drawn in the lab's 960 x 430 space, below a 45px header strip we do not use.
const W = 960;
const H = 385;
const TOP = 45;
const INK = "#f2f6ee";

const clamp = (t: number) => Math.max(0, Math.min(1, t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - (1 - t) ** 3;
const smooth = (u: number) => u * u * (3 - 2 * u);

const images = new Map<string, Promise<HTMLImageElement>>();
function load(name: string): Promise<HTMLImageElement> {
  const url = urlOf(name);
  if (!url) return Promise.reject(new Error(`No cutaway art called ${name}`));
  if (!images.has(name)) {
    const img = new Image();
    img.src = url;
    images.set(name, img.decode().then(() => img));
  }
  return images.get(name)!;
}

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d", { willReadFrequently: true })!];
}

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
function opaqueBounds(g: CanvasRenderingContext2D, width: number, height: number): Bounds | null {
  const pixels = g.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 18) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left ? { left, top, width: right - left, height: bottom - top } : null;
}

// ---------------------------------------------------------------- the illustration

type Painter = (ctx: CanvasRenderingContext2D, t: number) => void;

function line(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, b: number, color: string, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(a, b);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** A pose with the second player's head and shoulders swapped in when her hairstyle differs. */
async function composite(spec: (typeof STORY)[StoryKind], pose: number, a: Athlete, b?: Athlete): Promise<{ canvas: HTMLCanvasElement; bounds: Bounds } | null> {
  const name = spec.art(pose);
  const base = await load(`${name}-${a.hair}`);
  const regions = b && b.hair !== a.hair ? spec.regions(pose) : [];
  const other = regions.length ? await load(`${name}-${b!.hair}`) : null;
  const [canvas, g] = newCanvas(base.naturalWidth, base.naturalHeight);
  g.drawImage(base, 0, 0);
  if (other) {
    for (const [x, y, w, h] of regions) {
      const left = Math.round(x * canvas.width), top = Math.round(y * canvas.height);
      const width = Math.round(w * canvas.width), height = Math.round(h * canvas.height);
      g.clearRect(left, top, width, height);
      g.drawImage(other, x * other.naturalWidth, y * other.naturalHeight, w * other.naturalWidth, h * other.naturalHeight, left, top, width, height);
    }
  }
  const bounds = opaqueBounds(g, canvas.width, canvas.height);
  return bounds ? { canvas, bounds } : null;
}

async function storyPainter(kind: StoryKind, req: CutawayRequest): Promise<Painter> {
  const spec = STORY[kind];
  const pose = req.pose ?? 0;
  const art = await composite(spec, pose, req.a, req.b);
  const { contact, end } = TIMING;
  return (ctx, time) => {
    const u = ease(clamp((time - contact) / (end - contact)));
    const tilt = spec.tilt * (1 - u);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOP, W, H);
    ctx.clip();
    ctx.fillStyle = "#101915";
    ctx.fillRect(0, TOP, W, H);
    const offset = 18 * u;
    for (let y = 132; y < 230; y += 18) line(ctx, -offset, y, W, y, "#23382c");
    line(ctx, 0, 248, W, 248, "#526c59", 2);
    if (kind === "grounding") line(ctx, 642, 258, 732, 430, "#819d87", 3);
    if (spec.posts) {
      line(ctx, 700, 125, 700, 365, "#819d87", 3);
      line(ctx, 785, 125, 785, 365, "#819d87", 3);
      line(ctx, 700, 220, 785, 220, "#819d87", 3);
    }
    for (let i = 0; i < 30; i++) {
      const x = (i * 173) % 960, y = 270 + ((i * 37) % 144);
      line(ctx, x - offset, y, x + 18 - offset, y, "#253a2e");
    }
    if (art) {
      const { left, top, width, height } = art.bounds;
      const frame = spec.frame;
      // Reserve space for the complete slide, lift and rotated corners before drawing.
      const rotatedWidth = width + height * Math.sin(spec.tilt);
      const rotatedHeight = height + width * 0.5 * Math.sin(spec.tilt);
      const margin = 16;
      const fitWidth = 2 * Math.min(480 - margin, 960 - 480 - frame.slide - margin);
      const fitHeight = spec.ground - frame.rise - TOP - margin;
      const target = kind === "grounding" && pose ? 550 : frame.width;
      const scale = Math.min(target / width, frame.height / height, fitWidth / rotatedWidth, fitHeight / rotatedHeight);
      const w = width * scale, h = height * scale;
      ctx.translate(480 + frame.slide * u, spec.ground - frame.rise * (1 - u));
      ctx.rotate(tilt);
      ctx.drawImage(art.canvas, left, top, width, height, -w / 2, -h, w, h);
    }
    ctx.restore();
  };
}

/** The original big hit: one running sprite, mirrored for the tackler, with the hairstyle drawn on top. */
async function bigHitPainter(req: CutawayRequest): Promise<Painter> {
  const sprite = await load("sprite");
  const variant = (hair: number) => {
    const part = HAIR_PARTS[hair];
    const [canvas, g] = newCanvas(sprite.width, sprite.height);
    g.drawImage(sprite, 0, 0);
    if (part) {
      g.scale(canvas.width / 152, canvas.height / 260);
      g.globalCompositeOperation = "destination-out";
      g.fill(new Path2D(HEAD_CLEAR));
      g.globalCompositeOperation = "source-over";
      g.lineJoin = "round";
      g.lineCap = "round";
      g.fillStyle = "#1b201e";
      g.strokeStyle = INK;
      g.lineWidth = 1;
      for (const path of part.hijab ? [part.outer] : [part.outer, SCALP]) {
        const shape = new Path2D(path);
        g.fill(shape);
        g.stroke(shape);
      }
      g.strokeStyle = "#c7ccc6";
      g.lineWidth = 0.8;
      g.stroke(new Path2D(part.detail));
      if (!part.hijab) g.stroke(new Path2D(BRAID_LINES));
    }
    return canvas;
  };
  const runner = variant(req.a.hair);
  const defender = req.b && req.b.hair !== req.a.hair ? variant(req.b.hair) : runner;
  const { start, contact, end } = TIMING;

  const player = (ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, build: number, x: number, y: number, side: number, lean: number, isDefender: boolean) => {
    const height = isDefender ? 207 : 218;
    const width = ((height * sprite.width) / sprite.height) * build;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(side, 1);
    ctx.rotate(lean);
    ctx.drawImage(image, -width * 0.5, -height * 0.69, width, height);
    if (!isDefender) {
      ctx.save();
      ctx.translate(width * 0.22, -height * 0.29);
      ctx.rotate(-0.48);
      oval(ctx, 0, 0, 17, 9, "#101915");
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 9, 0, 0, Math.PI * 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      line(ctx, -6, 0, 6, 0, INK, 1.3);
      ctx.restore();
    }
    ctx.restore();
  };

  return (ctx, t) => {
    const approach = clamp((t - start) / (contact - start));
    const after = clamp((t - contact) / (end - contact));
    const recoil = ease(clamp((after - 0.12) / 0.88));
    const contactMotion = approach ** 1.35;
    const impact = t >= contact;
    const wave = impact ? Math.sin(after * 29) * Math.exp(-after * 9) : 0;
    ctx.fillStyle = "#101915";
    ctx.fillRect(0, TOP, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOP, W, H);
    ctx.clip();
    ctx.translate(-18 * approach + 14 * recoil, 0);
    for (let i = 0; i < 5; i++) {
      const y = 171 + i * 13;
      line(ctx, -25, y, 1000, y, "#23382c");
      for (let j = 0; j < 54; j++) {
        const x = 12 + j * 19 + Math.sin(j * 59 + i * 9) * 6;
        line(ctx, x, y - 3, x + 2, y - 3, "#3a5142");
      }
    }
    line(ctx, -25, 251, 1000, 251, "#526c59", 2);
    line(ctx, 790, 252, 896, 425, "#6b8875", 5);
    line(ctx, 783, 147, 783, 244, "#6b8875", 3);
    line(ctx, 815, 147, 815, 244, "#6b8875", 3);
    line(ctx, 783, 194, 815, 194, "#6b8875", 3);
    for (let i = 0; i < 32; i++) {
      const x = (i * 139) % 960, y = 274 + ((i * 43) % 132);
      line(ctx, x, y, x + 8 + (i % 6) * 4, y, "#203329");
    }
    ctx.restore();
    const rx = 380 + 63 * approach - 53 * recoil, dx = 710 - 171 * contactMotion - 60 * recoil;
    const ry = 295 + 27 * recoil, dy = 291 + 15 * approach + 22 * recoil;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOP, W, H);
    ctx.clip();
    const zoom = 0.86;
    ctx.translate(472 + (req.shake ? wave * 6 : 0), 260 + (req.shake ? wave * 3 : 0));
    ctx.scale(zoom, zoom);
    ctx.translate(-472, -260);
    oval(ctx, rx, 381 + recoil * 12, 75, 8, "#0b110e");
    oval(ctx, dx, 381 + recoil * 12, 79, 8, "#0b110e");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    player(ctx, runner, req.a.build, rx, ry, 1, 0.1 - 0.3 * recoil, false);
    player(ctx, defender, req.b?.build ?? 1, dx, dy, -1, 0.23 + 0.65 * contactMotion - 0.18 * recoil, true);
    if (impact && after < 0.28) {
      ctx.globalAlpha = 1 - after / 0.28;
      for (const [a, l] of [[-2.7, 34], [-1.95, 51], [-1.4, 24], [-0.72, 36], [0.58, 27], [1.23, 32], [2.28, 22]]) {
        const rad = 15 + 72 * after;
        line(ctx, 463 + Math.cos(a) * rad, 254 + Math.sin(a) * rad, 463 + Math.cos(a) * (rad + l), 254 + Math.sin(a) * (rad + l), INK, 2.6);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };
}

// ---------------------------------------------------------------- the field behind it

/** A plain pitch, used when there is no arena frame to cut away from (a card has no field scene). */
export function pitchBackdrop(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#112019";
  ctx.fillRect(0, TOP, W, H);
  for (let x = 0; x < W; x += 110) {
    ctx.fillStyle = (x / 110) % 2 ? "#13241b" : "#112019";
    ctx.fillRect(x, TOP, 110, H);
  }
  ctx.fillStyle = "#0e1a14";
  ctx.fillRect(741, TOP, 219, H);
  for (const x of [155, 375, 741]) line(ctx, x, 46, x, 419, x === 741 ? "#82ad90" : "#304a39", x === 741 ? 2 : 1);
  for (const y of [52, 414]) line(ctx, 0, y, W, y, "#759985", 2);
}

// ---------------------------------------------------------------- playback

function polygon(ctx: CanvasRenderingContext2D, points: number[][]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.clip();
}
function splitView(ctx: CanvasRenderingContext2D, progress: number, paint: () => void) {
  const eased = smooth(progress);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, TOP, W, H);
  ctx.clip();
  const halves: [number, number[][]][] = [
    [-1, [[0, 45], [960, 45], [0, 430]]],
    [1, [[960, 45], [960, 430], [0, 430]]],
  ];
  for (const [side, points] of halves) {
    ctx.save();
    ctx.translate(side * 190 * eased, side * 440 * eased);
    polygon(ctx, points);
    paint();
    ctx.restore();
  }
  ctx.restore();
}

/** Real seconds the illustration itself runs: a slow-motion opening, then normal speed. */
const SLOW_REAL = TIMING.slowLength / TIMING.slowRate;
const VISIBLE_SCENE = TIMING.end - (TIMING.contact + TIMING.cutDelay);
const BODY = SLOW_REAL + (VISIBLE_SCENE - TIMING.slowLength);
/** Total real seconds from the cut to the end of the exit. */
export const cutawayLength = (mode: Transition) => BODY + TIMING.hold + (mode === "hard" ? 0 : TIMING.exit);

/** The scene-clock time shown at `p` real seconds after the cut. */
function actionAt(p: number): number {
  const scene = p < SLOW_REAL ? p * TIMING.slowRate : TIMING.slowLength + (p - SLOW_REAL);
  return TIMING.contact + (Math.min(scene, VISIBLE_SCENE) * (TIMING.end - TIMING.contact)) / VISIBLE_SCENE;
}

/** Draws one frame of the cutaway, `p` real seconds after the cut, with its entry and exit transitions. */
export function drawFrame(ctx: CanvasRenderingContext2D, paint: Painter, field: HTMLCanvasElement, mode: Transition, p: number) {
  const drawField = () => ctx.drawImage(field, 0, TOP);
  ctx.save();
  ctx.translate(0, -TOP);
  const bodyEnd = BODY + TIMING.hold;
  if (p < bodyEnd) {
    const reveal = mode === "hard" ? 1 : clamp(p / TIMING.reveal);
    const action = actionAt(p);
    if (mode === "split" && reveal < 1) {
      paint(ctx, action);
      splitView(ctx, reveal, drawField);
    } else if (mode === "diagonal" && reveal < 1) {
      drawField();
      ctx.save();
      const edge = mix(-176, 960, smooth(reveal));
      ctx.beginPath();
      ctx.moveTo(0, 45);
      ctx.lineTo(edge + 176, 45);
      ctx.lineTo(edge, 430);
      ctx.lineTo(0, 430);
      ctx.closePath();
      ctx.clip();
      paint(ctx, action);
      ctx.restore();
    } else {
      paint(ctx, action);
    }
  } else {
    const q = clamp((p - bodyEnd) / TIMING.exit);
    if (mode === "split") {
      paint(ctx, TIMING.end);
      splitView(ctx, 1 - q, drawField);
    } else {
      drawField();
      ctx.save();
      const edge = mix(-176, 960, smooth(q));
      polygon(ctx, [[edge + 176, 45], [960, 45], [960, 430], [edge, 430]]);
      paint(ctx, TIMING.end);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Loads the artwork for a request and returns what is needed to draw it. Rejects if the art is missing. */
export async function prepare(req: CutawayRequest): Promise<Painter> {
  return req.kind === "bighit" ? bigHitPainter(req) : storyPainter(req.kind, req);
}

export const CANVAS_SIZE = { width: W, height: H };

/** Copies the arena (or a plain pitch) into a 960 x 385 snapshot to cut away from. */
export function snapshotField(source: HTMLCanvasElement | null): HTMLCanvasElement {
  const [canvas, g] = newCanvas(W, H);
  if (source && source.width > 0 && source.height > 0) {
    // Fill the frame without stretching: crop whichever side is too long.
    const scale = Math.max(W / source.width, H / source.height);
    const sw = W / scale, sh = H / scale;
    g.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, W, H);
  } else {
    g.translate(0, -TOP);
    pitchBackdrop(g);
  }
  return canvas;
}
