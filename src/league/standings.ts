import type { Fixture } from "./schedule";

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  triesFor: number;
  bonus: number;
  points: number;
}

/** Win 4, draw 2, +1 for 3+ tries, +1 for losing by 7 or fewer. */
export function computeStandings(teamIds: string[], fixtures: Fixture[]): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    teamIds.map((id) => [id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, triesFor: 0, bonus: 0, points: 0 }]),
  );
  for (const f of fixtures) {
    if (!f.result) continue;
    const { homeScore, awayScore, homeTries, awayTries } = f.result;
    const sides: [StandingRow, number, number, number][] = [
      [rows.get(f.homeId)!, homeScore, awayScore, homeTries],
      [rows.get(f.awayId)!, awayScore, homeScore, awayTries],
    ];
    for (const [row, pf, pa, tries] of sides) {
      row.played++;
      row.pointsFor += pf;
      row.pointsAgainst += pa;
      row.triesFor += tries;
      if (pf > pa) {
        row.won++;
        row.points += 4;
      } else if (pf === pa) {
        row.drawn++;
        row.points += 2;
      } else {
        row.lost++;
        if (pa - pf <= 7) {
          row.bonus++;
          row.points++;
        }
      }
      if (tries >= 3) {
        row.bonus++;
        row.points++;
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      b.pointsFor - a.pointsFor ||
      a.teamId.localeCompare(b.teamId),
  );
}

/** Table as it stood after the given matchday. */
export function standingsAt(teamIds: string[], fixtures: Fixture[], matchday: number): StandingRow[] {
  return computeStandings(teamIds, fixtures.filter((f) => f.matchday <= matchday));
}

export type FormResult = "W" | "D" | "L";

/** Last n results for a club, oldest first. */
export function teamForm(fixtures: Fixture[], teamId: string, n = 5): FormResult[] {
  return fixtures
    .filter((f) => f.result && (f.homeId === teamId || f.awayId === teamId))
    .sort((a, b) => a.matchday - b.matchday)
    .slice(-n)
    .map((f) => {
      const mine = f.homeId === teamId ? f.result!.homeScore : f.result!.awayScore;
      const theirs = f.homeId === teamId ? f.result!.awayScore : f.result!.homeScore;
      return mine > theirs ? "W" : mine === theirs ? "D" : "L";
    });
}

/** Highest matchday with results, or 0. */
export function lastPlayedMatchday(fixtures: Fixture[]): number {
  return fixtures.reduce((m, f) => (f.result ? Math.max(m, f.matchday) : m), 0);
}
