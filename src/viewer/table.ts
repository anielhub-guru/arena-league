import { h } from "../dom";
import { teamById, type SeasonState } from "../league/season";
import { lastPlayedMatchday, standingsAt, teamForm } from "../league/standings";

export interface TableOptions {
  compact?: boolean;
  onClub?: (teamId: string) => void;
}

/** Football Manager style league table: movement arrows, form chips, highlighted club. */
export function buildTable(s: SeasonState, opts: TableOptions = {}): HTMLElement {
  const ids = s.teams.map((t) => t.id);
  const last = lastPlayedMatchday(s.fixtures);
  const now = standingsAt(ids, s.fixtures, last);
  const prev = last >= 2 ? standingsAt(ids, s.fixtures, last - 1) : null;
  const prevPos = new Map(prev?.map((r, i) => [r.teamId, i + 1]));

  const cols = opts.compact
    ? ["#", "", "Club", "P", "+/-", "Pts", "Form"]
    : ["#", "", "Club", "P", "W", "D", "L", "PF", "PA", "+/-", "TF", "BP", "Pts", "Form"];
  const table = h("table", { class: "league" });
  table.append(h("thead", {}, h("tr", {}, ...cols.map((c, i) => h("th", { class: i === 2 ? "club" : "" }, c)))));
  const body = h("tbody");
  now.forEach((r, i) => {
    const pos = i + 1;
    const team = teamById(s, r.teamId);
    let arrow = h("span", { class: "mv same" }, "–");
    const old = prevPos.get(r.teamId);
    if (old !== undefined && old !== pos) {
      const d = old - pos;
      arrow = h("span", { class: `mv ${d > 0 ? "up" : "down"}` }, `${d > 0 ? "▲" : "▼"}${Math.abs(d)}`);
    }
    const form = h("td", { class: "form" }, ...teamForm(s.fixtures, r.teamId).map((f) => h("span", { class: `chip ${f}` }, f)));
    const diff = r.pointsFor - r.pointsAgainst;
    const nameCell = h("td", { class: "club" }, team.name);
    const cells = opts.compact
      ? [h("td", {}, String(r.played)), h("td", {}, diff > 0 ? `+${diff}` : String(diff)), h("td", { class: "pts" }, String(r.points))]
      : [
          ...[r.played, r.won, r.drawn, r.lost, r.pointsFor, r.pointsAgainst].map((v) => h("td", {}, String(v))),
          h("td", {}, diff > 0 ? `+${diff}` : String(diff)),
          h("td", {}, String(r.triesFor)),
          h("td", {}, String(r.bonus)),
          h("td", { class: "pts" }, String(r.points)),
        ];
    const tr = h("tr", { class: `${r.teamId === s.managedId ? "you" : ""} ${pos === 1 && last > 0 ? "leader" : ""}` }, h("td", { class: "pos" }, String(pos)), h("td", {}, arrow), nameCell, ...cells, form);
    if (opts.onClub) {
      tr.classList.add("click");
      tr.onclick = () => opts.onClub!(r.teamId);
    }
    body.append(tr);
  });
  table.append(body);
  return table;
}
