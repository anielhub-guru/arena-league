import { h } from "../dom";
import { slotPlayer } from "../engine/match";
import { ATTRS, ROLES, type Attr, type Player, type TacticId } from "../engine/types";

/**
 * Radar (spider) chart of the six ratings. Used for a team's shape and for a single player's profile.
 *
 * Design notes: the scale is fixed (40 to 90) so shapes can be compared across screens and seasons.
 * Identity never relies on colour alone: the first series is a solid line with round markers, the second
 * a dashed line with square markers, and there is always a legend and a values table. Labels use text
 * colours; the series colours only appear on marks. Grid lines are solid hairlines.
 */

export type Profile = Record<Attr, number>;

/** Clockwise from the top. Ball-in-hand skills sit together on the right, defensive ones on the left. */
export const RADAR_ORDER: readonly Attr[] = ["pace", "handling", "power", "tackling", "stamina", "kicking"];

/** The ratings each tactic leans on. Balanced makes no special demand. */
export const TACTIC_FOCUS: Record<TacticId, Attr[]> = {
  balanced: [],
  attacking: ["pace", "handling"],
  defensive: ["tackling", "stamina"],
  territory: ["kicking", "tackling"],
};

export const ATTR_NAMES: Record<Attr, string> = { power: "Power", pace: "Pace", handling: "Handling", tackling: "Tackling", kicking: "Kicking", stamina: "Stamina" };

const MIN = 40;
const MAX = 90;
const RINGS = [50, 60, 70, 80];

export interface RadarSeries {
  id: string;
  label: string;
  values: Profile;
  /** CSS variable name, e.g. "--r1". */
  color: string;
  /** Second series: dashed line and square markers, so it differs by more than colour. */
  alt?: boolean;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Mean rating of each attribute over some players. */
export function profileOf(players: Player[]): Profile {
  return Object.fromEntries(ATTRS.map((a) => [a, Math.round(avg(players.map((p) => p[a])))])) as Profile;
}

/** One player's ratings. */
export const playerProfile = (p: Player): Profile => profileOf([p]);

/** The best five from a squad, one per slot, as they would actually play (natural role first, then overall). */
export function bestFive(squad: Player[]): Player[] {
  const used = new Set<string>();
  const ovr = (p: Player) => avg(ATTRS.map((a) => p[a]));
  return ROLES.map((role) => {
    const pick = squad.filter((p) => !used.has(p.id)).sort((a, b) => Number(b.role === role) - Number(a.role === role) || ovr(b) - ovr(a))[0];
    if (!pick) throw new Error("Not enough players for a starting five");
    used.add(pick.id);
    return slotPlayer(pick, role);
  });
}

/** A short line-key in the series colour (dashed for the second series), as used in the legend and tooltip. */
function keyFor(sr: RadarSeries): HTMLElement {
  const k = h("i", { class: `r-key${sr.alt ? " alt" : ""}` });
  k.style.borderColor = `var(${sr.color})`;
  return k;
}

const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

const W = 380;
const H = 330;
const CX = W / 2;
const CY = 165;
const R = 108;
const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / RADAR_ORDER.length;
const radius = (v: number) => (Math.max(MIN, Math.min(MAX, v)) - MIN) / (MAX - MIN) * R;
const point = (i: number, v: number): [number, number] => [CX + Math.cos(angle(i)) * radius(v), CY + Math.sin(angle(i)) * radius(v)];
const fmt = (n: number) => n.toFixed(1);

export interface RadarOptions {
  title: string;
  /** Ratings to emphasise, usually those the chosen tactic leans on. */
  focus?: Attr[];
  /** One line under the legend. */
  note?: string;
}

/** Builds the chart, its legend, a values table, and hover/focus tooltips. */
export function buildRadar(series: RadarSeries[], opts: RadarOptions): HTMLElement {
  const focus = new Set(opts.focus ?? []);
  const root = h("div", { class: "radar" });
  const n = RADAR_ORDER.length;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${opts.title}. ${series.map((x) => `${x.label}: ${RADAR_ORDER.map((a) => `${ATTR_NAMES[a]} ${x.values[a]}`).join(", ")}`).join(". ")}` });

  // Tactic emphasis: a faint wedge behind the ratings the tactic leans on, kept inside the hexagon.
  const edge = (i: number, j: number) => [(point(i, MAX)[0] + point(j, MAX)[0]) / 2, (point(i, MAX)[1] + point(j, MAX)[1]) / 2];
  RADAR_ORDER.forEach((a, i) => {
    if (!focus.has(a)) return;
    const prev = edge((i + n - 1) % n, i);
    const next = edge(i, (i + 1) % n);
    const tip = point(i, MAX);
    s.append(svg("polygon", { points: [[CX, CY], prev, tip, next].map((p) => p.map(fmt).join(",")).join(" "), class: "r-wedge" }));
  });
  // Rings and spokes: solid hairlines.
  for (const v of [...RINGS, MAX]) {
    const pts = RADAR_ORDER.map((_, i) => point(i, v).map(fmt).join(",")).join(" ");
    s.append(svg("polygon", { points: pts, class: "r-ring" }));
  }
  const spokes: SVGLineElement[] = [];
  RADAR_ORDER.forEach((_, i) => {
    const [x, y] = point(i, MAX);
    const line = svg("line", { x1: CX, y1: CY, x2: fmt(x), y2: fmt(y), class: "r-spoke" });
    spokes.push(line);
    s.append(line);
  });
  // Ring values, small and muted, up the top spoke.
  for (const v of RINGS) {
    const [x, y] = point(0, v);
    const t = svg("text", { x: fmt(x + 4), y: fmt(y - 2), class: "r-tick" });
    t.textContent = String(v);
    s.append(t);
  }
  // Axis names in text colour. Emphasised axes are bold with a marker.
  RADAR_ORDER.forEach((a, i) => {
    const x = CX + Math.cos(angle(i)) * (R + 16);
    const y = CY + Math.sin(angle(i)) * (R + 16);
    const c = Math.cos(angle(i));
    const t = svg("text", { x: fmt(x), y: fmt(y + 4), "text-anchor": Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end", class: focus.has(a) ? "r-axis on" : "r-axis" });
    t.textContent = focus.has(a) ? `◆ ${ATTR_NAMES[a]}` : ATTR_NAMES[a];
    s.append(t);
  });
  // Series: the first gets a faint wash. A 2px surface ring keeps markers legible where they overlap.
  for (const sr of [...series].reverse()) {
    const pts = RADAR_ORDER.map((a, i) => point(i, sr.values[a]));
    const poly = svg("polygon", { points: pts.map((p) => p.map(fmt).join(",")).join(" "), class: `r-shape${sr.alt ? " alt" : ""}` });
    poly.style.stroke = `var(${sr.color})`;
    poly.style.fill = sr.alt ? "none" : `var(${sr.color})`;
    s.append(poly);
    for (const [x, y] of pts) {
      const m = sr.alt ? svg("rect", { x: fmt(x - 4.5), y: fmt(y - 4.5), width: 9, height: 9, class: "r-dot" }) : svg("circle", { cx: fmt(x), cy: fmt(y), r: 4.5, class: "r-dot" });
      (m as SVGElement).style.fill = `var(${sr.color})`;
      s.append(m);
    }
  }

  // Tooltip: one box listing every series for the axis under the pointer or focus. textContent only.
  const tip = h("div", { class: "r-tip", role: "tooltip" });
  tip.hidden = true;
  const show = (i: number, x: number, y: number) => {
    const a = RADAR_ORDER[i];
    tip.replaceChildren(h("b", {}, ATTR_NAMES[a]), ...series.map((sr) => h("div", {}, keyFor(sr), `${sr.label}: `, h("b", {}, String(sr.values[a])))), ...(series.length === 2 ? [h("div", { class: "dim" }, `Difference ${series[0].values[a] - series[1].values[a] >= 0 ? "+" : ""}${series[0].values[a] - series[1].values[a]}`)] : []));
    tip.style.left = `${Math.min(x + 12, 230)}px`;
    tip.style.top = `${y + 8}px`;
    tip.hidden = false;
    spokes.forEach((l, j) => l.classList.toggle("hot", j === i));
  };
  const hide = () => {
    tip.hidden = true;
    spokes.forEach((l) => l.classList.remove("hot"));
  };
  // Hit areas are whole sectors, far bigger than the marks.
  RADAR_ORDER.forEach((a, i) => {
    const a0 = angle(i) - Math.PI / n;
    const a1 = angle(i) + Math.PI / n;
    const rr = R + 20;
    const p0 = [CX + Math.cos(a0) * rr, CY + Math.sin(a0) * rr];
    const p1 = [CX + Math.cos(a1) * rr, CY + Math.sin(a1) * rr];
    const hit = svg("path", { d: `M${CX},${CY} L${fmt(p0[0])},${fmt(p0[1])} A${rr},${rr} 0 0 1 ${fmt(p1[0])},${fmt(p1[1])} Z`, class: "r-hit", tabindex: 0, "aria-label": `${ATTR_NAMES[a]}: ${series.map((x) => `${x.label} ${x.values[a]}`).join(", ")}` });
    const [px, py] = point(i, 70).map((v) => v * (s.getBoundingClientRect().width / W || 1));
    hit.addEventListener("pointermove", (e) => {
      const box = s.getBoundingClientRect();
      show(i, (e as PointerEvent).clientX - box.left, (e as PointerEvent).clientY - box.top);
    });
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(i, px, py));
    hit.addEventListener("blur", hide);
    s.append(hit);
  });

  // Legend (always, for two or more series) and a values table (the same numbers, no hover needed).
  const legend = h("div", { class: "r-legend" }, ...series.map((sr) => h("span", {}, keyFor(sr), sr.label)));
  const table = h("table", { class: "r-table" });
  table.append(
    h("thead", {}, h("tr", {}, h("th", {}, ""), ...series.map((sr) => h("th", {}, sr.label)), ...(series.length === 2 ? [h("th", {}, "Diff")] : []))),
    h("tbody", {}, ...RADAR_ORDER.map((a) => {
      const d = series.length === 2 ? series[0].values[a] - series[1].values[a] : 0;
      return h("tr", { class: focus.has(a) ? "on" : "" }, h("th", {}, focus.has(a) ? `◆ ${ATTR_NAMES[a]}` : ATTR_NAMES[a]), ...series.map((sr) => h("td", {}, String(sr.values[a]))), ...(series.length === 2 ? [h("td", {}, `${d > 0 ? "▲ +" : d < 0 ? "▼ " : "= "}${d === 0 ? "0" : d}`)] : []));
    })),
  );

  root.append(
    h("div", { class: "r-plot" }, s, tip),
    h("div", { class: "r-side" }, ...(series.length >= 2 ? [legend] : []), table, ...(focus.size ? [h("div", { class: "hint" }, "◆ marks what your tactic leans on.")] : []), ...(opts.note ? [h("div", { class: "advice" }, opts.note)] : [])),
  );
  return root;
}
