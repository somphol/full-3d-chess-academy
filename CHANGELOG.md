# Changelog

All notable changes to Full 3D Chess Academy & Studio are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-02

First complete release: a playable 3D studio with a full rules engine and a bilingual teaching layer.

### Added

- **3D studio** — Three.js renderer with ACES tone mapping, soft shadows, a room environment probe, a procedural wood/slate board, brass trim, coordinate labels and 32 styled pieces built from lathe and extrusion geometry.
- **Camera** — OrbitControls with damping, polar limits, camera presets for White, Black, Top and Studio, a cycle button, gentle idle orbit, and portrait-aware fitting down to 390 px.
- **Complete chess rules** — pawn double-step, en passant, both castles with path checks, four promotions, check, checkmate, stalemate, fifty-move, threefold repetition and insufficient material. SAN with disambiguation and mate markers.
- **Interaction** — raycast selection, pulsing legal-move rings, red capture tori, gold castling, last-move glow, check ring, click-versus-orbit detection, hover feedback, piece lift and sway.
- **Academy** — piece inspector with value, rules, tags and projected flight/step arcs; live bilingual coach with a checklist and lesson card; hint engine; blunder guard with “Undo &amp; learn”; three tactical drills with hints, retry, streak and best.
- **Interface** — three-column studio layout, movable tabs, move list, captured material, material balance, camera and studio settings, help modal, promotion, blunder, drill and game-over dialogs, toast system.
- **Bilingual EN/TH** — full interface translation, bilingual lessons, tips and drill copy, secondary-language coach line with a toggle.
- **Sound** — synthesised lifts, drops, captures, castles, checks, promotions, illegal-move buzz and win/draw/puzzle fanfares.
- **Persistence and export** — localStorage replay of the saved game, saved preferences and puzzle streaks; PGN and JSON download built locally.
- **Release material** — README with screenshots, architecture, design, testing, deployment, puzzles and privacy guides, AGENTS.md handoff, MIT licence, third-party notices, CI workflow and build provenance in `state.json`.
- **Verification** — dependency-free Node suite (perft, rules, SAN, draws, puzzles, i18n, markup, docs) and a 54-point headless-Chrome interaction pass.

### Known limitations

- Hot-seat only; no computer opponent.
- Puzzle validation is single-move.
- Board interaction is pointer/touch only.
- Three.js requires a network connection on first load.
- Safari and Firefox are not automated.
