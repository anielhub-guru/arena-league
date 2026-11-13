import { Rng, hashSeed } from "../engine/rng";
import { ATTRS, ROLES } from "../engine/types";
import type { Attr, Gender, Player, Role, TacticId, Team } from "../engine/types";

interface TeamDef {
  id: string;
  name: string;
  short: string;
  strength: number;
  style: TacticId;
  /** Club colour, used for the pressure bar, scoreboard and arena dots. */
  color: string;
}

export const TEAM_DEFS: TeamDef[] = [
  { id: "ash", name: "Abuja Wardens", short: "ABJ", strength: 64, style: "balanced", color: "#e3cf7a" },
  { id: "bla", name: "Benin Reavers", short: "BEN", strength: 67, style: "attacking", color: "#f0897a" },
  { id: "cre", name: "Calabar Herons", short: "CAL", strength: 60, style: "territory", color: "#b7a4e0" },
  { id: "dun", name: "Kano Ironclads", short: "KAN", strength: 69, style: "defensive", color: "#b8c7c0" },
  { id: "eas", name: "Enugu Stags", short: "ENU", strength: 62, style: "balanced", color: "#8fe3a6" },
  { id: "fen", name: "Jos Forge", short: "JOS", strength: 58, style: "attacking", color: "#f0b35a" },
  { id: "gra", name: "Lagos Corsairs", short: "LAG", strength: 65, style: "territory", color: "#7fb6e0" },
  { id: "hig", name: "Ibadan Vanguard", short: "IBA", strength: 61, style: "defensive", color: "#e58fb4" },
];

const PROSPECT_CENTRE = 63;

/** Club colour by team id (falls back to the old home/away colours). */
export const teamColor = (id: string, fallback = "#8fe3a6") => TEAM_DEFS.find((d) => d.id === id)?.color ?? fallback;

const FIRST_MEN = ["Emeka", "Tunde", "Chidi", "Ibrahim", "Segun", "Kelechi", "Obinna", "Femi", "Musa", "Damilola", "Chinedu", "Yusuf", "Babatunde", "Ikenna", "Abubakar", "Olumide", "Nnamdi", "Sani", "Tobenna", "Kayode", "Uche", "Adebayo", "Ifeanyi", "Bello"];
const FIRST_WOMEN = ["Ngozi", "Amaka", "Funmi", "Aisha", "Chioma", "Blessing", "Folake", "Zainab", "Adaeze", "Temitope", "Ifeoma", "Hauwa", "Yetunde", "Nkechi", "Bukola", "Fatima", "Chiamaka", "Omolara", "Halima", "Titilayo", "Ebere", "Sade", "Kehinde", "Amina"];
const LAST = ["Okafor", "Adeyemi", "Balogun", "Eze", "Abubakar", "Okonkwo", "Ogunleye", "Nwosu", "Lawal", "Obi", "Adebisi", "Ibrahim", "Chukwu", "Olawale", "Danjuma", "Uzoma", "Afolabi", "Musa", "Nwachukwu", "Bankole", "Ajayi", "Onyeka", "Salisu", "Oyelaran"];

/** Squad of eight: the first five are the default starters, the last three the bench. */
const SQUAD_ROLES: Role[] = [...ROLES, "Bruiser", "Winger", "Pivot"];

const ROLE_BIAS: Record<Role, Partial<Record<Attr, number>>> = {
  Anchor: { power: 10, tackling: 6, pace: -8 },
  Bruiser: { power: 8, tackling: 4, handling: -2 },
  Pivot: { handling: 8, kicking: 14, power: -8 },
  Winger: { pace: 14, handling: 2, tackling: -8 },
  Sweeper: { tackling: 10, pace: 4, kicking: 2, power: -2 },
};

const clampRating = (v: number) => Math.max(30, Math.min(95, Math.round(v)));

function buildPlayer(rng: Rng, id: string, name: string, role: Role, age: number, base: number): Player {
  const p: Player = { id, name, role, age, power: 0, pace: 0, handling: 0, tackling: 0, kicking: 0, stamina: 0 };
  for (const a of ATTRS) p[a] = clampRating(base + (ROLE_BIAS[role][a] ?? 0) + rng.int(-8, 8));
  return p;
}

/** Potential for a player who already exists: young players have headroom, veterans have none. */
export function initialPotential(p: Player, rng: Rng): number {
  return clampRating(overall(p) + Math.max(0, Math.round((27 - p.age) * 1.6)) + rng.int(0, 4));
}

/** 1 to 5 stars for a potential (or scouted potential) value. */
export const potentialStars = (v: number) => Math.max(1, Math.min(5, Math.round((v - 48) / 7)));

/**
 * Clubs (names, styles, strength tiers) are fixed. Players are generated from the seed, so every
 * new game has different squads. The men's and women's leagues share the clubs but not the players.
 */
export function generateTeams(seed: number, gender: Gender = "men"): Team[] {
  return TEAM_DEFS.map((def) => {
    const rng = new Rng(hashSeed(seed, def.id, gender));
    const firstNames = gender === "women" ? FIRST_WOMEN : FIRST_MEN;
    const used = new Set<string>();
    const players: Player[] = SQUAD_ROLES.map((role, i) => {
      let name: string;
      do {
        name = `${rng.pick(firstNames)} ${rng.pick(LAST)}`;
      } while (used.has(name));
      used.add(name);
      const p = buildPlayer(rng, `${def.id}-${i + 1}`, name, role, rng.int(20, 34), def.strength - (i >= 5 ? 5 : 0));
      p.potential = initialPotential(p, new Rng(hashSeed(seed, p.id, "pot")));
      return p;
    });
    return { id: def.id, gender, name: def.name, short: def.short, style: def.style, players, lineup: players.slice(0, 5).map((p) => p.id) };
  });
}

/** Chance a player retires at the end of the season in which they reach this age. */
export const retireChance = (age: number) => (age <= 30 ? 0 : age === 31 ? 0.1 : age === 32 ? 0.25 : age === 33 ? 0.45 : age === 34 ? 0.7 : 1);

/**
 * Offseason: everyone ages. Youngsters grow toward their potential, veterans fade and lose potential.
 * Returns the players who retire, by club id. They are not removed here.
 */
export function evolvePlayers(teams: Team[], seed: number): Map<string, Player[]> {
  const retired = new Map<string, Player[]>();
  for (const t of teams) {
    const rng = new Rng(hashSeed(seed, t.id, "evolve"));
    for (const p of t.players) {
      p.age++;
      p.potential ??= initialPotential(p, rng);
      if (p.age <= 27) {
        const gap = p.potential - overall(p);
        const gain = gap > 0 ? Math.max(0, Math.min(6, Math.round(gap / (p.age <= 22 ? 2.2 : 3.5) + rng.int(-1, 1)))) : 0;
        for (const a of ATTRS) p[a] = clampRating(p[a] + gain + rng.int(-1, 1));
      } else if (p.age >= 31) {
        p.potential = Math.max(30, p.potential - 2);
        for (const a of ATTRS) p[a] = clampRating(p[a] - 2 + (a === "pace" ? -1 : 0) + rng.int(-2, 2));
      } else {
        for (const a of ATTRS) p[a] = clampRating(p[a] + rng.int(-1, 1));
      }
      if (rng.chance(retireChance(p.age))) retired.set(t.id, [...(retired.get(t.id) ?? []), p]);
    }
  }
  return retired;
}

/** Young prospects for a vacancy. Their true potential is hidden behind a noisy `scouted` value. */
export function makeProspects(team: Team, slotKey: string, role: Role, seed: number, count = 3): Player[] {
  const def = TEAM_DEFS.find((d) => d.id === team.id);
  const strength = def?.strength ?? 62;
  const firstNames = team.gender === "women" ? FIRST_WOMEN : FIRST_MEN;
  const taken = new Set(team.players.map((p) => p.name));
  return Array.from({ length: count }, (_, k) => {
    const rng = new Rng(hashSeed(seed, team.id, "prospect", slotKey, k));
    let name: string;
    do {
      name = `${rng.pick(firstNames)} ${rng.pick(LAST)}`;
    } while (taken.has(name));
    taken.add(name);
    // Club tiers matter less for new talent than for the founding squads, so dynasties rise and fall.
    const potential = clampRating(PROSPECT_CENTRE + (strength - PROSPECT_CENTRE) * 0.4 + rng.int(-6, 10));
    const p = buildPlayer(rng, `${team.id}-p${slotKey}-${k + 1}`, name, role, rng.int(17, 19), potential - rng.int(14, 20));
    p.potential = potential;
    p.scouted = clampRating(potential + rng.int(-6, 6));
    return p;
  });
}

export function overall(p: Player): number {
  return Math.round((p.power + p.pace + p.handling + p.tackling + p.kicking + p.stamina) / 6);
}

/** The club's internal goal, flavour only: first season: its strength rank among the league's clubs; later seasons: your last finish. */
export function clubObjective(clubId: string, lastFinish?: number): string {
  if (lastFinish) {
    // After the first season the goal follows your last finish: hold the title, chase the one above, or climb.
    if (lastFinish <= 1) return "Defend the title";
    if (lastFinish === 2) return "Win the league";
    if (lastFinish >= TEAM_DEFS.length) return "Climb off the bottom";
    return `Finish in the top ${lastFinish - 1}`;
  }
  const order = TEAM_DEFS.map((d, i) => ({ id: d.id, strength: d.strength, i })).sort((a, b) => b.strength - a.strength || a.i - b.i);
  const rank = order.findIndex((d) => d.id === clubId);
  if (rank < 0) return "";
  const n = order.length;
  if (rank < n / 4) return "Win the league";
  if (rank < n / 2) return "Finish in the top half";
  if (rank < (n * 3) / 4) return "Finish in the top six";
  return "Avoid finishing bottom";
}

export function teamRating(t: Team): number {
  const starters = t.lineup.map((id) => t.players.find((p) => p.id === id)!);
  return Math.round(starters.reduce((s, p) => s + overall(p), 0) / starters.length);
}
