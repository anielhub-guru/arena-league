/**
 * Rivalries. Every pair of clubs keeps a short record of how they have got on, and the
 * club you manage gets one rival: the opponent with the most history behind it. Games
 * are heated by how often you have met and how close they have been, and by a run of
 * wins for one side. Records carry across seasons, and across jobs.
 */
export interface PairRecord {
  /** Wins for the club whose id sorts first, wins for the other, and draws. */
  w: [number, number];
  d: number;
  /** Games decided by one try or less. */
  close: number;
  /** Club that won the latest game, or "draw". */
  last?: string;
  /** Consecutive wins by `last`. Zero after a draw. */
  streak: number;
}

export type Rivalry = Record<string, PairRecord>;

/** Meetings needed before a pair can be called a rivalry. */
export const RIVAL_MIN_MEETINGS = 3;
/** Margin, in points, at or under which a game counts as close. */
const CLOSE_MARGIN = 7;

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const meetings = (r: PairRecord) => r.w[0] + r.w[1] + r.d;

/** Adds one finished game to the record. Mutates `rivalry`. */
export function recordMeeting(rivalry: Rivalry, homeId: string, awayId: string, homeScore: number, awayScore: number) {
  const key = pairKey(homeId, awayId);
  const r = (rivalry[key] ??= { w: [0, 0], d: 0, close: 0, streak: 0 });
  const winner = homeScore === awayScore ? undefined : homeScore > awayScore ? homeId : awayId;
  if (!winner) r.d++;
  else r.w[winner === key.split("|")[0] ? 0 : 1]++;
  if (Math.abs(homeScore - awayScore) <= CLOSE_MARGIN) r.close++;
  const now = winner ?? "draw";
  r.streak = winner && r.last === winner ? r.streak + 1 : winner ? 1 : 0;
  r.last = now;
}

const heat = (r: PairRecord) => meetings(r) + 2 * r.close + (r.streak >= 3 ? 2 : 0);

/** The club's rival, if the history is deep enough. Ties go to the earlier id so it never flickers. */
export function rivalOf(rivalry: Rivalry | undefined, clubId: string): string | undefined {
  let best: { id: string; h: number } | undefined;
  for (const [key, r] of Object.entries(rivalry ?? {})) {
    const [a, b] = key.split("|");
    if (a !== clubId && b !== clubId) continue;
    if (meetings(r) < RIVAL_MIN_MEETINGS) continue;
    const id = a === clubId ? b : a;
    const h = heat(r);
    if (!best || h > best.h || (h === best.h && id < best.id)) best = { id, h };
  }
  return best?.id;
}

/** Wins, draws and losses from `clubId`'s point of view against `otherId`. */
export function headToHead(rivalry: Rivalry | undefined, clubId: string, otherId: string) {
  const r = rivalry?.[pairKey(clubId, otherId)];
  if (!r) return { w: 0, d: 0, l: 0, streak: 0, streakBy: undefined as string | undefined };
  const first = pairKey(clubId, otherId).split("|")[0] === clubId;
  return {
    w: r.w[first ? 0 : 1],
    d: r.d,
    l: r.w[first ? 1 : 0],
    streak: r.streak,
    streakBy: r.last && r.last !== "draw" ? r.last : undefined,
  };
}

/** Extra lines for the commentary and news, written from the manager's side. */
export interface RivalNotes {
  /** Added to the kick-off line. */
  kickoff: string;
  /** Added to the full-time line by who won: "win", "draw" or "loss" for the managed club. */
  fulltime: { win: string; draw: string; loss: string };
  /** Passed into the engine so it knows which side is the manager's. */
  managedIsHome: boolean;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What the commentary should say about a rival fixture, from the record before the game. */
export function rivalNotes(rivalry: Rivalry | undefined, managedId: string, rivalId: string, rivalName: string, managedIsHome: boolean): RivalNotes {
  const h = headToHead(rivalry, managedId, rivalId);
  const rec = `${plural(h.w, "win")}, ${plural(h.d, "draw")} and ${plural(h.l, "defeat")} so far`;
  let story = `${rec}.`;
  if (h.streak >= 2 && h.streakBy === managedId) story = `${rec}, and you have won the last ${h.streak}.`;
  else if (h.streak >= 2 && h.streakBy === rivalId) story = `${rec}, and ${rivalName} have won the last ${h.streak}.`;
  return {
    kickoff: `This is a rivalry game. ${story}`,
    fulltime: {
      win: h.streakBy === rivalId && h.streak >= 2 ? "The run is broken, and the rivalry swings back" : "Bragging rights are yours",
      draw: "Nothing settled between these two",
      loss: h.streakBy === rivalId && h.streak >= 2 ? "That is another one for the rivals" : "The rivals take the bragging rights",
    },
    managedIsHome,
  };
}
