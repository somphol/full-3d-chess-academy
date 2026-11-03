# Design

## Premise

A chess academy should feel like a room, not a spreadsheet. The interface frames a real, lit board inside a dark studio, with the teaching material on the walls rather than on top of the board. Everything is built to read at a glance, to sit still while you think, and to explain itself in two languages.

## Visual system

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#070a10` | studio night |
| `--panel` | `rgba(17,22,32,.82)` | glass rails |
| `--ink` | `#e9eef8` | primary text |
| `--muted` | `#8d9ab1` | secondary text |
| `--gold` | `#e7c778` | brass, focus, kingly accents |
| `--teal` | `#5fe3cb` | legal moves, live coaching |
| `--red` | `#ff7d7d` | danger, captures, check |
| `--serif` | Iowan / Palatino / Georgia | titles and piece cards |
| `--sans` | system UI + Noto Sans Thai | everything functional |

The board itself is the only warm surface: maple wood on light squares, blue-grey slate on dark, walnut frame, brass trim and corner studs. Pieces are polished ivory and deep obsidian with a gold crown detail. The camera starts behind White at a raked angle, high enough to read the whole board, low enough to see the pieces as objects.

## Layout

Three columns on wide screens: academy rail (Coach / Puzzles / Moves), board stage, match rail. The board gets the centre and the majority of the width; the rails are glass, scroll independently, and never cover the canvas except for the floating inspector and the compact dock.

Below 1120 px the match rail becomes a row. Below 860 px the app becomes a single scroll: stage first, then academy, then studio cards. The stage keeps a fixed share of the viewport, the dock reduces to icons, and the inspector becomes a bottom sheet. The camera widens and steps back so the full board remains visible at 390 px.

## Board language

- **Teal ring** — a legal quiet move.
- **Red torus** — a legal capture.
- **Gold ring** — castling.
- **Amber square glow** — the last move.
- **Red ring + glow** — the king is in check.
- **Teal halo + lift** — the selected/inspected piece.
- **Arcs and discs** — the inspector’s projected paths; solid for current-turn pieces, dim for study.

The palette is consistent everywhere: teal is “you can”, red is “danger”, gold is “special”.

## Piece design

Each piece is a composite of primitives with a shared base profile, so the set feels like one family:

- Pawn: a small lathe bell with a sphere head and a brass collar.
- Rook: tapered tower, six crenellations, a dark inner ring to suggest a hollow top.
- Knight: an extruded horse-head silhouette with a beveled edge, an eye and a mane; profiles face across the board so the shape reads from both camera sides.
- Bishop: a mitre lathe with a brass finial and a dark slit.
- Queen: a tall body, a ring of nine alternating gold points and a top orb.
- King: the tallest body, a coronet and a brass cross.

Materials use clearcoat and a room environment probe; the ivory catches a warm highlight, the obsidian picks up the blue rim. Shadows are soft and grounded by a dark circular floor.

## The opponent

The Opponent card is deliberately quiet: a two-state switch, a side choice, three strengths and a short status line. It sits above the camera so it reads as part of the match, not as a separate game mode. When the bot is on, the badge names the strength, the match note says “You are White · Club bot”, and a teal thinking badge appears in the stage while the search runs. During that moment the board accepts no input, which prevents accidental moves against a half-played reply.

Three strengths are labelled by feel rather than by rating: Casual, Club and Sharp. The bot is presented as a training partner, never as a rated engine. Undo is worded as taking back “both its reply and your move”, because that is the useful unit for a learner.

## Teaching system

The coach is written as a patient club player, not a warning system:

- One primary tip, one secondary-language line, then a short checklist of what to verify.
- Tips prioritise the concrete: check, a mate-in-one, a free capture, then opening principles, then a rotating library.
- Explanations name the piece and square, give the move in algebraic notation, and say what happens next.
- The blunder guard never blocks a move permanently. It shows the threat, offers “Undo &amp; learn”, and accepts “Keep the move”.
- Drill copy explains the idea after the move, not before it.

## Bilingual typography

Thai text is set in the system Thai stack with a taller line height and slightly reduced tracking for uppercase eyebrow labels. The interface switches immediately: every static label has a translation, every dynamic string goes through `t()`, and lesson/puzzle content carries both languages in data.

**Only the selected language is shown by default.** English mode renders no Thai — not in the coach, not in dialogs, not in drill explanations. Thai mode is equally exclusive. The optional “Show the other language” switch adds a dim secondary line for comparison; it is off on first run and for migrated sessions. The switch is a study aid, not the default reading experience.

## Motion

Motion is used to explain, not decorate:

- Pieces drop in at boot and arc when they move.
- Selected pieces lift and sway slowly.
- Legal rings breathe; check pulses.
- The camera idles with a very slow orbit after nine quiet seconds, and the toggle can stop it.
- Modal entrances are 240 ms and reduced-motion users get instant states.

## Sound

Short synthesised cues: a soft lift, a wooden drop, a noise-burst capture, a two-note castle, a two-note check alarm, a four-note promotion, a buzzer for illegal attempts, and a fanfare for a solved drill. Nothing loops, nothing is sampled.
