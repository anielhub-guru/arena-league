# Changelog

Versions follow `MAJOR.MINOR.PATCH`. The version lives in `package.json` and is mirrored in
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` (a test fails if they
drift apart). It is shown in the app footer and on the new-game screen.

## Unreleased

- Rare long-range drop goal: about one in ten territory kicks that would have run dead is instead a monster kick
  that holds its line and splits the posts for three points. The arena shows the usual towering kick, then it
  goes over the bar instead of running dead.
- Season goal bonus: meeting the club goal at the end of the season pays a cash bonus (₦600k), and smashing it
  pays more (₦1.5m), each with a line of board flavour text in the club news. Smashing it means finishing two
  or more places inside the goal, or, for a title goal, winning the league by six points or more.

## 0.8.1

- The overview now has a Season goal and rivalry card under the last result. It shows your club goal with the
  position it needs, whether you are on track or behind and by how many points, and the matchdays left. Below
  it sit your rival (record, streak and next meeting) and the club that gave you your heaviest defeat.
- Club news moved under the league table on the overview.

## 0.8.0

- New History tab (key 6). Champions by year: champions, runners-up, the league's top scorer, your own finish
  and a title count per club.
- Club records, kept per club: biggest win, most points and tries in a match, most league points in a season,
  and the best player performances in a match and in a season. Each club starts with generated founding
  records that follow the club's strength (strong clubs start higher), and they fall as seasons are played.
  Breaking one of your club's records appears in the club news. Pick any club to see its records.
- Retired legends: a player who retires after three or more seasons is remembered by the club they retired
  from (best eight kept per club), with their career line. No hall of fame. Save version 9; older saves get
  founding records and start recording legends from the next retirement.

## 0.7.0

- Job offers: after two or more seasons, other clubs may approach you. Good results bring strong clubs, middling
  ones mid-table clubs, and poor form only a rare lifeline from a bottom club. Taking a job moves you to that
  club with its squad, a mandate and a new bank balance; your old club carries on under the computer. Turning
  down strong offers makes the next approach a little less likely. Offers judge only your record at your
  current club, and the club goal follows your last finish there. Save version 8.
- New Training tab: pick the focus and see what each player has gained this season. Training no longer wastes
  a slot on a player who cannot improve, and the choice of who trains is now an unbiased shuffle.
- New highlights: carries held up on the line (with a few different looks), sixth-tackle turnovers deep in
  the opposition half, and kicks that bounce into touch.
- The Gamble team talk is now called All in.
- Rivals: every pair of clubs keeps a head-to-head record, and after three meetings your closest history becomes
  your rival. Games against them get a rivalry line at kick-off and full time, plus a line in the club news. Fixtures show a RIVAL tag, and a separate LOST BY tag marks the club that beat you
  by the widest score (14 points or more), with its own kick-off line.

## 0.6.0 (stable alpha)

- Matches are more draining (fatigue 0.65), so substitutions matter. Tiredness now carries between matches:
  playing a lot builds it, resting clears it, and both scale with the player's stamina. Tired players start
  weaker and tire faster; the Squad table shows a Weary/Tired tag. It resets each season.
- AI clubs rest worn-out starters and make their own substitutions (at most two, never for your club). Each
  club has its own coaching temperament, with some randomness every match.
- Defensive shapes rebalanced: Sweeper back beats a quick Winger, Flat line beats power forwards, Narrow
  edges a balanced attack.
- Fixed a runner who had beaten the defence turning back to be tackled. A chased carrier's top speed now
  fades gradually, he never steers backward into the tackle, and nobody can run off the end of the field.

- The ball no longer spins in a player's hands. It now moves by what happened to it: passes spiral
  (pointed, laces turning), long kicks tumble end over end, chips turn slowly, grubbers skip and wobble.
- New grubber and chip and chase near the line (a chaser races a defender for the ball in-goal; a try,
  a covered ball or a dead ball). Attacking sides try them most, Defensive least.
- Attacking sides now string several passes together before the runner is released.
- Tackles need real contact. The tackler now chases the carrier (faster than a runner with the ball) and the hit
  only lands when the two touch, instead of firing on a timer. The carrier keeps running and shifts line until he
  is hit, instead of stopping to wait for the tackle.
- Passes before a try now vary with how close the line is. Within 12 m the player just takes it and goes
  (or one short pass); within 25 m no long loops or chains; passing chains are 2 to 4 passes, not a fixed count.
- AI clubs now train too, at a slower rate than you: about half a point a week for one player, up to the
  player's potential, instead of none.
- Try animation: the ball stays in the scorer's hands until it is grounded, so it no longer looks thrown.

## 0.5.0

- League picker redesigned: pixel-art man and woman on the Men's / Women's league cards, left-aligned
  layout and a hover effect.
- Spider (radar) chart of the six ratings. Squad tab: **Team shape** (your starting five against the next
  opponent or the league average, with the ratings your tactic leans on marked) and a **Player profile**
  when you select a player. Offseason: your best five now against after your plan, and a profile of any
  player you click (yours, a prospect or a listed player) against the player they would replace.
  Counting stats stay in the table, since a radar suits ratings but not mixed-unit stats.

## 0.4.0

- Attacking is now strong only for the right side. Its bonus scales with the pace and handling of your
  starting five; a side without them makes more errors and is countered when it loses the ball. Before, it
  won 55 to 70% of matches whatever the squad. Now (same overall rating, vs Balanced): about 40% when
  unsuited, 53% neutral, 61 to 68% when well suited. The Squad tab shows how well your five suits it, and AI
  clubs that cannot play it fall back to Balanced.
- Offseason screen replaces the single prospect pick: sell any player, sign any prospect from the youth
  shortlist (replacing anyone you choose, not just your oldest), and optionally buy from the transfer list.
- Money: match winnings, prize money by finishing position, sales, and unpicked prospects sold; a wage bill
  that grows with squad quality. Player value depends on ability, young potential and age. Only the manager's
  club keeps a balance. Transfer listings favour veterans and bench players and are priced by true value,
  while you only see a noisy potential estimate, so deals and traps are real. At most 2 signings a window.
- Debt never blocks the season, it only stops you buying.
- Saves are version 6; versions 3 to 5 are upgraded on load.

## 0.3.0

- Player lifecycle: every player has a hidden potential. Youngsters grow toward it, veterans fade and
  lose potential, and players retire from 31 (certain by 35). Previously nobody ever left, and by season 40
  the league was full of 65-year-olds at the rating floor. Now it holds steady: tested over 50 seasons.
- Offseason decisions: a scouted shortlist of three prospects for each retiree (potential shown as a
  noisy 1 to 5 star estimate), plus an optional succession signing for your oldest player. The new season
  starts when you confirm. AI clubs take their best prospect automatically.
- Training now stops at a player's potential, and new talent depends less on a club's fixed tier, so the
  champions change over the years instead of one club winning for ever.
- The previous save is kept as `season.bak.json`.
- Saves from 0.2.x (version 4) are upgraded on load. New `Pot` column in the Squad tab for your club.

## 0.2.0

- Nigerian clubs and player names; choose the men's or women's league at the start of a new game.
- Cards: yellow (sin bin) and red (sent off, one-match ban), a man down is felt in the match.
- Defensive shape (sweeper back, flat line, narrow) with scouting advice for the next opponent.
  The game pauses to ask how to cover when one of your players is carded in a match you watch.
  Tactic and shape are visible in the highlight animations.
- Player of the match, best player on each side, and a rating at full time; saved on the result.
- Player stats, varied commentary, and an in-game rulebook with a first-launch guide and in-match help.
- Resume button in the side panel, kicker's-eye view of kicks at goal, contact and ball physics.

## 0.1.0

- First release: offline Tauri 2 desktop app with the match engine, league, table, live match
  screen and highlight arena.
