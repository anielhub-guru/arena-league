import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateTeams } from "../src/league/teams";
import { simulateMatch } from "../src/engine/match";
import { HAIR } from "../src/league/look";
import { CHANCE, LAB_HAIR, STORY } from "../src/cutaways/data";
import { kindsFor } from "../src/cutaways";

const art = (name: string) => existsSync(new URL(`../src/cutaways/art/${name}.webp`, import.meta.url));

describe("illustrated cutaways", () => {
  it("has artwork for every kind, pose and lab hairstyle", () => {
    expect(art("sprite")).toBe(true);
    for (const [kind, spec] of Object.entries(STORY)) {
      for (const pose of kind === "grounding" ? [0, 1, 2] : [0]) {
        for (let hair = 0; hair <= 4; hair++) expect(art(`${spec.art(pose)}-${hair}`), `${kind} pose ${pose} hair ${hair}`).toBe(true);
      }
    }
  });

  it("maps every game hairstyle to a lab hairstyle", () => {
    expect(LAB_HAIR).toHaveLength(HAIR.length);
    for (const h of LAB_HAIR) expect(h >= 0 && h <= 4).toBe(true);
  });

  it("every kind has odds between 0 and 1, and every event kind it picks exists", () => {
    for (const [kind, chance] of Object.entries(CHANCE)) {
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThanOrEqual(1);
      expect(kind === "bighit" || kind in STORY).toBe(true);
    }
  });

  it("suggests cutaways for real match events and never for plain play", () => {
    const [home, away] = generateTeams(7, "women");
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const log = simulateMatch({ id: `c${i}`, seed: 100 + i, season: 1, matchday: 1, home, away, homeTactic: "balanced", awayTactic: "balanced" });
      for (const ev of log.events) {
        const kinds = kindsFor(ev);
        kinds.forEach((k) => seen.add(k));
        if (["kickoff", "halftime", "fulltime", "sub", "talk", "conversion", "penalty-goal"].includes(ev.type)) expect(kinds).toEqual([]);
      }
    }
    expect(seen.size).toBeGreaterThan(2);
    for (const k of seen) expect(CHANCE).toHaveProperty(k);
  });
});
