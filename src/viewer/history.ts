import { h } from "../dom";
import { LEGEND_MIN_SEASONS, RECORD_KEYS, RECORD_META } from "../league/history";
import { isSeasonOver, seasonRecordFor, teamById, type SeasonRecord, type SeasonState } from "../league/season";

const name = (s: SeasonState, id?: string) => (id ? teamById(s, id).name : "-");

/** Completed seasons, plus the season just finished if the next one has not started yet. */
export function allSeasons(s: SeasonState): SeasonRecord[] {
  const done = [...s.history];
  if (isSeasonOver(s) && !done.some((r) => r.season === s.season)) done.push(seasonRecordFor(s));
  return done;
}

function table(head: string[], rows: (string | HTMLElement)[][], cls = "squad"): HTMLElement {
  const t = h("table", { class: cls }, h("thead", {}, h("tr", {}, ...head.map((x, i) => h("th", { class: i === 0 ? "club" : "" }, x)))));
  const body = h("tbody");
  for (const r of rows) body.append(h("tr", {}, ...r.map((c, i) => h("td", { class: i === 0 ? "club" : "" }, c))));
  t.append(body);
  return t;
}

/** Champions by year. */
export function championsCard(s: SeasonState): HTMLElement {
  const seasons = allSeasons(s);
  const sec = h("section", { class: "card" }, h("h2", {}, "Champions by year"));
  if (!seasons.length) return (sec.append(h("div", { class: "hint" }, "No seasons completed yet. Each champion is recorded here at the end of the season.")), sec);
  const titles = new Map<string, number>();
  for (const r of seasons) titles.set(r.championId, (titles.get(r.championId) ?? 0) + 1);
  const rows = [...seasons].reverse().map((r) => [
    `Season ${r.season}`,
    name(s, r.championId) + (r.championPoints !== undefined ? ` (${r.championPoints} pts)` : ""),
    name(s, r.runnerUpId),
    r.topScorer ? `${r.topScorer.name}, ${name(s, r.topScorer.clubId)} (${r.topScorer.points})` : "-",
    r.clubId ? `${name(s, r.clubId)}: ${r.managedPosition}` : String(r.managedPosition),
  ]);
  sec.append(table(["Season", "Champions", "Runners-up", "Top scorer (pts)", "You finished"], rows));
  const counts = [...titles].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${name(s, id)} ${n}`);
  sec.append(h("div", { class: "hint" }, `Titles: ${counts.join(", ")}.`));
  return sec;
}

/** One club's records and retired legends, with a picker for which club. */
export function clubCard(s: SeasonState, clubId: string, pick: (id: string) => void): HTMLElement {
  const recs = s.records[clubId];
  const select = h("select", { title: "Choose a club" });
  for (const t of s.teams) select.append(h("option", { value: t.id, selected: t.id === clubId }, t.name));
  select.onchange = () => pick(select.value);
  const sec = h("section", { class: "card" }, h("h2", {}, "Club records"), h("div", { class: "toolbar" }, select));
  if (recs) {
    const rows = RECORD_KEYS.map((k) => {
      const r = recs[k];
      const who = RECORD_META[k].kind === "player" ? r.holder : r.vs ? `vs ${r.vs}` : "";
      const when = r.season === 0 ? "Before the league" : `Season ${r.season}`;
      return [RECORD_META[k].label, String(r.value), who || "-", r.season === 0 ? when : r.vs && RECORD_META[k].kind === "player" ? `${when}, vs ${r.vs}` : when];
    });
    sec.append(table(["Record", "Value", "Holder", "Set"], rows));
    sec.append(h("div", { class: "hint" }, "Founding records are set by the club's standing before the league began. Break one and it goes in the club news."));
  }
  const legends = s.legends[clubId] ?? [];
  sec.append(h("h2", { class: "sub" }, "Retired legends"));
  if (!legends.length) sec.append(h("div", { class: "hint" }, `Players who retire after ${LEGEND_MIN_SEASONS} or more seasons are remembered here, by the club they retired from.`));
  else sec.append(table(["Player", "Role", "Retired", "Seasons", "Apps", "Points", "Tries", "Tackles"], legends.map((l) => [l.name, l.role, `Season ${l.season}, age ${l.age}`, String(l.seasons), String(l.apps), String(l.points), String(l.tries), String(l.tackles)])));
  return sec;
}
