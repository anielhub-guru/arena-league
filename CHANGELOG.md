# Changelog

Versions follow `MAJOR.MINOR.PATCH`. The version lives in `package.json` and is mirrored in
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` (a test fails if they
drift apart). It is shown in the app footer and on the new-game screen.

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
