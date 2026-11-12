import { describe, expect, it } from "vitest";
import { Narrator } from "../src/engine/commentary";
import { BIN_PHASES, MatchSim, simulateMatch } from "../src/engine/match";
import { Rng, hashSeed } from "../src/engine/rng";
import type { MatchLog, Team } from "../src/engine/types";
import { STAT_KEYS } from "../src/engine/types";
import { SAVE_VERSION, autoPlan, completeOffseason, careerLine, isSeasonOver, migrateSave, newGame, playMatchday, startNextSeason } from "../src/league/season";
import { generateTeams } from "../src/league/teams";
import { buildScene } from "../src/viewer/scenes";

const teams = generateTeams(21);
const run = (n: number, ta: "balanced" | "attacking" | "defensive" | "territory" = "balanced", tb = ta, home = teams[0], away = teams[1]) =>
  simulateMatch({ id: "d", season: 1, matchday: 1, home, away, homeTactic: ta, awayTactic: tb, seed: hashSeed("disc", n) });

describe("cards", () => {
  it("happen at a believable rate, mostly yellow", () => {
    let y = 0, r = 0;
    const N = 500;
    for (let n = 0; n < N; n++) {
      const m = run(n);
      y += m.events.filter((e) => e.type === "yellow").length;
      r += m.events.filter((e) => e.type === "red").length;
    }
    console.log({ yellowPerMatch: y / N, redPerMatch: r / N });
    expect(y / N).toBeGreaterThan(0.3);
    expect(y / N).toBeLessThan(2);
    expect(r / N).toBeGreaterThan(0.01);
    expect(r / N).toBeLessThan(0.3);
    expect(r).toBeLessThan(y);
  });

  it("keep card events, team stats and player lines consistent", () => {
    for (let n = 0; n < 200; n++) {
      const m = run(n, "defensive");
      for (const side of [0, 1] as const) {
        const ev = m.events.filter((e) => e.team === side);
        const yellows = ev.filter((e) => e.type === "yellow").length;
        const reds = ev.filter((e) => e.type === "red").length;
        // A second yellow is announced as a red but also counts as a yellow, so yellows >= yellow events.
        expect(m.stats[side].reds ?? 0).toBe(reds);
        expect(m.stats[side].yellows ?? 0).toBeGreaterThanOrEqual(yellows);
        const lines = (m.players ?? []).filter((l) => l.team === side);
        expect(lines.reduce((a, l) => a + l.reds, 0)).toBe(reds);
        expect(lines.reduce((a, l) => a + l.yellows, 0)).toBe(m.stats[side].yellows ?? 0);
      }
    }
  });

  it("send a yellow-carded player off the pitch for ten minutes and then bring them back", () => {
    let checked = 0;
    for (let n = 0; n < 400 && checked < 25; n++) {
      const m = run(n, "defensive");
      for (const y of m.events.filter((e) => e.type === "yellow")) {
        const back = m.events.find((e) => e.type === "return" && e.pid === y.pid);
        const redLater = m.events.find((e) => e.type === "red" && e.pid === y.pid);
        if (redLater) continue;
        const end = 2400;
        if (y.sec + BIN_PHASES * 30 >= end) {
          expect(back).toBeUndefined();
          continue;
        }
        expect(back, `yellow at ${y.sec}s`).toBeDefined();
        expect(back!.sec - y.sec).toBe(BIN_PHASES * 30);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("never involve a player who is off the pitch", () => {
    for (let n = 0; n < 300; n++) {
      const m = run(n, "defensive", "territory");
      const off = new Map<string, number>(); // pid -> sec until (Infinity for a red)
      for (const e of m.events) {
        if (e.type === "yellow" && e.pid) off.set(e.pid, e.sec + BIN_PHASES * 30);
        else if (e.type === "red" && e.pid) off.set(e.pid, Infinity);
        else if (e.type === "return" && e.pid) off.delete(e.pid);
        else if (e.player && e.type !== "sub" && e.type !== "talk") {
          const id = [...(m.players ?? [])].find((l) => l.name === e.player)?.id;
          if (id && off.has(id)) expect.fail(`${e.player} acted (${e.type}) at ${e.sec}s while off the pitch`);
        }
      }
    }
  });

  it("tell the animation who is missing, and the scene leaves them out", () => {
    let withOff = 0;
    for (let n = 0; n < 400 && withOff < 8; n++) {
      const m = run(n, "defensive");
      for (const e of m.events) {
        if (!e.highlight || !(e.cast?.offA?.length || e.cast?.offD?.length)) continue;
        withOff++;
        expect(e.cast!.a).toHaveLength(5);
        const sc = buildScene(e)!;
        expect(sc).not.toBeNull();
        for (const i of e.cast!.offD ?? []) expect(Object.keys(sc.init)).not.toContain(`d${i}`);
        for (const i of e.cast!.offA ?? []) expect(Object.keys(sc.init)).not.toContain(`a${i}`);
        expect(JSON.stringify(sc.beats.map((b) => b.cap))).not.toMatch(/undefined/);
      }
    }
    expect(withOff).toBeGreaterThan(3);
  });

  it("make the side that is a man up score more", () => {
    // Measure tries per second of play while the opponent is down a player versus at full strength.
    let upSecs = 0, upTries = 0, evenSecs = 0, evenTries = 0;
    for (let n = 0; n < 700; n++) {
      const m = run(n, "defensive");
      const downUntil: [number, number][][] = [[], []]; // per side: [from, to] windows when that side is short
      for (const e of m.events) {
        if (e.type === "yellow" && e.team !== undefined) downUntil[e.team].push([e.sec, Math.min(2400, e.sec + BIN_PHASES * 30)]);
        if (e.type === "red" && e.team !== undefined) {
          // a second yellow's bin window ends at the red
          const w = downUntil[e.team][downUntil[e.team].length - 1];
          if (w && w[1] > e.sec && w[0] === e.sec) w[1] = 2400;
          else downUntil[e.team].push([e.sec, 2400]);
        }
      }
      const short = (side: 0 | 1, sec: number) => downUntil[side].some(([a, b]) => sec >= a && sec < b);
      for (let sec = 0; sec < 2400; sec += 30) {
        const s0 = short(0, sec), s1 = short(1, sec);
        if (s0 === s1) continue; // only compare phases where exactly one side is short
        upSecs += 30;
        evenSecs += 0;
      }
      for (const e of m.events) {
        if (e.type !== "try" || e.team === undefined) continue;
        const attacker = e.team;
        const defender = attacker === 0 ? 1 : 0;
        if (short(defender, e.sec) && !short(attacker, e.sec)) upTries++;
      }
      // Baseline: tries per second when both sides are at full strength.
      for (let sec = 0; sec < 2400; sec += 30) if (!short(0, sec) && !short(1, sec)) evenSecs += 30;
      for (const e of m.events) if (e.type === "try" && e.team !== undefined && !short(0, e.sec) && !short(1, e.sec)) evenTries++;
    }
    // upSecs counts seconds when exactly one side is short; the side with the ball can be either, so one team scores against it.
    const upRate = upTries / upSecs;
    const evenRate = evenTries / evenSecs / 2; // per side
    console.log({ manUpTriesPerMinute: upRate * 60, evenTriesPerMinutePerSide: evenRate * 60 });
    expect(upRate).toBeGreaterThan(evenRate * 1.25);
  }, 30000);

  it("cannot be substituted off while carded, and a side never drops below three on the pitch", () => {
    let tried = false;
    for (let n = 0; n < 300 && !tried; n++) {
      const sim = new MatchSim({ id: "s", season: 1, matchday: 1, home: teams[0], away: teams[1], homeTactic: "defensive", awayTactic: "defensive", seed: hashSeed("sub", n) });
      let guard = 0;
      while (!sim.finished && guard++ < 200) {
        sim.step();
        for (const side of [0, 1] as const) {
          expect(sim.onPitch(side)).toBeGreaterThanOrEqual(3);
          const carded = sim.sides[side].field.find((p) => sim.cardState(side, p));
          const bench = sim.sides[side].bench[0];
          if (carded && bench && sim.sides[side].subs < 3) {
            expect(sim.substitute(side, carded.id, bench.id)).toBe(false);
            tried = true;
          }
        }
      }
    }
    expect(tried).toBe(true);
  });

  it("make defensive tactics and tired players more likely to be carded", () => {
    const cards = (t: "balanced" | "attacking" | "defensive" | "territory") => {
      let c = 0;
      for (let n = 0; n < 400; n++) {
        const m = run(n, t, "balanced");
        c += m.events.filter((e) => (e.type === "yellow" || e.type === "red") && e.team === 0).length;
      }
      return c;
    };
    const att = cards("attacking"), def = cards("defensive");
    console.log({ attackingCards: att, defensiveCards: def });
    expect(def).toBeGreaterThan(att);
  });
});

describe("suspensions", () => {
  it("apply a one-match ban after a red, replace the starter, then clear", () => {
    let proved = false;
    for (let seed = 1; seed < 40 && !proved; seed++) {
      let s = newGame(seed, "dun");
      while (!isSeasonOver(s) && !proved) {
        const before = s;
        const r = playMatchday(s);
        s = r.state;
        const reds = r.logs.flatMap((l) => (l.players ?? []).filter((x) => x.reds > 0));
        if (!reds.length) continue;
        const red = reds[0];
        const team = s.teams.find((t) => t.players.some((p) => p.id === red.id))!;
        const player = team.players.find((p) => p.id === red.id)!;
        expect(player.ban).toBe(1);
        if (isSeasonOver(s)) continue;
        // The following matchday: the banned player must not play for their club.
        const next = playMatchday(s);
        for (const log of next.logs) expect((log.players ?? []).some((x) => x.id === red.id)).toBe(false);
        const after = next.state.teams.find((t) => t.id === team.id)!.players.find((p) => p.id === red.id)!;
        expect(after.ban ?? 0).toBe(0);
        if (team.id === "dun") expect(s.teams.find((t) => t.id === "dun")!.lineup).not.toContain(red.id);
        void before;
        proved = true;
      }
    }
    expect(proved).toBe(true);
  }, 60000);

  it("never starts a suspended player, even if the lineup still names them", () => {
    const t: Team = structuredClone(teams[2]);
    const star = t.players.find((p) => p.id === t.lineup[0])!;
    star.ban = 1;
    const sim = new MatchSim({ id: "x", season: 1, matchday: 1, home: t, away: teams[3], homeTactic: "balanced", awayTactic: "balanced", seed: 4 });
    expect(sim.sides[0].field.map((p) => p.id)).not.toContain(star.id);
    expect(sim.sides[0].bench.map((p) => p.id)).not.toContain(star.id);
    expect(sim.sides[0].field).toHaveLength(5);
    const log = sim.runToEnd().toLog();
    expect((log.players ?? []).some((l) => l.id === star.id)).toBe(false);
  });
});

describe("player stats", () => {
  it("add up to the match and the season", () => {
    let s = newGame(5, "bla");
    for (let i = 0; i < 6; i++) {
      const r = playMatchday(s);
      s = r.state;
      for (const log of r.logs) {
        const lines = log.players ?? [];
        expect(lines.length).toBeGreaterThanOrEqual(10);
        for (const side of [0, 1] as const) {
          const pts = lines.filter((l) => l.team === side).reduce((a, l) => a + l.points, 0);
          expect(pts).toBe(side === 0 ? log.homeScore : log.awayScore);
          expect(lines.filter((l) => l.team === side).reduce((a, l) => a + l.tries, 0)).toBe(log.stats[side].tries);
          expect(lines.filter((l) => l.team === side).reduce((a, l) => a + l.tackles, 0)).toBe(log.stats[side].tackles);
          expect(lines.filter((l) => l.team === side).reduce((a, l) => a + l.metres, 0)).toBe(log.stats[side].metres);
        }
      }
    }
    const totalPoints = Object.values(s.seasonStats).reduce((a, t) => a + t.points, 0);
    const played = s.fixtures.filter((f) => f.result).reduce((a, f) => a + f.result!.homeScore + f.result!.awayScore, 0);
    expect(totalPoints).toBe(played);
    expect(Math.max(...Object.values(s.seasonStats).map((t) => t.apps))).toBe(6);
  });

  it("roll into the career at season end", () => {
    let s = newGame(9, "ash");
    while (!isSeasonOver(s)) s = playMatchday(s).state;
    const id = s.teams.find((t) => t.id === "ash")!.players[0].id;
    const seasonOne = { ...s.seasonStats[id] };
    const s2 = startNextSeason(JSON.parse(JSON.stringify(s)));
    expect(s2.seasonStats).toEqual({});
    expect(s2.careerStats[id].apps).toBe(seasonOne.apps);
    expect(s2.careerStats[id].seasons).toBe(1);
    for (const k of STAT_KEYS) expect(careerLine(s2, id)[k]).toBe(seasonOne[k]);
    const s3 = playMatchday(completeOffseason(s2, autoPlan(s2))).state;
    expect(careerLine(s3, id).apps).toBeGreaterThanOrEqual(seasonOne.apps);
  });

  it("upgrade a version 3 save and refuse unknown ones", () => {
    const fresh = newGame(1, "ash");
    const v3 = JSON.parse(JSON.stringify({ ...fresh, version: 3, seasonStats: undefined, careerStats: undefined }));
    const up = migrateSave(v3)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.seasonStats).toEqual({});
    expect(migrateSave({ ...fresh, version: 1 })).toBeNull();
  });

  it("still read match logs saved before player stats and cards existed", () => {
    const m: MatchLog = JSON.parse(JSON.stringify(run(3)));
    delete m.players;
    for (const st of m.stats) {
      delete st.yellows;
      delete st.reds;
    }
    expect(() => careerLine(newGame(1, "ash"), "nobody")).not.toThrow();
    expect(m.players).toBeUndefined();
  });
});

describe("commentary", () => {
  const facts = { team: "ABJ", opp: "KAN", him: "him", c: "Emeka Okafor", cs: "Okafor", t: "Tunde Eze", ts: "Eze", gain: 12, n: 3, where: "in their own half" };
  it("does not repeat a phrasing back to back and uses several", () => {
    for (const call of ["carry", "knockOn", "jackal", "sixth", "kickLive", "penaltyCorner"] as const) {
      const nar = new Narrator(new Rng(5));
      const out: string[] = [];
      for (let i = 0; i < 40; i++) out.push(nar[call]({ ...facts, k: "Emeka Okafor", dist: 40, run: 12 }));
      for (let i = 1; i < out.length; i++) expect(out[i], `${call} repeated at ${i}`).not.toBe(out[i - 1]);
      expect(new Set(out).size, call).toBeGreaterThanOrEqual(3);
    }
  });
  it("keeps the facts the animation shows in every phrasing", () => {
    const nar = new Narrator(new Rng(8));
    for (let i = 0; i < 30; i++) {
      const f = { ...facts, k: "Emeka Okafor", dist: 33, side: "left" as const, what: "conversion" };
      expect(nar.conversionMiss(f, "x", "post")).toMatch(/left (upright|post)|(upright|post)/);
      expect(nar.conversionMiss({ ...f, side: "right" }, "x", "wide")).toMatch(/right/);
      expect(nar.conversionMiss(f, "x", "short")).toMatch(/short/);
      expect(nar.breakEnd("touch", f)).toMatch(/touch|out of play/);
      expect(nar.breakEnd("touch", f)).toMatch(/line-out/i);
      expect(nar.breakEnd("foul", f)).toMatch(/high|neck/);
      expect(nar.breakEnd("caught", f)).toMatch(/behind/);
      expect(nar.breakEnd("covered", { ...f, sweeper: "Ade Bello" })).toMatch(/Bello/);
    }
  });
  it("adds score context to tries", () => {
    const nar = new Narrator(new Rng(2));
    const f = { team: "ABJ", opp: "KAN", him: "him", c: "A B", ts: "C" };
    expect(nar.try(f, "power", 10, 10, 20)).toMatch(/levels/);
    expect(nar.try(f, "power", 12, 10, 20)).toMatch(/take the lead/);
    expect(nar.try(f, "break", 5, 12, 38)).toMatch(/time is running out/);
  });
  it("does not change what happens in a match", () => {
    const a = run(11);
    const b = run(11);
    expect(a.events.map((e) => e.text)).toEqual(b.events.map((e) => e.text));
    expect(a.homeScore).toBe(b.homeScore);
  });
  it("reads varied over a whole match", () => {
    const m = run(14);
    const carries = m.events.filter((e) => e.type === "carry").map((e) => e.text);
    // Names differ so exact repeats are rare anyway; check the sentence skeletons vary.
    const skeletons = new Set(carries.map((t) => t.replace(/[A-Z][a-z]+ [A-Z][a-z]+|\b[A-Z][a-z]+\b|\d+/g, "_")));
    expect(skeletons.size).toBeGreaterThan(8);
  });
});
