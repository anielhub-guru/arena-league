import { h } from "./dom";
import menPortrait from "./assets/men.png";
import womenPortrait from "./assets/women.png";
import { ATTRS, ROLES, type Gender, type MatchLog, type Player, type ShapeId, type TacticId, type Team } from "./engine/types";
import { SHAPES, TACTICS, adviseShape, attackFit, slotPlayer } from "./engine/match";
import { MAX_BUYS, fmtMoney, sellPrice, teenSalePrice, wageOf } from "./league/economy";
import {
  TRAINING,
  buildSim,
  careerLine,
  isSeasonOver,
  isSuspended,
  managedFixture,
  migrateSave,
  newGame,
  playMatchday,
  startNextSeason,
  teamById,
  type SeasonState,
  type TrainingFocus,
  autoPlan,
  checkPlan,
  completeOffseason,
  type OffseasonPlan,
} from "./league/season";
import { computeStandings, teamForm } from "./league/standings";
import { TEAM_DEFS, clubObjective, generateTeams, overall, potentialStars, teamRating } from "./league/teams";
import * as store from "./storage";
import { LiveMatch } from "./viewer/live";
import { ATTR_NAMES, TACTIC_FOCUS, bestFive, buildRadar, playerProfile, profileOf } from "./viewer/radar";
import { buildRules } from "./viewer/rules";
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
/** Which stats the Squad tab shows. */
let statsMode: "season" | "career" = "season";
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
  rulesDialog.replaceChildren(buildRules(() => rulesDialog.close()));
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

/** League chosen on the new-game screen (null until picked). */
let pickGender: Gender | null = null;

const startNew = (teamId: string) =>
  guarded(async () => {
    if (!pickGender) return;
    // Clubs are fixed; players are generated from this random seed, so every new game differs.
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0;
    await store.resetSave();
    await persist(newGame(seed, teamId, pickGender));
    tab = "overview";
  });

/** Quick sim: play the whole matchday without watching. */
const quickSim = () => {
  const s = state;
  if (!s || isSeasonOver(s) || s.intake) return;
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
  if (!s || isSeasonOver(s) || s.intake) return;
  const f = managedFixture(s);
  if (!f) return;
  const sim = buildSim(s, f, true);
  const managedSide = f.homeId === s.managedId ? 0 : 1;
  live = new LiveMatch({
    onHelp: showRules,
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
    onHelp: showRules,
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
  const team0 = state ? teamById(state, state.managedId) : null;
  if (team0) {
    // Whoever comes off the bench into the starting five must be free to play.
    const inA = team0.lineup.includes(a);
    const inB = team0.lineup.includes(b);
    const entering = inA && !inB ? b : inB && !inA ? a : null;
    const player = entering ? team0.players.find((x) => x.id === entering) : null;
    if (player && isSuspended(player)) {
      error = `${player.name} is suspended and cannot start the next match.`;
      render();
      return;
    }
  }
  error = "";
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
  pickGender = null;
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
  const showPot = team.id === state?.managedId;
  t.append(h("thead", {}, h("tr", {}, h("th", {}, "Slot"), h("th", { class: "club" }, "Player"), h("th", { title: "The position this player is best at" }, "Natural role"), h("th", {}, "Age"), ...(showPot ? [h("th", { title: "Potential: how good this player can become, 1 to 5 stars. Growth and training stop at this ceiling, and it falls with age." }, "Pot")] : []), ...ATTRS.map((a) => h("th", { title: ATTR_INFO[a][1] }, ATTR_INFO[a][0])), h("th", { title: "Average of the six ratings" }, "Overall"))));
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
      h("td", { class: "club" }, p.name, oop ? h("span", { class: "oop", title: "Out of position: -5 to every attribute" }, " ⚠ -5") : null, isSuspended(p) ? h("span", { class: "card-chip r", title: "Sent off in the last match: misses the next one" }, "SUSPENDED") : null, (p.tired ?? 0) >= 8 ? h("span", { class: "oop", title: `Tired from recent matches (${Math.round(p.tired!)}/100): starts the match slightly weaker and tires faster. High stamina recovers quicker. Rest a player to freshen them.` }, (p.tired ?? 0) >= 20 ? " ● Tired" : " ● Weary") : null, p.retiring ? h("span", { class: "card-chip r", title: "Retires when you confirm your offseason signings" }, "RETIRING") : null),
      h("td", {}, p.role),
      h("td", {}, String(p.age)),
      ...(showPot ? [h("td", { class: "stars", title: `Potential ${p.potential ?? "?"}` }, p.potential ? stars(p.potential) : "")] : []),
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

/** Season or career stats for a squad, with a toggle. */
function statsTable(s: SeasonState, team: Team, rerender: () => void): HTMLElement {
  const cols: [string, string, string][] = [
    ["Apps", "apps", "Matches played"],
    ["Pts", "points", "Points scored (tries 5, conversions 2, penalty goals 3, drop goals 3)"],
    ["Tries", "tries", "Tries scored"],
    ["Kick pts", "kick", "Points from conversions, penalty goals and drop goals"],
    ["Carries", "carries", "Times carrying the ball into contact"],
    ["Metres", "metres", "Metres gained carrying the ball"],
    ["Breaks", "lineBreaks", "Line breaks"],
    ["Tackles", "tackles", "Tackles made"],
    ["Turnovers", "turnovers", "Turnovers won (jackals and interceptions)"],
    ["YC", "yellows", "Yellow cards (10 minutes in the sin bin)"],
    ["RC", "reds", "Red cards (sent off and suspended for a match)"],
  ];
  const season = statsMode === "season";
  const toggle = h("div", { class: "toolbar" });
  for (const m of ["season", "career"] as const) {
    const btn = h("button", { class: statsMode === m ? "active" : "" }, m === "season" ? `Season ${s.season}` : "Career");
    btn.onclick = () => {
      statsMode = m;
      rerender();
    };
    toggle.append(btn);
  }
  const t = h("table", { class: "squad stats" });
  t.append(h("thead", {}, h("tr", {}, h("th", { class: "club" }, "Player"), ...(season ? [] : [h("th", { title: "Seasons played, including this one" }, "Seasons")]), ...cols.map(([c, , tipText]) => h("th", { title: tipText }, c)))));
  const body = h("tbody");
  for (const p of team.players) {
    const tot = season ? (s.seasonStats[p.id] ?? null) : careerLine(s, p.id);
    const get = (k: string): number => {
      if (!tot) return 0;
      if (k === "kick") return tot.conversions * 2 + tot.penaltyGoals * 3 + tot.dropGoals * 3;
      return (tot as unknown as Record<string, number>)[k] ?? 0;
    };
    body.append(h("tr", {}, h("td", { class: "club" }, p.name), ...(season ? [] : [h("td", {}, String(careerLine(s, p.id).seasons))]), ...cols.map(([, k]) => h("td", { class: k === "yellows" && get(k) ? "yc" : k === "reds" && get(k) ? "rc" : "" }, String(get(k))))));
  }
  t.append(body);
  return h("div", {}, toggle, t);
}

function scout(s: SeasonState, id: string) {
  const team = teamById(s, id);
  const close = h("button", {}, "Close");
  close.onclick = () => scoutDialog.close();
  scoutDialog.replaceChildren(
    h("h2", {}, team.name),
    h("div", { class: "dim" }, `Rating ${teamRating(team)}  |  Usual style: ${TACTICS[team.style].label}  |  Form: `, formChips(s, id)),
    playerTable(team),
    h("h3", { class: "sub" }, "Stats"),
    statsTable(s, team, () => scout(s, id)),
    h("div", { class: "toolbar" }, close),
  );
  if (!scoutDialog.open) scoutDialog.showModal();
}

function card(title: string, ...kids: (Node | string)[]): HTMLElement {
  return h("section", { class: "card" }, h("h2", {}, title), ...kids);
}

const stars = (v: number) => "★".repeat(potentialStars(v)) + "☆".repeat(5 - potentialStars(v));

/** The offseason plan being built on screen. It starts from the sensible default and the manager changes it. */
let plan: OffseasonPlan = { sell: [], sign: [], buy: [] };
/** Squad tab: what to compare the team shape with. Offseason: the player whose profile is open. */
let radarVs: "opp" | "league" = "opp";
let inspectId: string | null = null;
let planKey = "";

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function offseasonCard(s: SeasonState): HTMLElement {
  const intake = s.intake!;
  const key = `${s.seed}:${s.season}`;
  if (planKey !== key) {
    plan = autoPlan(s);
    planKey = key;
  }
  const team = teamById(s, s.managedId);
  const check = checkPlan(s, plan);
  const retiring = new Set(intake.retiring);
  const inspect = (id: string) => {
    inspectId = inspectId === id ? null : id;
    render();
  };
  const attrHead = ATTRS.map((a) => h("th", { title: ATTR_INFO[a][1] }, ATTR_INFO[a][0]));
  const attrCells = (p: Player) => ATTRS.map((a) => h("td", {}, String(p[a])));
  const act = (label: string, on: boolean, fn: () => void, disabled = false) => {
    const b = h("button", { class: on ? "primary" : "", disabled }, label);
    b.onclick = () => {
      fn();
      render();
    };
    return b;
  };

  // 1. Your squad: sell anyone not retiring.
  const squad = h("table", { class: "squad" });
  squad.append(h("thead", {}, h("tr", {}, h("th", { class: "club" }, "Your squad"), h("th", {}, "Role"), h("th", {}, "Age"), h("th", {}, "Pot"), ...attrHead, h("th", {}, "Overall"), h("th", { title: "What a club pays you for them" }, "Sale price"), h("th", { title: "Paid each season" }, "Wage"), h("th", {}, ""))));
  const sb = h("tbody");
  for (const p of team.players) {
    const gone = retiring.has(p.id);
    const sold = plan.sell.includes(p.id);
    sb.append(
      h("tr", { class: gone || sold ? "bench" : "" },
        h("td", { class: "club link", title: "Show profile", onclick: () => inspect(p.id) }, p.name, gone ? h("span", { class: "card-chip r" }, "RETIRING") : null, sold ? h("span", { class: "card-chip y" }, "SELLING") : null),
        h("td", {}, p.role), h("td", {}, String(p.age)), h("td", { class: "stars" }, stars(p.potential ?? 0)), ...attrCells(p),
        h("td", { class: "pts" }, String(overall(p))), h("td", {}, fmtMoney(sellPrice(p))), h("td", {}, fmtMoney(wageOf(p))),
        h("td", {}, gone ? "" : act(sold ? "Keep" : "Sell", sold, () => (plan = { ...plan, sell: toggle(plan.sell, p.id) })))),
    );
  }
  squad.append(sb);

  // 2. Youth shortlist. Unpicked prospects are sold, so signing one costs you that sale.
  const vacated = new Set(intake.retiring.map((id) => team.players.find((p) => p.id === id)!.role));
  const youth = h("table", { class: "squad" });
  youth.append(h("thead", {}, h("tr", {}, h("th", { class: "club" }, "Youth shortlist"), h("th", {}, "Role"), h("th", {}, "Age"), h("th", { title: "Scouting estimate of how good they can become. Reports can be off by about a star." }, "Potential"), ...attrHead, h("th", {}, "Overall"), h("th", { title: "What you get if you do not sign them" }, "Sale if unsigned"), h("th", {}, ""))));
  const yb = h("tbody");
  for (const p of intake.prospects) {
    const on = plan.sign.includes(p.id);
    yb.append(
      h("tr", { class: on ? "sel" : "" },
        h("td", { class: "club link", title: "Show profile", onclick: () => inspect(p.id) }, p.name, vacated.has(p.role) ? h("span", { class: "oop", title: "Fills a retirement" }, " ●") : null),
        h("td", {}, p.role), h("td", {}, String(p.age)), h("td", { class: "stars" }, stars(p.scouted ?? 0)), ...attrCells(p),
        h("td", { class: "pts" }, String(overall(p))), h("td", {}, fmtMoney(teenSalePrice(p))),
        h("td", {}, act(on ? "Signed" : "Sign", on, () => (plan = { ...plan, sign: toggle(plan.sign, p.id) })))),
    );
  }
  youth.append(yb);

  // 3. Transfer list: other clubs' players. You see their ratings, not their true potential.
  const market = h("table", { class: "squad" });
  market.append(h("thead", {}, h("tr", {}, h("th", { class: "club" }, "Transfer list"), h("th", {}, "Club"), h("th", {}, "Role"), h("th", {}, "Age"), h("th", { title: "Scouting estimate, not the truth" }, "Potential"), ...attrHead, h("th", {}, "Overall"), h("th", {}, "Asking"), h("th", {}, ""))));
  const mb = h("tbody");
  for (const l of intake.market) {
    const p = l.player;
    const on = plan.buy.includes(p.id);
    mb.append(
      h("tr", { class: on ? "sel" : "" },
        h("td", { class: "club link", title: "Show profile", onclick: () => inspect(p.id) }, p.name), h("td", {}, teamById(s, l.clubId).short), h("td", {}, p.role), h("td", {}, String(p.age)), h("td", { class: "stars" }, stars(p.scouted ?? 0)), ...attrCells(p),
        h("td", { class: "pts" }, String(overall(p))), h("td", {}, fmtMoney(l.price)),
        h("td", {}, act(on ? "Buying" : "Buy", on, () => (plan = { ...plan, buy: toggle(plan.buy, p.id) }), !on && plan.buy.length >= MAX_BUYS))),
    );
  }
  market.append(mb);

  /** Your best five now against after your plan, plus the profile of whoever you clicked. */
  function radarBlocks(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (check.roster.length >= 5) {
      out.push(h("div", { class: "hint" }, "Your best five now (before retirements) against after your plan. Click any name below to see that player's profile."));
      out.push(buildRadar(
        [
          { id: "after", label: "After your plan", values: profileOf(bestFive(check.roster)), color: "--r1" },
          { id: "now", label: "Now", values: profileOf(bestFive(team.players)), color: "--r2", alt: true },
        ],
        { title: "Starting five, now and after your plan", focus: TACTIC_FOCUS[s.tactic], note: s.tactic === "balanced" ? undefined : `Your tactic is ${TACTICS[s.tactic].label}.` },
      ));
    }
    const who = inspectId ? [...team.players, ...intake.prospects, ...intake.market.map((l) => l.player)].find((p) => p.id === inspectId) : null;
    if (who) {
      const own = team.players.some((p) => p.id === who.id);
      const rival = own
        ? null
        : team.players.filter((p) => p.role === who.role).sort((a, b) => Number(retiring.has(a.id)) - Number(retiring.has(b.id)) || overall(b) - overall(a))[0] ?? null;
      const base = rival;
      out.push(buildRadar(
        [
          { id: "who", label: who.name, values: playerProfile(who), color: "--r1" },
          base ? { id: "base", label: `${base.name} (yours)`, values: playerProfile(base), color: "--r2", alt: true } : { id: "base", label: "Your best five", values: profileOf(bestFive(team.players)), color: "--r2", alt: true },
        ],
        { title: `Profile of ${who.name}`, note: `${who.role}, age ${who.age}, overall ${overall(who)}. Potential is a scouting estimate for players who are not yours: ${stars(who.scouted ?? who.potential ?? 0)}.` },
      ));
    }
    return out;
  }
  const confirm = h("button", { class: "primary", disabled: busy || !check.ok }, "Confirm and start the season");
  confirm.onclick = () => void guarded(async () => void (await persist(completeOffseason(s, plan))));
  const reset = h("button", {}, "Reset to default");
  reset.onclick = () => {
    plan = autoPlan(s);
    render();
  };
  const money = (label: string, v: number, sign = "") => h("span", { class: "dim" }, `${label} ${sign}${fmtMoney(v)}   `);
  const summary = h("div", { class: "advice" },
    h("b", {}, `Squad ${check.size}/8   `), money("Balance now", s.money), money("Unpicked prospects sold", check.teenIncome, "+"), money("Sales", check.sellIncome, "+"), money("Purchases", check.buyCost, "-"), h("b", {}, `Balance after ${fmtMoney(check.moneyAfter)}`));
  return card(
    `Season ${s.season}: offseason`,
    h("p", { class: "dim" }, "Everything here is optional except refilling the squad to eight. Retirees leave, young prospects grow toward a potential you can only estimate, and prospects you do not sign are sold for income. Other clubs' players on the transfer list are priced by what they are really worth, so a good eye finds a bargain and a bad one finds a trap."),
    summary,
    ...(check.problems.length ? [h("div", { class: "err" }, check.problems.join(" "))] : []),
    ...radarBlocks(),
    squad,
    h("div", { class: "hint" }, `Youth shortlist: ● marks a position that lost a player. Prospects start weaker than established players and grow, so a teenager is an investment.`),
    youth,
    h("div", { class: "hint" }, `Transfer list: at most ${MAX_BUYS} signings per offseason. The selling club replaces the player with a youngster.`),
    market,
    h("div", { class: "toolbar" }, confirm, reset),
  );
}

function overviewView(s: SeasonState): HTMLElement {
  const me = teamById(s, s.managedId);
  const ids = s.teams.map((t) => t.id);
  const table = computeStandings(ids, s.fixtures);
  const pos = table.findIndex((r) => r.teamId === s.managedId) + 1;
  const left = h("div", { class: "col" });

  if (s.intake) {
    left.append(offseasonCard(s));
  } else if (isSeasonOver(s)) {
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
        h("div", { class: "dim" }, `${home ? "Home" : "Away"}  |  Your tactic: ${TACTICS[s.tactic].label}  |  Shape: ${SHAPES[s.shape].label}  |  Rating ${teamRating(me)} v ${teamRating(opp)}`),
        h("div", { class: "dim" }, "Opposition form: ", formChips(s, opp.id)),
        h("div", { class: "dim" }, `Club goal: ${clubObjective(s.managedId, s.history[s.history.length - 1]?.managedPosition)}`),
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
    left.append(card(`Last result (matchday ${last.matchday})`, h("div", { class: "result" }, `${teamById(s, last.homeId).name}  ${r.homeScore} - ${r.awayScore}  ${teamById(s, last.awayId).name}`), ...(r.potm ? [h("div", { class: "potm-line" }, `★ Player of the match: ${r.potm.name} (${r.potm.club}), rating ${r.potm.rating.toFixed(1)}`)] : []), h("div", { class: "toolbar" }, btn)));
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

  const starters = team.lineup.map((id, i) => slotPlayer(team.players.find((p) => p.id === id)!, ROLES[i]));
  const fit = attackFit(starters);
  const skill = Math.round(starters.reduce((t, p) => t + (p.pace + p.handling) / 2, 0) / starters.length);
  const fitText = fit >= 0.6 ? "well suited" : fit >= 0.1 ? "a reasonable fit" : fit >= -0.3 ? "a poor fit" : "badly suited";
  const tactics = h("div", { class: "choices" });
  for (const [id, t] of Object.entries(TACTICS)) {
    const b = h("button", { class: `choice ${s.tactic === id ? "active" : ""}` }, h("b", {}, t.label), h("span", {}, t.description));
    b.onclick = () => void update((x) => void (x.tactic = id as TacticId));
    tactics.append(b);
  }
  // Defensive shape, with scouting advice against whoever you play next.
  const next = managedFixture(s);
  const opp = next ? teamById(s, next.homeId === s.managedId ? next.awayId : next.homeId) : null;
  const advice = opp ? adviseShape(opp.lineup.map((id) => opp.players.find((p) => p.id === id)!)) : null;
  const oppFive = opp ? opp.lineup.map((id, i) => slotPlayer(opp.players.find((p) => p.id === id)!, ROLES[i])) : null;
  const leagueFive = s.teams.flatMap((t) => t.lineup.map((id) => t.players.find((p) => p.id === id)!));
  const vs = radarVs === "opp" && oppFive ? "opp" : "league";
  const mine = profileOf(starters);
  const other = vs === "opp" ? profileOf(oppFive!) : profileOf(leagueFive);
  const otherLabel = vs === "opp" ? opp!.name : "League average";
  const focus = TACTIC_FOCUS[s.tactic];
  const mean = (pr: typeof mine) => Math.round(focus.reduce((t, a) => t + pr[a], 0) / focus.length);
  const names = focus.map((a) => ATTR_NAMES[a]).join(" and ");
  const vsButtons = h("div", { class: "toolbar" }, ...(["opp", "league"] as const).map((k) => {
    const b = h("button", { class: vs === k ? "active" : "", disabled: k === "opp" && !oppFive }, k === "opp" ? `Next opponent${opp ? ` (${opp.short})` : ""}` : "League average");
    b.onclick = () => {
      radarVs = k;
      render();
    };
    return b;
  }));
  const shapeCard = card(
    "Team shape",
    h("div", { class: "hint" }, "Average of each rating across your starting five as they will play (out-of-position penalty included). The scale is fixed at 40 to 90, so you can compare shapes at a glance."),
    vsButtons,
    buildRadar(
      [
        { id: "you", label: team.name, values: mine, color: "--r1" },
        { id: "other", label: otherLabel, values: other, color: "--r2", alt: true },
      ],
      {
        title: "Team shape",
        focus,
        note: focus.length ? `${TACTICS[s.tactic].label} leans on ${names}: yours average ${mean(mine)}, ${otherLabel} ${mean(other)}.` : "Balanced makes no special demand, so an even shape is fine. Switch tactic to see which ratings it leans on.",
      },
    ),
  );
  const picked = selectedPlayer ? team.players.find((p) => p.id === selectedPlayer) : null;
  const profileCard = picked
    ? card(
        `Player profile: ${picked.name}`,
        buildRadar(
          [
            { id: "p", label: picked.name, values: playerProfile(picked), color: "--r1" },
            { id: "t", label: "Starting five average", values: mine, color: "--r2", alt: true },
          ],
          { title: `Profile of ${picked.name}`, note: `${picked.role}, age ${picked.age}, potential ${stars(picked.potential ?? 0)}. Click another player to swap, or the same player to close.` },
        ),
      )
    : null;
  const shapes = h("div", { class: "choices three" });
  for (const [id, sh] of Object.entries(SHAPES)) {
    const rec = advice?.best === id;
    const b = h("button", { class: `choice ${s.shape === id ? "active" : ""}` }, h("b", {}, sh.label, rec ? h("em", { class: "rec" }, ` recommended vs ${opp!.short}`) : null), h("span", {}, sh.description));
    b.onclick = () => void update((x) => void (x.shape = id as ShapeId));
    shapes.append(b);
  }
  const training = h("div", { class: "choices" });
  for (const [id, t] of Object.entries(TRAINING)) {
    const b = h("button", { class: `choice ${s.training === id ? "active" : ""}` }, h("b", {}, t.label), h("span", {}, t.description));
    b.onclick = () => void update((x) => void (x.training = id as TrainingFocus));
    training.append(b);
  }
  return h("div", { class: "col" },
    card(`${team.name} - starting five & bench`, h("div", { class: "hint" }, hint), playerTable(team, { selectable: true })),
    ...(profileCard ? [profileCard] : []),
    shapeCard,
    card("Player stats", h("div", { class: "hint" }, "Hover a column heading to see what it counts. Yellow card: 10 minutes in the sin bin. Red card: off for the match and a one-match ban."), statsTable(s, team, render)),
    card("What the ratings mean (0-100, hover a column for the same tip)", h("div", { class: "legend" }, ...ATTRS.flatMap((a) => [h("b", {}, ATTR_INFO[a][0]), h("span", {}, ATTR_INFO[a][1])]))),
    card(
      "Your defensive shape",
      h("div", { class: "hint" }, "Where your defence puts its weight. Tactic is how ambitious you are; shape is how you defend. Both show on the pitch in highlights. If one of your players is carded in a match you watch, the game pauses and asks how you want to cover. On quick sim, the game picks the best fit."),
      ...(advice ? [h("div", { class: "advice" }, `Next opponent ${opp!.name}: ${advice.why}`)] : []),
      shapes,
    ),
    h("div", { class: "grid" },
      card("Your tactic", h("div", { class: "advice" }, `Attacking needs pace and handling. Your starting five averages ${skill} (62 is neutral, 72 is ideal), so ${fitText}. A poorly suited side that attacks makes errors and gets countered when it loses the ball.`), tactics),
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
  const box = h("div", { class: "picker" }, h("h1", {}, "DOMINION LEAGUE MANAGER"), h("p", { class: "dim" }, `Dominion: five-a-side rugby for territory, played across Nigeria.  Version ${__APP_VERSION__}`));
  const help = h("button", {}, "How to play");
  help.onclick = showRules;

  if (!pickGender) {
    box.classList.add("wide");
    box.append(h("p", { class: "select-tag" }, "SELECT YOUR LEAGUE"));
    const options: [Gender, string, string, string, string][] = [
      ["men", "Men's league", "Eight clubs, men's squads.", menPortrait, "01"],
      ["women", "Women's league", "The same eight clubs with their own women's squads.", womenPortrait, "02"],
    ];
    const grid = h("div", { class: "cs-grid" });
    for (const [g, title, blurb, img, no] of options) {
      const portrait = h("span", { class: "cs-portrait" });
      portrait.style.setProperty("--img", `url("${img}")`);
      const b = h("button", { class: `cs-card ${g}` }, h("span", { class: "cs-no" }, no), portrait, h("span", { class: "cs-info" }, h("b", {}, title), h("span", {}, blurb)));
      b.onclick = () => {
        pickGender = g;
        render();
      };
      grid.append(b);
    }
    box.append(grid);
    box.append(h("p", { class: "dim" }, "The clubs are fixed. The players are generated fresh every time you start a new game, so each game has different squads and stars."), help);
    return box;
  }

  const teams = generateTeams(1, pickGender);
  const back = h("button", {}, "← Change league");
  back.onclick = () => {
    pickGender = null;
    render();
  };
  box.append(h("p", {}, pickGender === "women" ? "Women's league: choose your club" : "Men's league: choose your club"));
  for (const def of TEAM_DEFS) {
    const t = teams.find((x) => x.id === def.id)!;
    const b = h("button", { class: "pick" }, h("b", {}, def.name), h("span", { class: "dim pick-info" }, `Style: ${TACTICS[def.style].label}   Rating ~${teamRating(t)}`), h("span", { class: "dim pick-goal" }, `Goal: ${clubObjective(def.id)}`));
    b.onclick = () => void startNew(def.id);
    box.append(b);
  }
  box.append(h("p", { class: "dim" }, "Ratings are indicative: the club's strength is fixed, but its players are generated when you start."), h("div", { class: "toolbar" }, back, help));
  return box;
}

// ------------------------------------------------------------------ shell

/** Scroll offset of the page body, kept across re-renders so clicking a button doesn't jump you to the top. */
let lastScrollTab: string | null = null;

function render() {
  const oldMain = app.querySelector("main");
  const keepScroll = oldMain && lastScrollTab === tab ? oldMain.scrollTop : 0;
  const keepWin = window.scrollY;
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
  const over = isSeasonOver(s) || !!s.intake;
  const quick = h("button", { disabled: busy || over }, "Quick sim");
  quick.onclick = () => void quickSim();
  const watch = h("button", { class: "primary", disabled: busy || over }, "▶ Watch match");
  watch.onclick = watchMatch;
  const newBtn = h("button", {}, "New game");
  newBtn.onclick = newGameFlow;
  const helpBtn = h("button", {}, "How to play");
  helpBtn.onclick = showRules;
  app.append(h("header", {}, h("h1", {}, "DOMINION LEAGUE"), nav, h("span", { class: "spacer" }), h("span", { class: "dim" }, `${teamById(s, s.managedId).name} | ${s.gender === "women" ? "Women's" : "Men's"} League | Season ${s.season} | ${fmtMoney(s.money)}`), watch, quick, helpBtn, newBtn));

  const body = h("main");
  if (tab === "overview") body.append(overviewView(s));
  else if (tab === "squad") body.append(squadView(s));
  else if (tab === "table") body.append(card("League table", buildTable(s, { onClub: (id) => (id === s.managedId ? undefined : scout(s, id)) }), h("div", { class: "hint" }, "▲▼ = places moved since the previous matchday. Win 4, draw 2, +1 for 3+ tries (TF), +1 for losing by 7 or fewer (BP). Click a club to scout it.")));
  else body.append(fixturesView(s));
  app.append(body);
  if (error) app.append(h("div", { class: "err" }, error));
  app.append(h("footer", {}, `Dominion League Manager v${__APP_VERSION__}  |  Saved automatically  |  Data: ${dir}`));
  // Restore scroll after layout; a tab switch (different tab than last render) starts at the top.
  const sameView = lastScrollTab === tab;
  lastScrollTab = tab;
  if (sameView) {
    body.scrollTop = keepScroll;
    window.scrollTo(0, keepWin);
  }
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
      const upgraded = migrateSave(parsed);
      if (!upgraded) throw new Error(`save is from an older version (${parsed.version}) that this build cannot upgrade`);
      state = upgraded;
    }
  } catch (e) {
    error = `Could not read saved season (${e instanceof Error ? e.message : String(e)}). Picking a club will start a new game and overwrite it. The previous save, if any, is kept as season.bak.json in the data folder.`;
  }
  render();
  // First launch: show the guide once so a new player can learn the sport before picking a club.
  try {
    if (!state && !localStorage.getItem("dominion:help-seen")) {
      localStorage.setItem("dominion:help-seen", "1");
      showRules();
    }
  } catch {
    /* storage unavailable: skip the prompt */
  }
}

void boot();
