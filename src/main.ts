import { h } from "./dom";
import { ATTRS, ROLES, type MatchLog, type Player, type TacticId, type Team } from "./engine/types";
import { TACTICS, slotPlayer } from "./engine/match";
import {
  SAVE_VERSION,
  TRAINING,
  buildSim,
  isSeasonOver,
  managedFixture,
  newGame,
  playMatchday,
  startNextSeason,
  teamById,
  type SeasonState,
  type TrainingFocus,
} from "./league/season";
import { computeStandings, teamForm } from "./league/standings";
import { TEAM_DEFS, generateTeams, overall, teamRating } from "./league/teams";
import * as store from "./storage";
import { LiveMatch } from "./viewer/live";
import { buildTable } from "./viewer/table";

type Tab = "overview" | "squad" | "table" | "fixtures";
const TABS: [Tab, string][] = [
  ["overview", "1 Overview"],
  ["squad", "2 Squad"],
  ["table", "3 Table"],
  ["fixtures", "4 Fixtures"],
];

let state: SeasonState | null = null;
let tab: Tab = "overview";
let busy = false;
let live: LiveMatch | null = null;
let selectedPlayer: string | null = null;
let dir = "";
let error = "";

const app = document.getElementById("app") as HTMLElement;
const scoutDialog = h("dialog", { class: "scout" });
const rulesDialog = h("dialog", { class: "rules" });
document.body.append(scoutDialog, rulesDialog);

const ATTR_INFO: Record<(typeof ATTRS)[number], [string, string]> = {
  power: ["Power", "Strength. Breaks tackles and drives through defenders. Matters most for Anchors and Bruisers."],
  pace: ["Pace", "Speed. Gets runners through gaps and wins races. Matters most for Wingers."],
  handling: ["Handling", "Catching and passing. Fewer dropped balls (knock-ons) and fewer intercepted passes."],
  tackling: ["Tackling", "Stopping runners and stealing the ball. Your whole line's tackling is averaged."],
  kicking: ["Kicking", "Distance and accuracy of kicks for territory, conversions, penalties and drop goals."],
  stamina: ["Stamina", "Staying fresh. Tired players get slower, weaker and clumsier as the match goes on."],
};

function showRules() {
  const close = h("button", {}, "Close");
  close.onclick = () => rulesDialog.close();
  rulesDialog.replaceChildren(
    h("h2", {}, "How to play"),
    h("h3", {}, "The sport"),
    h("p", {}, "Dominion is five-a-side rugby on a 100m arena. There are only two ways to score. First, carry the ball over the other team's line and ground it for a TRY (5 points). Throwing or passing the ball into the end zone does NOT score. Second, kick it over the crossbar and between the posts: a CONVERSION after a try (+2), a PENALTY kick (3), or a DROP GOAL in open play (3)."),
    h("h3", {}, "Kicks at goal"),
    h("p", {}, "Every kick at goal cuts to a view from behind the kicker. A score goes between the uprights and over the bar, and flags go up. A miss can drift wide, drop short, or hit the post and bounce away. Occasionally one clips the post and still goes over."),
    h("h3", {}, "Possession"),
    h("p", {}, "The team with the ball can run it, pass it sideways or backwards (forward passes are not allowed), or kick it downfield to win territory. The ball is lost if the carrier is tackled six times, drops it forward (a KNOCK-ON), has a pass INTERCEPTED, has it stolen in the tackle (a TURNOVER), or is forced into touch (out of play, line-out to the other side). A high tackle gives away a penalty."),
    h("h3", {}, "The five positions"),
    h("ul", {},
      h("li", {}, "Anchor and Bruiser: heavy runners who crash into the defence."),
      h("li", {}, "Pivot: the playmaker. Distributes the ball and usually kicks."),
      h("li", {}, "Winger: fast finisher on the outside."),
      h("li", {}, "Sweeper: the last defender. Covers line breaks and catches kicks.")),
    h("h3", {}, "Highlights"),
    h("p", {}, "Most of a match is read as commentary. Big moments (tries, line breaks, kicks at goal, long kicks, interceptions, turnovers, costly knock-ons) switch to a top-down view. Look for set plays: the dummy run (a decoy drags a defender out), the loop, the switch, the crash ball and the long skip pass. Letters on the dots are positions: A, B, P, W, S."),
    h("h3", {}, "What you control"),
    h("p", {}, "Your starting five, your tactic, your training focus, and during a watched match: tactic changes, substitutions and the half-time team talk."),
    h("div", { class: "toolbar" }, close),
  );
  rulesDialog.showModal();
}

// ------------------------------------------------------------------ actions

async function persist(next: SeasonState, logs: MatchLog[] = []) {
  // Logs first, so a saved season never references a missing log.
  await store.writeMatchLogs(logs);
  await store.writeSave(next);
  state = next;
}

async function guarded(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try {
    error = "";
    await fn();
  } catch (e) {
    error = `Error: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy = false;
    render();
  }
}

const startNew = (teamId: string) =>
  guarded(async () => {
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0;
    await store.resetSave();
    await persist(newGame(seed, teamId));
    tab = "overview";
  });

/** Quick sim: play the whole matchday without watching. */
const quickSim = () => {
  const s = state;
  if (!s || isSeasonOver(s)) return;
  return guarded(async () => {
    const r = playMatchday(s);
    await persist(r.state, r.logs);
  });
};

const nextSeason = () => {
  const s = state;
  if (!s) return;
  return guarded(async () => {
    await persist(startNextSeason(s));
    tab = "overview";
  });
};

/** Watch your match live (paused at kick-off so you can still adjust). */
function watchMatch() {
  const s = state;
  if (!s || isSeasonOver(s)) return;
  const f = managedFixture(s);
  if (!f) return;
  const sim = buildSim(s, f);
  const managedSide = f.homeId === s.managedId ? 0 : 1;
  live = new LiveMatch({
    home: teamById(s, f.homeId),
    away: teamById(s, f.awayId),
    sim,
    managedSide,
    onExit: (log) => {
      live?.dispose();
      live = null;
      void guarded(async () => {
        // The tactic the manager ended on becomes their default for next time.
        const r = playMatchday(s, log);
        const used = managedSide === 0 ? log.homeTactic : log.awayTactic;
        r.state.tactic = used;
        await persist(r.state, r.logs);
        tab = "overview";
      });
    },
  });
  render();
}

function replayMatch(id: string) {
  const s = state;
  if (!s) return;
  void guarded(async () => {
    const log = await store.readMatchLog(id);
    if (!log) throw new Error("Match log not found on disk.");
    live = new LiveMatch({
      home: teamById(s, log.homeId),
      away: teamById(s, log.awayId),
      log,
      onExit: () => {
        live?.dispose();
        live = null;
        render();
      },
    });
  });
}

const update = (mut: (s: SeasonState) => void) => {
  const s = state;
  if (!s) return;
  const next = structuredClone(s);
  mut(next);
  return guarded(() => persist(next));
};

/** Swap two squad members: lineup <-> lineup swaps slots, lineup <-> bench replaces the starter. */
function swapPlayers(a: string, b: string) {
  void update((s) => {
    const team = teamById(s, s.managedId);
    const ia = team.lineup.indexOf(a);
    const ib = team.lineup.indexOf(b);
    if (ia >= 0 && ib >= 0) [team.lineup[ia], team.lineup[ib]] = [team.lineup[ib], team.lineup[ia]];
    else if (ia >= 0) team.lineup[ia] = b;
    else if (ib >= 0) team.lineup[ib] = a;
  });
}

function newGameFlow() {
  if (!window.confirm("Abandon this save and start a new game?")) return;
  state = null;
  render();
}

// ------------------------------------------------------------------ views

function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

function formChips(s: SeasonState, id: string): HTMLElement {
  const f = teamForm(s.fixtures, id);
  return h("span", { class: "form" }, ...(f.length ? f.map((r) => h("span", { class: `chip ${r}` }, r)) : [h("span", { class: "dim" }, "no games yet")]));
}

function playerTable(team: Team, opts: { selectable?: boolean } = {}): HTMLElement {
  const t = h("table", { class: "squad" });
  t.append(h("thead", {}, h("tr", {}, h("th", {}, "Slot"), h("th", { class: "club" }, "Player"), h("th", { title: "The position this player is best at" }, "Natural role"), h("th", {}, "Age"), ...ATTRS.map((a) => h("th", { title: ATTR_INFO[a][1] }, ATTR_INFO[a][0])), h("th", { title: "Average of the six ratings" }, "Overall"))));
  const body = h("tbody");
  const rows: [string, Player][] = [
    ...team.lineup.map((id, i) => [ROLES[i], team.players.find((p) => p.id === id)!] as [string, Player]),
    ...team.players.filter((p) => !team.lineup.includes(p.id)).map((p) => ["Bench", p] as [string, Player]),
  ];
  for (const [slot, p] of rows) {
    const oop = slot !== "Bench" && p.role !== slot;
    const shown = oop ? slotPlayer(p, slot as Player["role"]) : p;
    const tr = h("tr", { class: `${slot === "Bench" ? "bench" : "starter"} ${selectedPlayer === p.id ? "sel" : ""}` },
      h("td", { class: "slot" }, slot),
      h("td", { class: "club" }, p.name, oop ? h("span", { class: "oop", title: "Out of position: -5 to every attribute" }, " ⚠ -5") : null),
      h("td", {}, p.role),
      h("td", {}, String(p.age)),
      ...ATTRS.map((a) => h("td", { class: shown[a] < p[a] ? "dn" : "" }, String(shown[a]))),
      h("td", { class: "pts" }, String(overall(shown))));
    if (opts.selectable) {
      tr.classList.add("click");
      tr.onclick = () => {
        if (selectedPlayer === null) selectedPlayer = p.id;
        else if (selectedPlayer === p.id) selectedPlayer = null;
        else {
          const a = selectedPlayer;
          selectedPlayer = null;
          swapPlayers(a, p.id);
          return;
        }
        render();
      };
    }
    body.append(tr);
  }
  t.append(body);
  return t;
}

function scout(s: SeasonState, id: string) {
  const team = teamById(s, id);
  const close = h("button", {}, "Close");
  close.onclick = () => scoutDialog.close();
  scoutDialog.replaceChildren(
    h("h2", {}, team.name),
    h("div", { class: "dim" }, `Rating ${teamRating(team)}  |  Usual style: ${TACTICS[team.style].label}  |  Form: `, formChips(s, id)),
    playerTable(team),
    h("div", { class: "toolbar" }, close),
  );
  scoutDialog.showModal();
}

function card(title: string, ...kids: (Node | string)[]): HTMLElement {
  return h("section", { class: "card" }, h("h2", {}, title), ...kids);
}

function overviewView(s: SeasonState): HTMLElement {
  const me = teamById(s, s.managedId);
  const ids = s.teams.map((t) => t.id);
  const table = computeStandings(ids, s.fixtures);
  const pos = table.findIndex((r) => r.teamId === s.managedId) + 1;
  const left = h("div", { class: "col" });

  if (isSeasonOver(s)) {
    const champ = teamById(s, table[0].teamId);
    const next = h("button", { class: "primary" }, "Start next season");
    next.onclick = () => void nextSeason();
    left.append(card(`Season ${s.season} complete`, h("p", {}, `Champions: ${champ.name}`), h("p", {}, `Your finish: ${ordinal(pos)} of ${table.length}`), next));
  } else {
    const f = managedFixture(s)!;
    const home = f.homeId === s.managedId;
    const opp = teamById(s, home ? f.awayId : f.homeId);
    const oppPos = table.findIndex((r) => r.teamId === opp.id) + 1;
    const watch = h("button", { class: "primary big" }, "▶ Watch match");
    watch.onclick = watchMatch;
    const sim = h("button", {}, "Quick sim (Space)");
    sim.onclick = () => void quickSim();
    const sc = h("button", {}, `Scout ${opp.short}`);
    sc.onclick = () => scout(s, opp.id);
    left.append(
      card(
        `Matchday ${s.matchday} of ${s.totalMatchdays}`,
        h("div", { class: "fixture" },
          h("div", { class: "side" }, h("b", {}, home ? me.name : opp.name), h("div", { class: "dim" }, home ? `${ordinal(pos)}` : `${ordinal(oppPos)}`)),
          h("div", { class: "vs" }, "v"),
          h("div", { class: "side" }, h("b", {}, home ? opp.name : me.name), h("div", { class: "dim" }, home ? `${ordinal(oppPos)}` : `${ordinal(pos)}`))),
        h("div", { class: "dim" }, `${home ? "Home" : "Away"}  |  Your tactic: ${TACTICS[s.tactic].label}  |  Rating ${teamRating(me)} v ${teamRating(opp)}`),
        h("div", { class: "dim" }, "Opposition form: ", formChips(s, opp.id)),
        h("div", { class: "toolbar" }, watch, sim, sc),
        h("div", { class: "hint" }, "Set your lineup, tactic and training on the Squad tab first. Watching lets you change tactics, substitute and give a half-time talk as it happens."),
      ),
    );
  }

  const last = s.fixtures.filter((f) => f.result && (f.homeId === s.managedId || f.awayId === s.managedId)).pop();
  if (last) {
    const r = last.result!;
    const btn = h("button", {}, "Replay");
    btn.onclick = () => replayMatch(last.id);
    left.append(card(`Last result (matchday ${last.matchday})`, h("div", { class: "result" }, `${teamById(s, last.homeId).name}  ${r.homeScore} - ${r.awayScore}  ${teamById(s, last.awayId).name}`), h("div", { class: "toolbar" }, btn)));
  }

  left.append(card("Club news", h("ul", { class: "news" }, ...s.news.slice(0, 8).map((n) => h("li", {}, h("span", { class: "dim" }, n.matchday ? `S${n.season} MD${n.matchday}  ` : `S${n.season}  `), n.text)))));

  const right = h("div", { class: "col" }, card("League table", buildTable(s, { compact: true, onClub: (id) => (id === s.managedId ? undefined : scout(s, id)) })));
  return h("div", { class: "grid" }, left, right);
}

function squadView(s: SeasonState): HTMLElement {
  const team = teamById(s, s.managedId);
  const hint = selectedPlayer
    ? "Now click another player to swap places with them (or click the same player to cancel)."
    : "Click a player, then click another, to swap them. Starters fill the five slots in order; bench players can replace any starter.";

  const tactics = h("div", { class: "choices" });
  for (const [id, t] of Object.entries(TACTICS)) {
    const b = h("button", { class: `choice ${s.tactic === id ? "active" : ""}` }, h("b", {}, t.label), h("span", {}, t.description));
    b.onclick = () => void update((x) => void (x.tactic = id as TacticId));
    tactics.append(b);
  }
  const training = h("div", { class: "choices" });
  for (const [id, t] of Object.entries(TRAINING)) {
    const b = h("button", { class: `choice ${s.training === id ? "active" : ""}` }, h("b", {}, t.label), h("span", {}, t.description));
    b.onclick = () => void update((x) => void (x.training = id as TrainingFocus));
    training.append(b);
  }
  return h("div", { class: "col" },
    card(`${team.name} - starting five & bench`, h("div", { class: "hint" }, hint), playerTable(team, { selectable: true })),
    card("What the ratings mean (0-100, hover a column for the same tip)", h("div", { class: "legend" }, ...ATTRS.flatMap((a) => [h("b", {}, ATTR_INFO[a][0]), h("span", {}, ATTR_INFO[a][1])]))),
    h("div", { class: "grid" },
      card("Your tactic", tactics),
      card("Training focus", h("div", { class: "hint" }, "After each matchday three players get a chance to improve in this area."), training)),
  );
}

function fixturesView(s: SeasonState): HTMLElement {
  const wrap = h("div", { class: "col" });
  for (let md = 1; md <= s.totalMatchdays; md++) {
    const box = h("section", { class: `card ${md === s.matchday ? "current" : ""}` }, h("h2", {}, `Matchday ${md}`));
    for (const f of s.fixtures.filter((x) => x.matchday === md)) {
      const mine = f.homeId === s.managedId || f.awayId === s.managedId;
      const row = h("div", { class: `frow ${mine ? "mine" : ""}` },
        h("span", { class: "h" }, teamById(s, f.homeId).name),
        h("span", { class: "sc" }, f.result ? `${f.result.homeScore} - ${f.result.awayScore}` : "v"),
        h("span", { class: "a" }, teamById(s, f.awayId).name));
      if (f.result) {
        const b = h("button", {}, "Replay");
        b.onclick = () => replayMatch(f.id);
        row.append(b);
      }
      box.append(row);
    }
    wrap.append(box);
  }
  return wrap;
}

function pickerView(): HTMLElement {
  const teams = generateTeams(1);
  const box = h("div", { class: "picker" }, h("h1", {}, "ARENA LEAGUE MANAGER"), h("p", { class: "dim" }, "Dominion: five-a-side rugby for territory. Choose the club you will manage for the season."));
  for (const def of TEAM_DEFS) {
    const t = teams.find((x) => x.id === def.id)!;
    const b = h("button", { class: "pick" }, h("b", {}, def.name), h("span", { class: "dim" }, `Style: ${TACTICS[def.style].label}   Rating ~${teamRating(t)}`));
    b.onclick = () => void startNew(def.id);
    box.append(b);
  }
  const help = h("button", {}, "How to play");
  help.onclick = showRules;
  box.append(h("p", { class: "dim" }, "Ratings are indicative; squads are generated when you start."), help);
  return box;
}

// ------------------------------------------------------------------ shell

function render() {
  app.replaceChildren();
  if (live) {
    app.append(live.root);
    return;
  }
  if (!state) {
    app.append(h("main", {}, pickerView()));
    if (error) app.append(h("div", { class: "err" }, error));
    return;
  }
  const s = state;
  const nav = h("nav");
  for (const [id, label] of TABS) {
    const b = h("button", { class: id === tab ? "active" : "" }, label);
    b.onclick = () => {
      tab = id;
      selectedPlayer = null;
      render();
    };
    nav.append(b);
  }
  const over = isSeasonOver(s);
  const quick = h("button", { disabled: busy || over }, "Quick sim");
  quick.onclick = () => void quickSim();
  const watch = h("button", { class: "primary", disabled: busy || over }, "▶ Watch match");
  watch.onclick = watchMatch;
  const newBtn = h("button", {}, "New game");
  newBtn.onclick = newGameFlow;
  const helpBtn = h("button", {}, "How to play");
  helpBtn.onclick = showRules;
  app.append(h("header", {}, h("h1", {}, "ARENA LEAGUE"), nav, h("span", { class: "spacer" }), h("span", { class: "dim" }, `${teamById(s, s.managedId).name} | Season ${s.season}`), watch, quick, helpBtn, newBtn));

  const body = h("main");
  if (tab === "overview") body.append(overviewView(s));
  else if (tab === "squad") body.append(squadView(s));
  else if (tab === "table") body.append(card("League table", buildTable(s, { onClub: (id) => (id === s.managedId ? undefined : scout(s, id)) }), h("div", { class: "hint" }, "▲▼ = places moved since the previous matchday. Win 4, draw 2, +1 for 3+ tries (TF), +1 for losing by 7 or fewer (BP). Click a club to scout it.")));
  else body.append(fixturesView(s));
  app.append(body);
  if (error) app.append(h("div", { class: "err" }, error));
  app.append(h("footer", {}, `Saved automatically  |  Data: ${dir}`));
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (["SELECT", "INPUT", "BUTTON"].includes(target.tagName)) return;
  if (scoutDialog.open || rulesDialog.open) return;
  if (live) {
    if (e.key === " ") {
      e.preventDefault();
      live.keyToggle();
    }
    return;
  }
  if (!state) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    void (isSeasonOver(state) ? nextSeason() : quickSim());
    return;
  }
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < TABS.length) {
    tab = TABS[idx][0];
    selectedPlayer = null;
    render();
  }
});

async function boot() {
  dir = await store.dataDir().catch(() => "");
  try {
    const raw = await store.loadSave();
    if (raw) {
      const parsed = JSON.parse(raw) as SeasonState;
      if (parsed.version !== SAVE_VERSION) throw new Error(`save is from an older version (${parsed.version}); this build needs version ${SAVE_VERSION}`);
      state = parsed;
    }
  } catch (e) {
    error = `Could not read saved season (${e instanceof Error ? e.message : String(e)}). Picking a club will start a new game and overwrite it.`;
  }
  render();
}

void boot();
