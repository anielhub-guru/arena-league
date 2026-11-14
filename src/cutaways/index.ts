import { h } from "../dom";
import type { Look, MatchEvent, Player, Team } from "../engine/types";
import { BUILDS, lookOf } from "../league/look";
import { rand } from "../viewer/scenes";
import { BEFORE, CHANCE, COOLDOWN_SEC, LAB_HAIR, MAX_PER_MATCH, TRANSITIONS, type Kind, type Transition } from "./data";
import { CANVAS_SIZE, cutawayLength, drawFrame, prepare, snapshotField, type Athlete, type CutawayRequest } from "./render";

/**
 * Illustrated cutaways: now and then, a moment in a match is shown as a detailed drawing instead of
 * only the arena animation. This file decides when, and who is drawn. ./render.ts draws it and
 * ./data.ts holds the tuning. The game never depends on a cutaway: if one does not apply, or its art
 * fails to load, the match carries on exactly as it did before.
 */

interface Settings {
  mode: Transition;
  shake: boolean;
}
const KEY = "dominion:cutaways";

function loadSettings(): Settings {
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fallback: Settings = { mode: reduced ? "dots" : "diagonal", shake: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    if (saved && TRANSITIONS.some(([id]) => id === saved.mode)) return { mode: saved.mode!, shake: !!saved.shake };
  } catch {
    // unreadable setting: use the default
  }
  return fallback;
}

/** Old match logs may lack the second stamp. */
const secOf = (e: MatchEvent) => e.sec ?? Math.max(0, (e.minute - 1) * 60);

const athlete = (look: Look): Athlete => ({ hair: LAB_HAIR[look.portrait] ?? 0, build: BUILDS[look.build][1] });

/** Which cutaways suit an event, in the order they are chosen from. */
export function kindsFor(ev: MatchEvent): Kind[] {
  const v = ev.variant;
  switch (ev.type) {
    case "yellow":
    case "red":
      return ["card"];
    case "try":
      return v === "power" || v === "break" ? ["grounding", "celebration"] : v === "grubber" || v === "chip" ? ["kickchase"] : [];
    case "kick":
      return v?.startsWith("grubber") || v?.startsWith("chip") ? ["kickchase"] : [];
    case "intercept":
      return ["intercept"];
    case "conversion":
    case "penalty-goal":
    case "drop-goal":
      return ["goal"];
    case "conversion-miss":
    case "penalty-miss":
    case "drop-miss":
      return ["goalmiss"];
    case "turnover":
      return v === "sixth" ? ["bighit", "waist", "double"] : ["jackal"];
    case "carry":
      return v === "held" ? ["bighit", "waist", "double"] : [];
    case "break":
      return v === "covered" ? ["lastditch", "ankle"] : v === "caught" ? ["ankle", "lastditch"] : [];
    default:
      return [];
  }
}

export interface CutawayHost {
  home: Team;
  away: Team;
  /** The element the layer sits in, and the canvas to cut away from. */
  stage: HTMLElement;
  arena: HTMLCanvasElement;
  /** Playback speed now, 0 while paused. */
  rate: () => number;
}

export class Cutaways {
  /** Add this inside the stage. It is empty and hidden until a cutaway plays. */
  readonly layer: HTMLElement;
  private canvas: HTMLCanvasElement;
  private settings = loadSettings();
  private lastSec = -Infinity;
  private shown = 0;
  private stop: (() => void) | null = null;

  constructor(private host: CutawayHost) {
    this.canvas = h("canvas", { width: CANVAS_SIZE.width, height: CANVAS_SIZE.height, class: "cutaway-art" });
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Illustrated cutaway of the moment");
    this.layer = h("div", { class: "cutaway" }, this.canvas);
    this.layer.hidden = true;
  }

  /** The player-facing controls: how a cutaway enters, and the optional impact shake. */
  controls(): HTMLElement {
    const select = h("select", { title: "How an illustrated cutaway cuts in. Choose Off to only see the field." });
    for (const [id, label] of TRANSITIONS) select.append(h("option", { value: id, selected: id === this.settings.mode }, label));
    const shake = h("input", { type: "checkbox", checked: this.settings.shake });
    const save = () => {
      this.settings = { mode: select.value as Transition, shake: shake.checked };
      try {
        localStorage.setItem(KEY, JSON.stringify(this.settings));
      } catch {
        // storage unavailable: the choice lasts for this match only
      }
    };
    select.onchange = save;
    shake.onchange = save;
    return h("span", { class: "cutaway-controls" }, h("span", { class: "sp" }, "Cutaways"), select, h("label", { class: "shake" }, shake, "Shake"));
  }

  private player(team: Team, by: { name?: string; id?: string }): Player | undefined {
    return team.players.find((p) => (by.id ? p.id === by.id : p.name === by.name));
  }

  /** True if the cutaway for this event shows the action itself, so it should play before the arena scene. */
  playsBefore(ev: MatchEvent): boolean {
    return kindsFor(ev).some((k) => BEFORE.has(k));
  }

  /** Works out what to show for an event, or null for the usual presentation. */
  plan(ev: MatchEvent): CutawayRequest | null {
    const { home, away } = this.host;
    if (this.settings.mode === "dots" || home.gender !== "women") return null;
    const kinds = kindsFor(ev);
    if (!kinds.length || this.shown >= MAX_PER_MATCH || secOf(ev) - this.lastSec < COOLDOWN_SEC) return null;
    const kind = kinds[Math.floor(rand(ev, 43) * kinds.length)];
    if (rand(ev, 41) >= CHANCE[kind]) return null;

    let a: Player | undefined;
    let b: Player | undefined;
    if (kind === "card") {
      a = this.player(ev.team === 0 ? home : away, { id: ev.pid });
    } else if (kind === "kickchase") {
      // Always the kicker, not the chaser who may score: she is the attacking side's slot `ki`.
      const atk = ev.att === 0 ? home : away;
      a = ev.cast?.ki !== undefined ? this.player(atk, { name: ev.cast.a[ev.cast.ki] }) : undefined;
    } else if (kind === "intercept" || kind === "goal" || kind === "goalmiss") {
      // One player, named on the event: the interceptor, or the kicker.
      a = this.player(ev.team === 0 ? home : away, { name: ev.player });
    } else if (ev.cast && ev.att !== undefined) {
      const atk = ev.att === 0 ? home : away;
      const def = ev.att === 0 ? away : home;
      a = this.player(atk, { name: ev.cast.a[ev.cast.ai] });
      b = this.player(def, { name: ev.cast.d[ev.cast.di] });
    }
    const la = a && lookOf(a, home.gender);
    if (!la) return null;
    const lb = b && lookOf(b, home.gender);
    // A card shows the referee on the left; she is nobody in particular.
    const second = lb ? athlete(lb) : kind === "card" ? { hair: Math.floor(rand(ev, 44) * 5), build: 1 } : undefined;
    return { kind, a: athlete(la), b: second, pose: kind === "grounding" ? Math.floor(rand(ev, 45) * 3) : undefined, mode: this.settings.mode, shake: this.settings.shake };
  }

  /** Plays the cutaway for an event, if there is one. Resolves when it has finished, or at once if there is none. */
  async play(ev: MatchEvent, fromArena: boolean): Promise<void> {
    const req = this.plan(ev);
    if (!req) return;
    let paint;
    try {
      paint = await prepare(req);
    } catch {
      return; // missing or undecodable art: carry on without
    }
    this.lastSec = secOf(ev);
    this.shown++;
    const field = snapshotField(fromArena ? this.host.arena : null);
    const ctx = this.canvas.getContext("2d")!;
    const total = cutawayLength(req.mode);
    await new Promise<void>((resolve) => {
      let p = 0;
      let last = 0;
      let raf = 0;
      const finish = () => {
        cancelAnimationFrame(raf);
        this.layer.hidden = true;
        this.stop = null;
        resolve();
      };
      this.stop = finish;
      const frame = (now: number) => {
        const dt = last ? Math.min(100, now - last) / 1000 : 0;
        last = now;
        p += dt * this.host.rate();
        drawFrame(ctx, paint, field, req.mode, Math.min(p, total));
        this.layer.hidden = false;
        if (p >= total) finish();
        else raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
  }

  /** Ends a cutaway that is playing (skip, or leaving the match). */
  cancel() {
    this.stop?.();
  }
}
