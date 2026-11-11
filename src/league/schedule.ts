export interface Fixture {
  id: string;
  matchday: number;
  homeId: string;
  awayId: string;
  result?: { homeScore: number; awayScore: number; homeTries: number; awayTries: number };
}

/** Double round-robin using the circle method: 2 * (n - 1) matchdays. */
export function buildSchedule(teamIds: string[], season: number): Fixture[] {
  if (teamIds.length < 2 || teamIds.length % 2 !== 0) throw new Error("Need an even number of teams");
  const n = teamIds.length;
  const ring = [...teamIds];
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i];
      const b = ring[n - 1 - i];
      // Alternate venues so nobody gets long home/away streaks.
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    ring.splice(1, 0, ring.pop() as string);
  }
  const all = [...rounds, ...rounds.map((rd) => rd.map(([h, a]) => [a, h] as [string, string]))];
  const fixtures: Fixture[] = [];
  all.forEach((round, idx) => {
    const matchday = idx + 1;
    round.forEach(([homeId, awayId], i) => {
      fixtures.push({ id: `s${season}-md${String(matchday).padStart(2, "0")}-${i + 1}`, matchday, homeId, awayId });
    });
  });
  return fixtures;
}
