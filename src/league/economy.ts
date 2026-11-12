import type { Player } from "../engine/types";
import { overall } from "./teams";

/**
 * Money is counted in thousands of naira. Only the manager's club has a bank balance: the AI clubs are
 * balanced by design, so nobody wins the league just by being rich. The ways money matters are
 * generous: prize money by finishing position, match winnings, selling teenagers you do not keep, and a
 * wage bill that grows with squad quality. A well-run club can get rich, and that is part of the game. What
 * stops money deciding the league is the market, not the budget: few listed players, at most MAX_BUYS signings
 * a window, prices that follow true value, and potential you can only estimate.
 */
export const MONEY_START = 4000;
/** Market signings allowed in one offseason. */
export const MAX_BUYS = 2;
/** What a club pays for a transfer-listed player you sell, compared with their value. */
export const SELL_RATE = 0.7;
/** What an unpicked teenager fetches, compared with their value: unproven, so a low rate. */
export const TEEN_RATE = 0.25;

/** Prize money by final league position (1st to 8th). */
export const PRIZES = [4500, 3600, 2800, 2200, 1700, 1300, 1000, 800];
/** Match winnings for the manager's club. */
export const MATCH_PAY = { win: 200, draw: 100, loss: 50 };
/** The wage bill is this share of the squad's current-ability value, paid each season. */
export const WAGE_RATE = 0.12;

const round10 = (v: number) => Math.round(v / 10) * 10;

/** What a player is worth for what they can do now. */
export const currentValue = (p: Player) => 4 * Math.max(0, overall(p) - 40) ** 2;

/**
 * Transfer value in thousands: current ability, plus a premium for young players with headroom
 * (potential above their rating), discounted for age from 30.
 */
export function playerValue(p: Player, potential: number = p.potential ?? overall(p)): number {
  const youth = Math.max(0, 27 - p.age);
  const growth = Math.max(0, potential - overall(p)) * youth * 10;
  const ageFactor = p.age <= 29 ? 1 : Math.max(0.2, 1 - 0.17 * (p.age - 29));
  return round10((currentValue(p) + growth) * ageFactor);
}

export const sellPrice = (p: Player) => round10(playerValue(p) * SELL_RATE);
export const teenSalePrice = (p: Player) => round10(playerValue(p) * TEEN_RATE);
export const wageOf = (p: Player) => round10(currentValue(p) * WAGE_RATE);

export function prizeFor(position: number): number {
  return PRIZES[Math.min(Math.max(position, 1), PRIZES.length) - 1];
}

/** "₦1.9m", "₦450k", "-₦1.2m". */
export function fmtMoney(k: number): string {
  const sign = k < 0 ? "-" : "";
  const a = Math.abs(k);
  return a >= 1000 ? `${sign}₦${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}m` : `${sign}₦${a}k`;
}
