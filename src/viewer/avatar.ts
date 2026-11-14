import type { Look } from "../engine/types";
import { BUILDS } from "../league/look";
import a0 from "../assets/avatars/a0.webp";
import a1 from "../assets/avatars/a1.webp";
import a2 from "../assets/avatars/a2.webp";
import a3 from "../assets/avatars/a3.webp";
import a4 from "../assets/avatars/a4.webp";
import a5 from "../assets/avatars/a5.webp";
import b0 from "../assets/avatars/b0.webp";
import b1 from "../assets/avatars/b1.webp";
import b2 from "../assets/avatars/b2.webp";
import b3 from "../assets/avatars/b3.webp";
import b4 from "../assets/avatars/b4.webp";
import b5 from "../assets/avatars/b5.webp";

/** Women's player portraits: white outline art, six hairstyles in two base faces. */
const FACE_ART = [[a0, a1, a2, a3, a4, a5], [b0, b1, b2, b3, b4, b5]];

// Face landmarks (eyes, nose, lips, jaw), normalised per portrait crop, for each base face.
const FACE_Y = [
  [[.33, .41, .46, .52], [.43, .49, .54, .59], [.30, .39, .45, .51], [.31, .39, .45, .51], [.25, .34, .41, .48], [.28, .36, .43, .50]],
  [[.32, .40, .46, .53], [.37, .43, .49, .56], [.31, .39, .45, .52], [.31, .38, .45, .51], [.28, .36, .43, .51], [.29, .37, .44, .51]],
];

const falloff = (value: number) => {
  const t = Math.max(0, 1 - Math.abs(value));
  return t * t * (3 - 2 * t);
};
const sign = (v: number) => (v === 1 ? -1 : v === 2 ? 1 : 0);

/** Warps the face features (eyes, nose, lips, jaw) of a portrait. */
function deform(pixels: Uint8ClampedArray, width: number, height: number, look: Look): Uint8ClampedArray {
  const [eyes, nose, lips, jaw] = FACE_Y[look.face][look.portrait];
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1), cx = u - 0.5;
      const dx = -cx * (0.29 * sign(look.nose) * falloff(cx / 0.084) * falloff((v - nose) / 0.059) + 0.32 * sign(look.jaw) * falloff(cx / 0.3) * falloff((v - jaw) / 0.093));
      const eyeZone = falloff((Math.abs(cx) - 0.067) / 0.062);
      const dy = -(v - eyes) * 0.38 * sign(look.eyes) * eyeZone * falloff((v - eyes) / 0.054) - (v - lips) * 0.45 * sign(look.lips) * falloff(cx / 0.105) * falloff((v - lips) / 0.05);
      const sx = Math.max(0, Math.min(width - 1, (u + dx) * (width - 1)));
      const sy = Math.max(0, Math.min(height - 1, (v + dy) * (height - 1)));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const a = sx - x0, b = sy - y0;
      for (let k = 0; k < 4; k++) {
        const first = pixels[(y0 * width + x0) * 4 + k] * (1 - a) + pixels[(y0 * width + x1) * 4 + k] * a;
        const second = pixels[(y1 * width + x0) * 4 + k] * (1 - a) + pixels[(y1 * width + x1) * 4 + k] * a;
        out[(y * width + x) * 4 + k] = first * (1 - b) + second * b;
      }
    }
  }
  return out;
}

const images = new Map<string, Promise<HTMLImageElement>>();
const load = (uri: string) => {
  if (!images.has(uri)) {
    const img = new Image();
    img.src = uri;
    images.set(uri, img.decode().then(() => img));
  }
  return images.get(uri)!;
};

async function paint(canvas: HTMLCanvasElement, look: Look): Promise<void> {
  const image = await load(FACE_ART[look.face][look.portrait]);
  const w = (canvas.width = image.naturalWidth), h = (canvas.height = image.naturalHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  if (look.eyes || look.nose || look.lips || look.jaw) {
    const data = ctx.getImageData(0, 0, w, h);
    data.data.set(deform(data.data, w, h, look));
    ctx.putImageData(data, 0, 0);
  }
}

/** A canvas showing a player's avatar. It fills in once the artwork has decoded. */
export function avatarCanvas(look: Look, label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  canvas.className = "avatar-art";
  canvas.style.transform = `scaleX(${BUILDS[look.build][1]})`;
  void paint(canvas, look).catch(() => canvas.remove());
  return canvas;
}
