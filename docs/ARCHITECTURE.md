# Architecture

## Three files, one module

```text
index.html   markup, dialogs, import map, drill JSON
style.css    design tokens, layout, panels, modals, breakpoints
script.js    engine · content · audio/storage · renderer · controller · UI · boot
```

`script.js` is a single ES module so the engine can be evaluated in Node by slicing between `/* ENGINE:START */` and `/* ENGINE:END */`. Nothing in that block imports Three.js or touches the DOM.

## Chess engine

The board is a flat `Array(64)`; `index = rank * 8 + file`, index 0 is a1. Each cell is `null` or `{ type: 'P'|'N'|'B'|'R'|'Q'|'K', color: 'w'|'b' }`.

Key functions:

| Function | Responsibility |
| --- | --- |
| `createState(fen)` | parse FEN, initialise history, position list and SAN list |
| `genMoves(state, color)` | pseudo-legal moves, castling rights, en passant, four promotions |
| `legalMoves(state, color)` | apply each move, reject those leaving the king attacked, undo |
| `applyMove` / `undoMove` | mutate board + rights + clocks, push/pop a complete undo record |
| `isAttacked` / `inCheck` | pawn, knight, king, rank/file and diagonal rays |
| `gameStatus` | mate, stalemate, fifty-move, threefold, insufficient material |
| `moveToSAN` | disambiguation, captures, castling, promotion, `+` / `#` |
| `perft` | node count used by the verification suite |

`applyMove` asserts that the piece belongs to the side to move. Every call site passes the correct color: `detectThreats` and `moveToSAN` temporarily apply moves on the same turn and undo immediately.

Positions are recorded as a FEN-like key (placement + turn + castling + en passant) on every move and popped on undo, which makes threefold detection a count over `state.positions`.

Search and SAN call `applyMove(state, move, false)` so they skip the position-key bookkeeping; the game commit uses the default `true`. This is why the bot can search thousands of nodes without corrupting threefold history.

## The bot

The opponent lives inside the engine block so the verification suite can call it directly:

```js
chooseBotMove(state, 'club', rng) -> { move, score, depth, nodes, elapsedMs, random }
```

- **Evaluation** — centipawn material plus piece-square tables (separate king table in simplified endgames), a small bishop-pair bonus, and a side-to-move perspective for negamax.
- **Search** — negamax with alpha-beta, MVV-LVA/centre move ordering, quiescence for captures and checks, a previous-depth best-move first ordering, and iterative deepening inside a wall-clock deadline.
- **Levels** — `easy`: 1 ply, 42% random, 320 ms · `club`: 3 ply, 4% random, 900 ms · `sharp`: 4 ply, no random, 1.4 s. If the deadline lands mid-depth, the last completed depth is used.
- **Safety** — a sentinel throw cancels a timed-out search; apply/undo always run in pairs; `chooseBotMove` leaves the position untouched (asserted by the suite).

`scheduleBotTurn` sets `UI.botThinking`, paints the status badge, waits one animation frame, runs the search, then commits through `commitGameMove(move, { byAI: true })`. The AI path skips the blunder guard, but it uses the same SAN, animation, sound, status and persistence code as a human move. A token cancels a pending search when the user undoes, starts a new game, switches sides, or opens a modal. The bot is not allowed to move while any modal is open; closing the modal re-queues it.

## Rendering

- `WebGLRenderer` with `alpha: true`, ACES filmic tone mapping, PCF soft shadows and `SRGBColorSpace`.
- `RoomEnvironment` through `PMREMGenerator` for metal reflections; key directional light with a 2k shadow map, blue rim light, warm and cool point fills.
- Board: rounded plinth, walnut frame with brass trim, 64 rounded tiles top at `y = 0`. Wood and slate textures are drawn procedurally into 512² canvases, so there are no image files to load.
- Pieces: cached template groups per type/colour. Pawns, rooks, bishops, queens and kings are `LatheGeometry` profiles plus rings/spheres; knights are an extruded silhouette with an eye and mane. Templates are cloned per square, sharing geometry and materials.
- Raycasting intersects piece roots (recursively) before tiles. A pointer press/release pair under ~7 px counts as a click; larger motion is an orbit drag.
- Highlights are additive meshes in a disposable group: square glows, pulsing rings, capture tori, a red check ring, and quadratic arc lines for the inspector.
- Animation: a `Map` of piece → tween (from/to, delay, arc, fade). Selection lift and a slow sway are interpolated in the render loop when a piece is not tweening.
- Camera: `OrbitControls` with damping, polar limits and a clamped target. `fitDistanceForViewport()` widens FOV and increases distance on portrait screens; presets animate position and target with a 750 ms ease.
- Boot: `rebuildPieces({ animate: true })` drops the pieces in, then the loading veil fades. `window.__CHESS_STUDIO_READY__` is set for tests.

## Interaction model

`UI.mode` is `play` or `puzzle`. `activeState()` returns the corresponding engine state, so every renderer and panel function works against the board currently on screen.

Flow in play mode:

```text
click piece → selectSquare()
  own piece  → legal moves for that square → clickable rings
  any piece + lens / opponent → pseudo-legal paths → inspection arcs only
click legal target → attemptMove()
  promotion → modal (Q/R/B/N) → commit
  otherwise → commitGameMove()
```

`commitGameMove` computes SAN before mutating, applies the move, animates the mesh (including rook for castling, victim fade, promotion swap), refreshes the UI, saves, plays the right sound, and then runs the blunder guard. Checkmate/stalemate opens the end modal after a short beat.

Puzzles keep their own state; entering a drill does not touch the saved game. A wrong move is rejected without mutating the board, resets the streak, and flashes the stage. A correct move marks the drill, updates the streak, and opens the explanation modal.

## Persistence

```js
localStorage['full3dChessAcademy.v1'] = {
  v: 2, lang, sound, tips, guard, coords, motion,
  vsBot: false, botLevel: 'club', humanColor: 'w',
  game: { startFen, moves: ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f1c4', 'e1g1'] },
  puzzles: { solved: ['back-rank'], streak: 4, best: 7 }
}
```

Moves are stored in UCI (`from` + `to` + optional lowercase promotion). On boot each is matched against `legalMoves`; SAN and castling rights are rebuilt by replaying. If a stored move is no longer legal, the restore is abandoned and a fresh board is used. Preferences are restored before the first render.

## i18n

`I18N.en` and `I18N.th` hold interface strings only. Lessons, piece rules, coach tips and drill copy are bilingual objects in their own structures so they can be edited together. Static markup uses `data-i18n`, with `data-i18n-attr="aria-label:key"` for attributes. Dynamic text goes through `t(key, vars)`.

**The selected language is the only visible language by default.** English mode must not show Thai in any panel, coach tip, dialog, drill explanation or game-over copy. `UI.tips` is off by default (and older stores are migrated off); the optional “Show the other language” switch adds a secondary line to coach and modal copy but never replaces the primary. The `body.hide-alt-tips` class and the `.modal-sub-alt` rule enforce this. Chess notation and FEN remain language-neutral.

## Extending it

- **Bot tuning:** `AI_LEVELS` controls depth, time, randomness and quiescence; `PST` controls positional play. Keep the engine pure and re-run the bot checks plus a live browser move after any change.
- **New lesson/tip:** add to `LESSONS` or `COACH_TIPS` with `{ en, th }`; no key registration needed.
- **New drill:** append to `#puzzle-data` with a legal FEN, `side`, UCI, SAN, bilingual hint/explanation. Run `node scripts/check.mjs`; it proves legality, SAN and mate claims.
- **New piece set:** replace `buildPiece` templates; keep the root group's `userData.isPiece`, `type`, `color`, `square` and `baseRot`, and keep the base at `y = 0`.
- **New board size/theme:** the mapping lives in `squarePos` and the tile loop; update `screenPointForSquare`, frame dimensions, label placement, `fitDistanceForViewport` and the tests together.
- **Engine change:** keep the markers, keep `ENGINE_API` exports, and add a perft or regression case before touching move generation.
