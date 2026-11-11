# Arena League Manager

Offline management game, text-first with a small 2D arena view for action moments, for a fictional 5v5 league playing **Dominion**, a rugby-inspired contest for territory. Advance a matchday, read commentary, watch the table change. Built with Tauri 2 and a minimal TypeScript frontend (Vite, no framework). No server, no network.

## Layout

| Path | Role |
|---|---|
| `src/engine/` | Match engine (`match.ts`), seeded RNG, shared types. No DOM, no I/O. |
| `src/league/` | Teams, schedule, standings, season flow. Pure functions over a serialisable `SeasonState`. |
| `src/viewer/` | Table, highlight choreography (`scenes.ts`, pure and unit-tested), canvas renderer (`arena.ts`), live match controller (`live.ts`), stat helpers. |
| `src/storage.ts`, `src/main.ts` | Persistence bridge and the app shell. |
| `src-tauri/src/lib.rs` | Rust commands that save to the app local data dir. |
| `tests/` | Vitest tests for the engine and league. |

## The game

You manage one club of eight in a 14-matchday season. Between matches you:

- **Pick the starting five** from an 8-player squad (Squad tab: click two players to swap). Playing someone out of their natural role costs -5 on every attribute.
- **Set your tactic** (Balanced / Attacking / Defensive / Territory). You can only change your own club; other clubs can be scouted (click them in the table).
- **Set a training focus** (Attack / Defence / Kicking / Fitness). After each matchday three players get a chance of +1 in that area.
- **Choose how to play the match:** *Watch match* or *Quick sim* (`Space`).

Watching opens a live match screen in the style of Football Manager's commentary view:

- **A running clock.** The match clock (mm:ss) ticks on its own, about 30 match seconds per real second at 1x, so a whole match takes roughly 2.5 to 3 minutes. Commentary appears as the clock reaches each moment, and a line stays up at least ~3.3 seconds while a minute or two of match time passes. Routine moments are not narrated (they are still in the full log); big moments always are.
- **Pressure meter.** A bar under the scoreboard fills with how far up the pitch your team is (full bar = camped on their line), and drains when the other team is pushing you back.
- **Highlights only in the arena.** The top-down view stays hidden until something worth watching happens (tries, line breaks, kicks at goal, long kicks, interceptions, turnovers, costly knock-ons). The clock waits while a highlight plays (about 5 to 8 seconds), then the result line appears.
- **Every highlight has an ending.** A line break ends in one of: tackled by the covering Sweeper, dragged down from behind, shoved into touch (ball out of play, line-out to the defence), or a high-tackle foul (penalty, often followed by a kick at goal). Or the runner scores a try.
- **Contact.** Tackles are collisions with mass: heavy players carry more momentum, players go down flat on the ground and get back up, a runner can be driven backwards or run through a tackle, defenders dive and miss, and big hits shake the camera.
- **Kicks at goal show why they scored or missed.** Conversions, penalties and drop goals cut to a view from behind the kicker with large uprights and a crossbar. A score goes between the posts and over the bar and the officials raise flags. Misses can drift wide of the left or right upright (red cross), drop short, or hit the post and bounce away. Occasionally a kick clips the post and still goes over. The commentary names the direction, so the text and the picture always agree.
- **Ball physics.** The ball has a ground position and a height. Kicks and passes follow a parabola, the shadow stays on the ground while the ball rises above it, and on landing it bounces (losing energy each time) and rolls to a stop.
- **Players move like players.** Each player is a small physics agent with a top speed and acceleration (wingers quick off the mark, anchors heavy), a reaction delay (defenders react a beat later than attackers), smooth turning, and personal space. A nose shows which way they face and faint trails show fast runners.
- **Choreographed plays:** attackers stand deep in an echelon, the Pivot distributes, the carrier runs onto the ball, and the defence holds a line with the Sweeper behind. Set plays: crash ball, dummy run (a decoy drags a defender out of position), loop, switch and skip pass. A caption names what is happening.
- **Controls:** pause, speed 1x/2x/4x/8x, skip to full time, and while paused change tactic, check player energy and make up to 3 substitutions. Touching any of those controls pauses the match and a green **Resume match** button appears at the top of the side panel. At half-time you give a team talk. Continue appears next to the controls and at the top of the side panel at full time.

Any finished match can be replayed, with its highlights, from the overview or the Fixtures tab. The "How to play" button explains the sport, positions and ratings in plain language.

The League Table has movement arrows (places gained or lost since the previous matchday), a form column, and your club highlighted.

Dominion rules: 40 minutes (80 phases), a 100m arena, sets of up to six tackles. Kicks, knock-ons, jackal turnovers and penalties swing territory. Scoring: try 5, conversion 2, penalty goal 3, drop goal 3. Table points: win 4, draw 2, +1 for 3+ tries, +1 for losing by 7 or fewer. Matches are deterministic from the save seed until you intervene. After matchday 14, start the next season (players age, ratings drift).

Keys: `Space`/`Enter` quick-sim (or pause/resume while watching), `1`-`4` switch tabs.

## Saves

After each matchday the app writes full match logs first, then the season, to the app local data directory (written atomically via temp file and rename):

- macOS: `~/Library/Application Support/com.arenaleague.manager/`
- Windows: `%LOCALAPPDATA%\com.arenaleague.manager\`
- Linux: `~/.local/share/com.arenaleague.manager/`

Contents: `season.json` and `matches/<fixtureId>.json`. The path is shown in the footer. In a plain browser (`npm run dev` without Tauri) it falls back to localStorage.

## Prerequisites (all platforms)

Node 20+, Rust stable (via rustup), then `npm install`.

- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Windows**: Microsoft C++ Build Tools ("Desktop development with C++"), WebView2 (preinstalled on Windows 10/11), Rust MSVC toolchain. Bundles: NSIS `.exe` and WiX `.msi` (WiX needs Windows).
- **Linux (Debian/Ubuntu)**: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`. Bundles: `.deb`, `.rpm`, `.AppImage`.

Tauri cannot cross-compile desktop installers reliably; build each OS on that OS (or in CI).

## Commands

```sh
npm install
npm test                      # engine and league tests
(cd src-tauri && cargo test)  # save-file tests
npm run tauri dev             # run the desktop app with hot reload
npm run tauri build           # package for the host OS
```

macOS specifics:

```sh
npm run tauri build -- --bundles app,dmg                          # host architecture
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin --bundles app,dmg   # Intel build from Apple Silicon
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg  # one universal binary
```

Output lands in `src-tauri/target/release/bundle/` (or `.../<target>/release/bundle/`). Builds are unsigned: on macOS right-click > Open the first time, or sign and notarise for distribution.

Windows: `npm run tauri build` (add `-- --bundles nsis` for just the installer). Linux: `npm run tauri build` (add `-- --bundles deb` etc.).

## Build and test status

Tested on macOS 26 (Darwin 25.4), **Intel x86_64** host, Node 22, Rust 1.96.

| Item | Status |
|---|---|
| TypeScript tests (`npm test`) | Pass (7 tests: determinism, score and timestamp consistency, balance, highlight counts, a complete choreographed scene for every highlight type, schedule, full season and rollover) |
| Movement physics | Stepped frame by frame in a browser for every highlight kind: no teleporting (player steps stay within top speed), ball moves continuously (max about 0.5 m per frame). Acceleration spikes only at scripted tackles. |
| Kick outcomes | All five rendered and checked by eye: good, off the post and in, off the post, wide, short. |
| Resume button | Driven with a real click in a 560px-high window: appears when the substitution controls are touched, stays after a substitution, resumes the match. |
| Rust tests (`cargo test`) | Pass (2 tests: id sanitising, atomic save round trip) |
| UI behaviour | Driven end to end in headless Chrome against the production web build: club pick, quick sim, table arrows, lineup swap, tactic/training, live match with substitution, half-time talk, skip, continue, reload restores the season (localStorage backend), replay. No page errors. |
| macOS x86_64 `.app` and `.dmg` | **Built** and installed from the DMG to `~/Applications`; Mach-O x86_64 |
| macOS arm64 / universal | Not built |
| Windows (`.exe`/`.msi`) | **Not built, not tested.** Instructions above only |
| Linux (`.deb`/`.AppImage`) | **Not built, not tested.** Instructions above only |
| Installed app: close and reopen restores season (Rust file backend) | **Not verified through the GUI.** No accessibility or screen-capture permission was available to click through the installed app. The Rust save/load code is unit-tested; the same UI logic was verified against the localStorage backend. Manual check: pick a club, press `Space` twice, quit, reopen. |

Saves from the first release (version 1) are not compatible; the app tells you and starting a new game overwrites them.

## Future targets

Android and iOS are not enabled. `lib.rs` already has the `mobile_entry_point` attribute; add them later with `npm run tauri android init` / `ios init`. The UI would need touch-friendly sizing.
