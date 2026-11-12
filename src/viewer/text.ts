import type { MatchLog } from "../engine/types";
import { h } from "../dom";
import { describeLine, ratedPlayers } from "../league/awards";

/** Scorers list as plain text lines, with cards. */
export function scorerLines(m: MatchLog): string[] {
  const label: Record<string, string> = { try: "try", conversion: "con", "penalty-goal": "pen", "drop-goal": "drop", yellow: "YELLOW CARD", red: "RED CARD" };
  return m.events
    .filter((e) => e.type in label)
    .map((e) => `${String(e.minute).padStart(2)}'  ${(e.team === 0 ? m.homeName : m.awayName).padEnd(20)} ${e.player} (${label[e.type]})`);
}

/** Two-sided stat bars, FM match-summary style. */
export function statBars(m: MatchLog): HTMLElement {
  const [a, b] = m.stats;
  const total = a.possession + b.possession || 1;
  const rows: [string, number, number, string?][] = [
    ["Possession", Math.round((a.possession / total) * 100), Math.round((b.possession / total) * 100), "%"],
    ["Tries", a.tries, b.tries],
    ["Metres gained", a.metres, b.metres],
    ["Line breaks", a.lineBreaks, b.lineBreaks],
    ["Carries", a.carries, b.carries],
    ["Tackles", a.tackles, b.tackles],
    ["Kicks", a.kicks, b.kicks],
    ["Turnovers won", a.turnoversWon, b.turnoversWon],
    ["Errors", a.errors, b.errors],
    ["Penalties conceded", a.penaltiesConceded, b.penaltiesConceded],
    ["Yellow cards", a.yellows ?? 0, b.yellows ?? 0],
    ["Red cards", a.reds ?? 0, b.reds ?? 0],
  ];
  const box = h("div", { class: "stats" });
  for (const [label, l, r, unit = ""] of rows) {
    const sum = l + r || 1;
    box.append(
      h("div", { class: "statrow" },
        h("span", { class: "sv l" }, `${l}${unit}`),
        h("div", { class: "bar" }, h("i", { class: "home" }), h("i", { class: "away" })),
        h("span", { class: "sv r" }, `${r}${unit}`),
        h("span", { class: "sl" }, label)),
    );
    const bars = box.lastElementChild!.querySelectorAll<HTMLElement>(".bar i");
    bars[0].style.width = `${(l / sum) * 100}%`;
    bars[1].style.width = `${(r / sum) * 100}%`;
  }
  return box;
}

/** The best performers of a match, best first, as "Name (Club): what they did". Empty for old logs. */
export function standoutLines(m: MatchLog, count = 4): string[] {
  return ratedPlayers(m)
    .slice(0, count)
    .map((r) => `${r.line.name} (${r.club}): ${describeLine(r.line)}`);
}
