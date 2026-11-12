import type { MatchLog, PlayerLine } from "../engine/types";

/** One-line description of a player's match for the news and the post-match panel. */
export function describeLine(l: PlayerLine): string {
  const bits: string[] = [];
  if (l.tries) bits.push(`${l.tries} ${l.tries === 1 ? "try" : "tries"}`);
  const kicks = l.conversions * 2 + l.penaltyGoals * 3 + l.dropGoals * 3;
  if (kicks) bits.push(`${kicks} from the boot`);
  if (l.lineBreaks) bits.push(`${l.lineBreaks} line ${l.lineBreaks === 1 ? "break" : "breaks"}`);
  if (l.tackles >= 4) bits.push(`${l.tackles} tackles`);
  if (l.turnovers) bits.push(`${l.turnovers} ${l.turnovers === 1 ? "turnover" : "turnovers"} won`);
  if (l.metres >= 30) bits.push(`${l.metres}m gained`);
  return bits.join(", ") || `${l.carries} carries, ${l.tackles} tackles`;
}

/** Roughly how much a player's match mattered, for picking the standout. */
export const impact = (l: PlayerLine) => l.points + l.tackles * 0.6 + l.metres / 15 + l.lineBreaks * 1.5 + l.turnovers * 2 - l.yellows * 2 - l.reds * 6;

type Result = "win" | "draw" | "loss";

/** What a player did, plus a small bonus for being on the winning side. */
const matchScore = (l: PlayerLine, r: Result) => impact(l) + (r === "win" ? 1.5 : r === "draw" ? 0.5 : 0);

/** A familiar 4.0 to 10.0 rating where about 6.0 is an average performance. */
export function matchRating(l: PlayerLine, r: Result): number {
  return Math.round(Math.min(10, Math.max(4, 5 + matchScore(l, r) * 0.17)) * 10) / 10;
}

export interface Rated {
  line: PlayerLine;
  rating: number;
  club: string;
}

function resultFor(log: MatchLog, team: 0 | 1): Result {
  const mine = team === 0 ? log.homeScore : log.awayScore;
  const theirs = team === 0 ? log.awayScore : log.homeScore;
  return mine > theirs ? "win" : mine === theirs ? "draw" : "loss";
}

/** Everyone who played, best first. Empty for logs saved before player stats existed. */
export function ratedPlayers(log: MatchLog): Rated[] {
  return (log.players ?? [])
    .map((line) => ({ line, rating: matchRating(line, resultFor(log, line.team)), score: matchScore(line, resultFor(log, line.team)), club: line.team === 0 ? log.homeName : log.awayName }))
    .sort((a, b) => b.score - a.score || b.line.metres - a.line.metres || a.line.name.localeCompare(b.line.name))
    .map(({ line, rating, club }) => ({ line, rating, club }));
}

/** The player of the match, or null if the log has no player stats. */
export function playerOfTheMatch(log: MatchLog): Rated | null {
  return ratedPlayers(log)[0] ?? null;
}

/** The best player on each side: [home, away]. */
export function teamBest(log: MatchLog): [Rated | null, Rated | null] {
  const all = ratedPlayers(log);
  return [all.find((r) => r.line.team === 0) ?? null, all.find((r) => r.line.team === 1) ?? null];
}
