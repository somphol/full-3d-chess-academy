# Puzzle ladder

Three beginner drills, loaded as JSON from `#puzzle-data` in `index.html`. The test suite re-parses every position, proves the solution is legal, checks the SAN string and confirms that a `#` really is mate.

## 01 · Back-rank mate

```text
FEN   6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1
Play  Ra8#
Idea  The rook owns the open eighth rank. The black king's own pawns
      occupy f7, g7 and h7, so there is no flight square and no block.
```

Teaching point: a safe king still needs Luft. The pawn shield that protects a king can also imprison him.

## 02 · The queen's kiss

```text
FEN   7k/8/5K2/8/8/8/8/6Q1 w - - 0 1
Play  Qg7#
Idea  The queen steps next to the king and is protected by the white king
      on f6. She covers h8, g8 and h7; the king cannot capture her.
```

Teaching point: the queen is strongest when supported. A king is a fighting piece in the endgame, even while delivering mate.

## 03 · Knight fork

```text
FEN   2r1k3/8/8/8/4N3/8/8/4K3 w - - 0 1
Play  Nd6+
Idea  The knight checks the king on e8 and attacks the rook on c8.
      Black must answer the check; White takes the rook next.
```

Teaching point: knights attack squares, not lines. Find the square that touches both targets.

## Design rules for new drills

1. Use a legal FEN. The side **not** to move must not be in check.
2. Store the expected move in UCI (lowercase promotion suffix), and the same move in SAN with `+`/`#`.
3. If the title promises mate, the position must actually be mate after the move.
4. Keep the hint conceptual, never the move itself.
5. Write the explanation for a beginner: name the idea, the squares, and why the defence fails.
6. Run `node scripts/check.mjs` before committing.

The drills are single-move by design. A future ladder can add scripted replies, but it must extend the validator first.
