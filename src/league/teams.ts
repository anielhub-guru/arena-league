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
      const p: Player = { id: `${def.id}-${i + 1}`, name, role, age: rng.int(20, 34), power: 0, pace: 0, handling: 0, tackling: 0, kicking: 0, stamina: 0 };
      const base = def.strength - (i >= 5 ? 5 : 0);
      for (const a of ATTRS) p[a] = clampRating(base + (ROLE_BIAS[role][a] ?? 0) + rng.int(-8, 8));
      return p;
    });
    return { id: def.id, gender, name: def.name, short: def.short, style: def.style, players, lineup: players.slice(0, 5).map((p) => p.id) };
  });
}

/** Offseason: young players grow, veterans fade. */
export function evolvePlayers(teams: Team[], seed: number): void {
  for (const t of teams) {
    const rng = new Rng(hashSeed(seed, t.id, "evolve"));
    for (const p of t.players) {
      p.age++;
      const drift = p.age <= 24 ? 2 : p.age >= 31 ? -2 : 0;
      for (const a of ATTRS) {
        const bonus = a === "pace" && p.age >= 30 ? -1 : 0;
        p[a] = clampRating(p[a] + drift + bonus + rng.int(-3, 3));
      }
    }
  }
}

export function overall(p: Player): number {
  return Math.round((p.power + p.pace + p.handling + p.tackling + p.kicking + p.stamina) / 6);
}

export function teamRating(t: Team): number {
  const starters = t.lineup.map((id) => t.players.find((p) => p.id === id)!);
  return Math.round(starters.reduce((s, p) => s + overall(p), 0) / starters.length);
}
