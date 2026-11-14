// Pulls the cutaway artwork out of the silhouette lab page and writes it to src/cutaways/art.
// Usage: npm run cutaways:extract -- /path/to/dominion-multi-test.html
// The lab page keeps its art as base64 arrays. Only the art is extracted: the framing and timing
// tables live in src/cutaways/data.ts and are edited by hand.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run cutaways:extract -- <path to the lab html>");
  process.exit(1);
}
const out = new URL("../src/cutaways/art/", import.meta.url);
mkdirSync(out, { recursive: true });
const lines = readFileSync(src, "utf8").split("\n");

/** Reads `const name = [...]` (possibly followed by .map(...)) as JSON. */
function array(name) {
  const line = lines.find((l) => l.startsWith(`const ${name}`));
  if (!line) throw new Error(`${name} not found in ${src}`);
  return JSON.parse(line.slice(line.indexOf("=") + 1).trim().replace(/;$/, "").replace(/\.map\(.*\)$/, ""));
}
const tackle = array("tackleArt");
const action = array("actionArt");
const grounding = array("groundingArt");
const jackal = array("jackalArt");
const main = array("mainLooks");
const extra = array("extraLooks");
const spriteLine = lines.find((l) => l.startsWith("const spriteUri="));
const sprite = spriteLine?.match(/'(data:image\/webp;base64,[^']+)'/)?.[1];
if (!sprite) throw new Error("spriteUri not found");

let count = 0;
const save = (name, uri) => {
  if (!uri) throw new Error(`Missing artwork for ${name}`);
  writeFileSync(new URL(`${name}.webp`, out), Buffer.from(uri.split(",")[1], "base64"));
  count++;
};

// kind: [original art, art for hairstyles 1-4 (index 0 = hairstyle 1)]
const KINDS = {
  grounding0: [action[0], (l) => main[l][0]],
  grounding1: [grounding[0], (l) => extra[l][0]],
  grounding2: [grounding[1], (l) => extra[l][1]],
  celebration: [action[1], (l) => main[l][1]],
  lastditch: [action[2], (l) => main[l][2]],
  jackal: [action[3], (l) => jackal[l]],
  card: [action[6], (l) => main[l][6]],
  waist: [tackle[0], (l) => extra[l][3]],
  double: [tackle[1], (l) => extra[l][4]],
  ankle: [tackle[2], (l) => extra[l][5]],
};
save("sprite", sprite);
for (const [kind, [original, look]] of Object.entries(KINDS)) {
  save(`${kind}-0`, original);
  for (let l = 0; l < 4; l++) save(`${kind}-${l + 1}`, look(l));
}
console.log(`Wrote ${count} images to src/cutaways/art`);
