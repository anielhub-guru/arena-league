/**
 * Tuning tables for the illustrated cutaways. Everything you would change when updating the
 * artwork or the feel of a cutaway is in this file; the artwork itself is in ./art and is
 * regenerated from the silhouette lab with `npm run cutaways:extract`.
 */

export type Transition = "diagonal" | "split" | "hard" | "dots";
export type Kind = "bighit" | "grounding" | "celebration" | "lastditch" | "jackal" | "card" | "waist" | "double" | "ankle";
export type StoryKind = Exclude<Kind, "bighit">;

/** Seconds, on the lab's scene clock: contact is when the cutaway pose begins, end is when it settles. */
export const TIMING = {
  start: 1.02,
  contact: 1.34,
  end: 1.94,
  /** The cut happens this long after contact. */
  cutDelay: 0.13,
  /** Entry reveal, and the exit that carries the illustration away (real seconds at 1x). */
  reveal: 0.17,
  exit: 0.24,
  /** The first part of the cutaway plays in slow motion: this much scene time, at this rate. */
  slowLength: 0.18,
  slowRate: 0.3,
  /** Real seconds the finished illustration stays on screen before the exit (the lab ends straight away). */
  hold: 0.9,
};

/** Transition names, in the order they are offered. */
export const TRANSITIONS: readonly [Transition, string][] = [
  ["diagonal", "Forward diagonal"],
  ["split", "Split slash"],
  ["hard", "Hard cut"],
  ["dots", "Off (field only)"],
];

/** Chance that a matching moment gets a cutaway. The roll is seeded from the event, so a replay repeats it. */
export const CHANCE: Record<Kind, number> = {
  card: 0.5,
  grounding: 0.3,
  celebration: 0.3,
  jackal: 0.4,
  bighit: 0.12,
  waist: 0.12,
  double: 0.12,
  lastditch: 0.25,
  ankle: 0.2,
};

/** Most cutaways in one match: they are a treat, one or two a game. */
export const MAX_PER_MATCH = 2;

/** Fewest match seconds between two cutaways in one match, so they stay a treat. */
export const COOLDOWN_SEC = 420;

/**
 * Game hairstyle (Look.portrait, see league/look.ts HAIR) to the lab's hairstyle number:
 * 0 original braided ponytail, 1 braided bun, 2 natural puff, 3 sports hijab, 4 bob cut.
 */
export const LAB_HAIR = [0, 2, 3, 4, 0, 1] as const;

export interface Frame {
  width: number;
  height: number;
  rise: number;
  slide: number;
}
/** [x, y, width, height] as fractions of the pose image. */
export type Region = readonly [number, number, number, number];

export interface StorySpec {
  /** Artwork file prefix for a pose, e.g. grounding0 gives art/grounding0-<hair>.webp. */
  art: (pose: number) => string;
  frame: Frame;
  /** Where the second person is when the two players have different hairstyles. */
  regions: (pose: number) => readonly Region[];
  ground: number;
  /** The body settles from a tilt, for the diving pose. */
  tilt: number;
}

const BIG: Frame = { width: 450, height: 280, rise: 5, slide: 30 };

export const STORY: Record<StoryKind, StorySpec> = {
  // pose 0 is an open dive, 1 dives through an ankle tackle, 2 breaks a waist tackle
  grounding: {
    art: (pose) => `grounding${pose}`,
    frame: { width: 410, height: 184, rise: 28, slide: 42 },
    regions: (pose) => (pose === 1 ? [[0.24, 0.13, 0.2, 0.56]] : pose === 2 ? [[0.22, 0.15, 0.21, 0.6]] : []),
    ground: 361,
    tilt: 0.055,
  },
  celebration: { art: () => "celebration", frame: { width: 360, height: 276, rise: 6, slide: 6 }, regions: () => [[0.59, 0.07, 0.41, 0.3]], ground: 390, tilt: 0 },
  lastditch: { art: () => "lastditch", frame: { width: 385, height: 260, rise: 13, slide: 32 }, regions: () => [[0.28, 0.27, 0.4, 0.29]], ground: 390, tilt: 0 },
  jackal: { art: () => "jackal", frame: { width: 410, height: 238, rise: 6, slide: 12 }, regions: () => [[0.49, 0, 0.28, 0.39]], ground: 390, tilt: 0 },
  card: { art: () => "card", frame: { width: 360, height: 275, rise: 0, slide: 0 }, regions: () => [[0, 0.09, 0.39, 0.24]], ground: 390, tilt: 0 },
  waist: { art: () => "waist", frame: BIG, regions: () => [[0.3, 0.2, 0.34, 0.3]], ground: 390, tilt: 0 },
  double: {
    art: () => "double",
    frame: BIG,
    regions: () => [
      [0.16, 0.36, 0.31, 0.29],
      [0.63, 0, 0.3, 0.39],
    ],
    ground: 390,
    tilt: 0,
  },
  ankle: { art: () => "ankle", frame: { ...BIG, rise: 20 }, regions: () => [[0.12, 0.44, 0.33, 0.32]], ground: 390, tilt: 0 },
};

/** The original "big hit" is drawn from one sprite, with hair drawn on top. Paths are in the sprite's 152 x 260 space. */
export const SCALP = "M111 8 C97 -3 82 0 77 12 C71 21 75 31 80 36 L89 34 Q91 27 98 23 L106 24 Q101 17 111 8 Z";
export const BRAID_LINES = "M108 9 Q88 -1 79 17 M106 13 Q87 4 78 23 M104 17 Q86 11 79 28 M104 21 Q90 16 82 33";
/** Index 0 keeps the sprite's own hair. */
export const HAIR_PARTS: readonly ({ outer: string; detail: string; hijab?: boolean } | null)[] = [
  null,
  {
    outer: "M80 22 C77 15 68 14 63 19 C56 24 59 34 66 37 Q74 41 81 33 Z",
    detail: "M62 26 Q67 18 76 24 M62 30 Q68 23 77 28 M66 35 Q72 29 78 32",
  },
  {
    outer: "M83 24 Q79 18 73 17 Q70 13 65 16 Q58 14 55 19 Q48 19 47 25 Q42 31 48 36 Q49 43 56 43 Q61 48 67 44 Q74 46 79 40 Q85 38 86 32 Z",
    detail: "M53 25 Q57 21 62 23 M51 33 Q55 37 60 34 M63 41 Q68 38 72 40",
  },
  {
    outer: "M110 7 C98 -5 82 -1 75 11 Q68 25 75 35 L71 53 L82 62 L100 61 L104 43 Q95 34 98 23 L106 24 Q102 14 110 7 Z",
    detail: "M79 34 Q87 46 98 48 M77 52 Q88 57 98 54",
    hijab: true,
  },
  {
    outer: "M110 8 Q95 -4 81 4 Q69 11 70 29 L72 49 Q83 55 98 47 L97 36 Q91 30 98 23 L106 24 Q101 17 110 8 Z",
    detail: "M78 15 Q73 29 79 44 M84 10 Q78 22 84 45",
    hijab: true,
  },
];
/** The area of the sprite (152 x 260 space) cleared before a new hairstyle is drawn. */
export const HEAD_CLEAR = "M38 -4 H114 L111 8 Q101 17 106 24 L98 23 Q91 27 89 34 L80 38 L72 56 H38 Z";
