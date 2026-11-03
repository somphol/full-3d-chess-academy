# Testing

## Automated suite (shipped)

```bash
node --check script.js
node scripts/check.mjs
```

`scripts/check.mjs` has no dependencies. It slices the engine out of `script.js` between the markers and evaluates it in Node, then checks the document and drills.

Coverage:

- **Move generation** — start position 20 moves; perft 20 / 400 / 8,902; Kiwipete 48 / 2,039.
- **Special rules** — en passant generation, capture removal, SAN, undo; both castles, king/rook placement, SAN, undo; all four promotions, `=Q` SAN, board mutation, undo.
- **End states** — Fool’s mate, stalemate, threefold repetition by knight shuffle, fifty-move counter, king + bishop insufficient material, Italian-game SAN sequence, rook check suffix.
- **Bot** — finds the back-rank mate and the free rook, returns a legal move at all three levels, leaves the position untouched, and a Sharp search of a middlegame position finishes inside the 5-second test budget with depth and node counts reported.
- **Bilingual integrity** — EN/TH dictionaries have identical key sets; every `data-i18n`, `data-i18n-attr` and dynamic `t()` key exists.
- **Markup integrity** — required ids exist, no duplicate ids, stylesheet and module links, pinned Three.js, import map, drill JSON.
- **Drills** — three unique drills, bilingual copy, FEN parses, side to move matches, the side not to move is not in check, the UCI solution is legal, SAN matches, promised mates are mate, board restores after undo.
- **Release integrity** — required documents exist, relative Markdown links resolve, `.nojekyll` is empty, `state.json` parses and records elapsed time, tokens and credits.

Current result: **84 checks passed, 0 failed**.

## Headless browser pass (not shipped)

A local harness drove Chrome through the DevTools Protocol with Node’s built-in WebSocket. It is not committed because it depends on a local Chrome path and a temporary HTTP server. It performed **97 interaction checks** across two passes.

### Core pass — 54 checks

- Boot: 32 meshes, 3 drills, canvas sized, loading veil dismissed, zero console errors/exceptions.
- Selection: click e2, two legal moves, inspector visible; click e4 commits SAN `e4`; turn passes.
- Undo restores the start and White’s turn.
- Language switch to Thai updates `<html lang>`, the coach and the stage badge; switching back works.
- Drill: load back-rank, 9 puzzle meshes, White to move, select a1, play a8, solved + streak + explanation modal, exit to the saved game.
- Capture: king takes rook; mesh removed, tray shows the rook, material says `+5`.
- Promotion: a7–a8 opens the modal; choosing queen places a queen and closes the modal.
- New game: confirmation appears with moves on the board; confirm resets to 32 pieces.
- Guard: hanging queen gives a ≥9 gain; the guard modal opens and names the piece; Undo &amp; Learn restores the queen.
- Castling: e1–g1 moves king to g1, rook to f1, SAN `O-O`, rook mesh on f1.
- Checkmate: Queen h4# ends the game, shows “Black wins”, review closes the modal, undo reopens play.
- Reload: the saved game is replayed from localStorage with the same SAN.
- Responsive: 390 × 844 has no horizontal overflow.

### Opponent and language pass — 43 checks

- English is the default and `document.body.innerText` contains **no Thai** on load, after a move, in the blunder dialog and after switching back from Thai.
- The secondary-language switch is off by default; the blunder dialog’s second-language line computes to `display: none`.
- Bot mode enables from the Opponent card; settings, level badge and side controls update.
- Playing White: e4, thinking badge appears, bot replies, turn returns, SAN appears in the move list.
- Undo removes both the bot reply and the human move and returns the turn.
- Switching to Black starts a fresh game; the bot opens; undo is refused before the human has moved.
- Black’s move is accepted and the bot replies; bot mode, side and saved moves survive a reload.
- Thai mode shows Thai, English mode hides it again; bot copy follows the language.
- The optional study switch reveals Thai when enabled and hides it when off.
- Mobile 390 × 844 has no horizontal overflow; zero console errors/exceptions.

Screenshots from both passes are in `assets/`.

## Manual matrix

| Area | Verified in Chrome 1440 × 1000 | Verified at 390 × 844 |
| --- | --- | --- |
| 3D board, lights, shadows | yes | yes |
| Orbit / pan / zoom | yes | touch orbit, pinch zoom |
| Click selection, rings, captures | yes | tap |
| Inspector lift, sway, arcs | yes | yes |
| Promotion, guard, game over | yes | yes (modal fits) |
| Drill flow, hint, reset, next | yes | yes |
| EN ⇄ TH across panels and modals | yes | yes |
| Export PGN / JSON | yes (download starts) | not re-run |
| localStorage reload restore | yes | yes |

## Known gaps

- Safari and Firefox are not automated. Import maps, `CanvasTexture` and WebGL2 should work, but a manual pass is recommended before a wide launch.
- The board is not operable by keyboard; buttons, tabs, language, camera and shortcuts are.
- No screen-reader representation of the position beyond the move list and status announcements.
- Puzzle checks are single-move by design.
- The bot is not strength-tested against an external engine or a rating pool; the checks prove legality, tactics and time bounds, not playing strength.
- Bot search runs on the main thread, so a Sharp search can pause animation for up to ~1.4 s. The thinking badge is painted before the search begins.
- Sound was verified by code path and manual listening, not by waveform assertions.

## Reproducing the browser pass

```bash
python3 -m http.server 8080
# launch Chrome with --remote-debugging-port and a throwaway profile
# drive it with Page.navigate, Runtime.evaluate, Input.dispatchMouseEvent
# project a square with: ChessStudio.screenPointForSquare(28, 0.4)
```

`window.ChessStudio` exposes `game`, `ui`, `engine`, `puzzles`, `pieceMeshes`, `screenPointForSquare`, `loadPuzzle`, `setLang`, `setCamera`, `rebuildPieces`, `refreshAll` and `threatsForKey` for diagnostics.
