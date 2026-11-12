import type { Rng } from "./rng";

/**
 * Commentary. Every moment has several phrasings, and the narrator avoids reusing a
 * phrasing it used recently, so a match does not read like a template. It also adds
 * score context to tries ("That levels it up", "They take the lead").
 *
 * It owns its own seeded Rng, separate from the match Rng, so the wording never changes
 * what happens in a match.
 *
 * Facts that the animation also shows (which upright a kick missed, whether a break ended
 * in touch, a foul or a tackle from behind, how many tackles have been made) are passed in
 * and must appear in every phrasing of that moment. The words change, the facts do not.
 */
export interface Facts {
  /** Short name of the team in possession / acting, and of the other team. */
  team: string;
  opp: string;
  /** Full name and surname of the ball carrier, tackler, kicker or culprit. */
  c?: string;
  cs?: string;
  t?: string;
  ts?: string;
  k?: string;
  /** "him" or "her". */
  him: string;
  gain?: number;
  n?: number;
  where?: string;
  dist?: number;
  run?: number;
  side?: "left" | "right";
  what?: string;
  sweeper?: string;
}

type Bank = ((f: Facts) => string)[];

const CARRY_HARD: Bank = [
  (f) => `${f.c} carries hard for ${f.gain}m, brought down by ${f.ts}. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.c} drives into the line and clatters on for ${f.gain}m before ${f.ts} gets ${f.him} down. Tackle ${f.n}.`,
  (f) => `Good go-forward from ${f.c}: ${f.gain}m, with ${f.ts} doing the tackling. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.c} takes it up and bumps off ${f.ts} for ${f.gain}m. ${f.team} are ${f.where}. Tackle ${f.n}.`,
  (f) => `${f.c} finds a gap and rumbles ${f.gain}m before the tackle from ${f.ts}. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.ts} cannot stop ${f.c} straight away. ${f.gain}m gained before ${f.him} goes down. Tackle ${f.n}.`,
];
const CARRY_STOPPED: Bank = [
  (f) => `${f.ts} stops ${f.c} behind the gain line. Tackle ${f.n}.`,
  (f) => `${f.c} is met by ${f.ts} and goes backwards. Tackle ${f.n}.`,
  (f) => `A big hit from ${f.ts}: ${f.c} loses ground. Tackle ${f.n}.`,
  (f) => `${f.team} go nowhere. ${f.ts} wraps up ${f.c} behind the gain line. Tackle ${f.n}.`,
  (f) => `${f.c} runs into a brick wall in ${f.ts}. No gain, tackle ${f.n}.`,
];
const CARRY_SMALL: Bank = [
  (f) => `${f.c} picks up ${f.gain}m before ${f.ts} wraps ${f.him} up. Tackle ${f.n}.`,
  (f) => `${f.c} takes it on for ${f.gain}m and is tackled by ${f.ts}. Tackle ${f.n}.`,
  (f) => `${f.gain}m for ${f.c}, hauled down by ${f.ts}. Tackle ${f.n}.`,
  (f) => `Steady carry from ${f.c}: ${f.gain}m, and ${f.ts} makes the tackle. That is number ${f.n}.`,
  (f) => `${f.c} edges forward ${f.gain}m, with ${f.ts} finishing the job. Tackle ${f.n}.`,
];
const KNOCK_ON: Bank = [
  (f) => `${f.c} spills it forward under pressure from ${f.ts}. Knock-on, ${f.opp} get the put-in.`,
  (f) => `Dropped! ${f.c} loses the ball forward as ${f.ts} closes in. Knock-on, and ${f.opp} will restart.`,
  (f) => `${f.ts} puts the pressure on and ${f.c} fumbles it forward. Knock-on, ${f.opp} get the ball.`,
  (f) => `Handling error from ${f.c}: the ball goes forward. Knock-on, and ${f.opp} have possession.`,
  (f) => `${f.c} cannot hold it and knocks on under the pressure of ${f.ts}. ${f.opp} take over.`,
];
const JACKAL: Bank = [
  (f) => `${f.t} gets over the ball and wins the jackal turnover! ${f.opp} counter from ${f.where}.`,
  (f) => `Jackal! ${f.t} pounces on the ball in the tackle and ${f.opp} have it back, ${f.where}.`,
  (f) => `${f.t} rips the ball free at the breakdown. Turnover to ${f.opp}, ${f.where}.`,
  (f) => `Superb work at the breakdown from ${f.t}, who steals it. ${f.opp} will counter from ${f.where}.`,
];
const SIXTH: Bank = [
  (f) => `Sixth tackle and ${f.team} run out of ideas ${f.where}. Turnover to ${f.opp}.`,
  (f) => `${f.team} have used all six tackles ${f.where}, so ${f.opp} take over.`,
  (f) => `That is the sixth tackle. ${f.team} cannot make it count ${f.where}, and ${f.opp} get the ball.`,
  (f) => `Out of tackles. ${f.team} must hand it over ${f.where}. Turnover to ${f.opp}.`,
];
const INTERCEPT: Bank = [
  (f) => `${f.t} reads the pass intended for ${f.c}, steps in and intercepts! ${f.opp} counter for ${f.run}m.`,
  (f) => `Intercepted! ${f.t} picks off the pass meant for ${f.c} and is away for ${f.run}m.`,
  (f) => `Loose pass, and ${f.t} is on it. ${f.opp} break away for ${f.run}m after the interception.`,
  (f) => `${f.t} jumps the passing lane, intercepts, and runs ${f.run}m the other way for ${f.opp}.`,
];
const KICK_DEAD: Bank = [
  (f) => `${f.k} puts up a huge kick that runs dead. ${f.opp} drop out from their 22.`,
  (f) => `${f.k} hits it too far and it rolls over the dead-ball line. Drop-out for ${f.opp}.`,
  (f) => `Overcooked kick from ${f.k} runs dead. ${f.opp} restart from their 22.`,
];
const KICK_LIVE: Bank = [
  (f) => `${f.k} kicks for territory, ${f.dist}m downfield. ${f.opp} gather it ${f.where}.`,
  (f) => `${f.k} sends it ${f.dist}m up the pitch. ${f.opp} collect ${f.where}.`,
  (f) => `Territory kick from ${f.k}: ${f.dist}m, and ${f.opp} take it ${f.where}.`,
  (f) => `${f.k} puts boot to ball for ${f.dist}m. ${f.opp} are ${f.where} when they gather it.`,
];
const PENALTY_CORNER: Bank = [
  (f) => `${f.ts} gives away a penalty and ${f.team} kick to the corner, now ${f.where}.`,
  (f) => `Penalty to ${f.team} after ${f.ts} infringes. They find touch and are now ${f.where}.`,
  (f) => `The referee penalises ${f.ts}. ${f.team} kick for the corner and are ${f.where}.`,
];
const PEN_LEAD_BREAKDOWN: Bank = [
  (f) => `${f.ts} (${f.opp}) is penalised at the breakdown.`,
  (f) => `The whistle goes against ${f.ts} (${f.opp}) at the breakdown.`,
  (f) => `${f.ts} (${f.opp}) infringes in the tackle area and is penalised.`,
];
const PEN_LEAD_HIGH: Bank = [
  (f) => `${f.ts} (${f.opp}) is penalised for the high tackle.`,
  (f) => `The referee punishes ${f.ts} (${f.opp}) for that high tackle.`,
];
const PEN_GOAL: Bank = [
  (f) => `${f.k} slots the penalty from ${f.dist}m out, straight between the posts. Three points to ${f.team}.`,
  (f) => `${f.k} sends it ${f.dist}m through the uprights. ${f.team} take three.`,
  (f) => `${f.k} makes no mistake from ${f.dist}m. Three more for ${f.team}.`,
];
const RELIEF: Bank = [(f) => `Relief for ${f.opp}.`, (f) => `A let-off for ${f.opp}.`, (f) => `${f.opp} escape.`];
const DROP_GOAL: Bank = [
  (f) => `DROP GOAL! ${f.k} steadies and strikes it sweetly from ${f.dist}m, right between the posts. ${f.team} take three.`,
  (f) => `DROP GOAL! Out of nowhere, ${f.k} drops it over from ${f.dist}m. Three points to ${f.team}.`,
  (f) => `DROP GOAL! ${f.k} takes the shot from ${f.dist}m and it sails between the uprights. ${f.team} add three.`,
];
const DROP_RESTART: Bank = [(f) => `${f.opp} restart from their 22.`, (f) => `${f.opp} take the drop-out from their 22.`];
const CONVERSION: Bank = [
  (f) => `${f.k} splits the posts with the conversion.`,
  (f) => `${f.k} adds the extra two with a cool conversion.`,
  (f) => `The conversion from ${f.k} sails over. Two more.`,
];

const MISS: Record<"post" | "wide" | "short", Bank> = {
  post: [
    (f) => `${f.k} strikes the ${f.what} from ${f.dist}m and it smacks the ${f.side} upright and bounces away! So close.`,
    (f) => `${f.k} hits the ${f.side} post from ${f.dist}m! The ${f.what} rebounds away. Unlucky.`,
    (f) => `Off the ${f.side} upright! ${f.k}'s ${f.what} from ${f.dist}m clangs the post and stays out.`,
  ],
  short: [
    (f) => `${f.k} cannot get the distance on the ${f.what} from ${f.dist}m. It drops short of the bar.`,
    (f) => `${f.k}'s ${f.what} from ${f.dist}m falls short, dropping under the crossbar.`,
  ],
  wide: [
    (f) => `${f.k} sends the ${f.what} from ${f.dist}m wide of the ${f.side} upright.`,
    (f) => `${f.k}'s ${f.what} from ${f.dist}m drifts wide of the ${f.side} upright.`,
    (f) => `Wide! ${f.k} misses the ${f.what} from ${f.dist}m, just outside the ${f.side} post.`,
  ],
};
const POST_IN: Bank = [
  (f) => `${f.k} strikes the ${f.what} from ${f.dist}m. It clips the ${f.side} upright, bounces up and drops over the bar!`,
  (f) => `Lucky! ${f.k}'s ${f.what} from ${f.dist}m hits the ${f.side} post and goes over the bar.`,
];

const BREAK_TOUCH: Bank = [
  (f) => `${f.c} bursts through for ${f.gain}m but ${f.ts} bundles ${f.him} into touch! The ball is out of play and ${f.opp} take the line-out.`,
  (f) => `${f.c} slices through for ${f.gain}m, only for ${f.ts} to shove ${f.him} into touch. Line-out to ${f.opp}.`,
  (f) => `${f.c} breaks clear for ${f.gain}m but runs out of room: ${f.ts} forces ${f.him} out of play. ${f.opp} take the line-out.`,
];
const BREAK_FOUL: Bank = [
  (f) => `${f.c} bursts through for ${f.gain}m but ${f.ts} brings ${f.him} down with a high tackle! The referee blows for a penalty to ${f.team}.`,
  (f) => `${f.c} breaks clear for ${f.gain}m, and ${f.ts} catches ${f.him} high. Penalty to ${f.team}.`,
  (f) => `${f.c} slices through for ${f.gain}m but ${f.ts} makes contact with the neck. High tackle, and the referee awards ${f.team} a penalty.`,
];
const BREAK_COVERED: Bank = [
  (f) => `${f.c} cuts a line for ${f.gain}m but ${f.sweeper} scrambles across and makes the tackle. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.c} is through for ${f.gain}m, but ${f.sweeper} covers across to make the saving tackle. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.c} breaks the first line for ${f.gain}m, and it takes a last-ditch tackle from ${f.sweeper} to stop the try. Tackle ${f.n}, ${f.where}.`,
];
const BREAK_CAUGHT: Bank = [
  (f) => `${f.c} bursts through for ${f.gain}m before ${f.ts} drags ${f.him} down from behind. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.c} breaks clear for ${f.gain}m but is hauled down from behind by ${f.ts}. Tackle ${f.n}, ${f.where}.`,
  (f) => `${f.c} slices through for ${f.gain}m, and ${f.ts} chases back to catch ${f.him} from behind. Tackle ${f.n}, ${f.where}.`,
];
const TRY_BREAK: Bank = [
  (f) => `TRY! ${f.c} breaks the line and races clear. ${f.team} are over!`,
  (f) => `TRY! ${f.c} is through the gap and nobody is catching ${f.him}. ${f.team} score!`,
  (f) => `TRY! A glorious break from ${f.c}, who runs it in for ${f.team}!`,
  (f) => `TRY! ${f.c} splits the defence and sprints away to ground it. ${f.team} are over!`,
];
const TRY_POWER: Bank = [
  (f) => `TRY! ${f.c} powers through ${f.ts} and grounds it. ${f.team} score!`,
  (f) => `TRY! ${f.c} refuses to be stopped, bursts through ${f.ts} and gets it down. ${f.team} score!`,
  (f) => `TRY! ${f.c} drives straight through ${f.ts} for the line. ${f.team} are over!`,
  (f) => `TRY! Too strong for ${f.ts}: ${f.c} bulldozes over for ${f.team}!`,
];

const TRY_GRUBBER: Bank = [
  (f) => `TRY! ${f.k} pokes a grubber through the line, ${f.c} races onto it and dives on it before ${f.t} can! ${f.team} score!`,
  (f) => `TRY! A clever grubber kick from ${f.k} bobbles over the line, and ${f.c} wins the race to touch it down. ${f.team} are over!`,
  (f) => `TRY! ${f.k} rolls a grubber behind the defence, ${f.c} chases it down and grounds it ahead of ${f.t}. ${f.team} score!`,
];
const TRY_CHIP: Bank = [
  (f) => `TRY! ${f.k} chips it over the top, ${f.c} chases, gathers on the bounce and dives over. ${f.team} are in!`,
  (f) => `TRY! Chip and chase! ${f.k} lofts it over the rush, and ${f.c} beats ${f.t} to it and grounds it for ${f.team}!`,
  (f) => `TRY! ${f.k} puts a delicate chip in behind, ${f.c} outpaces ${f.t}, collects it and scores. ${f.team} score!`,
];
const GRUBBER_LOST: Bank = [
  (f) => `${f.k} rolls a grubber in behind, but ${f.t} gets back and covers it. ${f.opp} restart with a drop-out.`,
  (f) => `Grubber kick from ${f.k}. ${f.c} chases hard, but ${f.t} is there first and dots it down. Drop-out for ${f.opp}.`,
];
const GRUBBER_DEAD: Bank = [
  (f) => `${f.k} pokes a grubber through, but it bounces away and runs dead. ${f.opp} drop out from their 22.`,
  (f) => `The grubber from ${f.k} is just too firm, and it skids over the dead-ball line. Drop-out for ${f.opp}.`,
];
const CHIP_LOST: Bank = [
  (f) => `${f.k} chips it over the top, but ${f.t} reads it and gathers it safely. ${f.opp} drop out from the 22.`,
  (f) => `Chip and chase from ${f.k}, but ${f.c} cannot get there: ${f.t} takes it first. Drop-out for ${f.opp}.`,
];
const CHIP_DEAD: Bank = [
  (f) => `${f.k} chips it a touch too far and it sails over the dead-ball line. Drop-out for ${f.opp}.`,
  (f) => `The chip from ${f.k} is overhit, and ${f.c} watches it run dead. ${f.opp} restart from their 22.`,
];

const YELLOW_REASON_BREAKDOWN = ["repeated infringements at the breakdown", "a cynical professional foul", "deliberately slowing the ball down"];
const YELLOW_REASON_HIGH = ["a high tackle", "a reckless tackle around the neck"];
const RED_REASON_HIGH = ["a dangerous high tackle", "serious foul play"];
const RED_REASON_BREAKDOWN = ["serious foul play", "a dangerous challenge at the breakdown"];

export interface CardFacts {
  player: string;
  surname: string;
  team: string;
  /** Players left on the pitch for the carded side. */
  left: number;
  high: boolean;
  /** Match minute at which a sin-binned player comes back. */
  backAt?: number;
}

export class Narrator {
  private recent = new Map<string, number[]>();
  constructor(private rng: Rng) {}

  private pick<T>(key: string, bank: readonly T[]): T {
    const used = this.recent.get(key) ?? [];
    const window = Math.min(Math.max(1, bank.length - 1), 4);
    const free = bank.map((_, i) => i).filter((i) => !used.slice(-window).includes(i));
    const i = free.length ? free[Math.floor(this.rng.next() * free.length)] : Math.floor(this.rng.next() * bank.length);
    this.recent.set(key, [...used, i].slice(-6));
    return bank[i];
  }

  private say(key: string, bank: Bank, f: Facts): string {
    return this.pick(key, bank)(f);
  }

  carry(f: Facts): string {
    const gain = f.gain ?? 0;
    const base = gain >= 8 ? this.say("carry-hard", CARRY_HARD, f) : gain <= 0 ? this.say("carry-stop", CARRY_STOPPED, f) : this.say("carry-small", CARRY_SMALL, f);
    return f.n === 5 ? `${base} One tackle left before the turnover.` : base;
  }
  knockOn = (f: Facts) => this.say("knock-on", KNOCK_ON, f);
  jackal = (f: Facts) => this.say("jackal", JACKAL, f);
  sixth = (f: Facts) => this.say("sixth", SIXTH, f);
  intercept = (f: Facts) => this.say("intercept", INTERCEPT, f);
  kickDead = (f: Facts) => this.say("kick-dead", KICK_DEAD, f);
  kickLive = (f: Facts) => this.say("kick-live", KICK_LIVE, f);
  kickAheadLost = (kind: "grubber" | "chip", dead: boolean, f: Facts) =>
    this.say(`${kind}-${dead ? "dead" : "lost"}`, kind === "grubber" ? (dead ? GRUBBER_DEAD : GRUBBER_LOST) : dead ? CHIP_DEAD : CHIP_LOST, f);
  penaltyCorner = (f: Facts) => this.say("pen-corner", PENALTY_CORNER, f);

  penaltyGoal(f: Facts, high: boolean, postIn: boolean): string {
    const lead = high ? this.say("pen-lead-high", PEN_LEAD_HIGH, f) : this.say("pen-lead-breakdown", PEN_LEAD_BREAKDOWN, f);
    return postIn ? `${lead} ${this.say("post-in", POST_IN, f)} Three points to ${f.team}.` : `${lead} ${this.say("pen-goal", PEN_GOAL, f)}`;
  }
  penaltyMiss(f: Facts, kind: "post" | "wide" | "short"): string {
    return `Penalty to ${f.team}. ${this.say(`miss-${kind}`, MISS[kind], f)} ${this.say("relief", RELIEF, f)}`;
  }
  dropGoal(f: Facts, postIn: boolean): string {
    return postIn ? `DROP GOAL! ${this.say("post-in", POST_IN, f)} ${f.team} take three.` : this.say("drop-goal", DROP_GOAL, f);
  }
  dropMiss(f: Facts, kind: "post" | "wide" | "short"): string {
    return `${this.say(`miss-${kind}`, MISS[kind], f)} ${this.say("drop-restart", DROP_RESTART, f)}`;
  }
  conversion(f: Facts, score: string, postIn: boolean): string {
    return `${postIn ? this.say("post-in", POST_IN, f) : this.say("conversion", CONVERSION, f)} ${score}`;
  }
  conversionMiss(f: Facts, score: string, kind: "post" | "wide" | "short"): string {
    return `${this.say(`miss-${kind}`, MISS[kind], f)} ${score}`;
  }

  breakEnd(variant: "touch" | "foul" | "covered" | "caught", f: Facts): string {
    const bank = { touch: BREAK_TOUCH, foul: BREAK_FOUL, covered: BREAK_COVERED, caught: BREAK_CAUGHT }[variant];
    return this.say(`break-${variant}`, bank, f);
  }

  /** A try, with how it changes the scoreboard. `a` and `d` are the scores after the try, before the conversion. */
  try(f: Facts, kind: "break" | "power" | "grubber" | "chip", a: number, d: number, minute: number): string {
    const banks = { break: TRY_BREAK, power: TRY_POWER, grubber: TRY_GRUBBER, chip: TRY_CHIP };
    const base = this.say(`try-${kind}`, banks[kind], f);
    const before = a - 5;
    let extra = "";
    if (a === d) extra = "That levels the scores.";
    else if (before <= d && a > d) extra = `${f.team} take the lead.`;
    else if (a < d && minute >= 34) extra = `${f.opp} still lead, and time is running out for ${f.team}.`;
    else if (a < d) extra = `${f.team} are back within ${d - a}.`;
    else if (a - d > 14) extra = `${f.team} are now well clear.`;
    else if (this.rng.chance(0.5)) extra = `${f.team} lead by ${a - d}.`;
    return extra ? `${base} ${extra}` : base;
  }

  yellow(c: CardFacts): string {
    const reason = this.pick(c.high ? "yc-high" : "yc-breakdown", c.high ? YELLOW_REASON_HIGH : YELLOW_REASON_BREAKDOWN);
    const tail = `${c.team} play with ${c.left} for ten minutes${c.backAt ? `, until about minute ${c.backAt}` : ""}.`;
    return this.pick("yc", [
      `YELLOW CARD! ${c.player} (${c.team}) is sent to the sin bin for ${reason}. ${tail}`,
      `Yellow card for ${c.player} (${c.team}), who is sent to the sin bin for ${reason}. ${tail}`,
      `The referee shows ${c.player} (${c.team}) a yellow card for ${reason}. Into the sin bin. ${tail}`,
    ]);
  }
  secondYellow(c: CardFacts): string {
    return `SECOND YELLOW! ${c.player} (${c.team}) has already been warned, and a second yellow means a red card. ${c.team} are down to ${c.left} for the rest of the match, and ${c.surname} will miss the next match.`;
  }
  red(c: CardFacts): string {
    const reason = this.pick(c.high ? "rc-high" : "rc-breakdown", c.high ? RED_REASON_HIGH : RED_REASON_BREAKDOWN);
    return this.pick("rc", [
      `RED CARD! ${c.player} (${c.team}) is sent off for ${reason}. ${c.team} play the rest of the match with ${c.left}, and ${c.surname} will miss the next match.`,
      `Straight red for ${c.player} (${c.team}) for ${reason}! ${c.team} are down to ${c.left} for the rest of the match, and ${c.surname} is suspended for the next one.`,
    ]);
  }
  back(player: string, team: string, count: number): string {
    return this.pick("back", [
      `${player} is back from the sin bin and ${team} are up to ${count} again.`,
      `The ten minutes are up. ${player} returns for ${team}, who are back to ${count}.`,
    ]);
  }
}
