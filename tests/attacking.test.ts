import { describe, expect, it } from "vitest";
import { ATTACK, MatchSim, attackFit } from "../src/engine/match";
import { aiTactic, newGame, teamById } from "../src/league/season";
import type { TacticId, Team } from "../src/engine/types";

const base = teamById(newGame(1, "ash"), "ash");

/** The same squad, shifted toward ball-in-hand skill (d > 0) or toward power and tackling (d < 0). Overall rating is unchanged. */
function variant(id: string, d: number): Team {
  const t = structuredClone(base);
  t.id = id;
  t.players.forEach((p, i) => {
    p.id = id + i;
    p.pace += d;
    p.handling += d;
    p.power -= d;
    p.tackling -= d;
  });
  t.lineup = t.players.slice(0, 5).map((p) => p.id);
  return t;
}

/** Points share (win = 1, draw = 0.5) of A playing `ta` against B playing `tb`, alternating home and away. */
function share(a: Team, ta: TacticId, b: Team, tb: TacticId, n = 300): number {
  let pts = 0;
  for (let i = 0; i < n; i++) {
    const home = i % 2 === 0;
    const log = new MatchSim({ id: `m${i}`, season: 1, matchday: 1, home: home ? a : b, away: home ? b : a, homeTactic: home ? ta : tb, awayTactic: home ? tb : ta, seed: 5000 + i, homeAuto: true, awayAuto: true }).runToEnd().toLog();
    const [mine, theirs] = home ? [log.homeScore, log.awayScore] : [log.awayScore, log.homeScore];
    pts += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
  }
  return pts / n;
}

describe("attacking tactic", () => {
  it("is strong for a side with pace and handling, and gets countered without them", () => {
    const suited = share(variant("A", 10), "attacking", variant("B", 10), "balanced");
    const neutral = share(variant("A", 0), "attacking", variant("B", 0), "balanced");
    const unsuited = share(variant("A", -10), "attacking", variant("B", -10), "balanced");
    console.log("attacking v balanced:", { unsuited, neutral, suited });
    expect(suited).toBeGreaterThan(0.58);
    expect(unsuited).toBeLessThan(0.46);
    expect(suited).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(unsuited);
  });

  it("fit follows the lineup's pace and handling", () => {
    const lineup = (d: number) => variant("X", d).players.slice(0, 5);
    expect(attackFit(lineup(12))).toBeGreaterThan(0.8);
    expect(attackFit(lineup(-12))).toBeLessThan(-0.5);
    expect(attackFit(lineup(12))).toBeGreaterThan(attackFit(lineup(0)));
    const mid = ATTACK.centre;
    const flat = lineup(0).map((p) => ({ ...p, pace: mid, handling: mid }));
    expect(attackFit(flat)).toBeCloseTo(0, 5);
  });

  it("AI clubs that cannot play Attacking fall back to Balanced", () => {
    const capable = { ...variant("Z", 10), style: "attacking" as const };
    expect(aiTactic(capable)).toBe("attacking");
    const poor = { ...variant("Z", -12), style: "attacking" as const };
    expect(aiTactic(poor)).toBe("balanced");
    expect(aiTactic({ ...poor, style: "defensive" })).toBe("defensive");
  });
});
