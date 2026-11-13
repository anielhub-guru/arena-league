import { describe, expect, it } from "vitest";
import { headToHead, recordMeeting, rivalOf, type Rivalry } from "../src/league/rivals";
import { autoPlan, buildSim, completeOffseason, isSeasonOver, newGame, playMatchday, startNextSeason, type SeasonState } from "../src/league/season";

describe("rivalry records", () => {
  it("counts results from either side and tracks streaks", () => {
    const r: Rivalry = {};
    recordMeeting(r, "a", "b", 10, 3);
    recordMeeting(r, "b", "a", 5, 12);
    recordMeeting(r, "a", "b", 7, 7);
    expect(headToHead(r, "a", "b")).toMatchObject({ w: 2, d: 1, l: 0 });
    expect(headToHead(r, "b", "a")).toMatchObject({ w: 0, d: 1, l: 2 });
    expect(r["a|b"].close).toBe(3);
    expect(r["a|b"].streak).toBe(0);
  });
  it("needs three meetings, then picks the hottest opponent", () => {
    const r: Rivalry = {};
    recordMeeting(r, "me", "x", 10, 9);
    recordMeeting(r, "me", "x", 10, 9);
    expect(rivalOf(r, "me")).toBeUndefined();
    recordMeeting(r, "x", "me", 9, 10);
    recordMeeting(r, "me", "y", 30, 0);
    recordMeeting(r, "me", "y", 30, 0);
    recordMeeting(r, "me", "y", 30, 0);
    expect(rivalOf(r, "me")).toBe("x");
  });
});

describe("rivals in play", () => {
  it("adds a rivalry line to the commentary only once a rival exists, without changing the result", () => {
    let s: SeasonState = newGame(11, "ash");
    while (!isSeasonOver(s)) s = playMatchday(s).state;
    s = startNextSeason(s);
    if (s.offers) s = { ...s, offers: undefined };
    s = completeOffseason(s, autoPlan(s));
    while (!isSeasonOver(s)) s = playMatchday(s).state;
    const rival = rivalOf(s.rivalry, "ash");
    expect(rival).toBeDefined();
    const fx = { id: "t", matchday: 1, homeId: "ash", awayId: rival! };
    const withRival = buildSim(s, fx).runToEnd().toLog();
    const without = buildSim({ ...s, rivalry: {} }, fx).runToEnd().toLog();
    expect(withRival.homeScore).toBe(without.homeScore);
    expect(withRival.awayScore).toBe(without.awayScore);
    expect(withRival.events[0].text).toContain("rivalry game");
    expect(without.events[0].text).not.toContain("rivalry");
    expect(withRival.events.at(-1)!.text).toMatch(/Bragging rights|rivals|Nothing settled/);
  });
});
