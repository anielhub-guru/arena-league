import { Rng, hashSeed } from "../engine/rng";
import { ATTRS, ROLES } from "../engine/types";
import type { Attr, Player, Role, TacticId, Team } from "../engine/types";

interface TeamDef {
  id: string;
  name: string;
  short: string;
  strength: number;
  style: TacticId;
}

export const TEAM_DEFS: TeamDef[] = [
  { id: "ash", name: "Ashford Wardens", short: "ASH", strength: 64, style: "balanced" },
  { id: "bla", name: "Blackmoor Reavers", short: "BLA", strength: 67, style: "attacking" },
  { id: "cre", name: "Crestfall Herons", short: "CRE", strength: 60, style: "territory" },
  { id: "dun", name: "Dunmere Ironclads", short: "DUN", strength: 69, style: "defensive" },
  { id: "eas", name: "Eastvale Stags", short: "EAS", strength: 62, style: "balanced" },
  { id: "fen", name: "Fenwick Forge", short: "FEN", strength: 58, style: "attacking" },
  { id: "gra", name: "Grayhaven Corsairs", short: "GRA", strength: 65, style: "territory" },
  { id: "hig", name: "Highcliff Vanguard", short: "HIG", strength: 61, style: "defensive" },
];

const FIRST = ["Tomas", "Rhys", "Callum", "Idris", "Mateo", "Jonah", "Kofi", "Ewan", "Dario", "Silas", "Niall", "Tobias", "Arlo", "Bram", "Cyrus", "Declan", "Felix", "Gideon", "Hamish", "Ivor", "Joss", "Kieran", "Lachlan", "Magnus"];
const LAST = ["Vance", "Okoro", "Hartley", "Brandt", "Castellan", "Moreau", "Ashdown", "Quill", "Rennick", "Sorrel", "Thackeray", "Underhill", "Voss", "Whitlock", "Yarrow", "Zeller", "Calloway", "Dunmore", "Ellery", "Fairbourne", "Garrick", "Holloway", "Imrie", "Keane"];

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

export function generateTeams(seed: number): Team[] {
  return TEAM_DEFS.map((def) => {
    const rng = new Rng(hashSeed(seed, def.id));
    const used = new Set<string>();
    const players: Player[] = SQUAD_ROLES.map((role, i) => {
      let name: string;
      do {
        name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      } while (used.has(name));
      used.add(name);
      const p: Player = { id: `${def.id}-${i + 1}`, name, role, age: rng.int(20, 34), power: 0, pace: 0, handling: 0, tackling: 0, kicking: 0, stamina: 0 };
      const base = def.strength - (i >= 5 ? 5 : 0);
      for (const a of ATTRS) p[a] = clampRating(base + (ROLE_BIAS[role][a] ?? 0) + rng.int(-8, 8));
      return p;
    });
    return { id: def.id, name: def.name, short: def.short, style: def.style, players, lineup: players.slice(0, 5).map((p) => p.id) };
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
