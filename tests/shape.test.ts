import { describe, expect, it } from "vitest";
import { MatchSim, SHAPES, adviseShape } from "../src/engine/match";
import { hashSeed } from "../src/engine/rng";
import type { Player, ShapeId, Team } from "../src/engine/types";
import { generateTeams } from "../src/league/teams";

const SHAPE_IDS: ShapeId[] = ["sweeper", "flat", "narrow"];
const base = generateTeams(21)[0];

/** The same club with the Winger sped up or the forwards strengthened, to make a recognisable attack. */
function attack(kind: "neutral" | "winger" | "forwards"): Team {
  const t: Team = structuredClone(base);
  t.id = `opp-${kind}`;
  const get = (i: number): Player => t.players.find((p) => p.id === t.lineup[i])!;
  if (kind === "winger") {
    get(3).pace = 88;
    get(0).power -= 8;
    get(1).power -= 8;
  } else if (kind === "forwards") {
    get(0).power = 88;
    get(1).power = 88;
    get(3).pace -= 12;
  }
  return t;
}

/** Average points conceded by the defence per 40-minute match, optionally a man down for the whole match. */
function conceded(shape: ShapeId, kind: "neutral" | "winger" | "forwards", manDown: boolean, n = 600): number {
  const opp = attack(kind);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sim = new MatchSim({
      id: "s",
      season: 1,
      matchday: 1,
      home: structuredClone(base),
      away: opp,
      homeTactic: "balanced",
      awayTactic: "balanced",
      homeShape: shape,
      awayShape: "sweeper",
      seed: hashSeed("shape", shape, kind, i),
    });
    if (manDown) sim.sides[0].bin.set(sim.sides[0].field[1].id, 99999);
    sim.runToEnd();
    total += sim.sides[1].score;
  }
  return total / n;
}

describe("defensive shapes", () => {
  it("each shape has a trade-off: none is best against every attack, full strength or a man down", () => {
    const rows: Record<string, number> = {};
    for (const manDown of [false, true]) {
      for (const kind of ["neutral", "winger", "forwards"] as const) {
        for (const s of SHAPE_IDS) rows[`${manDown ? "4v5" : "5v5"} ${kind} ${s}`] = +conceded(s, kind, manDown).toFixed(1);
      }
    }
    console.table(
      ["5v5", "4v5"].flatMap((m) =>
        (["neutral", "winger", "forwards"] as const).map((k) => ({ case: `${m} vs ${k}`, sweeper: rows[`${m} ${k} sweeper`], flat: rows[`${m} ${k} flat`], narrow: rows[`${m} ${k} narrow`] })),
      ),
    );
    // Lower is better. A shape that wins every row would make the choice pointless.
    const best = (m: string, k: string) => SHAPE_IDS.reduce((a, b) => (rows[`${m} ${k} ${b}`] < rows[`${m} ${k} ${a}`] ? b : a));
    const winners = new Set<ShapeId>();
    for (const m of ["5v5", "4v5"]) for (const k of ["neutral", "winger", "forwards"]) winners.add(best(m, k));
    expect(winners.size).toBeGreaterThanOrEqual(2);
    // Each shape wins where it should: the sweeper against a fast winger, the flat line against
    // power runners (most of all a man down), and the flat line loses badly to the winger.
    expect(rows["5v5 winger flat"]).toBeGreaterThan(rows["5v5 winger sweeper"]);
    expect(rows["4v5 forwards flat"]).toBeLessThan(rows["4v5 forwards sweeper"] - 1);
  }, 120000);

  it("a man down costs points whatever the shape", () => {
    for (const s of SHAPE_IDS) expect(conceded(s, "neutral", true, 300)).toBeGreaterThan(conceded(s, "neutral", false, 300));
  }, 60000);

  it("scouting advice matches the attack", () => {
    const pick = (kind: "neutral" | "winger" | "forwards") => adviseShape(attack(kind).lineup.map((id) => attack(kind).players.find((p) => p.id === id)!)).best;
    expect(pick("winger")).toBe("sweeper");
    expect(pick("forwards")).toBe("flat");
    expect(SHAPES[pick("neutral")]).toBeDefined();
  });
});
