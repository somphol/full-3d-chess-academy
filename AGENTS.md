# AGENTS.md — Full 3D Chess Academy & Studio

## 1. What this is

An offline-first, bilingual **3D chess academy** delivered as a static site: `index.html`, `style.css` and one ES module, `script.js`, with Three.js 0.169.0 pinned on jsDelivr. It renders an 8×8 board in true WebGL with orbit/pan/zoom, plays a complete game of standard international chess against a built-in bot or a friend, and wraps it in a teaching layer: piece inspector with projected paths, live EN/TH coach, blunder guard with undo, three tactical drills, synthesised audio, localStorage and PGN/JSON export.

It is **not** Thai chess (Makruk), not a chess server, not a strong chess engine, and not a framework starter. It needs a network connection on first load for Three.js; everything else, including the bot search, is local. Current release: **v1.1.0**.

- Live: <https://somphol.github.io/full-3d-chess-academy/>
- Local master: `~/Projects/full-3d-chess-academy`
- Human entry point: [README.md](README.md)

## 2. Commands

```bash
# run — no install, no build
python3 -m http.server 8080
# open http://localhost:8080  (serve over HTTP; ES modules fail on file://)

# verification
node --check script.js
node scripts/check.mjs        # 84 assertions, no dependencies

# deploy = push to main; GitHub Pages serves the repo root
git push origin main
```

`scripts/check.mjs` extracts the engine between `/* ENGINE:START */` and `/* ENGINE:END */`, evaluates it in Node, and checks perft, special rules, SAN, draws, every drill, i18n symmetry, referenced DOM ids, the CDN pin, docs and `state.json`. The 97-check headless-Chrome interaction passes are not in the repo (local Chrome path); see [docs/TESTING.md](docs/TESTING.md).

## 3. Architecture

Load order: `index.html` → `style.css` → `script.js` (module). The module is one linear file in seven labelled sections:

1. **Chess engine** — pure functions over a 64-cell board, `index = rank * 8 + file`, index 0 = a1. `createState`, `genMoves` (pseudo-legal), `legalMoves` (apply/undo king-safety filter), `applyMove`/`undoMove` with a full undo record, `inCheck`/`isAttacked`, `gameStatus`, `moveToSAN`, `toFEN`, `perft`. `ENGINE_API` is returned for the test harness.
2. **Content** — `I18N` (en/th), `PIECE_INFO`, `LESSONS`, `COACH_TIPS`, drills parsed from `#puzzle-data` JSON in the HTML.
3. **Audio / storage / helpers** — `Sound` (Web Audio oscillators + noise buffers), `Store` (`full3dChessAcademy.v1`), glyph tables, `t()`.
4. **Three.js studio** — renderer with ACES + PCF soft shadows, RoomEnvironment probe, key/rim/fill lights, procedural wood and slate `CanvasTexture`s, rounded plinth and frame, lathe/extrude piece templates, highlight rings and inspection arcs, raycasting, animation, responsive camera fit, render loop.
5. **Game controller** — selection, promotion, commit, blunder analysis (`detectThreats`), undo, hints, drill lifecycle, game over, exports, persistence/replay.
   - **Bot** — `chooseBotMove(state, level, rng)` is pure and lives inside the engine block so Node can test it. Negamax + alpha-beta + quiescence + piece-square evaluation; `easy` is 1 ply with 42% random, `club` is 3 ply, `sharp` is 4 ply with a 1.4 s iterative-deepening cap. `scheduleBotTurn` lets the UI paint a thinking badge, then commits the move through the same `commitGameMove(..., { byAI: true })` path.
6. **Interface** — DOM cache, static and dynamic translation, status bar, move list, captured material, coach checklist, inspector, puzzles, modals, toasts, tabs.
7. **Events & boot** — language, dock, camera, toggles, pointer handling (click vs orbit drag), keyboard, restore, first render.

Board mapping: `x = file - 3.5`, `z = 3.5 - rank`, tile top at `y = 0`; camera default `(0, 8.9, 10.4)` looking at `(0, 0.35, 0.6)` so White is nearest. `screenPointForSquare` exists for testing and projects with the live camera.

The game is stored as `{ startFen, moves: ["e2e4", …] }` and **replayed through the engine** on load, so SAN, castling rights and history are reconstructed rather than trusted from storage. Puzzle progress is separate (`solved`, `streak`, `best`). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 4. Decisions and constraints

- **Standard international chess is the product.** Do not substitute Makruk, change the starting array, or weaken castling/en passant/promotion/draw rules. The engine tests in `scripts/check.mjs` are the contract.
- **Three.js is pinned at 0.169.0 and loaded from jsDelivr.** Keep the import map exact; do not float `@latest`. The app depends on it at runtime, so the CDN failure overlay must stay. Do not add other runtime network dependencies without updating the privacy and deployment docs.
- **Three source files.** All app logic lives in `script.js`; docs and tests are separate. Keep the engine pure and between the markers — the test suite depends on that boundary. Do not import Three into the engine section.
- **Coordinates and piece orientation are fixed.** `squarePos`, `screenPointForSquare`, `pieceMeshes` keys and raycast squares all assume the mapping above. Knights use `baseRot` 0 for White and π for Black so their profiles face across the board; changing this is a visual decision, not a logic one.
- **The camera must fit narrow viewports.** `fitDistanceForViewport()` raises the distance and widens FOV below 1.05 aspect. Do not replace it with a fixed distance without re-testing 390 px and a rotated phone.
- **One language at a time is the default.** Every key exists in both dictionaries; static text uses `data-i18n`, dynamic text `t()`. `UI.tips` is **off** by default and older stores are migrated to off: English mode must render no Thai anywhere, including coach tips, blunder dialogs, drill explanations and game-over copy. The “Show the other language” switch is the only way to add a secondary line, and it must never replace the primary language. Keep the `body.hide-alt-tips` guard and the `.modal-sub-alt` rule.
- **The bot must never freeze the interface without warning.** Search runs on the main thread, bounded by `AI_LEVELS[*].timeMs` (max 1.4 s) and iterative deepening. Show the thinking badge before searching, cancel by token on undo/new game/side change, and never let it move while a modal is open. Do not raise the time cap without re-testing mobile. It is a teaching opponent, not a titled engine; do not market it as one.
- **The blunder guard is heuristic.** It flags a hanging piece worth ≥3 after the move (accounting for recapture) and mate-in-one. It must explain, never scold, and always offer undo. It is not a search engine.
- **Drills are data.** FEN, UCI solution, SAN, hint and explanation live in `#puzzle-data`. The test suite rejects illegal FENs, illegal solutions, SAN drift and promised mates that are not mate. Never ship a drill the suite cannot prove.
- **No clocks.** Two-player hot-seat remains available from the Opponent card; the bot is optional. Do not imply a rating or a tournament engine.
- **`state.json` is historical provenance.** Do not wire it into runtime logic or rewrite it to hide the build history.
- **No analytics, tracking, cookies or remote calls.** Exports are local Blobs.

## 5. Known issues

- **The bot is a heuristic opponent, not a strong engine.** It uses material + piece-square evaluation with alpha-beta and quiescence, no opening book, no endgame tablebase, no transposition table. Sharp looks roughly four plies ahead; it will not challenge a club-strength human.
- **Bot search runs on the main thread.** A Sharp move can pause animation for up to about 1.4 s after the thinking badge appears. Undo or a modal cancels the search between root iterations, not mid-syscall.
- **English-only is the default.** Users who want the bilingual study line must enable “Show the other language”; older stored preferences are migrated to off.
- **Board play is pointer/touch only.** Pieces and squares are not keyboard-focusable; the UI buttons and shortcuts are. Documented as an accessibility gap.
- **Safari and Firefox are not automated.** Verified in headless Chrome 1440×1000 and 390×844; the APIs used are standard, but Safari import-map and `CanvasTexture` behaviour deserve a manual pass.
- **First load needs the CDN.** If jsDelivr is blocked, the studio shows an explanatory overlay after 12 seconds instead of a blank canvas.
- **Puzzle validation is single-move.** Each drill checks one expected move; there are no scripted replies.
- **Thai copy is agent-authored.** It is complete and consistent; a native reviewer should proofread before a marketing push.
- **Sound needs a gesture.** Browsers suspend `AudioContext`; the app resumes it on the first click or keypress.
- **Auto-save is per browser profile.** Clearing site data removes the game; export first.

## 6. Continuity

- **Deployed copy:** GitHub Pages, `main`, repository root. URL above.
- **Local master:** `~/Projects/full-3d-chess-academy`.
- **Build record:** `state.json` holds the session id, wall-clock elapsed time, token counters, line counts, verification method and deployment URLs. Do not regenerate it casually; it is the provenance of 1.1.0.
- **Release notes:** [CHANGELOG.md](CHANGELOG.md).
- **Map:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (engine + renderer), [docs/DESIGN.md](docs/DESIGN.md) (visual and teaching system), [docs/TESTING.md](docs/TESTING.md) (what was verified), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Pages runbook), [docs/PUZZLES.md](docs/PUZZLES.md) (drill ladder), [docs/PRIVACY.md](docs/PRIVACY.md) (data handling).
- **Publishing:** keep the repository public (MIT) and Pages on `main` / `/`. If the repo is renamed, update the absolute URLs in `index.html` (OG tags), `README.md`, `AGENTS.md`, `script.js` (PGN `Annotator`/site copy), and `state.json`.
