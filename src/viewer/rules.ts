import { h } from "../dom";
import { MATCH_PAY, MAX_BUYS, PRIZES, SELL_RATE, TEEN_RATE, fmtMoney } from "../league/economy";
import { BIN_PHASES, MAX_SUBS, PHASES, RED_BAN, TACTICS, SHAPES } from "../engine/match";

/**
 * The rulebook. Everything here describes what the engine actually does, so the commentary,
 * the numbers and the animations make sense. If a rule in match.ts changes, change it here too.
 */

type Kid = Node | string;
const p = (...k: Kid[]) => h("p", {}, ...k);
const ul = (...items: Kid[][]) => h("ul", {}, ...items.map((i) => h("li", {}, ...i)));
const b = (t: string) => h("b", {}, t);
const tbl = (head: string[], rows: string[][]) =>
  h("table", { class: "rtable" }, h("thead", {}, h("tr", {}, ...head.map((c) => h("th", {}, c)))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c, i) => h(i === 0 ? "th" : "td", {}, c))))));
const tip = (...k: Kid[]) => h("div", { class: "rtip" }, ...k);

interface Section {
  id: string;
  title: string;
  body: () => Node[];
}

const minutes = BIN_PHASES / 2;

const SECTIONS: Section[] = [
  {
    id: "quick",
    title: "Dominion in one minute",
    body: () => [
      p("Dominion is a five-a-side contest for territory, built on rugby. Two teams of five fight over a 100 metre arena. The team with the ball tries to carry it over the other team's line. The other team tries to stop them, win the ball back and do the same."),
      ul(
        [b("Score by carrying the ball over the line"), " and grounding it: a TRY, worth 5 points. Kicking it there does not count."],
        [b("Or score by kicking"), " the ball over the crossbar and between the posts: conversion (2), penalty goal (3), drop goal (3)."],
        [b("You can only run it forward."), " Passes must go sideways or backwards. A forward pass is not allowed."],
        [b("You get six tackles."), " After the sixth tackle the ball goes to the other team."],
        [b("You are the manager."), " You choose the five, the tactic, the training and, in a watched match, the substitutions and the half-time talk."],
      ),
      tip("It plays like a mix of rugby union (tries, conversions, penalties, drop goals) and rugby league (a set of six tackles), cut down to five players so every player matters."),
    ],
  },
  {
    id: "clock",
    title: "The match and the clock",
    body: () => [
      p(`A match is 40 minutes: two halves of 20. The game is played in ${PHASES} phases of 30 match-seconds each. A phase is one action by the team with the ball: a carry, a kick, a kick at goal.`),
      p("In a watched match the clock runs by itself (about 30 match-seconds per real second at 1x speed, so roughly 2.5 to 3 minutes for a whole match). Quiet moments are only in the full match log. Big moments always get a line of commentary, and the clock waits while a highlight plays."),
      ul(
        [b("Half time"), " is after phase 40. You can give a team talk, change tactics and substitute."],
        [b("Restart"), " after a score, the team that conceded gets the ball in its own half."],
        [b("Speed controls"), " are 1x, 2x, 4x and 8x. You can pause, or skip to full time."],
      ),
    ],
  },
  {
    id: "possession",
    title: "Possession, sets and territory",
    body: () => [
      p("The team with the ball is on attack. It moves along the arena by carrying and kicking. Where the ball is on the arena is shown by the ", b("pressure bar"), " under the scoreboard: full means your team is camped on their line, empty means you are being pushed back into your own."),
      h("h4", {}, "The set of six"),
      p("Each time a runner is tackled, the tackle count goes up by one. The commentary tells you the count (\"Tackle 3\"). On the sixth tackle the attack has run out of chances and the ball goes to the other team. The count starts again whenever the ball changes hands, or after a penalty."),
      h("h4", {}, "Carries and the gain line"),
      p("A carry is a runner taking the ball into the defence. The result is the number of metres gained. ", b("The gain line"), " is where the attack started the phase. If a runner is stopped behind it, they have gone backwards. Strong runners (Power) break tackles, fast runners (Pace) find gaps, and a weak defence gives up more metres."),
      h("h4", {}, "Passes"),
      p("Passes go backwards or flat, never forward. The highlight animations show set plays built on that: the crash ball, the dummy run, the loop, the switch and the long skip pass. They are there to drag a defender out of position."),
    ],
  },
  {
    id: "scoring",
    title: "Scoring",
    body: () => [
      tbl(
        ["Score", "Points", "How it happens"],
        [
          ["Try", "5", "A runner carries the ball over the line and grounds it. Passing or kicking it over does not count."],
          ["Conversion", "2", "A free kick at goal right after a try. It must go over the crossbar and between the posts."],
          ["Penalty goal", "3", "A kick at goal awarded after the other side breaks the rules, if the attack is close enough."],
          ["Drop goal", "3", "A kick at goal in open play, from the ground, between the posts. It is rare."],
        ],
      ),
      h("h4", {}, "Kicks at goal"),
      p("Every kick at goal cuts to a view from behind the kicker with big uprights and a crossbar. Good kicks go between the posts and over the bar. A miss is one of three kinds, and the commentary names it so the words and the picture agree:"),
      ul(
        [b("Wide"), " of the left or right upright."],
        [b("Hits the post"), " (left or right) and bounces away."],
        [b("Short"), ": it drops below the crossbar."],
      ),
      p("Very occasionally a kick clips the post and still goes over. That counts."),
    ],
  },
  {
    id: "losing",
    title: "How the ball is lost",
    body: () => [
      tbl(
        ["What happens", "What you see", "Result"],
        [
          ["Sixth tackle", "\"Sixth tackle... turnover\"", "The other team gets the ball where the tackle was made."],
          ["Knock-on", "The ball goes forward off the carrier's hands", "The other team gets the ball. Handling and tired hands cause these."],
          ["Interception", "A defender steps into a passing lane", "The defender runs the ball back, usually 8 to 35 metres."],
          ["Jackal turnover", "A tackler gets over the ball and rips it free", "Only happens when the runner has been stopped for almost no gain. The tackler's team counters."],
          ["Out of play (touch)", "A line break ends with the runner shoved over the touchline", "Line-out: the defending team gets the ball."],
          ["Kick for territory", "The attacking team boots it downfield", "The other team collects it where it lands. If it goes over the dead-ball line they drop out from their own 22."],
        ],
      ),
      tip("A knock-on or interception deep in your opponent's half costs the most, because the attack was close to scoring. That is why those get a highlight."),
    ],
  },
  {
    id: "kicking",
    title: "Kicks and restarts",
    body: () => [
      ul(
        [b("Kick for territory"), ": a long kick to push the other team back. A kicker's Kicking rating decides how far it goes. Kicks are more likely deep in your own half, and the Territory tactic kicks the most."],
        [b("Dead ball"), ": a kick that lands past the end of the arena. The other team restarts with a drop-out from their 22."],
        [b("The 22"), ": the zone in the 22 metres in front of each try line. You will hear it in the commentary (\"pinned deep in their own 22\", \"inside the opposition 22\")."],
        [b("Drop goal"), ": tried in open play when the attack is within about 30 metres of the line. A miss gives the defence a restart from their 22."],
        [b("Drop-out"), " and ", b("put-in"), ": the other team simply gets the ball back."],
      ),
    ],
  },
  {
    id: "penalties",
    title: "Penalties",
    body: () => [
      p("The referee gives a penalty when the defence breaks the rules. This can happen in any phase, and it is much more likely when a runner breaks the line and is caught by a ", b("high tackle"), " (a tackle around the neck, which is dangerous)."),
      p("Then one of two things happens, depending on how close the attack is to the line:"),
      ul(
        [b("Close enough to goal"), ": usually a kick at goal. It is worth 3 points if it goes over, and it can miss like any other kick."],
        [b("Otherwise"), ": a kick to the corner, which moves the ball about 25 metres upfield and gives the attack a fresh set of six."],
      ),
    ],
  },
  {
    id: "cards",
    title: "Cards: yellow and red",
    body: () => [
      p("A penalty can come with a card. The referee shows a card to a player who breaks the rules badly or keeps breaking them. There are two kinds."),
      tbl(
        ["Card", "What it means", "What happens"],
        [
          ["Yellow", `The player goes to the sin bin for ${minutes} minutes.`, "The team plays a man down until they come back. The commentary tells you when they return. A player in the sin bin cannot be substituted."],
          ["Second yellow", "A second yellow in the same match is a red.", "See red."],
          ["Red", "The player is sent off for the rest of the match.", `The team plays a man down for the whole rest of the match, and the player is suspended for ${RED_BAN === 1 ? "the next match" : `the next ${RED_BAN} matches`}.`],
        ],
      ),
      h("h4", {}, "What being a man down does"),
      p("A team with a player off has a gap in its defence and one fewer runner. In practice the opposition gain more metres, break the line more often, and score more. Ten minutes in the sin bin can easily cost a try. A team is never reduced below three players on the pitch."),
      h("h4", {}, "What makes cards more likely"),
      ul(
        [b("Your tactic."), ` Hard-tackling tactics give away more cards: Defensive ${TACTICS.defensive.card}x, Territory ${TACTICS.territory.card}x, Balanced ${TACTICS.balanced.card}x, Attacking ${TACTICS.attacking.card}x. A high tackle is a lot more likely to be a card than a routine penalty.`],
        [b("Tired players."), " Players who are tired and have low Stamina mistime tackles. Substituting tired players, and training Fitness, lowers the risk."],
      ),
      h("h4", {}, "Suspensions"),
      p("After a red card, the player misses the next matchday. If the player is in your starting five, the game replaces them with the best player available (the same natural position if possible) and tells you in the club news. You cannot put a suspended player in the starting five. Suspended players show a red SUSPENDED tag on the Squad tab. A ban carries over into a new season if it hasn't been served."),
    ],
  },
  {
    id: "positions",
    title: "The five positions",
    body: () => [
      tbl(
        ["Position", "Job", "What to look for"],
        [
          ["Anchor (A)", "Heavy runner who crashes into the defence.", "Power and tackling."],
          ["Bruiser (B)", "The other heavy runner. Carries a lot, especially near the line.", "Power."],
          ["Pivot (P)", "The playmaker. Distributes the ball and usually kicks.", "Handling and Kicking."],
          ["Winger (W)", "Fast finisher on the outside.", "Pace."],
          ["Sweeper (S)", "The last defender. Covers line breaks and catches kicks.", "Tackling and pace."],
        ],
      ),
      p("The letters A, B, P, W, S are what you see on the dots in the arena. A player playing out of their natural position loses 5 points on every rating (shown as \"-5\" on the Squad tab). Each player has a natural role, but you can place them anywhere."),
      h("h4", {}, "Ratings (0 to 100)"),
      ul(
        [b("Power"), ": breaks tackles. ", b("Pace"), ": speed and gaps. ", b("Handling"), ": fewer knock-ons and intercepted passes."],
        [b("Tackling"), ": stopping runners and stealing the ball. ", b("Kicking"), ": distance and accuracy. ", b("Stamina"), ": staying fresh as the match goes on."],
      ),
    ],
  },
  {
    id: "manage",
    title: "Tactics, subs and energy",
    body: () => [
      tbl(
        ["Tactic", "Plays like", "Cards"],
        (Object.values(TACTICS)).map((t) => [t.label, t.description.replace(/\s*(Fewer cards|Hard tackling means more cards|Slightly more cards)\.?$/, ""), `${t.card}x`]),
      ),
      p(b("Attacking is strong, but only for the right side."), " Its bonus depends on the average pace and handling of your starting five: about 62 is neutral, 72 or more gets the full bonus (more metres, fewer errors), and 52 or less is reckless. A side that attacks without those tools makes more mistakes, and when it loses the ball the other side counters, hitting it while the attackers are out of shape. The Squad tab tells you how well your five suits it. AI clubs that cannot play Attacking fall back to Balanced."),
      p(b("Reading the spider chart."), " On the Squad tab, the Team shape chart plots the six ratings of your starting five (as they will play, out-of-position penalty included) against your next opponent or the league average. A diamond marks the ratings your tactic leans on, so you can see at a glance whether your side is built for it. Select a player to see their own profile against your starting five."),
      h("h4", {}, "Defensive shape"),
      p("Tactic is how ambitious you are. Shape is how your defence stands, and it is how you cover a man down. You can see it on the pitch in highlights: the defensive line, how deep it stands and where the Sweeper is."),
      tbl(["Shape", "What it does"], Object.values(SHAPES).map((sh) => [sh.label, sh.description])),
      p("Before each match the Squad tab recommends a shape against your next opponent's attack (a quick Winger, powerful forwards, or a balanced attack). If one of your players is carded in a match you are watching, the game pauses and asks how you want to cover. If you quick-sim, the game picks the best fit for you."),
      h("h4", {}, "Team talk"),
      p("At half time you pick a team talk. Fire them up gives more ambition and a few more mistakes. Stay calm gives fewer errors and steady carries. Gamble might inspire a comeback or backfire."),
      h("h4", {}, "Substitutions and energy"),
      p(`You can make ${MAX_SUBS} substitutions in a match, and a substituted player cannot come back on. Energy bars show how fresh each player is. Tired players are slower, weaker and clumsier, and more likely to give away a card. Touching any control pauses the match; use the green Resume button when you're done.`),
    ],
  },
  {
    id: "screen",
    title: "Reading the match screen",
    body: () => [
      ul(
        [b("Commentary card"), ": the large line of text. The small label above it is the type of moment and the minute, for example ", b("23'  TRY"), "."],
        [b("Full match log"), ": every moment of the match, including quiet carries the commentary skipped."],
        [b("Arena view"), ": hidden until something worth watching happens (tries, line breaks, kicks at goal, long kicks, interceptions, turnovers, costly knock-ons and fouls)."],
        [b("Banners"), " flash on the arena to name what just happened: LINE BREAK, KNOCK-ON, INTERCEPTED, TURNOVER, HIGH TACKLE, PENALTY, COVERED, CAUGHT, OUT OF PLAY, KICK, DEAD BALL."],
        [b("Pressure bar"), ": how far up the arena your team is."],
        [b("Card chips"), " under the pressure bar: a yellow chip means a player is in the sin bin, a red chip means a player has been sent off. The player is also missing from the arena animation, so a man-down team really does show four dots."],
        [b("Energy table"), " on the right: each starter's freshness, or their card status."],
      ),
      tip("The text, the numbers and the animation always describe the same event. If the commentary says a kick hit the left upright, that is what you will see."),
    ],
  },
  {
    id: "season",
    title: "The season, the table and the stats",
    body: () => [
      p("There are 8 clubs and 14 matchdays. Every club plays every other club twice, home and away, and every club plays on every matchday. After matchday 14 the season ends and you can start the next."),
      tbl(
        ["Table points", ""],
        [
          ["Win", "4 points"],
          ["Draw", "2 points"],
          ["Try bonus (TF)", "+1 for scoring 3 or more tries"],
          ["Losing bonus (BP)", "+1 for losing by 7 points or fewer"],
        ],
      ),
      h("h4", {}, "Training"),
      p("After each matchday, three players from your squad have a chance to gain +1 on the rating you picked (Attack, Defence, Kicking or Fitness). Between seasons, young players grow and veterans fade."),
      h("h4", {}, "Player stats"),
      p("The Squad tab shows every player's season and career stats: appearances, points, tries, kicking, metres gained, tackles, line breaks, turnovers won and cards. Your club news names the standout player after each match. Stats are kept for every club, so you can scout rivals' stars as well."),
    ],
  },
  {
    id: "money",
    title: "Careers, the offseason and money",
    body: () => [
      p("Every player has a hidden ", b("potential"), ": a ceiling on how good they can become. Players under 28 grow toward it, from 31 they fade (and their ceiling falls), and from 31 they can retire. Training can never lift a player past their potential."),
      h("h4", {}, "The offseason"),
      p("After matchday 14 and before the next season you have an offseason screen. Retirees leave, and you must refill your squad to eight with at least one natural player in each of the five positions. Beyond that, everything is optional."),
      ul(
        [b("Youth shortlist."), " Teenage prospects, three for each position that lost a player and one for the others. Their rating is real but their potential is a scouting estimate (1 to 5 stars) that can be about a star out. Sign any of them, replacing anyone you choose."],
        [b("Selling."), " Sell any player who is not retiring. They go to another club and you get their sale price."],
        [b("Transfer list."), ` Each other club lists one player, usually a veteran or a bench player rather than a star. The asking price follows what they are really worth, which includes the potential you cannot see, so a good judge finds bargains and a poor one finds traps. You can make up to ${MAX_BUYS} signings per offseason, and the selling club replaces the player with a youngster.`],
      ),
      h("h4", {}, "Money"),
      p("Only your club keeps a balance; the AI clubs are balanced by design. Building a fortune is part of the game: money comes from match winnings (", `win ${fmtMoney(MATCH_PAY.win)}, draw ${fmtMoney(MATCH_PAY.draw)}, loss ${fmtMoney(MATCH_PAY.loss)}`, "), prize money for your final position (", `${fmtMoney(PRIZES[0])} for first down to ${fmtMoney(PRIZES[PRIZES.length - 1])} for eighth`, "), selling players, and selling the prospects you do not sign. It goes on a yearly wage bill, which grows with the quality of your squad, and on transfers. Money speeds up your rebuilding but cannot buy the league: only a few players are listed each year, you can sign at most a couple, and finding the ones who are really worth it is the skill. If your balance goes negative you can still play on, but you cannot buy anyone until you are back in credit."),
      tip(`A player's value rises with ability and with young potential, and falls with age. Selling pays ${Math.round(SELL_RATE * 100)}% of value; an unsigned teenager fetches ${Math.round(TEEN_RATE * 100)}%.`),
    ],
  },
  {
    id: "glossary",
    title: "Glossary",
    body: () => [
      h("dl", {},
        ...(
          [
            ["Breakdown", "The moment after a tackle where the ball is contested."],
            ["Conversion", "The kick at goal after a try, worth 2."],
            ["Dead ball", "A kick that lands past the end of the arena. Drop-out for the defence."],
            ["Drop-out", "A restart kicked by the defence from its own 22."],
            ["Gain line", "Where the attack began the phase. Behind it means going backwards."],
            ["High tackle", "A tackle around the neck. Dangerous, so a penalty and often a card."],
            ["Jackal", "A tackler gets over the ball and rips it away."],
            ["Knock-on", "The ball is dropped or knocked forward. The other team gets it."],
            ["Line break", "A runner gets clean through the defence."],
            ["Line-out", "A restart after the ball goes out of play: the defending team gets it."],
            ["Man down", "A team with a player in the sin bin or sent off."],
            ["Out of position", "A player in a slot that isn't their natural role: -5 on every rating."],
            ["Phase", "One action by the team with the ball. A match has 80."],
            ["Pressure bar", "How far up the arena your team has the ball."],
            ["Put-in", "The ball given to a team after the other side's error."],
            ["Red card", "Sent off for the rest of the match and suspended for the next one."],
            ["Set of six", "A team's allowance of six tackles before it must give up the ball."],
            ["Sin bin", `Where a yellow-carded player sits out ${minutes} minutes.`],
            ["Touch", "Out of play beyond the side line."],
            ["Try", "Grounding the ball over the opponents' line: 5 points."],
            ["Yellow card", `A ${minutes}-minute sin-bin penalty. A second yellow is a red.`],
          ] as [string, string][]
        ).flatMap(([t, d]) => [h("dt", {}, t), h("dd", {}, d)]),
      ),
    ],
  },
];

/** The full rulebook: a contents list on the left, the rules on the right. */
export function buildRules(close: () => void): HTMLElement {
  const content = h("div", { class: "rbody" });
  const nav = h("nav", { class: "rnav" });
  for (const s of SECTIONS) {
    const sec = h("section", { class: "rsec", id: `rules-${s.id}` }, h("h3", {}, s.title), ...s.body());
    content.append(sec);
    const btn = h("button", {}, s.title);
    btn.onclick = () => sec.scrollIntoView({ behavior: "smooth", block: "start" });
    nav.append(btn);
  }
  const closeBtn = h("button", { class: "primary" }, "Close");
  closeBtn.onclick = close;
  return h("div", { class: "rules-wrap" }, h("div", { class: "rhead" }, h("h2", {}, "How to play Dominion"), closeBtn), h("div", { class: "rcols" }, nav, content));
}
