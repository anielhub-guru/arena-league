import { h } from "../dom";
import { MAX_SUBS, MatchSim, TACTICS, TALKS, type TalkId } from "../engine/match";
import type { EventType, MatchEvent, MatchLog, TacticId, Team } from "../engine/types";
import { ArenaView } from "./arena";
import { buildScene } from "./scenes";
import { scorerLines, statBars } from "./text";

export interface LiveOptions {
  home: Team;
  away: Team;
  /** Live mode: the simulation to drive. Replay mode: leave undefined and pass `log`. */
  sim?: MatchSim;
  log?: MatchLog;
  /** Which side the manager controls (live mode only). */
  managedSide?: 0 | 1;
  /** Called when the user leaves after full time. In live mode the final log is passed. */
  onExit: (log: MatchLog, live: boolean) => void;
}

const LABEL: Partial<Record<EventType, string>> = {
  kickoff: "KICK-OFF",
  carry: "RUN",
  break: "LINE BREAK",
  kick: "KICK",
  "knock-on": "KNOCK-ON",
  turnover: "TURNOVER",
  intercept: "INTERCEPTED",
  penalty: "PENALTY",
  "penalty-goal": "PENALTY GOAL",
  "penalty-miss": "PENALTY MISSED",
  "drop-goal": "DROP GOAL",
  "drop-miss": "DROP GOAL MISSED",
  try: "TRY",
  conversion: "CONVERSION",
  "conversion-miss": "CONVERSION MISSED",
  halftime: "HALF TIME",
  fulltime: "FULL TIME",
  sub: "SUBSTITUTION",
  talk: "TEAM TALK",
};

/** Match seconds that pass per real second at 1x. A full match is 2400 match seconds. */
export const CLOCK_RATE = 30;
/** A line stays up at least this long (real ms at 1x) before the next one replaces it. */
const MIN_HOLD_MS = 3300;
/** Routine moments are only narrated when this many match seconds have passed since the last line. */
const MINOR_GAP_SEC = 110;
const ALWAYS_SHOWN = new Set<EventType>(["kickoff", "halftime", "fulltime", "sub", "talk"]);

const secOf = (e: MatchEvent) => e.sec ?? Math.max(0, (e.minute - 1) * 60);
const fmtClock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export class LiveMatch {
  readonly root: HTMLElement;
  private arena: ArenaView;
  private opts: LiveOptions;
  private feed = h("div", { class: "feed" });
  private score = h("div", { class: "sb-score" }, "0 - 0");
  private clock = h("div", { class: "sb-clock" }, "00:00");
  private pFill = h("i", { class: "pfill" });
  private pMark = h("b", { class: "pmark" });
  private pressure = 0.5;
  private clockSec = 0;
  /** The clock never runs more than a few seconds past the event being waited on. */
  private pendingSec = Infinity;
  private clockFrozen = false;
  private lastShownSec = -999;
  private lastShownAt = 0;
  private arenaOpen = false;
  private inHighlight = false;
  private arenaCloseAt = 0;
  private ticker = 0;
  private progress = h("i");
  private status = h("div", { class: "sb-status" }, "Set your tactic and substitutes, then kick off.");
  private manage = h("div", { class: "manage" });
  /** Always-visible resume control at the top of the side panel while the match is paused. */
  private resumeBar = h("div", { class: "resumebar" });
  private resumeBtn = h("button", { class: "primary big" }, "▶ Resume match");
  private stage = h("div", { class: "stage" });
  private cmTag = h("div", { class: "cm-tag" });
  private cmText = h("div", { class: "cm-text" });
  private pauseBtn = h("button", { class: "primary" }, "Kick off");
  private skipBtn = h("button", {}, "Skip to end");
  private speedBtns: HTMLButtonElement[] = [];
  private paused = true;
  private skipping = false;
  private done = false;
  private disposed = false;
  private running = false;
  private started = false;
  private speed = 1;
  private wake: (() => void) | null = null;
  private perspective: 0 | 1 = 0;
  private replayBatches: MatchEvent[][] = [];
  private replayIdx = 0;
  private talkBox: HTMLElement | null = null;

  constructor(opts: LiveOptions) {
    this.opts = opts;
    this.perspective = opts.managedSide ?? 0;
    this.arena = new ArenaView(opts.home.short, opts.away.short);
    if (opts.log) {
      const byStep = new Map<number, MatchEvent[]>();
      for (const e of opts.log.events) byStep.set(e.step, [...(byStep.get(e.step) ?? []), e]);
      this.replayBatches = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      this.paused = false;
      this.started = true;
      this.pauseBtn.textContent = "Pause";
      this.status.textContent = "Replay";
    }
    this.root = this.build();
    this.ticker = window.setInterval(() => this.tick(), 50);
    this.updateManage();
    if (opts.log) void this.loop();
  }

  dispose() {
    this.disposed = true;
    this.done = true;
    window.clearInterval(this.ticker);
    this.arena.dispose();
    this.wake?.();
  }

  // ---------------------------------------------------------------- layout

  private build(): HTMLElement {
    const { home, away } = this.opts;
    const live = !!this.opts.sim;
    this.pauseBtn.onclick = () => this.togglePause();
    this.resumeBtn.onclick = () => this.setPaused(false);
    this.resumeBar.append(this.resumeBtn, h("div", { class: "hint" }, "The match is paused while you make changes."));
    this.resumeBar.hidden = true;
    this.skipBtn.onclick = () => this.skip();
    for (const s of [1, 2, 4, 8]) {
      const b = h("button", { class: s === this.speed ? "active" : "" }, `${s}x`);
      b.onclick = () => {
        this.speed = s;
        this.speedBtns.forEach((x) => x.classList.toggle("active", x === b));
      };
      this.speedBtns.push(b);
    }
    const controls = h("div", { class: "controls" }, this.pauseBtn, h("span", { class: "sp" }, "Speed"), ...this.speedBtns, h("span", { class: "spacer" }), this.skipBtn);

    const scoreboard = h("div", { class: "scoreboard" },
      h("div", { class: "sb-team home" }, home.name),
      h("div", { class: "sb-mid" }, this.score, this.clock, h("div", { class: "sb-bar" }, this.progress)),
      h("div", { class: "sb-team away" }, away.name));

    this.stage.append(this.arena.canvas, h("div", { class: "cm" }, this.cmTag, this.cmText));
    this.cmTag.textContent = "MATCH CENTRE";
    this.cmText.textContent = `${home.name} v ${away.name}`;

    const mine = this.perspective === 0 ? home : away;
    const theirs = this.perspective === 0 ? away : home;
    const pressure = h("div", { class: "pressure", title: "How far up the pitch your team has the ball. Full bar = camped on their line." },
      h("span", { class: "pl" }, `${mine.short} PRESSURE`),
      h("div", { class: "pbar" }, this.pFill, this.pMark),
      h("span", { class: "pr" }, theirs.short));
    this.setPressure(0.5, true);

    const log = h("details", { class: "logwrap" }, h("summary", {}, "Full match log"), this.feed);
    const left = h("div", { class: "live-main" }, scoreboard, pressure, this.status, this.stage, controls, log);
    if (live) this.manage.classList.add("on");
    // Touching any management control pauses the match.
    this.manage.addEventListener("focusin", () => {
      if (!this.paused && !this.done) this.setPaused(true);
    });
    return h("div", { class: `live ${live ? "with-manage" : ""}` }, left, this.manage);
  }

  /** Right-hand management panel: tactic, condition, substitutions. */
  private updateManage() {
    const { sim, managedSide: ms } = this.opts;
    if (this.done || !sim || ms === undefined) return;
    this.manage.replaceChildren(this.resumeBar);
    const side = sim.sides[ms];

    const tactic = h("select");
    for (const [id, t] of Object.entries(TACTICS)) tactic.append(h("option", { value: id, selected: id === side.tactic }, t.label));
    const tacticHelp = h("div", { class: "hint" }, TACTICS[side.tactic].description);
    tactic.onchange = () => {
      sim.setTactic(ms, tactic.value as TacticId);
      tacticHelp.textContent = TACTICS[tactic.value as TacticId].description;
    };

    const cond = h("table", { class: "cond" });
    for (const p of side.field) {
      const e = sim.energy(ms, p);
      cond.append(h("tr", {},
        h("td", { class: "r" }, p.role),
        h("td", {}, p.name),
        h("td", { class: "bar-cell" }, h("div", { class: "energy" }, Object.assign(h("i"), { style: `width:${e}%` }))),
        h("td", { class: "n" }, `${e}%`)));
    }

    const outSel = h("select");
    for (const p of side.field) outSel.append(h("option", { value: p.id }, `${p.role}: ${p.name}`));
    const inSel = h("select");
    for (const p of side.bench) inSel.append(h("option", { value: p.id }, `${p.name} (${p.role}, ${Math.round((p.power + p.pace + p.handling + p.tackling + p.kicking + p.stamina) / 6)})`));
    const subBtn = h("button", {}, "Make substitution");
    subBtn.disabled = side.subs >= MAX_SUBS || side.bench.length === 0;
    subBtn.onclick = () => {
      if (sim.substitute(ms, outSel.value, inSel.value)) {
        for (const ev of sim.drain()) this.reveal(ev);
        this.updateManage();
      }
    };

    this.manage.append(
      h("h3", {}, side.team.name),
      h("div", { class: "lbl" }, "Tactic"), tactic, tacticHelp,
      h("div", { class: "lbl" }, "Energy (tired players play worse)"), cond,
      h("div", { class: "lbl" }, `Substitutions (${side.subs}/${MAX_SUBS} used)`),
      outSel, inSel, subBtn,
      h("div", { class: "hint" }, "Opening a control pauses the match. Use the Resume button at the top of this panel when you're done."),
    );
    if (this.talkBox) this.resumeBar.after(this.talkBox);
  }

  // ---------------------------------------------------------------- flow

  private togglePause() {
    if (this.done) return;
    this.setPaused(!this.paused);
  }

  keyToggle() {
    this.togglePause();
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.resumeBar.hidden = !(p && this.started && !!this.opts.sim && !this.done);
    this.pauseBtn.textContent = p ? (this.started ? "Resume" : "Kick off") : "Pause";
    if (!p) {
      this.started = true;
      this.status.textContent = this.opts.log ? "Replay" : "";
      this.wake?.();
      this.wake = null;
      if (!this.running) void this.loop();
    } else if (this.started) {
      this.status.textContent = "Paused";
    }
  }

  private skip() {
    if (this.done) return;
    this.skipping = true;
    this.started = true;
    this.clockFrozen = false;
    this.arena.cancel();
    this.talkBox?.remove();
    this.talkBox = null;
    this.status.textContent = "Skipping to full time...";
    this.skipBtn.disabled = true;
    if (this.paused) this.setPaused(false);
    else if (!this.running) void this.loop();
    this.wake?.();
  }

  private nextBatch(): MatchEvent[] | null {
    if (this.opts.sim) return this.opts.sim.finished ? null : this.opts.sim.step();
    return this.replayBatches[this.replayIdx++] ?? null;
  }

  /** Runs every 50ms: advances the match clock and closes the arena after a highlight. */
  private tick() {
    if (this.disposed) return;
    const now = performance.now();
    if (this.started && !this.paused && !this.clockFrozen && !this.done && !this.skipping) {
      this.clockSec = Math.min(2400, this.pendingSec + 20, this.clockSec + 0.05 * this.speed * CLOCK_RATE);
      this.clock.textContent = fmtClock(this.clockSec);
      this.progress.style.width = `${(this.clockSec / 2400) * 100}%`;
    }
    if (this.paused) this.arenaCloseAt += 50;
    if (this.arenaOpen && !this.inHighlight && now >= this.arenaCloseAt) {
      this.arenaOpen = false;
      this.stage.classList.remove("hl");
      window.setTimeout(() => {
        if (!this.arenaOpen && !this.inHighlight) this.arena.clear();
      }, 450);
    }
  }

  /** Resolves once the match clock reaches the given match second. */
  private async clockTo(sec: number) {
    while (this.clockSec < sec && !this.skipping && !this.disposed) await new Promise((r) => window.setTimeout(r, 40));
  }

  /** Makes sure the previous line has been on screen long enough to read. */
  private async holdPrevious() {
    while (!this.skipping && !this.disposed && performance.now() - this.lastShownAt < MIN_HOLD_MS / this.speed) {
      await new Promise((r) => window.setTimeout(r, 40));
      if (this.paused) this.lastShownAt += 40;
    }
  }

  private async loop() {
    if (this.running) return;
    this.running = true;
    while (!this.done && !this.disposed) {
      if (this.paused && !this.skipping) {
        await new Promise<void>((r) => (this.wake = r));
        continue;
      }
      const batch = this.nextBatch();
      if (!batch) {
        this.finish();
        break;
      }
      for (const ev of batch) {
        if (this.disposed) return;
        await this.process(ev);
      }
      if (!this.skipping) this.softRefreshManage();
    }
    this.running = false;
  }

  /** Handles one event when the clock reaches it: narrate it, animate it, or just log it. */
  private async process(ev: MatchEvent) {
    this.pendingSec = secOf(ev);
    await this.clockTo(secOf(ev));
    if (this.skipping) {
      this.logLine(ev, false);
      this.setPressure(ev.x1 / 100);
      this.score.textContent = `${ev.homeScore} - ${ev.awayScore}`;
      return;
    }
    const scene = ev.highlight ? buildScene(ev) : null;
    if (scene) {
      await this.holdPrevious();
      this.inHighlight = true;
      this.clockFrozen = true; // like Football Manager, the clock waits while a highlight plays
      this.cmTag.textContent = "HIGHLIGHT";
      this.cmText.textContent = fmtClock(this.clockSec);
      this.arenaOpen = true;
      this.stage.classList.add("hl");
      this.setPressure(ev.x0 / 100);
      await this.arena.play(scene, () => (this.paused ? 0 : this.speed));
      this.inHighlight = false;
      if (this.disposed) return;
      this.reveal(ev);
      this.arenaCloseAt = performance.now() + 1900 / this.speed;
      this.clockFrozen = ev.type === "halftime";
      return;
    }
    const narrate = ev.key || ALWAYS_SHOWN.has(ev.type) || secOf(ev) - this.lastShownSec >= MINOR_GAP_SEC;
    if (!narrate) {
      this.logLine(ev, false);
      this.setPressure(ev.x1 / 100);
      return;
    }
    await this.holdPrevious();
    if (this.disposed) return;
    this.reveal(ev);
    if (ev.type === "halftime") {
      this.clockFrozen = true;
      this.clockSec = Math.max(this.clockSec, 1200);
      if (this.opts.sim && this.opts.managedSide !== undefined) {
        this.showTalk();
        this.setPaused(true);
      } else {
        window.setTimeout(() => (this.clockFrozen = false), 2500 / this.speed);
      }
    }
  }

  /** Puts the event's line on the commentary card and updates the scoreboard. */
  private reveal(ev: MatchEvent) {
    this.score.textContent = `${ev.homeScore} - ${ev.awayScore}`;
    this.setPressure(ev.x1 / 100);
    this.lastShownSec = secOf(ev);
    this.lastShownAt = performance.now();
    if (ev.type === "halftime") this.clock.textContent = "HT";
    if (ev.type === "fulltime") this.clock.textContent = "FT";
    const fresh = h("div", { class: `cm-text fresh t-${ev.type} ${ev.key ? "key" : ""}` }, ev.text);
    this.cmText.replaceWith(fresh);
    this.cmText = fresh;
    this.cmTag.textContent = `${ev.minute}'  ${LABEL[ev.type] ?? ""}${ev.highlight ? "  ·  HIGHLIGHT" : ""}`;
    this.logLine(ev, true);
  }

  private logLine(ev: MatchEvent, narrated: boolean) {
    this.feed.prepend(h("div", { class: `ln t-${ev.type} ${ev.key || narrated ? "key" : ""}` }, h("span", { class: "min" }, `${ev.minute}'`), h("span", { class: "tx" }, ev.text)));
    while (this.feed.childElementCount > 300) this.feed.lastElementChild?.remove();
  }

  /** Pressure bar: share of the pitch your team has advanced, smoothed so it drifts rather than jumps. */
  private setPressure(homeShare: number, snap = false) {
    const raw = Math.min(0.97, Math.max(0.03, homeShare));
    const mine = this.perspective === 0 ? raw : 1 - raw;
    this.pressure = snap ? mine : this.pressure * 0.4 + mine * 0.6;
    const pct = `${(this.pressure * 100).toFixed(1)}%`;
    this.pFill.style.width = pct;
    this.pMark.style.left = pct;
    this.pFill.classList.toggle("hot", this.pressure > 0.6);
    this.pFill.classList.toggle("cold", this.pressure < 0.35);
  }

  /** Refresh energy bars without disturbing a focused control. */
  private softRefreshManage() {
    if (this.manage.contains(document.activeElement)) return;
    this.updateManage();
  }

  private showTalk() {
    const { sim, managedSide: ms } = this.opts;
    if (!sim || ms === undefined) return;
    const box = h("div", { class: "talk" }, h("div", { class: "lbl" }, "Half-time team talk"));
    for (const [id, t] of Object.entries(TALKS)) {
      const b = h("button", { title: t.description }, `${t.label} - ${t.description}`);
      b.onclick = () => {
        sim.talk(ms, id as TalkId);
        for (const ev of sim.drain()) this.reveal(ev);
        box.remove();
        this.talkBox = null;
        this.clockFrozen = false;
        this.setPaused(false);
      };
      box.append(b);
    }
    this.talkBox = box;
    this.resumeBar.after(box);
    this.status.textContent = "Half time. Give your team talk, change tactics or substitute.";
  }

  private finish() {
    this.done = true;
    this.resumeBar.hidden = true;
    this.pendingSec = Infinity;
    this.arenaOpen = false;
    this.inHighlight = false;
    this.clock.textContent = "FT";
    this.progress.style.width = "100%";
    const { sim, log: replay } = this.opts;
    const log = sim ? sim.toLog() : replay!;
    this.stage.classList.remove("hl");
    this.arena.clear();
    this.cmTag.textContent = "FULL TIME";
    const fresh = h("div", { class: "cm-text fresh t-fulltime key" }, `${log.homeName} ${log.homeScore} - ${log.awayScore} ${log.awayName}`);
    this.cmText.replaceWith(fresh);
    this.cmText = fresh;
    this.status.textContent = "The match is over.";
    this.skipBtn.disabled = true;
    const exit = () => this.opts.onExit(log, !!sim);
    this.pauseBtn.disabled = false;
    this.pauseBtn.textContent = sim ? "Continue ▶" : "Back";
    this.pauseBtn.onclick = exit;
    const exitBtn = h("button", { class: "primary" }, sim ? "Continue" : "Back");
    exitBtn.onclick = exit;
    this.manage.classList.add("on");
    this.manage.replaceChildren(h("h3", {}, "Full time"), h("div", { class: "exit" }, exitBtn), h("div", { class: "lbl" }, "Scorers"), h("pre", { class: "scorers" }, scorerLines(log).join("\n") || "No scores."), h("div", { class: "lbl" }, "Match stats"), statBars(log));
    this.root.classList.add("with-manage");
  }
}
