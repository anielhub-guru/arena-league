import { describe, expect, it } from "vitest";
import { GOAL_BONUS, goalBonus, goalResult } from "../src/league/economy";

describe("goal bonus", () => {
  it("pays nothing for a miss, a bonus for meeting the goal and more for smashing it", () => {
    expect(goalResult(5, 4)).toBe("missed");
    expect(goalResult(4, 4)).toBe("met");
    expect(goalResult(3, 4)).toBe("met");
    expect(goalResult(2, 4)).toBe("smashed");
    expect(goalBonus("missed")).toBe(0);
    expect(goalBonus("smashed")).toBeGreaterThan(goalBonus("met"));
    expect(goalBonus("met")).toBe(GOAL_BONUS.met);
  });
  it("a title goal is smashed only by winning clear of second place", () => {
    expect(goalResult(1, 1, 2)).toBe("met");
    expect(goalResult(1, 1, 8)).toBe("smashed");
    expect(goalResult(2, 1, 0)).toBe("missed");
  });
});
