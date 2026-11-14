// Pulls the cutaway artwork out of the silhouette lab page and writes it to src/cutaways/art.
// Usage: npm run cutaways:extract -- /path/to/dominion-multi-test.html /path/to/dominion-solo-test.html
// The multi page holds the first nine cutaways; the solo page holds the interception, kicking and
// kick-and-chase art. The lab pages keep their art as base64 arrays. Only the art is extracted: the framing and timing
// tables live in src/cutaways/data.ts and are edited by hand.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [src, soloSrc] = process.argv.slice(2);
if (!src || !soloSrc) {
  console.error("Usage: npm run cutaways:extract -- <path to dominion-multi-test.html> <path to dominion-solo-test.html>");
  process.exit(1);
}
const out = new URL("../src/cutaways/art/", import.meta.url);
mkdirSync(out, { recursive: true });

/** Reads `const name = [...]` (possibly followed by .map(...)) from a lab page as JSON. */
const reader = (file) => {
  const lines = readFileSync(file, "utf8").split("\n");
  return (name) => {
    const line = lines.find((l) => l.startsWith(`const ${name}`));
    if (!line) throw new Error(`${name} not found in ${file}`);
    return JSON.parse(line.slice(line.indexOf("=") + 1).trim().replace(/;$/, "").replace(/\.map\(.*\)$/, ""));
  };
};
const array = reader(src);
const soloArray = reader(soloSrc);
const tackle = array("tackleArt");
const action = array("actionArt");
const grounding = array("groundingArt");
const jackal = array("jackalArt");
const main = array("mainLooks");
const extra = array("extraLooks");
const soloAction = soloArray("actionArt");
const soloTackle = soloArray("tackleArt");
const soloMain = soloArray("mainLooks");
const soloExtra = soloArray("extraLooks");
const spriteLine = readFileSync(src, "utf8").split("\n").find((l) => l.startsWith("const spriteUri="));
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
  // From the solo page, where only these poses are filled in.
  intercept: [soloAction[4], (l) => soloMain[l][4]],
  goalmiss: [soloAction[5], (l) => soloMain[l][5]],
  goal: [soloTackle[3], (l) => soloExtra[l][6]],
  kickchase: [soloAction[8], (l) => soloMain[l][8]],
};
save("sprite", sprite);
for (const [kind, [original, look]] of Object.entries(KINDS)) {
  save(`${kind}-0`, original);
  for (let l = 0; l < 4; l++) save(`${kind}-${l + 1}`, look(l));
}
console.log(`Wrote ${count} images to src/cutaways/art`);
