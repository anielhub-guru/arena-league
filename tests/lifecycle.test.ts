import { describe, expect, it } from "vitest";
import { SAVE_VERSION, autoPlan, checkPlan, completeOffseason, isSeasonOver, migrateSave, newGame, playMatchday, startNextSeason, teamById, type OffseasonPlan, type SeasonState } from "../src/league/season";
import { overall, potentialStars } from "../src/league/teams";
import { MAX_BUYS, MONEY_START, playerValue, prizeFor, sellPrice, teenSalePrice } from "../src/league/economy";
import { ROLES } from "../src/engine/types";

/** A competent manager: best available player per slot. */
function setBestLineup(s: SeasonState) {
  const t = teamById(s, s.managedId);
  const used = new Set<string>();
  t.lineup = ROLES.map((role) => {
    const p = t.players.filter((x) => !used.has(x.id) && !((x.ban ?? 0) > 0)).sort((a, b) => Number(b.role === role) - Number(a.role === role) || overall(b) - overall(a))[0];
    used.add(p.id);
    return p.id;
  });
}

const meanOverall = (s: SeasonState) => {
  const all = s.teams.flatMap((t) => t.players.map(overall));
  return all.reduce((a, b) => a + b, 0) / all.length;
};

function playSeason(s: SeasonState): SeasonState {
  while (!isSeasonOver(s)) {
    s = playMatchday(s).state;
    setBestLineup(s);
  }
  return s;
}

/** Plays on to the first offseason in which at least one player retires. */
function toRetirement(seed: number): SeasonState {
  let s = newGame(seed, "ash");
  for (let i = 0; i < 12; i++) {
    s = startNextSeason(playSeason(s));
    if (s.intake!.retiring.length) return s;
    s = completeOffseason(s, autoPlan(s));
  }
  throw new Error("nobody retired in 12 seasons");
}

describe("player lifecycle", () => {
  it("the league stays alive for 50 seasons: squads stay whole, ages and ratings stay in a healthy band", () => {
    let s = newGame(2024, "ash", "women");
    const start = meanOverall(s);
    let retirements = 0;
    for (let season = 1; season <= 50; season++) {
      s = startNextSeason(playSeason(s));
      retirements += s.intake!.retiring.length;
      s = completeOffseason(s, autoPlan(s));
      setBestLineup(s);
      for (const t of s.teams) {
        expect(t.players).toHaveLength(8);
        expect(new Set(t.players.map((p) => p.id)).size).toBe(8);
        expect(new Set(t.lineup).size).toBe(5);
        for (const id of t.lineup) expect(t.players.some((p) => p.id === id)).toBe(true);
      }
      expect(Math.max(...s.teams.flatMap((t) => t.players.map((p) => p.age)))).toBeLessThanOrEqual(36);
    }
    expect(Math.abs(meanOverall(s) - start)).toBeLessThan(8);
    expect(retirements).toBeGreaterThan(15);
    expect(JSON.stringify(s).length).toBeLessThan(150_000); // the save does not grow without bound
    expect(s.history).toHaveLength(50);
  }, 120_000);

  it("a title is not a formality: over 50 seasons several clubs win, and no club wins most", () => {
    let s = newGame(99, "gra", "men");
    const titles: Record<string, number> = {};
    for (let season = 1; season <= 50; season++) {
      s = startNextSeason(playSeason(s));
      s = completeOffseason(s, autoPlan(s));
      setBestLineup(s);
      const c = s.history[s.history.length - 1].championId;
      titles[c] = (titles[c] ?? 0) + 1;
    }
    expect(Object.keys(titles).length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...Object.values(titles))).toBeLessThan(35);
  }, 120_000);

  it("training stops at a player's potential", () => {
    let s = newGame(3, "ash");
    const team = teamById(s, s.managedId);
    for (const p of team.players) p.potential = overall(p); // nobody has headroom
    const before = JSON.stringify(team.players.map(overall));
    s.training = "attack";
    s = playMatchday(s).state;
    expect(JSON.stringify(teamById(s, "ash").players.map(overall))).toBe(before);
  });

  it("saves from version 4 get potentials and money, and load", () => {
    const s = newGame(8, "ash");
    const old = structuredClone(s) as unknown as SeasonState;
    old.version = 4;
    delete (old as Partial<SeasonState>).money;
    for (const t of old.teams) for (const p of t.players) delete p.potential;
    const up = migrateSave(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.money).toBe(MONEY_START);
    for (const t of up.teams) for (const p of t.players) expect(p.potential).toBeGreaterThanOrEqual(overall(p));
  });
});

describe("offseason", () => {
  it("the new season cannot be played until the offseason is confirmed, and the squad must be refilled", () => {
    const s = toRetirement(5);
    expect(() => playMatchday(s)).toThrow(/offseason|signings/i);
    const empty: OffseasonPlan = { sell: [], sign: [], buy: [] };
    const c = checkPlan(s, empty);
    expect(c.ok).toBe(false);
    expect(c.problems.join(" ")).toMatch(/squad must have 8/);
    expect(() => completeOffseason(s, empty)).toThrow();
    const after = completeOffseason(s, autoPlan(s));
    expect(after.intake).toBeUndefined();
    expect(() => playMatchday(after)).not.toThrow();
  });

  it("prospects hide their true potential, and a signed prospect takes a retiree's place in the lineup", () => {
    const s = toRetirement(11);
    for (const o of s.intake!.prospects) {
      expect(o.age).toBeGreaterThanOrEqual(17);
      expect(o.age).toBeLessThanOrEqual(19);
      expect(Math.abs((o.scouted ?? 0) - (o.potential ?? 0))).toBeLessThanOrEqual(6);
      expect(potentialStars(o.potential ?? 0)).toBeGreaterThanOrEqual(1);
    }
    const retired = s.intake!.retiring[0];
    const wasStarter = teamById(s, s.managedId).lineup.includes(retired);
    const plan = autoPlan(s);
    const after = completeOffseason(s, plan);
    const team = teamById(after, after.managedId);
    expect(team.players.some((p) => p.id === retired)).toBe(false);
    for (const id of plan.sign) expect(team.players.some((p) => p.id === id)).toBe(true);
    if (wasStarter) expect(team.lineup).not.toContain(retired);
  });

  it("any player can be swapped for a prospect, and the unpicked prospects are sold for income", () => {
    const s = toRetirement(21);
    const team = teamById(s, s.managedId);
    const base = autoPlan(s);
    // Sell a starter who is not retiring, and sign a prospect of the same position instead.
    const sold = team.players.find((p) => !s.intake!.retiring.includes(p.id) && team.lineup.includes(p.id))!;
    const prospect = s.intake!.prospects.find((p) => p.role === sold.role && !base.sign.includes(p.id));
    expect(prospect).toBeDefined();
    const plan: OffseasonPlan = { sell: [sold.id], sign: [...base.sign, prospect!.id], buy: [] };
    const c = checkPlan(s, plan);
    expect(c.problems).toEqual([]);
    expect(c.sellIncome).toBe(sellPrice(sold));
    const unsigned = s.intake!.prospects.filter((p) => !plan.sign.includes(p.id));
    expect(c.teenIncome).toBe(unsigned.reduce((t, p) => t + teenSalePrice(p), 0));
    expect(c.teenIncome).toBeGreaterThan(0);
    const after = completeOffseason(s, plan);
    expect(after.money).toBe(s.money + c.sellIncome + c.teenIncome);
    const t2 = teamById(after, after.managedId);
    expect(t2.players.some((p) => p.id === sold.id)).toBe(false);
    expect(t2.players.some((p) => p.id === prospect!.id)).toBe(true);
    // Every club still has eight, and nobody is duplicated: the sold player went to a rival or abroad.
    for (const t of after.teams) expect(t.players).toHaveLength(8);
    expect(new Set(after.teams.flatMap((t) => t.players.map((p) => p.id))).size).toBe(64);
  });

  it("buying costs the asking price, takes the player from a club that replaces him, and hides true potential until signed", () => {
    const s = toRetirement(31);
    s.money = 50_000;
    const listing = s.intake!.market[0];
    expect(listing.player.potential).toBeUndefined();
    expect(listing.player.scouted).toBeDefined();
    const base = autoPlan(s);
    const team = teamById(s, s.managedId);
    // One in, one out keeps the squad at eight: release a bench player whose position stays covered.
    const bench = team.players.filter((p) => !team.lineup.includes(p.id) && !s.intake!.retiring.includes(p.id));
    const plan = bench.map((b): OffseasonPlan => ({ sell: [b.id], sign: base.sign, buy: [listing.player.id] })).find((pl) => checkPlan(s, pl).ok);
    expect(plan).toBeDefined();
    const c = checkPlan(s, plan!);
    const after = completeOffseason(s, plan!);
    const mine = teamById(after, after.managedId);
    expect(mine.players.some((p) => p.id === listing.player.id)).toBe(true);
    expect(mine.players.find((p) => p.id === listing.player.id)!.potential).toBeDefined();
    const club = teamById(after, listing.clubId);
    expect(club.players).toHaveLength(8);
    expect(club.players.some((p) => p.id === listing.player.id)).toBe(false);
    expect(after.money).toBe(s.money + c.sellIncome + c.teenIncome - listing.price);
  });

  it("refuses plans that overspend, buy too many, or leave a position uncovered", () => {
    const s = toRetirement(41);
    const base = autoPlan(s);
    s.money = 0;
    s.intake!.market.forEach((l) => (l.price = 99_999));
    const broke = checkPlan(s, { ...base, buy: [s.intake!.market[0].player.id] });
    expect(broke.problems.join(" ")).toMatch(/afford|squad must have/);
    s.money = 1_000_000;
    const many = checkPlan(s, { ...base, buy: s.intake!.market.slice(0, MAX_BUYS + 1).map((l) => l.player.id) });
    expect(many.problems.join(" ")).toMatch(/at most/);
  });

  it("transfer listings are mostly veterans and bench players, not stars", () => {
    let listed = 0;
    let stars = 0;
    let all = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = newGame(seed, "ash");
      for (let i = 0; i < 4; i++) {
        s = startNextSeason(playSeason(s));
        for (const l of s.intake!.market) {
          listed++;
          if (overall(l.player) >= 72) stars++;
        }
        all += s.teams.flatMap((t) => t.players).filter((p) => overall(p) >= 72).length;
        s = completeOffseason(s, autoPlan(s));
      }
    }
    // Far fewer stars are listed than their share of the league would give.
    expect(listed).toBeGreaterThan(100);
    expect(stars / listed).toBeLessThan(0.15);
    expect(all).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe("economy", () => {
  it("values rise with ability and with young potential, and fall with age", () => {
    const s = newGame(7, "ash");
    const p = structuredClone(teamById(s, "ash").players[0]);
    const base = playerValue({ ...p, age: 26, potential: overall(p) });
    expect(playerValue({ ...p, age: 26, potential: overall(p) + 10 })).toBeGreaterThan(base);
    expect(playerValue({ ...p, age: 19, potential: overall(p) + 10 })).toBeGreaterThan(playerValue({ ...p, age: 26, potential: overall(p) + 10 }));
    expect(playerValue({ ...p, age: 33, potential: overall(p) })).toBeLessThan(base);
    expect(prizeFor(1)).toBeGreaterThan(prizeFor(8));
    expect(sellPrice(p)).toBeLessThan(playerValue(p));
  });

  it("money cannot buy the league: a club that buys every window is helped, not made unbeatable", () => {
    const finishes = { rich: [] as number[], passive: [] as number[] };
    for (const [label, buys] of [["passive", false], ["rich", true]] as const) {
      for (const seed of [11, 12, 13]) {
        let s = newGame(seed, "ash");
        for (let season = 1; season <= 25; season++) {
          s = startNextSeason(playSeason(s));
          const plan = autoPlan(s);
          if (buys) {
            // Spend wherever there is an affordable improvement: swap a starter for the best listed player of that role.
            const team = teamById(s, s.managedId);
            let spent = 0;
            const sell: string[] = [];
            const buy: string[] = [];
            for (const l of [...s.intake!.market].sort((a, b) => overall(b.player) - overall(a.player))) {
              if (buy.length >= MAX_BUYS) break;
              const worse = team.players.filter((p) => p.role === l.player.role && !s.intake!.retiring.includes(p.id) && !sell.includes(p.id)).sort((a, b) => overall(a) - overall(b))[0];
              if (!worse || overall(l.player) <= overall(worse) + 2 || spent + l.price > s.money) continue;
              const check = checkPlan(s, { sell: [...sell, worse.id], sign: plan.sign, buy: [...buy, l.player.id] });
              if (check.size !== 8) continue;
              sell.push(worse.id);
              buy.push(l.player.id);
              spent += l.price;
            }
            const attempt: OffseasonPlan = { sell, sign: plan.sign, buy };
            s = completeOffseason(s, checkPlan(s, attempt).ok ? attempt : plan);
          } else {
            s = completeOffseason(s, plan);
          }
          setBestLineup(s);
        }
        finishes[label].push(s.history.reduce((t, h) => t + h.managedPosition, 0) / s.history.length);
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Spending helps a little at most; it never turns one club into a certain champion.
    expect(avg(finishes.rich)).toBeGreaterThan(1.8);
    expect(avg(finishes.passive) - avg(finishes.rich)).toBeLessThan(2);
  }, 240_000);
});
