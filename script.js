/* ============================================================================
   Full 3D Chess Academy & Studio — script.js
   Vanilla ES modules + Three.js. No framework, no backend, no tracking.

   Sections
   1. Chess engine (pure, testable: see scripts/check.mjs)
   2. Content: i18n, piece lore, lessons, puzzles
   3. Audio, persistence, small utilities
   4. Three.js studio: board, pieces, lights, raycasting, animation
   5. Game controller: selection, moves, promotion, guard, puzzles
   6. Interface: language, panels, coach, modals, exports, keyboard
   ========================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ==========================================================================
   1. CHESS ENGINE
   ========================================================================== */
/* ENGINE:START */
const FILES = 'abcdefgh';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PIECE_VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const PROMOTION_PIECES = ['Q', 'R', 'B', 'N'];

const KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KING_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

function sqName(i) { return FILES[i & 7] + ((i >> 3) + 1); }
function nameToSq(name) {
  if (typeof name !== 'string' || name.length < 2) return -1;
  const f = FILES.indexOf(name[0]);
  const r = parseInt(name[1], 10) - 1;
  if (f < 0 || r < 0 || r > 7) return -1;
  return r * 8 + f;
}
function otherColor(c) { return c === 'w' ? 'b' : 'w'; }

function parseFEN(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 1) throw new Error('Invalid FEN');
  const board = new Array(64).fill(null);
  let i = 56;
  for (const ch of parts[0]) {
    if (ch === '/') i -= 16;
    else if (/\d/.test(ch)) i += Number(ch);
    else {
      if (i < 0 || i > 63) throw new Error('Invalid FEN board');
      const upper = ch.toUpperCase();
      if (!'PNBRQK'.includes(upper)) throw new Error('Invalid FEN piece: ' + ch);
      board[i++] = { type: upper, color: ch === upper ? 'w' : 'b' };
    }
  }
  if (board.filter(Boolean).length < 2) throw new Error('Invalid FEN: too few pieces');
  const turn = parts[1] === 'b' ? 'b' : 'w';
  const rights = parts[2] || '-';
  const castling = { K: rights.includes('K'), Q: rights.includes('Q'), k: rights.includes('k'), q: rights.includes('q') };
  const ep = parts[3] && parts[3] !== '-' ? nameToSq(parts[3]) : null;
  const half = parts[4] != null ? Number(parts[4]) : 0;
  const full = parts[5] != null ? Number(parts[5]) : 1;
  return { board, turn, castling, ep, half: Number.isFinite(half) ? half : 0, full: Number.isFinite(full) ? full : 1 };
}

function castlingString(state) {
  const s = (state.castling.K ? 'K' : '') + (state.castling.Q ? 'Q' : '') +
    (state.castling.k ? 'k' : '') + (state.castling.q ? 'q' : '');
  return s || '-';
}

function positionKey(state) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) { s += empty; empty = 0; }
        s += p.color === 'w' ? p.type : p.type.toLowerCase();
      }
    }
    if (empty) s += empty;
    if (r > 0) s += '/';
  }
  return s + ' ' + state.turn + ' ' + castlingString(state) + ' ' + (state.ep == null ? '-' : sqName(state.ep));
}

function toFEN(state) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) { s += empty; empty = 0; }
        s += p.color === 'w' ? p.type : p.type.toLowerCase();
      }
    }
    if (empty) s += empty;
    if (r > 0) s += '/';
  }
  return `${s} ${state.turn} ${castlingString(state)} ${state.ep == null ? '-' : sqName(state.ep)} ${state.half} ${state.full}`;
}

function createState(fen = START_FEN) {
  const p = parseFEN(fen);
  const state = {
    board: p.board,
    turn: p.turn,
    castling: p.castling,
    ep: p.ep,
    half: p.half,
    full: p.full,
    history: [],
    positions: [],
    sanMoves: [],
  };
  state.positions.push(positionKey(state));
  return state;
}

function findKing(board, color) {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.type === 'K' && p.color === color) return i;
  }
  return -1;
}

function isAttacked(board, sq, by) {
  const f = sq & 7;
  const r = sq >> 3;

  // Pawns: a white pawn sits one rank below the square it attacks.
  const pawnRank = r + (by === 'w' ? -1 : 1);
  if (pawnRank >= 0 && pawnRank < 8) {
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      const p = board[pawnRank * 8 + nf];
      if (p && p.color === by && p.type === 'P') return true;
    }
  }

  for (const [df, dr] of KNIGHT_OFFSETS) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    const p = board[nr * 8 + nf];
    if (p && p.color === by && p.type === 'N') return true;
  }

  for (const [df, dr] of KING_DIRS) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    const p = board[nr * 8 + nf];
    if (p && p.color === by && p.type === 'K') return true;
  }

  const rays = [
    [ROOK_DIRS, 'R'],
    [BISHOP_DIRS, 'B'],
  ];
  for (const [dirs, type] of rays) {
    for (const [df, dr] of dirs) {
      let nf = f + df, nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const p = board[nr * 8 + nf];
        if (p) {
          if (p.color === by && (p.type === type || p.type === 'Q')) return true;
          break;
        }
        nf += df; nr += dr;
      }
    }
  }
  return false;
}

function inCheck(state, color) {
  const king = findKing(state.board, color);
  return king >= 0 && isAttacked(state.board, king, otherColor(color));
}

function makeMove(from, to, piece, extra = {}) {
  return {
    from, to, piece: piece.type, color: piece.color,
    captured: null, capturedSquare: null, promo: null,
    ep: false, castle: null, double: false,
    ...extra,
  };
}

function genMoves(state, color = state.turn) {
  const b = state.board;
  const moves = [];
  const addPawn = (from, to, captured, ep = false, promoRank = false, double = false) => {
    if (promoRank) {
      for (const promo of PROMOTION_PIECES) {
        moves.push(makeMove(from, to, b[from], { captured, promo, ep, double }));
      }
    } else {
      moves.push(makeMove(from, to, b[from], { captured, ep, double }));
    }
  };

  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || p.color !== color) continue;
    const f = i & 7;
    const r = i >> 3;

    if (p.type === 'P') {
      const dir = color === 'w' ? 8 : -8;
      const startRank = color === 'w' ? 1 : 6;
      const promoRank = color === 'w' ? 7 : 0;
      const one = i + dir;
      if (one >= 0 && one < 64 && !b[one]) {
        addPawn(i, one, null, false, (one >> 3) === promoRank);
        const two = i + dir * 2;
        if (r === startRank && !b[two]) {
          addPawn(i, two, null, false, false, true);
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df;
        const nr = r + (color === 'w' ? 1 : -1);
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const j = nr * 8 + nf;
        const target = b[j];
        if (target && target.color !== color) {
          addPawn(i, j, target.type, false, nr === promoRank);
        } else if (!target && state.ep === j) {
          addPawn(i, j, 'P', true, false);
        }
      }
      continue;
    }

    if (p.type === 'N' || p.type === 'K') {
      const offs = p.type === 'N' ? KNIGHT_OFFSETS : KING_DIRS;
      for (const [df, dr] of offs) {
        const nf = f + df, nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const j = nr * 8 + nf;
        const target = b[j];
        if (!target || target.color !== color) {
          moves.push(makeMove(i, j, p, { captured: target ? target.type : null }));
        }
      }
      if (p.type === 'K') {
        const rankHome = color === 'w' ? 0 : 7;
        const home = rankHome * 8 + 4;
        if (i === home && !isAttacked(b, i, otherColor(color))) {
          const kRight = color === 'w' ? state.castling.K : state.castling.k;
          const qRight = color === 'w' ? state.castling.Q : state.castling.q;
          const rookType = color === 'w' ? 'R' : 'R';
          if (kRight) {
            const f1 = rankHome * 8 + 5, g1 = rankHome * 8 + 6, h1 = rankHome * 8 + 7;
            const rook = b[h1];
            if (!b[f1] && !b[g1] && rook && rook.type === rookType && rook.color === color &&
              !isAttacked(b, f1, otherColor(color)) && !isAttacked(b, g1, otherColor(color))) {
              moves.push(makeMove(i, g1, p, { castle: color === 'w' ? 'K' : 'k' }));
            }
          }
          if (qRight) {
            const d1 = rankHome * 8 + 3, c1 = rankHome * 8 + 2, b1 = rankHome * 8 + 1, a1 = rankHome * 8;
            const rook = b[a1];
            if (!b[d1] && !b[c1] && !b[b1] && rook && rook.type === rookType && rook.color === color &&
              !isAttacked(b, d1, otherColor(color)) && !isAttacked(b, c1, otherColor(color))) {
              moves.push(makeMove(i, c1, p, { castle: color === 'w' ? 'Q' : 'q' }));
            }
          }
        }
      }
      continue;
    }

    const dirs = p.type === 'R' ? ROOK_DIRS : p.type === 'B' ? BISHOP_DIRS : KING_DIRS;
    for (const [df, dr] of dirs) {
      let nf = f + df, nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const j = nr * 8 + nf;
        const target = b[j];
        if (!target) {
          moves.push(makeMove(i, j, p));
        } else {
          if (target.color !== color) moves.push(makeMove(i, j, p, { captured: target.type }));
          break;
        }
        nf += df; nr += dr;
      }
    }
  }
  return moves;
}

function revokeRights(state, sq) {
  if (sq === 4) { state.castling.K = false; state.castling.Q = false; }
  else if (sq === 60) { state.castling.k = false; state.castling.q = false; }
  else if (sq === 0) state.castling.Q = false;
  else if (sq === 7) state.castling.K = false;
  else if (sq === 56) state.castling.q = false;
  else if (sq === 63) state.castling.k = false;
}

function applyMove(state, move, trackPositions = true) {
  const b = state.board;
  const piece = b[move.from];
  if (!piece) throw new Error('Illegal move: no piece on ' + sqName(move.from));
  if (piece.color !== state.turn) throw new Error('Illegal move: wrong side to move');

  const undo = {
    move,
    captured: null,
    capturedSquare: null,
    castling: { ...state.castling },
    ep: state.ep,
    half: state.half,
    full: state.full,
    rookUndo: null,
  };

  if (move.ep) {
    const capSq = move.to + (piece.color === 'w' ? -8 : 8);
    const victim = b[capSq];
    if (victim) {
      undo.captured = victim;
      undo.capturedSquare = capSq;
      b[capSq] = null;
    }
  } else if (b[move.to]) {
    undo.captured = b[move.to];
    undo.capturedSquare = move.to;
  }

  b[move.to] = move.promo ? { type: move.promo, color: piece.color } : piece;
  b[move.from] = null;

  if (move.castle) {
    const white = piece.color === 'w';
    const rank = white ? 0 : 7;
    if (move.castle === 'K' || move.castle === 'k') {
      b[rank * 8 + 5] = b[rank * 8 + 7];
      b[rank * 8 + 7] = null;
      undo.rookFrom = rank * 8 + 7;
      undo.rookTo = rank * 8 + 5;
    } else {
      b[rank * 8 + 3] = b[rank * 8 + 0];
      b[rank * 8 + 0] = null;
      undo.rookFrom = rank * 8 + 0;
      undo.rookTo = rank * 8 + 3;
    }
  }

  revokeRights(state, move.from);
  revokeRights(state, move.to);
  state.ep = move.double ? (move.from + move.to) / 2 : null;
  state.half = (piece.type === 'P' || undo.captured) ? 0 : state.half + 1;
  if (piece.color === 'b') state.full += 1;
  state.turn = otherColor(piece.color);
  state.history.push(undo);
  if (trackPositions) state.positions.push(positionKey(state));
  return undo;
}

function undoMove(state, trackPositions = true) {
  const undo = state.history.pop();
  if (!undo) return null;
  if (trackPositions) state.positions.pop();
  const b = state.board;
  const { move } = undo;

  b[move.from] = move.promo ? { type: 'P', color: move.color } : b[move.to];
  b[move.to] = null;

  if (undo.capturedSquare != null) {
    b[undo.capturedSquare] = undo.captured;
  }
  if (move.castle) {
    b[undo.rookFrom] = b[undo.rookTo];
    b[undo.rookTo] = null;
  }
  state.castling = { ...undo.castling };
  state.ep = undo.ep;
  state.half = undo.half;
  state.full = undo.full;
  state.turn = move.color;
  return undo;
}

function legalMoves(state, color = state.turn) {
  const out = [];
  const enemy = otherColor(color);
  for (const move of genMoves(state, color)) {
    applyMove(state, move, false);
    const king = findKing(state.board, color);
    const safe = king >= 0 && !isAttacked(state.board, king, enemy);
    undoMove(state, false);
    if (safe) out.push(move);
  }
  return out;
}

function insufficientMaterial(board) {
  const pieces = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.type !== 'K') pieces.push({ ...p, sq: i });
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0].type === 'B' || pieces[0].type === 'N')) return true;
  if (pieces.length === 2 && pieces[0].type === 'B' && pieces[1].type === 'B' &&
    pieces[0].color !== pieces[1].color) {
    const colorOf = (sq) => (sq & 7) + (sq >> 3);
    if ((colorOf(pieces[0].sq) % 2) === (colorOf(pieces[1].sq) % 2)) return true;
  }
  return false;
}

function gameStatus(state) {
  const check = inCheck(state, state.turn);
  const moves = legalMoves(state, state.turn);
  if (moves.length === 0) {
    if (check) {
      return { over: true, check, result: state.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', winner: otherColor(state.turn) };
    }
    return { over: true, check: false, result: '1/2-1/2', reason: 'stalemate', winner: null };
  }
  if (state.half >= 100) return { over: true, check, result: '1/2-1/2', reason: 'fifty', winner: null };
  const last = state.positions[state.positions.length - 1];
  if (state.positions.filter((k) => k === last).length >= 3) {
    return { over: true, check, result: '1/2-1/2', reason: 'threefold', winner: null };
  }
  if (insufficientMaterial(state.board)) {
    return { over: true, check, result: '1/2-1/2', reason: 'insufficient', winner: null };
  }
  return { over: false, check, result: null, reason: null, winner: null, moves };
}

function moveToSAN(state, move) {
  const piece = state.board[move.from];
  let base;
  if (move.castle) {
    base = (move.castle === 'K' || move.castle === 'k') ? 'O-O' : 'O-O-O';
  } else if (piece.type === 'P') {
    base = (move.captured || move.ep)
      ? FILES[move.from & 7] + 'x' + sqName(move.to)
      : sqName(move.to);
    if (move.promo) base += '=' + move.promo;
  } else {
    let dis = '';
    const rivals = legalMoves(state, piece.color).filter(
      (m) => m.to === move.to && m.from !== move.from && state.board[m.from] && state.board[m.from].type === piece.type
    );
    if (rivals.length) {
      const sameFile = rivals.some((m) => (m.from & 7) === (move.from & 7));
      const sameRank = rivals.some((m) => (m.from >> 3) === (move.from >> 3));
      if (!sameFile) dis = FILES[move.from & 7];
      else if (!sameRank) dis = String((move.from >> 3) + 1);
      else dis = sqName(move.from);
    }
    base = piece.type + dis + (move.captured ? 'x' : '') + sqName(move.to);
  }

  applyMove(state, move, false);
  const opp = state.turn;
  const givesCheck = inCheck(state, opp);
  const replies = givesCheck ? legalMoves(state, opp) : [];
  undoMove(state, false);
  if (givesCheck) base += replies.length === 0 ? '#' : '+';
  return base;
}

function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(state, state.turn);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    applyMove(state, m, false);
    nodes += perft(state, depth - 1);
    undoMove(state, false);
  }
  return nodes;
}

/* ------------------------------------------------------------------ AI ---- */
const AI_TIMEOUT = { timeout: true };
const AI_LEVELS = {
  easy: { depth: 1, timeMs: 320, random: 0.42, qdepth: 2, key: 'bot.easy' },
  club: { depth: 3, timeMs: 900, random: 0.04, qdepth: 3, key: 'bot.club' },
  strong: { depth: 4, timeMs: 1400, random: 0.0, qdepth: 3, key: 'bot.strong' },
};
const AI_MATE = 100000;
const AI_NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let aiNodes = 0;

/* Piece-square tables, a1..h8, White's point of view (centipawns). */
const PST = {
  P: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  N: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  B: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  R: [
    0, 0, 0, 5, 5, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  Q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -10, 5, 5, 5, 5, 5, 0, -10,
    0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  K: [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
  ],
  K_END: [
    -50, -30, -30, -30, -30, -30, -30, -50,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -50, -40, -30, -20, -20, -30, -40, -50,
  ],
};

function evaluateBoard(state) {
  let heavy = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p && p.type !== 'K' && p.type !== 'P') heavy += PIECE_VALUE[p.type];
  }
  let score = 0;
  let wBishops = 0;
  let bBishops = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p) continue;
    if (p.type === 'B') {
      if (p.color === 'w') wBishops++;
      else bBishops++;
    }
    const table = p.type === 'K' && heavy < 12 ? PST.K_END : PST[p.type];
    const idx = p.color === 'w' ? i : (i ^ 56);
    const value = (p.type === 'K' ? 0 : PIECE_VALUE[p.type] * 100) + table[idx];
    score += p.color === 'w' ? value : -value;
  }
  if (wBishops >= 2) score += 28;
  if (bBishops >= 2) score -= 28;
  return state.turn === 'w' ? score : -score;
}

function orderMoves(moves) {
  for (const m of moves) {
    let s = 0;
    if (m.captured) s += 900 + PIECE_VALUE[m.captured] * 100 - PIECE_VALUE[m.piece] * 8;
    if (m.promo) s += 800 + PIECE_VALUE[m.promo] * 100;
    if (m.castle) s += 55;
    const f = m.to & 7;
    const r = m.to >> 3;
    s += (3.5 - Math.abs(f - 3.5)) * 3 + (3.5 - Math.abs(r - 3.5)) * 3;
    m.aiScore = s;
  }
  moves.sort((a, b) => b.aiScore - a.aiScore);
  return moves;
}

function aiQuiesce(state, alpha, beta, deadline, ply, qdepth) {
  aiNodes++;
  if ((aiNodes & 511) === 0 && AI_NOW() > deadline) throw AI_TIMEOUT;

  const checked = inCheck(state, state.turn);
  const all = legalMoves(state);
  if (!all.length) return checked ? -AI_MATE + ply : 0;
  if (qdepth <= 0) return evaluateBoard(state);

  if (!checked) {
    const stand = evaluateBoard(state);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }

  const moves = checked ? all : all.filter((m) => m.captured || m.promo);
  orderMoves(moves);
  for (const m of moves) {
    applyMove(state, m, false);
    const score = -aiQuiesce(state, -beta, -alpha, deadline, ply + 1, qdepth - 1);
    undoMove(state, false);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function aiSearch(state, depth, alpha, beta, deadline, ply) {
  aiNodes++;
  if ((aiNodes & 511) === 0 && AI_NOW() > deadline) throw AI_TIMEOUT;

  if (depth <= 0) return aiQuiesce(state, alpha, beta, deadline, ply, 3);

  const moves = orderMoves(legalMoves(state));
  if (!moves.length) return inCheck(state, state.turn) ? -AI_MATE + ply : 0;

  let best = -Infinity;
  for (const m of moves) {
    applyMove(state, m, false);
    const score = -aiSearch(state, depth - 1, -beta, -alpha, deadline, ply + 1);
    undoMove(state, false);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function aiRoot(state, depth, deadline, previousBest) {
  const moves = orderMoves(legalMoves(state));
  if (!moves.length) return null;
  if (previousBest) {
    const i = moves.findIndex((m) => m.from === previousBest.from && m.to === previousBest.to && m.promo === previousBest.promo);
    if (i > 0) moves.unshift(moves.splice(i, 1)[0]);
  }
  let alpha = -Infinity;
  let bestScore = -Infinity;
  let best = moves[0];
  for (const m of moves) {
    applyMove(state, m, false);
    const score = -aiSearch(state, depth - 1, -Infinity, -alpha, deadline, 1);
    undoMove(state, false);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
    if (score > alpha) alpha = score;
  }
  return { move: best, score: bestScore, depth };
}

function chooseBotMove(state, level = 'club', rng = Math.random) {
  const cfg = AI_LEVELS[level] || AI_LEVELS.club;
  const legal = legalMoves(state);
  if (!legal.length) {
    return { move: null, score: 0, depth: 0, nodes: 0, elapsedMs: 0, level, random: false };
  }

  const started = AI_NOW();
  if (rng() < cfg.random) {
    const index = Math.floor(rng() * legal.length) % legal.length;
    return {
      move: legal[index], score: 0, depth: 0, nodes: 0,
      elapsedMs: AI_NOW() - started, level, random: true,
    };
  }

  aiNodes = 0;
  const deadline = started + cfg.timeMs;
  let best = null;
  try {
    for (let d = 1; d <= cfg.depth; d++) {
      const result = aiRoot(state, d, deadline, best ? best.move : null);
      if (result) best = result;
      if (AI_NOW() > deadline) break;
    }
  } catch (err) {
    if (err !== AI_TIMEOUT) throw err;
  }

  if (!best) {
    best = { move: orderMoves(legal)[0], score: 0, depth: 0 };
  }
  return {
    ...best,
    nodes: aiNodes,
    elapsedMs: Math.round(AI_NOW() - started),
    level,
    random: false,
  };
}

const ENGINE_API = {
  FILES, START_FEN, PIECE_VALUE, PROMOTION_PIECES,
  sqName, nameToSq, parseFEN, createState, positionKey, toFEN, castlingString,
  findKing, isAttacked, inCheck, genMoves, legalMoves, applyMove, undoMove,
  gameStatus, moveToSAN, perft, insufficientMaterial,
  AI_LEVELS, PST, evaluateBoard, chooseBotMove,
};
/* ENGINE:END */

/* ==========================================================================
   2. CONTENT — bilingual interface, piece lore, lessons, puzzles
   ========================================================================== */

const I18N = {
  en: {
    'brand.tagline': 'Rotate the studio. Learn the game. Play a full game of chess.',
    'ui.sound': 'Toggle sound', 'ui.help': 'Help', 'ui.close': 'Close', 'ui.cancel': 'Cancel',
    'tabs.coach': 'Coach', 'tabs.puzzles': 'Puzzles', 'tabs.moves': 'Moves',
    'coach.live': 'Live coaching', 'coach.refresh': 'Refresh',
    'coach.checks': 'What to check now', 'coach.lesson': 'Current lesson', 'coach.guard': 'Blunder guard',
    'coach.guardTitle': 'Warn me before a blunder',
    'coach.guardSub': 'Offers Undo & Learn after a hanging piece or mate-in-one.',
    'coach.tipsTitle': 'Show the other language',
    'coach.tipsSub': 'Adds a second-language line under coach tips and dialogs. Off means only the selected language is shown.',
    'puzzle.training': 'Tactical drills', 'puzzle.solvedLabel': 'solved', 'puzzle.streak': 'Streak',
    'puzzle.best': 'Best', 'puzzle.hint': 'Hint', 'puzzle.retry': 'Reset drill', 'puzzle.exit': 'Exit drill',
    'puzzle.pick': 'Pick a drill to load it onto the 3D board.',
    'puzzle.solvedStatus': 'Solved! Streak {n}. Pick another drill or keep exploring the position.',
    'moves.title': 'Move list', 'moves.white': 'White', 'moves.black': 'Black',
    'moves.empty': 'No moves yet. White begins.', 'moves.captured': 'Captured material',
    'moves.byWhite': 'White took', 'moves.byBlack': 'Black took', 'moves.none': 'Nothing yet',
    'moves.saved': 'Saved game',
    'moves.savedNote': 'Your game is saved in this browser automatically. Export it before clearing browser data.',
    'stage.play': 'Play mode', 'stage.inspect': 'Inspect mode', 'stage.puzzle': 'Drill mode', 'stage.check': 'Check',
    'stage.drag': 'Drag', 'stage.orbit': 'orbit', 'stage.scroll': 'Scroll', 'stage.zoom': 'zoom',
    'stage.rightDrag': 'Right-drag', 'stage.pan': 'pan', 'stage.click': 'Click', 'stage.select': 'select',
    'camera.title': 'Camera', 'camera.white': 'White view', 'camera.black': 'Black view',
    'camera.top': 'Top view', 'camera.studio': 'Studio', 'camera.coords': 'Board coordinates',
    'camera.motion': 'Gentle idle motion',
    'action.new': 'New game', 'action.undo': 'Undo', 'action.inspect': 'Inspect', 'action.hint': 'Hint',
    'inspector.paths': 'Flight paths shown on the board', 'inspector.value': 'Value', 'inspector.points': 'pts',
    'inspector.white': 'White', 'inspector.black': 'Black',
    'inspector.slides': 'Slides', 'inspector.jumps': 'Jumps', 'inspector.royal': 'Royal', 'inspector.pawn': 'Pawn',
    'match.title': 'The match', 'match.note': 'Standard international chess · two players, one screen',
    'match.material': 'Material', 'match.even': 'Even', 'match.whiteAhead': 'White ahead', 'match.blackAhead': 'Black ahead',
    'match.moveCount': '{n} moves',
    'match.botNote': 'You are {side} · {level} bot',
    'bot.title': 'Opponent', 'bot.human': 'Two players', 'bot.bot': 'The bot',
    'bot.playAs': 'Play as', 'bot.strength': 'Strength',
    'bot.easy': 'Casual', 'bot.club': 'Club', 'bot.strong': 'Sharp',
    'bot.start': 'Start vs bot',
    'bot.youAre': 'You are {side} · {level} bot',
    'bot.hotseat': 'Two players share this screen.',
    'bot.thinking': 'Bot is thinking…',
    'bot.wait': 'The bot is thinking.',
    'bot.on': 'Bot on. You are {side}.',
    'bot.off': 'Bot off — both sides are yours.',
    'bot.started': 'New game. You are {side} against the {level} bot.',
    'bot.switchTitle': 'Play as {side}?',
    'bot.switchBody': 'The current game will be cleared so you can start again as {side} against the bot.',
    'bot.newTitle': 'Start a new game against the bot?',
    'bot.newBody': 'The current game will be cleared. You will play {side} against the {level} bot.',
    'bot.newYes': 'Yes, start vs bot',
    'bot.moved': 'The bot played {move}.',
    'studio.title': 'Studio',
    'studio.note': 'A self-contained static app. Nothing is uploaded; exports are built locally.',
    'studio.pieces': 'Pieces', 'studio.squares': 'Squares', 'studio.puzzles': 'Drills',
    'studio.pgn': 'Export PGN', 'studio.json': 'Export JSON',
    'shortcuts.title': 'Keys', 'shortcuts.undo': 'Undo', 'shortcuts.new': 'New game',
    'shortcuts.inspect': 'Inspect lens', 'shortcuts.lang': 'Language', 'shortcuts.camera': 'Camera',
    'shortcuts.cancel': 'Deselect / close',
    'footer.built': 'Built with', 'footer.and': 'and vanilla JavaScript', 'footer.license': 'MIT licensed',
    'promo.eyebrow': 'Pawn promotion', 'promo.title': 'Choose your new piece',
    'promo.sub': 'Your pawn reached the last rank. A queen is strongest, but a knight can fork.',
    'piece.pawn': 'Pawn', 'piece.knight': 'Knight', 'piece.bishop': 'Bishop', 'piece.rook': 'Rook',
    'piece.queen': 'Queen', 'piece.king': 'King',
    'blunder.eyebrow': 'Blunder guard', 'blunder.title': 'That move gives something away',
    'blunder.undo': 'Undo & learn', 'blunder.keep': 'Keep the move',
    'over.eyebrow': 'Game over', 'over.new': 'Start a new game', 'over.review': 'Review the board',
    'solved.eyebrow': 'Drill complete', 'solved.title': 'Solved!', 'solved.next': 'Next drill',
    'solved.stay': 'Stay on this drill',
    'confirm.title': 'Start a new game?',
    'confirm.body': 'The current game will be cleared. Export it first if you want to keep the moves.',
    'confirm.yes': 'Yes, start fresh',
    'help.eyebrow': 'Academy handbook', 'help.title': 'How the studio works',
    'help.playTitle': 'Play',
    'help.playBody': 'Click a piece, then a glowing square. Legal moves appear as rings. Drag to orbit, scroll to zoom, right-drag to pan.',
    'help.inspectTitle': 'Inspect',
    'help.inspectBody': 'Click any piece to lift it, see its value and movement rules, and project its paths across the board.',
    'help.guardTitle': 'Undo & learn',
    'help.guardBody': 'When the guard spots a hanging piece or a mate-in-one, it explains the threat and offers a clean undo.',
    'help.puzzleTitle': 'Puzzles',
    'help.puzzleBody': 'Three beginner drills load a position onto the board. Find the move; the coach explains why it works.',
    'help.keysTitle': 'Keys',
    'help.keysBody': 'U undo · N new game · I inspect lens · L language · 1/2/3 camera · Esc deselect.',
    'help.dataTitle': 'Your data',
    'help.dataBody': 'Games and streaks live in this browser’s localStorage only. Export PGN or JSON any time; nothing is sent anywhere.',
    'help.botTitle': 'Play the bot',
    'help.botBody': 'Choose The bot, pick a side and a strength. The bot thinks briefly, then replies. Undo takes back both its reply and your move.',
    'help.credit': 'Built with', 'help.creditTool': 'the OpenCode agent harness',
    'help.creditModel': 'and the DeepSeek V4.1 Flash model',
    'help.offline': 'Serving over HTTP is recommended. Three.js loads from jsDelivr, so the studio needs a connection the first time.',
    'error.title': 'The 3D engine could not load',
    'error.body': 'This app fetches Three.js from a CDN. Check your internet connection, then reload. Serving the folder with python3 -m http.server also avoids local file restrictions.',
    'error.reload': 'Reload',
    'loading.title': 'Preparing the studio',
    'loading.sub': 'Polishing the board and setting the lights…',
    'status.whiteToMove': 'White to move', 'status.blackToMove': 'Black to move',
    'status.whiteWins': 'White wins', 'status.blackWins': 'Black wins', 'status.draw': 'Draw',
    'status.check': 'Check', 'status.checkmate': 'Checkmate', 'status.stalemate': 'Stalemate',
    'status.fifty': 'Fifty-move draw', 'status.threefold': 'Threefold repetition',
    'status.insufficient': 'Insufficient material', 'status.live': 'Live', 'status.drill': 'Drill',
    'status.ready': 'Ready', 'status.inspect': 'Inspecting', 'status.solved': 'Solved',
    'result.checkmate': '{side} delivered checkmate.',
    'result.stalemate': 'No legal move remains, but the king is not in check. It is a draw.',
    'result.fifty': 'Fifty moves without a pawn move or capture. The game is drawn.',
    'result.threefold': 'The same position appeared three times. The game is drawn.',
    'result.insufficient': 'Neither side has enough material to force mate. The game is drawn.',
    'toast.newGame': 'Fresh board. White begins.',
    'toast.undone': 'Move taken back. Try a different idea.',
    'toast.undoNothing': 'Nothing to undo yet.',
    'toast.exportPgn': 'PGN downloaded.',
    'toast.exportJson': 'Progress JSON downloaded.',
    'toast.exportEmpty': 'No moves to export yet.',
    'toast.restored': 'Saved game restored.',
    'toast.soundOn': 'Sound on.', 'toast.soundOff': 'Sound off.',
    'toast.inspectOn': 'Inspect lens on: clicks reveal movement, not moves.',
    'toast.inspectOff': 'Inspect lens off: clicks move pieces.',
    'toast.puzzleLoaded': 'Drill loaded. Find the best move for White.',
    'toast.puzzleWrong': 'Not the move. The board was reset — try the hint.',
    'toast.puzzleSolved': 'Solved! Streak {streak}.',
    'toast.puzzleHint': 'Hint shown below the board.',
    'toast.hintMate': 'There is a mate in one: {move}.',
    'toast.hintCapture': 'A free capture is available: {move}.',
    'toast.hintDevelop': 'A clean developing move: {move}.',
    'toast.guardOff': 'Blunder guard off.',
    'toast.invalidSave': 'The saved game could not be replayed, so a fresh board was set.',
    'toast.copy': 'Copied.',
    'toast.onlyWhite': 'In this drill only White moves. Reset the drill to try again.',
    'toast.puzzleExit': 'Drill closed. Your game is back on the board.',
    'toast.check': 'Check — deal with the threat.',
    'toast.blunderKept': 'Move kept. Watch the threat.',
    'toast.inspectHint': 'Select a piece to see its value and paths.',
    'toast.gameOver': 'This game is finished. Undo or start a new game.',
    'toast.coachRefreshed': 'Coach updated.',
    'toast.hintNone': 'No clear hint — improve your worst-placed piece.',
  },
  th: {
    'brand.tagline': 'หมุนสตูดิโอ เรียนรู้เกม และเล่นหมากรุกเต็มกระดาน',
    'ui.sound': 'เปิดหรือปิดเสียง', 'ui.help': 'ช่วยเหลือ', 'ui.close': 'ปิด', 'ui.cancel': 'ยกเลิก',
    'tabs.coach': 'โค้ช', 'tabs.puzzles': 'โจทย์', 'tabs.moves': 'บันทึกตาเดิน',
    'coach.live': 'โค้ชสด', 'coach.refresh': 'อัปเดต',
    'coach.checks': 'สิ่งที่ควรตรวจตอนนี้', 'coach.lesson': 'บทเรียนปัจจุบัน', 'coach.guard': 'ตัวช่วยกันพลาด',
    'coach.guardTitle': 'เตือนก่อนเดินพลาด',
    'coach.guardSub': 'เสนอการย้อนและเรียนรู้ เมื่อหมากถูกกินฟรีหรือถูกจู่โจมจน',
    'coach.tipsTitle': 'แสดงอีกภาษาหนึ่ง',
    'coach.tipsSub': 'เพิ่มบรรทัดภาษาอีกภาษาหนึ่งใต้คำแนะนำและในกล่องข้อความ ปิดไว้จะแสดงเฉพาะภาษาที่เลือก',
    'puzzle.training': 'แบบฝึกแท็กติก', 'puzzle.solvedLabel': 'แก้แล้ว', 'puzzle.streak': 'ต่อเนื่อง',
    'puzzle.best': 'สูงสุด', 'puzzle.hint': 'คำใบ้', 'puzzle.retry': 'เริ่มโจทย์ใหม่', 'puzzle.exit': 'ออกจากโจทย์',
    'puzzle.pick': 'เลือกโจทย์เพื่อโหลดลงกระดาน 3 มิติ',
    'puzzle.solvedStatus': 'แก้ได้แล้ว! ต่อเนื่อง {n} เลือกโจทย์อื่นหรือสำรวจตำแหน่งนี้ต่อ',
    'moves.title': 'รายการตาเดิน', 'moves.white': 'ขาว', 'moves.black': 'ดำ',
    'moves.empty': 'ยังไม่มีตาเดิน ขาวเริ่มก่อน', 'moves.captured': 'หมากที่ถูกกิน',
    'moves.byWhite': 'ขาวกินได้', 'moves.byBlack': 'ดำกินได้', 'moves.none': 'ยังไม่มี',
    'moves.saved': 'เกมที่บันทึกไว้',
    'moves.savedNote': 'เกมของคุณบันทึกในเบราว์เซอร์นี้อัตโนมัติ ส่งออกก่อนล้างข้อมูลเบราว์เซอร์',
    'stage.play': 'โหมดเล่น', 'stage.inspect': 'โหมดตรวจดู', 'stage.puzzle': 'โหมดโจทย์', 'stage.check': 'ถูกขัด',
    'stage.drag': 'ลาก', 'stage.orbit': 'หมุน', 'stage.scroll': 'เลื่อน', 'stage.zoom': 'ซูม',
    'stage.rightDrag': 'ลากขวา', 'stage.pan': 'เลื่อนกระดาน', 'stage.click': 'คลิก', 'stage.select': 'เลือก',
    'camera.title': 'กล้อง', 'camera.white': 'มุมขาว', 'camera.black': 'มุมดำ',
    'camera.top': 'มุมบน', 'camera.studio': 'สตูดิโอ', 'camera.coords': 'พิกัดกระดาน',
    'camera.motion': 'การเคลื่อนไหวเบา ๆ',
    'action.new': 'เกมใหม่', 'action.undo': 'ย้อนกลับ', 'action.inspect': 'ตรวจดู', 'action.hint': 'คำใบ้',
    'inspector.paths': 'แสดงเส้นทางบนกระดาน', 'inspector.value': 'แต้ม', 'inspector.points': 'แต้ม',
    'inspector.white': 'ขาว', 'inspector.black': 'ดำ',
    'inspector.slides': 'เลื่อน', 'inspector.jumps': 'กระโดด', 'inspector.royal': 'ราชวงศ์', 'inspector.pawn': 'เบี้ย',
    'match.title': 'การแข่งขัน', 'match.note': 'หมากรุกสากลมาตรฐาน · สองผู้เล่น หนึ่งหน้าจอ',
    'match.material': 'กำลังหมาก', 'match.even': 'เท่ากัน', 'match.whiteAhead': 'ขาวนำ', 'match.blackAhead': 'ดำนำ',
    'match.moveCount': '{n} ตา',
    'match.botNote': 'คุณคือ {side} · บอท{level}',
    'bot.title': 'คู่ต่อสู้', 'bot.human': 'สองผู้เล่น', 'bot.bot': 'บอท',
    'bot.playAs': 'เล่นเป็น', 'bot.strength': 'ระดับความแข็งแกร่ง',
    'bot.easy': 'ผ่อนคลาย', 'bot.club': 'คลับ', 'bot.strong': 'เฉียบคม',
    'bot.start': 'เริ่มเล่นกับบอท',
    'bot.youAre': 'คุณคือ {side} · บอท{level}',
    'bot.hotseat': 'สองผู้เล่นใช้หน้าจอเดียวกัน',
    'bot.thinking': 'บอทกำลังคิด…',
    'bot.wait': 'บอทกำลังคิด',
    'bot.on': 'เปิดบอทแล้ว คุณคือ {side}',
    'bot.off': 'ปิดบอทแล้ว ทั้งสองฝ่ายเป็นของคุณ',
    'bot.started': 'เกมใหม่ คุณคือ {side} พบกับบอท{level}',
    'bot.switchTitle': 'เล่นเป็น{side}หรือไม่?',
    'bot.switchBody': 'เกมปัจจุบันจะถูกล้างเพื่อเริ่มใหม่เป็น{side}กับบอท',
    'bot.newTitle': 'เริ่มเกมใหม่กับบอทหรือไม่?',
    'bot.newBody': 'เกมปัจจุบันจะถูกล้าง คุณจะเล่นเป็น{side}กับบอท{level}',
    'bot.newYes': 'ใช่ เริ่มกับบอท',
    'bot.moved': 'บอทเดิน {move}',
    'studio.title': 'สตูดิโอ',
    'studio.note': 'แอปสแตติกที่ทำงานในตัว ไม่มีการอัปโหลด ไฟล์ส่งออกสร้างในเครื่อง',
    'studio.pieces': 'หมาก', 'studio.squares': 'ช่อง', 'studio.puzzles': 'โจทย์',
    'studio.pgn': 'ส่งออก PGN', 'studio.json': 'ส่งออก JSON',
    'shortcuts.title': 'คีย์ลัด', 'shortcuts.undo': 'ย้อนกลับ', 'shortcuts.new': 'เกมใหม่',
    'shortcuts.inspect': 'โหมดตรวจดู', 'shortcuts.lang': 'ภาษา', 'shortcuts.camera': 'กล้อง',
    'shortcuts.cancel': 'ยกเลิกการเลือก / ปิด',
    'footer.built': 'สร้างด้วย', 'footer.and': 'และ JavaScript ล้วน', 'footer.license': 'สัญญาอนุญาต MIT',
    'promo.eyebrow': 'เลื่อนขั้นเบี้ย', 'promo.title': 'เลือกหมากใหม่',
    'promo.sub': 'เบี้ยของคุณไปถึงแถวสุดท้าย ราชินีแข็งแกร่งที่สุด แต่ม้าอาจสร้างสองง่ามได้',
    'piece.pawn': 'เบี้ย', 'piece.knight': 'ม้า', 'piece.bishop': 'บิชอป',
    'piece.rook': 'เรือ', 'piece.queen': 'ราชินี', 'piece.king': 'ราชา',
    'blunder.eyebrow': 'ตัวช่วยกันพลาด', 'blunder.title': 'ตาเดินนี้เสียเปรียบ',
    'blunder.undo': 'ย้อนและเรียนรู้', 'blunder.keep': 'เดินต่อ',
    'over.eyebrow': 'จบเกม', 'over.new': 'เริ่มเกมใหม่', 'over.review': 'ดูกระดานอีกครั้ง',
    'solved.eyebrow': 'ทำโจทย์สำเร็จ', 'solved.title': 'ถูกต้อง!', 'solved.next': 'โจทย์ถัดไป',
    'solved.stay': 'อยู่ที่โจทย์นี้',
    'confirm.title': 'เริ่มเกมใหม่หรือไม่?',
    'confirm.body': 'เกมปัจจุบันจะถูกล้าง ส่งออกเกมก่อนหากต้องการเก็บตาเดิน',
    'confirm.yes': 'ใช่ เริ่มใหม่',
    'help.eyebrow': 'คู่มือสถาบัน', 'help.title': 'สตูดิโอทำงานอย่างไร',
    'help.playTitle': 'การเล่น',
    'help.playBody': 'คลิกหมากแล้วคลิกช่องที่เรืองแสง ตาเดินที่ถูกต้องจะแสดงเป็นวงแหวน ลากเพื่อหมุน เลื่อนเพื่อซูม ลากขวาเพื่อเลื่อนกระดาน',
    'help.inspectTitle': 'การตรวจดู',
    'help.inspectBody': 'คลิกหมากตัวใดก็ได้เพื่อยกขึ้น ดูแต้มและกฎการเดิน พร้อมแสดงเส้นทางบนกระดาน',
    'help.guardTitle': 'ย้อนและเรียนรู้',
    'help.guardBody': 'เมื่อตัวช่วยพบหมากที่ถูกกินฟรีหรือการถูกจู่โจมจน จะอธิบายภัยและเสนอการย้อนกลับ',
    'help.puzzleTitle': 'โจทย์',
    'help.puzzleBody': 'แบบฝึกสามบทสำหรับผู้เริ่มต้น จะโหลดตำแหน่งลงกระดาน หาตาเดินที่ดีที่สุด แล้วโค้ชจะอธิบายเหตุผล',
    'help.keysTitle': 'คีย์ลัด',
    'help.keysBody': 'U ย้อนกลับ · N เกมใหม่ · I โหมดตรวจดู · L ภาษา · 1/2/3 กล้อง · Esc ยกเลิก',
    'help.dataTitle': 'ข้อมูลของคุณ',
    'help.dataBody': 'เกมและสถิติอยู่ใน localStorage ของเบราว์เซอร์นี้เท่านั้น ส่งออก PGN หรือ JSON ได้ทุกเมื่อ ไม่มีข้อมูลส่งออกไปที่ใด',
    'help.botTitle': 'เล่นกับบอท',
    'help.botBody': 'เลือกบอท เลือกฝ่ายและระดับความแข็งแกร่ง บอทจะคิดครู่หนึ่งแล้วเดินตอบ ย้อนกลับจะย้อนทั้งตาเดินของบอทและของคุณ',
    'help.credit': 'สร้างด้วย', 'help.creditTool': 'เครื่องมือเอเจนต์ OpenCode',
    'help.creditModel': 'และโมเดล DeepSeek V4.1 Flash',
    'help.offline': 'แนะนำให้เปิดผ่าน HTTP เพราะ Three.js โหลดจาก jsDelivr ครั้งแรกจึงต้องมีการเชื่อมต่อ',
    'error.title': 'โหลดเอนจิน 3 มิติไม่สำเร็จ',
    'error.body': 'แอปนี้โหลด Three.js จาก CDN ตรวจสอบการเชื่อมต่อแล้วโหลดใหม่ หรือเปิดโฟลเดอร์ด้วย python3 -m http.server เพื่อหลีกเลี่ยงข้อจำกัดไฟล์ในเครื่อง',
    'error.reload': 'โหลดใหม่',
    'loading.title': 'กำลังเตรียมสตูดิโอ',
    'loading.sub': 'กำลังขัดกระดานและจัดแสง…',
    'status.whiteToMove': 'ขาวเดิน', 'status.blackToMove': 'ดำเดิน',
    'status.whiteWins': 'ขาวชนะ', 'status.blackWins': 'ดำชนะ', 'status.draw': 'เสมอ',
    'status.check': 'ถูกขัด', 'status.checkmate': 'รุกจน', 'status.stalemate': 'อับหมาก',
    'status.fifty': 'เสมอเพราะครบ 50 ตา', 'status.threefold': 'เสมอเพราะตำแหน่งซ้ำสามครั้ง',
    'status.insufficient': 'หมากไม่พอจะรุกจน', 'status.live': 'กำลังเล่น', 'status.drill': 'โจทย์',
    'status.ready': 'พร้อม', 'status.inspect': 'กำลังตรวจดู', 'status.solved': 'แก้แล้ว',
    'result.checkmate': '{side} รุกจน',
    'result.stalemate': 'ไม่มีตาเดินที่ถูกต้อง แต่ราชาไม่ได้ถูกขัด จึงเป็นเกมเสมอ',
    'result.fifty': 'เดินครบ 50 ตาโดยไม่มีเบี้ยเดินหรือกินหมาก เกมเสมอ',
    'result.threefold': 'ตำแหน่งเดิมปรากฏสามครั้ง เกมเสมอ',
    'result.insufficient': 'ทั้งสองฝ่ายมีหมากไม่พอจะบังคับรุกจน เกมเสมอ',
    'toast.newGame': 'กระดานใหม่ ขาวเริ่มก่อน',
    'toast.undone': 'ย้อนตาเดินแล้ว ลองความคิดอื่น',
    'toast.undoNothing': 'ยังไม่มีตาเดินให้ย้อน',
    'toast.exportPgn': 'ดาวน์โหลด PGN แล้ว',
    'toast.exportJson': 'ดาวน์โหลด JSON แล้ว',
    'toast.exportEmpty': 'ยังไม่มีตาเดินให้ส่งออก',
    'toast.restored': 'กู้คืนเกมที่บันทึกไว้แล้ว',
    'toast.soundOn': 'เปิดเสียงแล้ว', 'toast.soundOff': 'ปิดเสียงแล้ว',
    'toast.inspectOn': 'เปิดโหมดตรวจดู: คลิกเพื่อดูการเดิน ไม่ใช่เดินหมาก',
    'toast.inspectOff': 'ปิดโหมดตรวจดู: คลิกเพื่อเดินหมาก',
    'toast.puzzleLoaded': 'โหลดโจทย์แล้ว หาตาเดินที่ดีที่สุดของฝ่ายขาว',
    'toast.puzzleWrong': 'ยังไม่ใช่ กระดานถูกรีเซ็ต ลองดูคำใบ้',
    'toast.puzzleSolved': 'ถูกต้อง! ต่อเนื่อง {streak}',
    'toast.puzzleHint': 'แสดงคำใบ้ใต้กระดานแล้ว',
    'toast.hintMate': 'มีรุกจนในหนึ่งตา: {move}',
    'toast.hintCapture': 'มีหมากให้กินฟรี: {move}',
    'toast.hintDevelop': 'ตาเดินพัฒนาที่ดี: {move}',
    'toast.guardOff': 'ปิดตัวช่วยกันพลาดแล้ว',
    'toast.invalidSave': 'ไม่สามารถเล่นเกมที่บันทึกไว้ซ้ำได้ จึงเริ่มกระดานใหม่',
    'toast.copy': 'คัดลอกแล้ว',
    'toast.onlyWhite': 'ในโจทย์นี้ฝ่ายขาวเดินเท่านั้น รีเซ็ตโจทย์เพื่อลองใหม่',
    'toast.puzzleExit': 'ปิดโจทย์แล้ว เกมของคุณกลับมาบนกระดาน',
    'toast.check': 'ถูกขัด จัดการภัยคุกคามก่อน',
    'toast.blunderKept': 'เดินต่อแล้ว ระวังภัยนั้น',
    'toast.inspectHint': 'เลือกหมากเพื่อดูแต้มและเส้นทาง',
    'toast.gameOver': 'เกมนี้จบแล้ว ย้อนกลับหรือเริ่มเกมใหม่',
    'toast.coachRefreshed': 'อัปเดตคำแนะนำแล้ว',
    'toast.hintNone': 'ยังไม่มีคำใบ้ชัดเจน พัฒนาหมากที่แย่ที่สุดก่อน',
  },
};

const PIECE_INFO = {
  P: {
    value: 1, icon: '♟',
    en: 'Moves one square forward, or two from its starting rank. Captures diagonally forward. Reaching the last rank promotes it — usually to a queen.',
    th: 'เดินหน้าได้หนึ่งช่อง หรือสองช่องจากแถวเริ่มต้น กินหมากในแนวทแยงไปข้างหน้า เมื่อถึงแถวสุดท้ายจะเลื่อนขั้น ปกติเป็นราชินี',
    tags: ['pawn'],
  },
  N: {
    value: 3, icon: '♞',
    en: 'Jumps in an L: two squares one way, then one square across. It is the only piece that leaps over others.',
    th: 'กระโดดเป็นตัว L สองช่องในแนวหนึ่งแล้วหนึ่งช่องในอีกแนว เป็นหมากเดียวที่กระโดดข้ามหมากอื่นได้',
    tags: ['jumps'],
  },
  B: {
    value: 3, icon: '♝',
    en: 'Slides any number of squares diagonally. It can never change square colour, so a pair of bishops covers the whole board.',
    th: 'เลื่อนในแนวทแยงได้ไม่จำกัดช่อง เปลี่ยนสีช่องไม่ได้ตลอดเกม บิชอปหนึ่งคู่จึงคลุมกระดานทั้งสองสี',
    tags: ['slides'],
  },
  R: {
    value: 5, icon: '♜',
    en: 'Slides any number of squares along files and ranks. It is happiest on an open file, and it castled with the king.',
    th: 'เลื่อนตามแนวตั้งและแนวนอนได้ไม่จำกัดช่อง ชอบอยู่ในไฟล์เปิด และเข้าปราสาทร่วมกับราชาได้',
    tags: ['slides', 'royal'],
  },
  Q: {
    value: 9, icon: '♛',
    en: 'Combines rook and bishop: any number of squares in straight lines or diagonals. The most powerful piece — do not trade her for scraps.',
    th: 'รวมพลังเรือและบิชอป เลื่อนได้ทั้งแนวตรงและแนวทแยงไม่จำกัดช่อง แข็งแกร่งที่สุด อย่าแลกกับหมากเล็กโดยไม่จำเป็น',
    tags: ['slides'],
  },
  K: {
    value: 0, icon: '♚',
    en: 'Moves one square in any direction. Castling tucks him away with a rook. He may never move into check.',
    th: 'เดินได้หนึ่งช่องทุกทิศทาง การเข้าปราสาทช่วยซ่อนราชาไว้กับเรือ ราชาเดินเข้าช่องที่ถูกโจมตีไม่ได้',
    tags: ['royal'],
  },
};

const LESSONS = [
  { glyph: '♟', name: { en: 'The centre', th: 'สี่ช่องกลาง' }, body: { en: 'Squares e4, d4, e5 and d5 are the high ground. A piece in the centre reaches more of the board.', th: 'ช่อง e4 d4 e5 และ d5 คือที่สูง หมากที่อยู่กลางกระดานควบคุมพื้นที่ได้มากกว่า' } },
  { glyph: '♞', name: { en: 'Develop first', th: 'พัฒนาหมากก่อน' }, body: { en: 'Bring knights and bishops out before you attack. A piece on its home square is a piece doing nothing.', th: 'นำม้าและบิชอปออกมาก่อนโจมตี หมากที่ยังอยู่บ้านคือหมากที่ไม่ได้ทำงาน' } },
  { glyph: '♔', name: { en: 'King safety', th: 'ความปลอดภัยของราชา' }, body: { en: 'Castle early. A safe king lets every other piece play with freedom.', th: 'เข้าปราสาทแต่เนิ่น ๆ ราชาที่ปลอดภัยทำให้หมากอื่นเล่นได้อย่างอิสระ' } },
  { glyph: '♖', name: { en: 'Open files', th: 'ไฟล์เปิด' }, body: { en: 'Put rooks on files with no pawns. A rook with a clear road is worth more than its five points.', th: 'วางเรือในไฟล์ที่ไม่มีเบี้ย เรือที่ทางโล่งมีค่ามากกว่า 5 แต้ม' } },
  { glyph: '♗', name: { en: 'Good bishop, bad bishop', th: 'บิชอปดีกับบิชอปแย่' }, body: { en: 'A bishop blocked by its own pawns is a tall pawn. Keep your diagonals long.', th: 'บิชอปที่ถูกเบี้ยตัวเองปิดทางเป็นเหมือนเบี้ยสูง ๆ รักษาแนวทแยงให้ยาว' } },
  { glyph: '♙', name: { en: 'Pawn structure', th: 'โครงสร้างเบี้ย' }, body: { en: 'Pawns cannot walk backwards. Every pawn push leaves a square weaker forever.', th: 'เบี้ยเดินถอยหลังไม่ได้ ทุกครั้งที่ดันเบี้ย จะมีช่องที่อ่อนลงตลอดไป' } },
  { glyph: '♕', name: { en: 'Do not rush the queen', th: 'อย่ารีบเอาราชินีออก' }, body: { en: 'An early queen becomes a target. Develop the small pieces first and let her join later.', th: 'ราชินีที่ออกเร็วจะเป็นเป้า พัฒนาหมากเล็กก่อนแล้วค่อยให้เธอออกโรง' } },
  { glyph: '♚', name: { en: 'The endgame king', th: 'ราชาในตอนท้ายเกม' }, body: { en: 'When queens are gone, the king becomes a fighting piece. Walk him toward the centre.', th: 'เมื่อราชินีหมดไป ราชาจะกลายเป็นหมากต่อสู้ เดินราชาเข้าหาศูนย์กลาง' } },
];

const COACH_TIPS = {
  welcome: { en: 'Welcome to the studio. Click any piece to inspect it, or move a pawn to begin.', th: 'ยินดีต้อนรับสู่สตูดิโอ คลิกหมากตัวใดก็ได้เพื่อตรวจดู หรือเดินเบี้ยเพื่อเริ่มเกม' },
  center: { en: 'Control the centre squares! Pieces there see more of the board and can switch flanks quickly.', th: 'คุมสี่ช่องกลางกระดาน! หมากที่อยู่ตรงนั้นมองเห็นกระดานได้มากกว่าและสลับปีกได้เร็ว' },
  castle: { en: 'Castling protects your king early and connects your rooks. It is usually worth doing before move ten.', th: 'การเข้าปราสาทช่วยปกป้องราชาตั้งแต่เนิ่น ๆ และเชื่อมเรือทั้งสอง มักคุ้มที่จะทำก่อนตาเดินที่ 10' },
  develop: { en: 'Develop your knights and bishops before launching an attack. Every piece should have a job.', th: 'พัฒนาม้าและบิชอปก่อนเริ่มโจมตี หมากทุกตัวควรมีหน้าที่' },
  check: { en: 'You are in check. Only three answers work: move the king, block the line, or capture the attacker.', th: 'คุณถูกขัด มีเพียงสามทาง: เดินราชาหนี กันแนวโจมตี หรือกินตัวที่รุก' },
  hanging: { en: 'One of your pieces is under threat. Look for a defence, a counter-threat, or a safe square.', th: 'หมากของคุณกำลังถูกคุกคาม หาการป้องกัน การโต้กลับ หรือช่องที่ปลอดภัย' },
  mate1: { en: 'There is a mate in one on the board. Check every king escape square before you play it.', th: 'มีรุกจนในหนึ่งตาอยู่บนกระดาน ตรวจช่องหนีของราชาให้ครบก่อนเดิน' },
  trade: { en: 'When you are ahead in material, trade pieces. When you are behind, keep the board busy.', th: 'เมื่อหมากมากกว่า ให้แลกหมาก เมื่อหมากน้อยกว่า ให้ทำให้กระดานยุ่งไว้' },
  pawns: { en: 'Think before pushing a pawn: it can never step back, and every push changes the squares it guards.', th: 'คิดก่อนดันเบี้ย เพราะเบี้ยถอยหลังไม่ได้ และทุกการดันเปลี่ยนช่องที่มันคุ้มครอง' },
  knight: { en: 'A knight on the rim is dim. Steer knights toward the centre where they reach eight squares.', th: 'ม้าที่อยู่ริมกระดานไร้พลัง นำม้าเข้าศูนย์กลางซึ่งมันควบคุมได้แปดช่อง' },
  rook: { en: 'Rooks belong on open files. Connect them by castling, then double them on the file you want to attack.', th: 'เรือควรอยู่ในไฟล์เปิด เชื่อมเรือด้วยการเข้าปราสาท แล้ววางซ้อนกันในไฟล์ที่ต้องการโจมตี' },
  queen: { en: 'The queen is powerful but not brave. Keep her behind your other pieces until the defence cracks.', th: 'ราชินีแข็งแกร่งแต่ไม่ควรเสี่ยง เก็บเธอไว้หลังหมากอื่นจนแนวรับแตก' },
  endgame: { en: 'Few pieces left: activate your king, push passed pawns, and cut off the enemy king.', th: 'หมากเหลือน้อย: เดินราชาออกมา ดันเบี้ยที่ผ่านได้ และตัดทางราชาศัตรู' },
  blunder: { en: 'That move left a piece hanging. Use Undo & learn to see the idea you missed.', th: 'ตาเดินนั้นทิ้งหมากไว้ให้กินฟรี ใช้ย้อนและเรียนรู้เพื่อดูความคิดที่พลาดไป' },
  inspection: { en: 'You are inspecting. The glowing markers show where this piece could travel if it were its turn.', th: 'คุณกำลังตรวจดู จุดเรืองแสงแสดงช่องที่หมากนี้จะไปได้หากถึงตาของมัน' },
};

const PUZZLES = loadPuzzleData();

function loadPuzzleData() {
  try {
    const el = document.getElementById('puzzle-data');
    const data = JSON.parse(el ? el.textContent : '[]');
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('Puzzle data could not be parsed', err);
    return [];
  }
}

/* ==========================================================================
   3. AUDIO, STORAGE, UTILITIES
   ========================================================================== */

const Sound = {
  enabled: true,
  ctx: null,
  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  tone({ freq = 440, to = null, dur = 0.16, type = 'sine', vol = 0.12, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  },
  noise({ dur = 0.18, vol = 0.09, freq = 900, q = 0.9, delay = 0 }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  },
  play(name) {
    if (!this.enabled) return;
    switch (name) {
      case 'lift': this.tone({ freq: 520, to: 640, dur: 0.09, type: 'sine', vol: 0.05 }); break;
      case 'drop':
        this.tone({ freq: 210, to: 120, dur: 0.12, type: 'triangle', vol: 0.1 });
        this.noise({ dur: 0.09, vol: 0.06, freq: 520 });
        break;
      case 'capture':
        this.noise({ dur: 0.2, vol: 0.14, freq: 1300, q: 0.6 });
        this.tone({ freq: 160, to: 70, dur: 0.22, type: 'sawtooth', vol: 0.09 });
        break;
      case 'castle':
        this.tone({ freq: 330, dur: 0.1, vol: 0.08 });
        this.tone({ freq: 440, dur: 0.12, vol: 0.08, delay: 0.09 });
        break;
      case 'check':
        this.tone({ freq: 880, dur: 0.13, type: 'triangle', vol: 0.09 });
        this.tone({ freq: 660, dur: 0.18, type: 'triangle', vol: 0.09, delay: 0.11 });
        break;
      case 'promote':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.16, vol: 0.07, delay: i * 0.07 }));
        break;
      case 'illegal':
        this.tone({ freq: 150, to: 110, dur: 0.16, type: 'square', vol: 0.05 });
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.07, delay: i * 0.1 }));
        break;
      case 'draw':
        this.tone({ freq: 392, dur: 0.3, vol: 0.06 });
        this.tone({ freq: 330, dur: 0.4, vol: 0.06, delay: 0.18 });
        break;
      case 'puzzle':
        [587, 784, 988, 1175].forEach((f, i) => this.tone({ freq: f, dur: 0.2, type: 'sine', vol: 0.07, delay: i * 0.08 }));
        break;
      default: break;
    }
  },
};

const STORE_KEY = 'full3dChessAcademy.v1';

const Store = {
  read() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (e) { return null; }
  },
  write(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  },
  clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  },
};

const GLYPHS = {
  w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' },
  b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' },
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function t(key, vars) {
  const dict = I18N[UI.lang] || I18N.en;
  let out = dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return out;
}
/* ==========================================================================
   4. THREE.JS STUDIO
   ========================================================================== */

const UI = {
  lang: 'en',
  sound: true,
  tips: false,
  guard: true,
  coords: true,
  motion: true,
  mode: 'play',            // 'play' | 'puzzle'
  inspectLens: false,
  selected: null,
  selectedMoves: [],
  inspectOnly: false,
  pendingPromo: null,
  lastMove: null,
  lastBlunder: null,
  gameOver: null,
  hint: null,
  hoverSquare: null,
  vsBot: false,
  botLevel: 'club',
  humanColor: 'w',
  botThinking: false,
  botTimer: null,
  botToken: 0,
  confirmData: null,
  puzzle: {
    activeId: null,
    state: null,
    attempts: 0,
    solvedIds: [],
    streak: 0,
    best: 0,
    lastSolved: null,
  },
  els: {},
  cameraPreset: 'white',
  idle: true,
  booted: false,
};

const stageEl = document.getElementById('stage');
const canvasEl = document.getElementById('board-canvas');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070a10, 0.014);

const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(stageEl.clientWidth || 900, stageEl.clientHeight || 700, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(38, (stageEl.clientWidth || 900) / (stageEl.clientHeight || 700), 0.1, 120);
camera.position.set(0, 8.8, 10.3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.35, 0.35);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.7;
controls.screenSpacePanning = false;
controls.minDistance = 5;
controls.maxDistance = 23;
controls.minPolarAngle = 0.12;
controls.maxPolarAngle = 1.45;
controls.autoRotateSpeed = 0.35;

// Studio reflections: a neutral room probe gives the metals something to chew on.
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.07);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
} catch (err) {
  console.warn('Environment probe unavailable', err);
}

/* ------------------------------- lights ---------------------------------- */

const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x121821, 0.55);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xfff0d2, 2.9);
keyLight.position.set(5.5, 11, 6.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(window.innerWidth < 900 ? 1024 : 2048, window.innerWidth < 900 ? 1024 : 2048);
keyLight.shadow.camera.left = -7.5;
keyLight.shadow.camera.right = 7.5;
keyLight.shadow.camera.top = 7.5;
keyLight.shadow.camera.bottom = -7.5;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 32;
keyLight.shadow.bias = -0.00035;
keyLight.shadow.normalBias = 0.022;
keyLight.shadow.radius = 3;
scene.add(keyLight);
scene.add(keyLight.target);

const rimLight = new THREE.DirectionalLight(0x8fb8ff, 1.2);
rimLight.position.set(-7, 6.5, -8);
scene.add(rimLight);

const warmFill = new THREE.PointLight(0xe7c778, 26, 24, 2);
warmFill.position.set(0, 5.5, -4.5);
scene.add(warmFill);

const frontFill = new THREE.PointLight(0xbfd4ff, 10, 18, 2);
frontFill.position.set(0, 3.5, 5.5);
scene.add(frontFill);

/* ------------------------------- textures -------------------------------- */

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#8a5a34');
  grad.addColorStop(0.45, '#a4744a');
  grad.addColorStop(0.72, '#7c4d2b');
  grad.addColorStop(1, '#96643c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 95; i++) {
    const y = Math.random() * 512;
    const amp = 4 + Math.random() * 16;
    const alpha = 0.03 + Math.random() * 0.09;
    ctx.strokeStyle = Math.random() > 0.45 ? `rgba(58,31,13,${alpha})` : `rgba(226,185,132,${alpha})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.2;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const yy = y + Math.sin((x / 512) * Math.PI * (1.2 + Math.random() * 0.05) + i) * amp;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  for (let k = 0; k < 3; k++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    for (let r = 14; r > 0; r -= 3) {
      ctx.strokeStyle = `rgba(52,28,12,${0.08 + (14 - r) * 0.004})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.7, r * 0.7, 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function makeSlateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#2f3d4d');
  grad.addColorStop(0.5, '#364658');
  grad.addColorStop(1, '#283441');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const a = Math.random() * 0.055;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(190,210,230,${a})` : `rgba(8,12,18,${a})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  for (let i = 0; i < 9; i++) {
    ctx.strokeStyle = `rgba(205,222,240,${0.02 + Math.random() * 0.03})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < 512) {
      x += (Math.random() - 0.5) * 26;
      y += 18 + Math.random() * 24;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const woodTex = makeWoodTexture();
const slateTex = makeSlateTexture();

const MAT = {
  wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.58, metalness: 0.05, envMapIntensity: 0.55 }),
  slate: new THREE.MeshStandardMaterial({ map: slateTex, roughness: 0.78, metalness: 0.12, envMapIntensity: 0.75 }),
  frame: new THREE.MeshPhysicalMaterial({ color: 0x2a1b12, roughness: 0.42, metalness: 0.2, clearcoat: 0.35, clearcoatRoughness: 0.5, envMapIntensity: 0.8 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 1, roughness: 0.27, envMapIntensity: 1.3 }),
  plinth: new THREE.MeshPhysicalMaterial({ color: 0x101720, roughness: 0.55, metalness: 0.35, clearcoat: 0.2, clearcoatRoughness: 0.6 }),
  ivory: new THREE.MeshPhysicalMaterial({
    color: 0xf3e8d2, metalness: 0.06, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.22,
    sheen: 0.5, sheenColor: 0xfff6e0, envMapIntensity: 1.05,
  }),
  obsidian: new THREE.MeshPhysicalMaterial({
    color: 0x171b23, metalness: 0.62, roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.2,
    envMapIntensity: 1.45,
  }),
  dark: new THREE.MeshStandardMaterial({ color: 0x090b0f, roughness: 0.5, metalness: 0.2 }),
};

/* ------------------------------- board ----------------------------------- */

const boardGroup = new THREE.Group();
scene.add(boardGroup);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(30, 72),
  new THREE.MeshStandardMaterial({ color: 0x080c12, roughness: 0.96, metalness: 0.08 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.72;
floor.receiveShadow = true;
scene.add(floor);

const haloRing = new THREE.Mesh(
  new THREE.TorusGeometry(7.1, 0.012, 8, 120),
  new THREE.MeshBasicMaterial({ color: 0xe7c778, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
);
haloRing.rotation.x = -Math.PI / 2;
haloRing.position.y = -0.7;
scene.add(haloRing);

const plinth = new THREE.Mesh(new RoundedBoxGeometry(9.7, 0.55, 9.7, 4, 0.14), MAT.plinth);
plinth.position.y = -0.4;
plinth.castShadow = true;
plinth.receiveShadow = true;
boardGroup.add(plinth);

const plinthTrim = new THREE.Mesh(new RoundedBoxGeometry(9.78, 0.05, 9.78, 3, 0.02), MAT.brass);
plinthTrim.position.y = -0.155;
boardGroup.add(plinthTrim);

// Raised, beveled frame.
const frameBars = [
  { pos: [0, -0.02, 4.3], size: [9.5, 0.27, 0.56] },
  { pos: [0, -0.02, -4.3], size: [9.5, 0.27, 0.56] },
  { pos: [4.3, -0.02, 0], size: [0.56, 0.27, 9.5] },
  { pos: [-4.3, -0.02, 0], size: [0.56, 0.27, 9.5] },
];
for (const bar of frameBars) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(bar.size[0], bar.size[1], bar.size[2], 3, 0.05), MAT.frame);
  m.position.set(...bar.pos);
  m.castShadow = true;
  m.receiveShadow = true;
  boardGroup.add(m);
}

const innerTrim = new THREE.Mesh(new THREE.BoxGeometry(8.14, 0.015, 8.14), MAT.brass);
innerTrim.position.y = 0.012;
innerTrim.scale.set(1.02, 1, 1.02);
innerTrim.material = new THREE.MeshStandardMaterial({ color: 0x8f7238, metalness: 0.9, roughness: 0.45 });
innerTrim.visible = false; // reserved for future inlay; keeps the board clean
boardGroup.add(innerTrim);

const tileMeshes = [];
const tileGeometry = new RoundedBoxGeometry(0.995, 0.18, 0.995, 2, 0.018);

for (let r = 0; r < 8; r++) {
  for (let f = 0; f < 8; f++) {
    const sq = r * 8 + f;
    const light = (f + r) % 2 === 1;
    const tile = new THREE.Mesh(tileGeometry, light ? MAT.wood : MAT.slate);
    tile.position.set(f - 3.5, -0.09, 3.5 - r);
    tile.receiveShadow = true;
    tile.userData.square = sq;
    tile.userData.isTile = true;
    boardGroup.add(tile);
    tileMeshes.push(tile);
  }
}

// Brass corner studs.
for (const sx of [-4.3, 4.3]) {
  for (const sz of [-4.3, 4.3]) {
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 18), MAT.brass);
    stud.position.set(sx, 0.12, sz);
    boardGroup.add(stud);
  }
}

/* --------------------------- board coordinates --------------------------- */

const labelsGroup = new THREE.Group();
boardGroup.add(labelsGroup);

function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 96, 96);
  ctx.font = '600 52px "Iowan Old Style", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(226, 212, 184, 0.9)';
  ctx.fillText(text, 48, 51);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.42, 0.42, 0.42);
  return sprite;
}

for (let f = 0; f < 8; f++) {
  const s = labelSprite(FILES[f]);
  s.position.set(f - 3.5, 0.17, 4.31);
  labelsGroup.add(s);
}
for (let r = 0; r < 8; r++) {
  const s = labelSprite(String(r + 1));
  s.position.set(-4.31, 0.17, 3.5 - r);
  labelsGroup.add(s);
}

/* ------------------------------- pieces ---------------------------------- */

const pieceGroup = new THREE.Group();
scene.add(pieceGroup);

const pieceMeshes = new Map();     // square -> root group
const pieceTemplates = new Map();  // type+color -> template group

function latheGeo(points, segments = 40) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0008), y)),
    segments
  );
}

function part(geo, mat, y = 0, x = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ringPart(radius, tube, y, mat = MAT.brass) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 40), mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  m.castShadow = true;
  return m;
}

const PIECE_GEOMETRY = {
  P: {
    body: [[0.33, 0], [0.33, 0.05], [0.31, 0.075], [0.27, 0.1], [0.17, 0.135], [0.135, 0.18], [0.115, 0.34], [0.14, 0.4], [0.168, 0.435], [0.12, 0.462], [0.085, 0.482], [0, 0.49]],
    height: 0.79,
  },
  R: {
    body: [[0.34, 0], [0.34, 0.06], [0.31, 0.09], [0.265, 0.13], [0.24, 0.3], [0.23, 0.45], [0.262, 0.49], [0.285, 0.52], [0.285, 0.59], [0.235, 0.59], [0.21, 0.55], [0, 0.55]],
    height: 0.8,
  },
  B: {
    body: [[0.33, 0], [0.33, 0.055], [0.3, 0.085], [0.23, 0.12], [0.175, 0.19], [0.135, 0.3], [0.185, 0.355], [0.145, 0.4], [0.105, 0.44], [0.205, 0.5], [0.215, 0.56], [0.17, 0.62], [0.1, 0.68], [0.075, 0.72], [0.09, 0.75], [0.05, 0.785], [0, 0.8]],
    height: 0.88,
  },
  Q: {
    body: [[0.35, 0], [0.35, 0.06], [0.32, 0.09], [0.25, 0.13], [0.19, 0.2], [0.15, 0.32], [0.19, 0.4], [0.15, 0.47], [0.11, 0.55], [0.17, 0.61], [0.2, 0.68], [0.185, 0.72], [0.13, 0.75], [0.09, 0.78], [0, 0.79]],
    height: 1.0,
  },
  K: {
    body: [[0.36, 0], [0.36, 0.06], [0.33, 0.09], [0.26, 0.13], [0.2, 0.2], [0.16, 0.33], [0.2, 0.41], [0.16, 0.48], [0.12, 0.56], [0.18, 0.62], [0.21, 0.7], [0.2, 0.74], [0.14, 0.78], [0.1, 0.81], [0, 0.82]],
    height: 1.08,
  },
};

function buildKnight(mat, color) {
  const g = new THREE.Group();
  g.add(part(latheGeo([
    [0.34, 0], [0.34, 0.055], [0.3, 0.085], [0.25, 0.12], [0.235, 0.17],
    [0.26, 0.205], [0.22, 0.235], [0, 0.245],
  ]), mat));

  const shape = new THREE.Shape();
  shape.moveTo(-0.2, 0.02);
  shape.bezierCurveTo(-0.3, 0.12, -0.29, 0.28, -0.16, 0.36);
  shape.bezierCurveTo(-0.2, 0.44, -0.13, 0.52, -0.02, 0.54);
  shape.lineTo(0.015, 0.63);
  shape.lineTo(0.075, 0.53);
  shape.lineTo(0.13, 0.51);
  shape.bezierCurveTo(0.31, 0.49, 0.35, 0.31, 0.29, 0.19);
  shape.lineTo(0.26, 0.11);
  shape.lineTo(0.13, 0.09);
  shape.lineTo(0.1, 0.02);
  shape.closePath();

  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2, bevelEnabled: true, bevelThickness: 0.028, bevelSize: 0.028, bevelSegments: 3, steps: 1, curveSegments: 10,
  });
  headGeo.translate(0, 0, -0.1);
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(headGeo, mat);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), MAT.dark);
  eye.position.set(0.145, 0.4, 0.108);
  head.add(eye);

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.12), mat);
  mane.position.set(-0.18, 0.3, 0);
  mane.rotation.z = 0.25;
  mane.castShadow = true;
  head.add(mane);

  head.position.y = 0.2;
  g.add(head);
  return g;
}

function buildPiece(type, color) {
  const mat = color === 'w' ? MAT.ivory : MAT.obsidian;
  const g = new THREE.Group();

  if (type === 'N') {
    g.add(buildKnight(mat, color));
    return g;
  }

  const info = PIECE_GEOMETRY[type];
  g.add(part(latheGeo(info.body), mat));

  if (type === 'P') {
    g.add(part(new THREE.SphereGeometry(0.152, 26, 20), mat, 0.622));
    g.add(ringPart(0.108, 0.014, 0.482));
  } else if (type === 'R') {
    g.add(part(new THREE.CylinderGeometry(0.275, 0.295, 0.08, 36), mat, 0.625));
    g.add(part(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 32), MAT.dark, 0.665));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const crenel = part(new THREE.BoxGeometry(0.105, 0.125, 0.16), mat);
      crenel.position.set(Math.cos(a) * 0.225, 0.705, Math.sin(a) * 0.225);
      crenel.rotation.y = -a + Math.PI / 2;
      crenel.castShadow = true;
      g.add(crenel);
    }
    g.add(ringPart(0.235, 0.012, 0.52));
  } else if (type === 'B') {
    g.add(ringPart(0.12, 0.014, 0.44));
    g.add(part(new THREE.SphereGeometry(0.045, 20, 14), MAT.brass, 0.825));
    const slit = part(new THREE.BoxGeometry(0.022, 0.17, 0.075), MAT.dark, 0.66, 0, 0.128);
    slit.rotation.x = 0.18;
    slit.rotation.z = 0.32;
    g.add(slit);
  } else if (type === 'Q') {
    g.add(ringPart(0.135, 0.016, 0.71));
    g.add(part(new THREE.CylinderGeometry(0.195, 0.165, 0.075, 36), mat, 0.775));
    const crown = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const spike = part(new THREE.SphereGeometry(0.041, 14, 10), i % 2 === 0 ? MAT.brass : mat);
      spike.position.set(Math.cos(a) * 0.182, 0.838, Math.sin(a) * 0.182);
      crown.add(spike);
    }
    g.add(crown);
    g.add(part(new THREE.SphereGeometry(0.072, 22, 16), mat, 0.9));
    g.add(ringPart(0.062, 0.008, 0.958));
  } else if (type === 'K') {
    g.add(ringPart(0.145, 0.017, 0.74));
    g.add(part(new THREE.CylinderGeometry(0.205, 0.17, 0.08, 36), mat, 0.8));
    const crown = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = part(new THREE.ConeGeometry(0.033, 0.085, 8), MAT.brass);
      spike.position.set(Math.cos(a) * 0.175, 0.875, Math.sin(a) * 0.175);
      crown.add(spike);
    }
    g.add(crown);
    const crossV = part(new THREE.BoxGeometry(0.055, 0.2, 0.055), MAT.brass, 0.99);
    const crossH = part(new THREE.BoxGeometry(0.155, 0.055, 0.055), MAT.brass, 1.012);
    g.add(crossV, crossH);
  }

  return g;
}

function getTemplate(type, color) {
  const key = type + color;
  if (!pieceTemplates.has(key)) {
    pieceTemplates.set(key, buildPiece(type, color));
  }
  return pieceTemplates.get(key);
}

function makePieceInstance(type, color, square) {
  const root = getTemplate(type, color).clone(true);
  root.userData.isPiece = true;
  root.userData.type = type;
  root.userData.color = color;
  root.userData.square = square;
  root.userData.baseRot = type === 'N' ? (color === 'w' ? 0 : Math.PI) : 0;
  root.rotation.y = root.userData.baseRot;
  const pos = squarePos(square);
  root.position.set(pos.x, 0, pos.z);
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return root;
}

function squarePos(square) {
  return new THREE.Vector3((square & 7) - 3.5, 0, 3.5 - (square >> 3));
}

function rebuildPieces({ animate = false } = {}) {
  for (const root of pieceMeshes.values()) {
    pieceGroup.remove(root);
  }
  pieceMeshes.clear();
  const state = activeState();
  let index = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = state.board[sq];
    if (!p) continue;
    const root = makePieceInstance(p.type, p.color, sq);
    pieceGroup.add(root);
    pieceMeshes.set(sq, root);
    if (animate) {
      root.position.y = 1.4 + (index % 8) * 0.12;
      animateRoot(root, new THREE.Vector3(root.position.x, 0, root.position.z), 520, 0, index * 24);
    }
    index++;
  }
  updateSelectionLift();
}

/* --------------------------- highlights ---------------------------------- */

const highlightGroup = new THREE.Group();
scene.add(highlightGroup);

function disposeGroupChildren(group) {
  const children = [...group.children];
  for (const child of children) {
    group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => { m.dispose(); });
      else child.material.dispose();
    }
  }
}

function addSquareGlow(square, color, opacity = 0.16) {
  const pos = squarePos(square);
  const geo = new THREE.PlaneGeometry(0.94, 0.94);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.014, pos.z);
  highlightGroup.add(mesh);
  return mesh;
}

function addRing(square, { inner = 0.28, outer = 0.38, color = 0x5fe3cb, opacity = 0.7, pulse = true, phase = 0 } = {}) {
  const pos = squarePos(square);
  const geo = new THREE.RingGeometry(inner, outer, 40);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.02, pos.z);
  mesh.userData.pulse = pulse;
  mesh.userData.phase = phase;
  mesh.userData.baseOpacity = opacity;
  highlightGroup.add(mesh);
  return mesh;
}

function addCaptureRing(square, color = 0xff8a7d, phase = 0) {
  const pos = squarePos(square);
  const geo = new THREE.TorusGeometry(0.34, 0.028, 8, 40);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.035, pos.z);
  mesh.userData.pulse = true;
  mesh.userData.phase = phase;
  mesh.userData.baseOpacity = 0.85;
  highlightGroup.add(mesh);
  return mesh;
}

function clearHighlights() {
  disposeGroupChildren(highlightGroup);
}

function renderHighlights() {
  clearHighlights();
  const state = activeState();

  if (UI.lastMove) {
    addSquareGlow(UI.lastMove.from, 0xe7c778, 0.13);
    addSquareGlow(UI.lastMove.to, 0xe7c778, 0.17);
  }

  if (UI.hint) {
    if (UI.hint.to != null) addRing(UI.hint.to, { inner: 0.2, outer: 0.34, color: 0xe7c778, opacity: 0.7, pulse: true });
    if (UI.hint.from != null) addRing(UI.hint.from, { inner: 0.38, outer: 0.46, color: 0xe7c778, opacity: 0.45, pulse: true });
  }

  if (state && state.turn) {
    for (const color of ['w', 'b']) {
      if (inCheck(state, color)) {
        const king = findKing(state.board, color);
        if (king >= 0) {
          addRing(king, { inner: 0.3, outer: 0.46, color: 0xff6b6b, opacity: 0.75, pulse: true });
          addSquareGlow(king, 0xff5252, 0.14);
        }
      }
    }
  }

  if (UI.selected != null) {
    addSquareGlow(UI.selected, 0x5fe3cb, 0.16);
    const sel = pieceMeshes.get(UI.selected);
    if (sel) {
      const pos = squarePos(UI.selected);
      addRing(UI.selected, { inner: 0.33, outer: 0.43, color: 0x5fe3cb, opacity: 0.55, pulse: true });
      const liftRing = new THREE.Mesh(
        new THREE.RingGeometry(0.36, 0.44, 44),
        new THREE.MeshBasicMaterial({ color: 0x9dfff0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      liftRing.rotation.x = -Math.PI / 2;
      liftRing.position.set(pos.x, 0.03, pos.z);
      liftRing.userData.pulse = true;
      liftRing.userData.phase = 1.4;
      liftRing.userData.baseOpacity = 0.35;
      highlightGroup.add(liftRing);
    }
  }

  if (UI.inspectOnly && UI.selected != null) {
    drawInspectPaths();
    return;
  }

  const seen = new Set();
  UI.selectedMoves.forEach((move, i) => {
    if (seen.has(move.to)) return;
    seen.add(move.to);
    if (move.castle) {
      addRing(move.to, { inner: 0.2, outer: 0.36, color: 0xe7c778, opacity: 0.75, pulse: true, phase: i });
    } else if (move.captured) {
      addCaptureRing(move.to, 0xff8a7d, i * 0.5);
    } else {
      addRing(move.to, { inner: 0.16, outer: 0.26, color: 0x5fe3cb, opacity: 0.7, pulse: true, phase: i * 0.6 });
    }
  });
}

function drawInspectPaths() {
  const state = activeState();
  const from = UI.selected;
  if (from == null) return;
  const piece = state.board[from];
  if (!piece) return;

  const targets = UI.selectedMoves;
  const seen = new Set();
  const start = squarePos(from);
  const startY = 0.24;

  for (const move of targets) {
    if (seen.has(move.to)) continue;
    seen.add(move.to);
    const end = squarePos(move.to);
    const dist = start.distanceTo(end);
    const mid = new THREE.Vector3(
      (start.x + end.x) / 2,
      startY + 0.12 + dist * 0.085,
      (start.z + end.z) / 2
    );
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(start.x, startY, start.z),
      mid,
      new THREE.Vector3(end.x, 0.06, end.z)
    );
    const pts = curve.getPoints(26);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: move.captured ? 0xff8a7d : 0x5fe3cb,
      transparent: true,
      opacity: piece.color === state.turn ? 0.55 : 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    highlightGroup.add(new THREE.Line(geo, mat));

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 20),
      new THREE.MeshBasicMaterial({
        color: move.captured ? 0xff8a7d : 0x9dfff0,
        transparent: true, opacity: 0.6, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(end.x, 0.03, end.z);
    disc.userData.pulse = true;
    disc.userData.phase = Math.random() * 6;
    disc.userData.baseOpacity = 0.6;
    highlightGroup.add(disc);
  }
}

/* --------------------------- selection lift ------------------------------ */

function updateSelectionLift() {
  // Lift is interpolated in the render loop; this function exists so callers
  // can express intent without touching per-frame state.
}

/* ------------------------------- hover ----------------------------------- */

const hoverRing = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.47, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
);
hoverRing.rotation.x = -Math.PI / 2;
hoverRing.position.y = 0.018;
scene.add(hoverRing);

/* --------------------------- animation system ---------------------------- */

const anims = new Map();

function animateRoot(root, to, dur = 280, arc = 0, delay = 0) {
  anims.set(root, {
    from: root.position.clone(),
    to: to.clone(),
    start: performance.now() + delay,
    dur,
    arc,
    fade: false,
  });
}

function fadeOutRoot(root, delay = 0) {
  anims.set(root, {
    from: root.position.clone(),
    to: root.position.clone().add(new THREE.Vector3(0, 0.55, 0)),
    start: performance.now() + delay,
    dur: 240,
    arc: 0,
    fade: true,
  });
}

function stepAnimations(now) {
  for (const [root, a] of anims) {
    if (now < a.start) continue;
    const p = clamp((now - a.start) / a.dur, 0, 1);
    const e = easeInOutCubic(p);
    root.position.x = a.from.x + (a.to.x - a.from.x) * e;
    root.position.z = a.from.z + (a.to.z - a.from.z) * e;
    root.position.y = a.from.y + (a.to.y - a.from.y) * e + (a.arc ? Math.sin(Math.PI * e) * a.arc : 0);
    if (a.fade) {
      const s = Math.max(0.001, 1 - e);
      root.scale.setScalar(s);
      root.rotation.y += 0.08;
    }
    if (p >= 1) {
      anims.delete(root);
      if (a.fade) {
        if (root.parent) root.parent.remove(root);
        const sq = root.userData.square;
        if (sq != null && pieceMeshes.get(sq) === root) pieceMeshes.delete(sq);
      } else {
        root.position.y = a.to.y;
      }
    }
  }
}

function stepPieceIdle(now) {
  const selectedRoot = UI.selected != null ? pieceMeshes.get(UI.selected) : null;
  for (const root of pieceMeshes.values()) {
    if (anims.has(root)) continue;
    const targetY = root === selectedRoot ? 0.16 : 0;
    root.position.y += (targetY - root.position.y) * 0.14;
    const base = root.userData.baseRot || 0;
    let targetRot = base;
    if (root === selectedRoot) targetRot = base + Math.sin(now * 0.0011) * 0.22;
    let diff = targetRot - root.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    root.rotation.y += diff * 0.08;
  }
}

function stepHighlightPulse(now) {
  for (const child of highlightGroup.children) {
    if (!child.userData.pulse) continue;
    const phase = child.userData.phase || 0;
    const s = 1 + Math.sin(now * 0.004 + phase) * 0.045;
    child.scale.setScalar(s);
    child.material.opacity = (child.userData.baseOpacity || 0.6) * (0.78 + 0.22 * Math.sin(now * 0.004 + phase));
  }
}

/* ------------------------------- camera ---------------------------------- */

const CAMERA_PRESETS = {
  white: { pos: [0, 8.9, 10.4], target: [0, 0.35, 0.6] },
  black: { pos: [0, 8.9, -10.4], target: [0, 0.35, -0.6] },
  top: { pos: [0, 14.6, 0.02], target: [0, 0, 0] },
  studio: { pos: [7.4, 7.2, 8.6], target: [0, 0.35, 0] },
};

const camTween = { active: false, start: 0, dur: 750, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), toTarget: new THREE.Vector3() };

function setCamera(preset, animate = true) {
  const cfg = CAMERA_PRESETS[preset];
  if (!cfg) return;
  UI.cameraPreset = preset;
  controls.autoRotate = false;
  const toTarget = new THREE.Vector3(...cfg.target);
  const toPos = new THREE.Vector3(...cfg.pos);
  const baseDistance = toPos.distanceTo(toTarget);
  const targetDistance = Math.max(baseDistance, fitDistanceForViewport());
  toPos.sub(toTarget).normalize().multiplyScalar(targetDistance).add(toTarget);
  if (!animate) {
    camera.position.copy(toPos);
    controls.target.copy(toTarget);
    controls.update();
    return;
  }
  camTween.active = true;
  camTween.start = performance.now();
  camTween.fromPos.copy(camera.position);
  camTween.toPos.copy(toPos);
  camTween.fromTarget.copy(controls.target);
  camTween.toTarget.copy(toTarget);
  document.querySelectorAll('[data-cam]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.cam === preset);
  });
  const label = UI.els.camLabel;
  if (label) {
    const key = preset === 'studio' ? 'camera.studio' : preset === 'black' ? 'camera.black' : preset === 'top' ? 'camera.top' : 'camera.white';
    label.textContent = t(key);
  }
}

function stepCamera(now) {
  if (!camTween.active) return;
  const p = clamp((now - camTween.start) / camTween.dur, 0, 1);
  const e = easeInOutCubic(p);
  camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
  controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
  if (p >= 1) camTween.active = false;
}

const cameraCycle = ['white', 'black', 'top', 'studio'];

/* ------------------------------- resize ---------------------------------- */

function screenPointForSquare(square, height = 0.12) {
  const pos = squarePos(square);
  pos.y = height;
  pos.project(camera);
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: rect.left + (pos.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-pos.y * 0.5 + 0.5) * rect.height,
  };
}

function fitDistanceForViewport() {
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const halfBoard = 4.8;
  const vertical = halfBoard / Math.tan(vFov / 2);
  const horizontal = halfBoard / Math.tan(hFov / 2);
  return Math.max(vertical, horizontal) * 1.06;
}

function resizeScene() {
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.8 ? 52 : camera.aspect < 1.05 ? 44 : 38;
  camera.updateProjectionMatrix();

  const dir = camera.position.clone().sub(controls.target);
  const distance = dir.length();
  const needed = fitDistanceForViewport();
  if (distance < needed) {
    camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(needed));
    camera.updateProjectionMatrix();
  }
}

if ('ResizeObserver' in window) {
  new ResizeObserver(resizeScene).observe(stageEl);
} else {
  window.addEventListener('resize', resizeScene);
}

/* ------------------------------- dust ------------------------------------ */

const dustGeo = new THREE.BufferGeometry();
const dustCount = 180;
const dustPositions = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const r = 6 + Math.random() * 16;
  const a = Math.random() * Math.PI * 2;
  dustPositions[i * 3] = Math.cos(a) * r;
  dustPositions[i * 3 + 1] = Math.random() * 10 - 0.5;
  dustPositions[i * 3 + 2] = Math.sin(a) * r;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    color: 0xd9c79e, size: 0.035, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  })
);
scene.add(dust);

/* ------------------------------- render loop ----------------------------- */

let lastFrame = performance.now();
let idleSince = performance.now();

function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  const dt = Math.min(60, now - lastFrame);
  lastFrame = now;

  stepCamera(now);
  stepAnimations(now);
  stepPieceIdle(now);
  stepHighlightPulse(now);

  controls.autoRotate = UI.motion && UI.idle && !UI.gameOver && now - idleSince > 9000 && !camTween.active;
  controls.update();

  // Keep the orbit target near the board so panning cannot lose the studio.
  controls.target.x = clamp(controls.target.x, -4.2, 4.2);
  controls.target.z = clamp(controls.target.z, -4.2, 4.2);
  controls.target.y = clamp(controls.target.y, 0, 1.6);

  if (hoverRing.material.opacity > 0.001) {
    hoverRing.material.opacity *= 0.9;
  }

  dust.rotation.y += dt * 0.000018;
  haloRing.material.opacity = 0.14 + Math.sin(now * 0.0006) * 0.05;

  renderer.render(scene, camera);
}

/* ------------------------------- picking --------------------------------- */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function pickAt(clientX, clientY) {
  updatePointer(clientX, clientY);
  raycaster.setFromCamera(pointer, camera);

  const roots = [...pieceMeshes.values()];
  const pieceHits = raycaster.intersectObjects(roots, true);
  if (pieceHits.length) {
    let obj = pieceHits[0].object;
    while (obj && !obj.userData.isPiece) obj = obj.parent;
    if (obj) {
      return { square: obj.userData.square, root: obj, piece: true };
    }
  }
  const tileHits = raycaster.intersectObjects(tileMeshes, false);
  if (tileHits.length) {
    return { square: tileHits[0].object.userData.square, root: null, piece: false };
  }
  return null;
}

function updateHover(clientX, clientY) {
  if (UI.dragging) return;
  const hit = pickAt(clientX, clientY);
  if (!hit) {
    hoverRing.material.opacity = 0;
    return;
  }
  UI.hoverSquare = hit.square;
  const pos = squarePos(hit.square);
  hoverRing.position.set(pos.x, 0.018, pos.z);
  hoverRing.material.color.set(hit.piece ? 0xffffff : 0x9dfff0);
  hoverRing.material.opacity = hit.piece ? 0.45 : 0.28;
}

/* ------------------------------- helpers --------------------------------- */

function activeState() {
  return UI.mode === 'puzzle' && UI.puzzle.state ? UI.puzzle.state : game.state;
}

function pieceName(type) {
  return t('piece.' + ({ P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }[type]));
}

function pieceValue(type) {
  return PIECE_VALUE[type] || 0;
}

function sideLabel(color) {
  return color === 'w' ? t('inspector.white') : t('inspector.black');
}
/* ==========================================================================
   5. GAME CONTROLLER
   ========================================================================== */

const game = {
  state: createState(),
  startFen: START_FEN,
  status: null,
};
UI.game = game;

const threatCache = new Map();

function currentPuzzle() {
  return PUZZLES.find((p) => p.id === UI.puzzle.activeId) || null;
}

function uciOf(move) {
  return sqName(move.from) + sqName(move.to) + (move.promo ? move.promo.toLowerCase() : '');
}

/* ----------------------------- opponent ---------------------------------- */

function botColor() {
  return UI.humanColor === 'w' ? 'b' : 'w';
}

function botLevelName() {
  return t('bot.' + UI.botLevel);
}

function updateOpponentUI() {
  const els = UI.els;
  if (!els.botBadge) return;
  els.botBadge.textContent = UI.vsBot ? botLevelName() : t('bot.human');
  els.botBadge.classList.toggle('badge-good', UI.vsBot);
  els.botBadge.classList.toggle('badge-quiet', !UI.vsBot);
  els.botSettings.hidden = !UI.vsBot;
  els.botNote.textContent = UI.vsBot
    ? t('bot.youAre', { side: sideLabel(UI.humanColor), level: botLevelName() })
    : t('bot.hotseat');

  document.querySelectorAll('[data-opponent]').forEach((b) => {
    const on = (b.dataset.opponent === 'bot') === UI.vsBot;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-side]').forEach((b) => {
    const on = b.dataset.side === UI.humanColor;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('[data-level]').forEach((b) => {
    const on = b.dataset.level === UI.botLevel;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  if (els.matchNote) {
    els.matchNote.textContent = UI.vsBot
      ? t('match.botNote', { side: sideLabel(UI.humanColor), level: botLevelName() })
      : t('match.note');
  }
  if (els.stageBot) els.stageBot.hidden = !(UI.vsBot && UI.botThinking);
}

function setVsBot(enabled) {
  if (UI.vsBot === enabled) {
    updateOpponentUI();
    return;
  }
  UI.vsBot = enabled;
  UI.lastBlunder = null;
  if (!enabled) cancelBot();
  saveState();

  if (UI.mode === 'puzzle') {
    updateOpponentUI();
    return;
  }

  if (enabled) {
    if (game.status && game.status.over) {
      startNewGame();
      return;
    }
    toast(t('bot.on', { side: sideLabel(UI.humanColor) }));
    updateOpponentUI();
    updateStatusBar();
    maybeBotTurn(700);
  } else {
    toast(t('bot.off'));
    updateOpponentUI();
    updateStatusBar();
  }
}

function setHumanColor(color) {
  const wanted = color === 'b' ? 'b' : 'w';
  if (UI.humanColor === wanted) return;

  if (UI.mode === 'puzzle') {
    UI.humanColor = wanted;
    updateOpponentUI();
    saveState();
    return;
  }

  if (!UI.vsBot) {
    UI.humanColor = wanted;
    updateOpponentUI();
    saveState();
    return;
  }

  if (game.state.history.length === 0) {
    UI.humanColor = wanted;
    startNewGame();
    return;
  }

  showConfirm({
    titleKey: 'bot.switchTitle',
    bodyKey: 'bot.switchBody',
    yesKey: 'confirm.yes',
    vars: { sideColor: wanted },
    onYes: () => {
      UI.humanColor = wanted;
      startNewGame();
    },
  });
}

function setBotLevel(level) {
  if (!AI_LEVELS[level] || UI.botLevel === level) return;
  UI.botLevel = level;
  updateOpponentUI();
  saveState();
  if (UI.vsBot && UI.mode === 'play' && game.state.turn === botColor()) {
    cancelBot();
    maybeBotTurn(260);
  }
}

function cancelBot() {
  UI.botToken += 1;
  UI.botThinking = false;
  if (UI.botTimer) {
    clearTimeout(UI.botTimer);
    UI.botTimer = null;
  }
  if (UI.els.stageBot) UI.els.stageBot.hidden = true;
}

function canBotPlay() {
  return UI.vsBot
    && UI.mode === 'play'
    && !UI.botThinking
    && game.status
    && !game.status.over
    && game.state.turn === botColor();
}

function maybeBotTurn(delay = 450) {
  if (UI.mode !== 'play' || !UI.vsBot) return;
  if (!game.status) game.status = gameStatus(game.state);
  if (game.status.over) return;
  if (game.state.turn !== botColor()) return;
  if (UI.botThinking) return;
  if (anyModalOpen()) return;
  scheduleBotTurn(delay);
}

function scheduleBotTurn(delay = 450) {
  cancelBot();
  if (!canBotPlay()) return;

  UI.botThinking = true;
  const token = ++UI.botToken;
  updateStatusBar();
  updateOpponentUI();

  UI.botTimer = setTimeout(() => {
    if (token !== UI.botToken) return;
    requestAnimationFrame(() => {
      if (token !== UI.botToken) return;
      if (anyModalOpen()) {
        UI.botThinking = false;
        UI.botTimer = null;
        updateStatusBar();
        updateOpponentUI();
        return;
      }
      let result = null;
      try {
        result = chooseBotMove(game.state, UI.botLevel);
      } catch (err) {
        console.error('The bot could not choose a move', err);
      }
      if (token !== UI.botToken) return;
      UI.botThinking = false;
      UI.botTimer = null;
      updateStatusBar();
      updateOpponentUI();
      if (!result || !result.move) return;
      commitGameMove(result.move, { byAI: true });
    });
  }, delay);
}

function undoVsBot() {
  cancelBot();
  const hasHumanMove = game.state.history.some((h) => h.move.color === UI.humanColor);
  if (!hasHumanMove) {
    toast(t('toast.undoNothing'), 'warn');
    return;
  }

  let removed = 0;
  while (game.state.history.length && removed < 4) {
    const last = game.state.history[game.state.history.length - 1].move;
    undoMove(game.state);
    game.state.sanMoves.pop();
    removed += 1;
    if (last.color === UI.humanColor) break;
  }

  const prev = game.state.history[game.state.history.length - 1];
  UI.lastMove = prev ? { from: prev.move.from, to: prev.move.to } : null;
  UI.gameOver = null;
  UI.lastBlunder = null;
  UI.hint = null;
  clearSelection({ silent: true });
  game.status = gameStatus(game.state);
  rebuildPieces();
  refreshAll();
  saveState();
  Sound.play('lift');
  toast(t('toast.undone'));
}

/* ----------------------------- threats ----------------------------------- */

function detectThreats(state) {
  const color = state.turn;
  const enemy = otherColor(color);
  const moves = legalMoves(state, color);
  let mate = null;
  let best = null;

  for (const move of moves) {
    applyMove(state, move);
    if (move.captured) {
      const defended = isAttacked(state.board, move.to, enemy);
      const gain = PIECE_VALUE[move.captured] - (defended ? PIECE_VALUE[move.piece] : 0);
      if (!best || gain > best.gain) {
        best = { move, gain, defended };
      }
    }
    if (!mate && inCheck(state, enemy)) {
      const replies = legalMoves(state, enemy);
      if (replies.length === 0) mate = move;
    }
    undoMove(state);
  }

  if (mate) mate.san = moveToSAN(state, mate);
  if (best) best.san = moveToSAN(state, best.move);
  return { mate, best, color };
}

function threatsForKey(state) {
  const key = positionKey(state);
  if (threatCache.has(key)) return threatCache.get(key);
  const result = detectThreats(state);
  if (threatCache.size > 100) threatCache.clear();
  threatCache.set(key, result);
  return result;
}

/* ----------------------------- selection --------------------------------- */

function clearSelection({ silent = false } = {}) {
  UI.selected = null;
  UI.selectedMoves = [];
  UI.inspectOnly = false;
  UI.inspectorSquare = null;
  if (UI.els.inspector) UI.els.inspector.hidden = true;
  if (!silent) renderHighlights();
}

function selectSquare(square) {
  const state = activeState();
  const piece = state.board[square];
  if (!piece) { clearSelection(); return; }

  if (UI.selected === square && !UI.inspectOnly) {
    clearSelection();
    return;
  }

  UI.selected = square;
  UI.inspectorSquare = square;
  let own = piece.color === state.turn;
  if (UI.mode === 'puzzle') own = own && piece.color === 'w' && UI.puzzle.noteKind !== 'solved';
  if (UI.inspectLens) own = false;

  if (own) {
    UI.selectedMoves = legalMoves(state, piece.color).filter((m) => m.from === square);
    UI.inspectOnly = false;
  } else {
    UI.selectedMoves = genMoves(state, piece.color).filter((m) => m.from === square);
    UI.inspectOnly = true;
  }

  Sound.play('lift');
  showInspector(square);
  renderHighlights();
  updateModeUI();
}

function onSquareClick(square) {
  if (!UI.booted) return;
  if (UI.pendingPromo) return;
  if (UI.lastBlunder && !UI.els.blunderModal.hidden) return;
  if (UI.mode === 'play' && game.status && game.status.over) {
    toast(t('toast.gameOver'), 'warn');
    return;
  }
  if (UI.mode === 'play' && UI.vsBot && (UI.botThinking || game.state.turn === botColor())) {
    return;
  }

  const state = activeState();
  const piece = state.board[square];

  if (square === UI.selected && !UI.inspectOnly) {
    clearSelection();
    return;
  }

  if (UI.selected != null && !UI.inspectOnly) {
    const candidates = UI.selectedMoves.filter((m) => m.to === square);
    if (candidates.length) {
      if (UI.inspectLens) return;
      attemptMove(candidates);
      return;
    }
  }

  if (piece) {
    selectSquare(square);
    return;
  }

  if (UI.selected != null) clearSelection();
}

function attemptMove(candidates) {
  if (candidates.length > 1 && candidates[0].promo) {
    UI.pendingPromo = candidates;
    openModal('modal-promotion');
    return;
  }
  const move = candidates[0];
  if (!move) return;
  if (UI.mode === 'puzzle') {
    playPuzzleMove(move);
  } else {
    commitGameMove(move);
  }
}

function animateMoveVisual(move) {
  let root = pieceMeshes.get(move.from);
  if (!root) { rebuildPieces(); return; }

  if (move.ep) {
    const capSq = move.to + (move.color === 'w' ? -8 : 8);
    const victim = pieceMeshes.get(capSq);
    if (victim) {
      pieceMeshes.delete(capSq);
      fadeOutRoot(victim);
    }
  } else if (move.captured) {
    const victim = pieceMeshes.get(move.to);
    if (victim) {
      pieceMeshes.delete(move.to);
      fadeOutRoot(victim);
    }
  }

  pieceMeshes.delete(move.from);
  const target = squarePos(move.to);
  root.userData.square = move.to;
  pieceMeshes.set(move.to, root);

  if (move.promo) {
    fadeOutRoot(root);
    root = makePieceInstance(move.promo, move.color, move.to);
    const from = squarePos(move.from);
    root.position.set(from.x, 0, from.z);
    pieceGroup.add(root);
    pieceMeshes.set(move.to, root);
  }

  animateRoot(root, new THREE.Vector3(target.x, 0, target.z), 320, move.piece === 'N' || move.promo ? 0.5 : 0.16);

  if (move.castle) {
    const rank = move.color === 'w' ? 0 : 7;
    const kingside = move.castle === 'K' || move.castle === 'k';
    const rookFrom = rank * 8 + (kingside ? 7 : 0);
    const rookTo = rank * 8 + (kingside ? 5 : 3);
    const rook = pieceMeshes.get(rookFrom);
    if (rook) {
      pieceMeshes.delete(rookFrom);
      pieceMeshes.set(rookTo, rook);
      rook.userData.square = rookTo;
      const p = squarePos(rookTo);
      animateRoot(rook, new THREE.Vector3(p.x, 0, p.z), 340, 0.12);
    }
  }
}

function commitGameMove(move, options = {}) {
  const byAI = options.byAI === true;
  const state = game.state;
  const san = moveToSAN(state, move);
  UI.lastMove = { from: move.from, to: move.to };
  UI.hint = null;
  UI.selected = null;
  UI.selectedMoves = [];
  UI.inspectOnly = false;
  UI.lastBlunder = null;
  UI.gameOver = null;
  if (UI.els.inspector) UI.els.inspector.hidden = true;

  applyMove(state, move);
  state.sanMoves.push(san);
  animateMoveVisual(move);

  const status = gameStatus(state);
  game.status = status;
  UI.gameOver = status.over ? status : null;

  refreshAll();
  saveState();

  if (status.over) {
    Sound.play(status.reason === 'checkmate' ? 'win' : 'draw');
    setTimeout(showGameOver, 460);
    return;
  }

  Sound.play(move.captured ? 'capture' : move.castle ? 'castle' : move.promo ? 'promote' : 'drop');

  if (status.check) {
    Sound.play('check');
    toast(t('toast.check'), 'warn');
  }

  let guarded = false;
  if (!byAI && UI.guard) guarded = evaluateBlunder();
  if (!byAI && !guarded) maybeBotTurn(560);
}

function evaluateBlunder() {
  const threats = threatsForKey(game.state);
  if (!threats.mate && !(threats.best && threats.best.gain >= 3)) return false;
  UI.lastBlunder = threats;
  showBlunderModal(threats);
  return true;
}

function blunderCopy(threats) {
  if (threats.mate) {
    return {
      en: `${sideLabel(threats.color)} can play ${threats.mate.san} — mate in one. The king has no escape. Undo the last move and look for a defence.`,
      th: `${sideLabel(threats.color)} เดิน ${threats.mate.san} รุกจนในหนึ่งตา ราชาหนีไม่ได้ ย้อนตาเดินล่าสุดแล้วหาการป้องกัน`,
    };
  }
  const best = threats.best;
  const victim = pieceName(best.move.captured);
  if (best.defended) {
    return {
      en: `${sideLabel(threats.color)} can take your ${victim} on ${sqName(best.move.to)} with ${best.san}. You can recapture, but the exchange still favours them.`,
      th: `${sideLabel(threats.color)} กิน${victim}ของคุณที่ ${sqName(best.move.to)} ด้วย ${best.san} คุณกินคืนได้ แต่การแลกยังเสียเปรียบ`,
    };
  }
  return {
    en: `${sideLabel(threats.color)} can take your ${victim} on ${sqName(best.move.to)} with ${best.san}. Nothing defends it — the piece is simply lost.`,
    th: `${sideLabel(threats.color)} กิน${victim}ของคุณที่ ${sqName(best.move.to)} ด้วย ${best.san} ไม่มีใครป้องกัน เสียหมากฟรี`,
  };
}

function showBlunderModal(threats) {
  const copy = blunderCopy(threats);
  const primary = UI.lang === 'th' ? copy.th : copy.en;
  const secondary = UI.lang === 'th' ? copy.en : copy.th;
  UI.els.blunderEn.textContent = primary;
  UI.els.blunderEn.lang = UI.lang;
  UI.els.blunderTh.textContent = secondary;
  UI.els.blunderTh.lang = UI.lang === 'th' ? 'en' : 'th';
  openModal('modal-blunder');
  Sound.play('illegal');
}

function undoLast() {
  if (UI.mode === 'puzzle') {
    retryPuzzle();
    return;
  }
  if (UI.vsBot) {
    undoVsBot();
    return;
  }
  if (!game.state.history.length) {
    toast(t('toast.undoNothing'), 'warn');
    return;
  }
  undoMove(game.state);
  game.state.sanMoves.pop();
  const prev = game.state.history[game.state.history.length - 1];
  UI.lastMove = prev ? { from: prev.move.from, to: prev.move.to } : null;
  UI.gameOver = null;
  UI.lastBlunder = null;
  UI.hint = null;
  clearSelection({ silent: true });
  game.status = gameStatus(game.state);
  rebuildPieces();
  refreshAll();
  saveState();
  Sound.play('lift');
  toast(t('toast.undone'));
}

function requestHint() {
  if (UI.mode === 'puzzle') {
    showPuzzleHint();
    return;
  }
  const state = game.state;
  if (game.status && game.status.over) return;
  if (UI.vsBot && (UI.botThinking || state.turn === botColor())) return;
  const threats = threatsForKey(state);
  let move = threats.mate || (threats.best && threats.best.gain > 0 ? threats.best.move : null);

  if (!move) {
    const moves = legalMoves(state);
    let bestScore = -Infinity;
    for (const m of moves) {
      let score = 0;
      if (m.castle) score += 4;
      if (m.captured) score += PIECE_VALUE[m.captured] * 1.2;
      const tf = m.to & 7;
      const tr = m.to >> 3;
      if ((tf === 3 || tf === 4) && (tr === 3 || tr === 4)) score += 2.2;
      if ((m.from === 1 || m.from === 6) && (m.to === 18 || m.to === 21 || m.to === 42 || m.to === 45)) score += 1.6;
      if (m.promo) score += 5;
      if (m.piece === 'Q' && state.half < 6) score -= 1;
      score += Math.random() * 0.3;
      if (score > bestScore) { bestScore = score; move = m; }
    }
  }

  if (!move) {
    toast(t('toast.hintNone'), 'warn');
    return;
  }

  UI.hint = { from: move.from, to: move.to };
  const san = moveToSAN(state, move);
  renderHighlights();
  if (threats.mate) toast(t('toast.hintMate', { move: san }), 'warn');
  else if (move.captured) toast(t('toast.hintCapture', { move: san }), 'warn');
  else toast(t('toast.hintDevelop', { move: san }));
  Sound.play('lift');
}

/* ----------------------------- puzzles ----------------------------------- */

function loadPuzzle(id) {
  const puzzle = PUZZLES.find((p) => p.id === id);
  if (!puzzle) return;
  cancelBot();
  let state;
  try {
    state = createState(puzzle.fen);
  } catch (err) {
    console.warn('Puzzle FEN rejected', puzzle.id, err);
    toast('This drill has an invalid position.', 'error');
    return;
  }
  closeAllModals();
  UI.mode = 'puzzle';
  UI.puzzle.activeId = puzzle.id;
  UI.puzzle.state = state;
  UI.puzzle.attempts = 0;
  UI.puzzle.noteKind = 'goal';
  UI.puzzle.lastSolved = null;
  UI.selected = null;
  UI.selectedMoves = [];
  UI.inspectOnly = false;
  UI.lastMove = null;
  UI.hint = null;
  UI.gameOver = null;
  UI.lastBlunder = null;
  if (UI.els.inspector) UI.els.inspector.hidden = true;
  rebuildPieces({ animate: true });
  refreshAll();
  switchTab('puzzles');
  setCamera('white');
  toast(t('toast.puzzleLoaded'));
  Sound.play('puzzle');
}

function playPuzzleMove(move) {
  const puzzle = currentPuzzle();
  if (!puzzle) return;
  const expected = String(puzzle.uci || '').toLowerCase();
  if (uciOf(move) !== expected) {
    Sound.play('illegal');
    UI.puzzle.attempts += 1;
    UI.puzzle.streak = 0;
    UI.puzzle.noteKind = 'wrong';
    flashStage();
    updatePuzzleUI();
    saveState();
    return;
  }

  const state = UI.puzzle.state;
  const san = moveToSAN(state, move);
  UI.lastMove = { from: move.from, to: move.to };
  UI.selected = null;
  UI.selectedMoves = [];
  UI.inspectOnly = false;
  UI.lastBlunder = null;
  UI.puzzle.lastSolved = puzzle;
  UI.puzzle.noteKind = 'solved';

  applyMove(state, move);
  state.sanMoves.push(san);
  animateMoveVisual(move);

  if (!UI.puzzle.solvedIds.includes(puzzle.id)) {
    UI.puzzle.solvedIds.push(puzzle.id);
    UI.puzzle.streak += 1;
    UI.puzzle.best = Math.max(UI.puzzle.best, UI.puzzle.streak);
  }

  refreshAll();
  saveState();
  Sound.play('puzzle');

  setTimeout(() => showPuzzleSolved(puzzle), 520);
}

function retryPuzzle() {
  const puzzle = currentPuzzle();
  if (!puzzle) return;
  loadPuzzle(puzzle.id);
}

function showPuzzleHint() {
  const puzzle = currentPuzzle();
  if (!puzzle) return;
  UI.puzzle.noteKind = 'hint';
  UI.puzzle.hintRevealed = true;
  UI.hint = { from: nameToSq(String(puzzle.uci).slice(0, 2)), to: null };
  updatePuzzleUI();
  renderHighlights();
  Sound.play('lift');
}

function exitPuzzle() {
  if (UI.mode !== 'puzzle') return;
  UI.mode = 'play';
  UI.puzzle.activeId = null;
  UI.puzzle.state = null;
  UI.puzzle.noteKind = null;
  UI.puzzle.lastSolved = null;
  UI.selected = null;
  UI.selectedMoves = [];
  UI.inspectOnly = false;
  UI.lastMove = null;
  UI.hint = null;
  UI.gameOver = null;
  closeAllModals();
  rebuildPieces();
  refreshAll();
  setCamera(UI.cameraPreset === 'top' ? 'top' : 'white');
  toast(t('toast.puzzleExit'));
  if (UI.vsBot) maybeBotTurn(600);
}

function showPuzzleSolved(puzzle) {
  const primary = puzzle.explanation ? puzzle.explanation[UI.lang] : '';
  const secondary = puzzle.explanation ? puzzle.explanation[UI.lang === 'th' ? 'en' : 'th'] : '';
  UI.els.puzzleModalBody.textContent = primary;
  UI.els.puzzleModalBody.lang = UI.lang;
  UI.els.puzzleModalBodyTh.textContent = secondary;
  UI.els.puzzleModalBodyTh.lang = UI.lang === 'th' ? 'en' : 'th';
  UI.els.puzzleModalTitle.textContent = t('solved.title') + ' · ' + t('puzzle.streak') + ' ' + UI.puzzle.streak;
  openModal('modal-puzzle');
}

function nextPuzzle() {
  if (!PUZZLES.length) return;
  const current = currentPuzzle();
  const start = current ? PUZZLES.findIndex((p) => p.id === current.id) : -1;
  for (let i = 1; i <= PUZZLES.length; i++) {
    const candidate = PUZZLES[(start + i + PUZZLES.length) % PUZZLES.length];
    if (!UI.puzzle.solvedIds.includes(candidate.id)) {
      loadPuzzle(candidate.id);
      return;
    }
  }
  loadPuzzle(PUZZLES[(start + 1) % PUZZLES.length].id);
}

/* ----------------------------- game lifecycle ---------------------------- */

function startNewGame() {
  cancelBot();
  UI.confirmData = null;
  closeAllModals();
  game.state = createState();
  game.startFen = START_FEN;
  game.status = gameStatus(game.state);
  UI.mode = 'play';
  UI.puzzle.activeId = null;
  UI.puzzle.state = null;
  UI.puzzle.noteKind = null;
  UI.puzzle.lastSolved = null;
  UI.gameOver = null;
  UI.lastBlunder = null;
  UI.lastMove = null;
  UI.hint = null;
  UI.selected = null;
  UI.selectedMoves = [];
  UI.inspectOnly = false;
  threatCache.clear();
  if (UI.els.inspector) UI.els.inspector.hidden = true;
  rebuildPieces({ animate: true });
  refreshAll();
  saveState();
  setCamera(UI.vsBot && UI.humanColor === 'b' ? 'black' : 'white');
  if (UI.vsBot) {
    toast(t('bot.started', { side: sideLabel(UI.humanColor), level: botLevelName() }));
    maybeBotTurn(820);
  } else {
    toast(t('toast.newGame'));
  }
}

function requestNewGame() {
  if (UI.mode === 'puzzle') exitPuzzle();
  if (game.state.history.length === 0) {
    startNewGame();
    return;
  }
  if (UI.vsBot) {
    showConfirm({
      titleKey: 'bot.newTitle',
      bodyKey: 'bot.newBody',
      yesKey: 'bot.newYes',
      vars: { sideColor: UI.humanColor, levelKey: 'bot.' + UI.botLevel },
      onYes: startNewGame,
    });
  } else {
    showConfirm({
      titleKey: 'confirm.title',
      bodyKey: 'confirm.body',
      yesKey: 'confirm.yes',
      onYes: startNewGame,
    });
  }
}

/* ----------------------------- export ------------------------------------ */

function buildPGN() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const status = game.status || gameStatus(game.state);
  const result = status.over ? status.result : '*';
  const headers = [
    ['Event', 'Full 3D Chess Academy & Studio'],
    ['Site', 'Local studio'],
    ['Date', `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`],
    ['Round', '-'],
    ['White', 'White'],
    ['Black', 'Black'],
    ['Result', result],
    ['Annotator', 'OpenCode · DeepSeek V4.1 Flash'],
  ];
  const head = headers.map(([k, v]) => `[${k} "${v}"]`).join('\n');
  const moves = game.state.sanMoves;
  const tokens = [];
  for (let i = 0; i < moves.length; i += 2) {
    tokens.push(`${i / 2 + 1}.`);
    tokens.push(moves[i]);
    if (moves[i + 1]) tokens.push(moves[i + 1]);
  }
  if (status.over) tokens.push(result);

  const lines = [];
  let line = '';
  for (const token of tokens) {
    if ((line + ' ' + token).trim().length > 78) {
      lines.push(line.trim());
      line = token;
    } else {
      line = (line + ' ' + token).trim();
    }
  }
  if (line) lines.push(line);
  return `${head}\n\n${lines.join('\n')}\n`;
}

function buildExportJSON() {
  const status = game.status || gameStatus(game.state);
  return JSON.stringify({
    app: 'Full 3D Chess Academy & Studio',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    startFen: game.startFen,
    fen: toFEN(game.state),
    pgn: buildPGN(),
    sanMoves: [...game.state.sanMoves],
    uciMoves: game.state.history.map((h) => uciOf(h.move)),
    status: {
      over: status.over,
      result: status.result,
      reason: status.reason,
      check: status.check,
    },
    puzzles: {
      solved: [...UI.puzzle.solvedIds],
      streak: UI.puzzle.streak,
      best: UI.puzzle.best,
    },
    credits: {
      tool: 'OpenCode',
      toolURL: 'https://opencode.ai',
      model: 'DeepSeek V4.1 Flash',
      modelID: 'opencode-go/deepseek-v4.1-flash',
      engine: 'Three.js 0.169.0',
    },
    privacy: 'Generated locally. No data left this browser.',
  }, null, 2);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportPGN() {
  if (!game.state.sanMoves.length) {
    toast(t('toast.exportEmpty'), 'warn');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  download(`full-3d-chess-${date}.pgn`, buildPGN(), 'application/x-chess-pgn');
  toast(t('toast.exportPgn'));
}

function exportJSON() {
  const date = new Date().toISOString().slice(0, 10);
  download(`full-3d-chess-${date}.json`, buildExportJSON(), 'application/json');
  toast(t('toast.exportJson'));
}

/* ----------------------------- persistence ------------------------------- */

function saveState() {
  Store.write({
    v: 2,
    lang: UI.lang,
    sound: UI.sound,
    tips: UI.tips,
    guard: UI.guard,
    coords: UI.coords,
    motion: UI.motion,
    vsBot: UI.vsBot,
    botLevel: UI.botLevel,
    humanColor: UI.humanColor,
    game: {
      startFen: game.startFen,
      moves: game.state.history.map((h) => uciOf(h.move)),
    },
    puzzles: {
      solved: [...UI.puzzle.solvedIds],
      streak: UI.puzzle.streak,
      best: UI.puzzle.best,
    },
  });
}

function restoreSavedGame(saved) {
  if (!saved || !saved.game || !Array.isArray(saved.game.moves) || !saved.game.moves.length) return false;
  const startFen = typeof saved.game.startFen === 'string' ? saved.game.startFen : START_FEN;
  let state;
  try {
    state = createState(startFen);
  } catch (e) {
    return false;
  }
  for (const uci of saved.game.moves) {
    const raw = String(uci).toLowerCase();
    const from = nameToSq(raw.slice(0, 2));
    const to = nameToSq(raw.slice(2, 4));
    const promo = raw.length > 4 ? raw[4].toUpperCase() : null;
    if (from < 0 || to < 0) return false;
    const legal = legalMoves(state);
    const move = legal.find((m) => m.from === from && m.to === to && (promo ? m.promo === promo : !m.promo));
    if (!move) return false;
    const san = moveToSAN(state, move);
    applyMove(state, move);
    state.sanMoves.push(san);
  }
  game.state = state;
  game.startFen = startFen;
  const last = state.history[state.history.length - 1];
  UI.lastMove = last ? { from: last.move.from, to: last.move.to } : null;
  return true;
}

/* ==========================================================================
   6. INTERFACE
   ========================================================================== */

function cacheElements() {
  const $ = (id) => document.getElementById(id);
  UI.els = {
    stage: $('stage'),
    canvas: $('board-canvas'),
    turnPill: $('turn-pill'),
    turnDot: $('turn-dot'),
    turnLabel: $('turn-label'),
    statusChip: $('status-chip'),
    stageMode: $('stage-mode'),
    stageTurn: $('stage-turn'),
    stageCheck: $('stage-check'),
    stageBot: $('stage-bot'),
    camLabel: $('cam-label'),
    botBadge: $('bot-badge'),
    botSettings: $('bot-settings'),
    botNote: $('bot-note'),
    matchNote: $('match-note'),
    inspector: $('inspector'),
    inspectorGlyph: $('inspector-glyph'),
    inspectorColor: $('inspector-color'),
    inspectorName: $('inspector-name'),
    inspectorMeta: $('inspector-meta'),
    inspectorRules: $('inspector-rules'),
    inspectorTags: $('inspector-tags'),
    coachPrimary: $('coach-tip-primary'),
    coachSecondary: $('coach-tip-secondary'),
    coachChecklist: $('coach-checklist'),
    lessonGlyph: $('lesson-glyph'),
    lessonName: $('lesson-name'),
    lessonBody: $('lesson-body'),
    puzzleList: $('puzzle-list'),
    puzzleSolved: $('puzzle-solved'),
    puzzleTotal: $('puzzle-total'),
    puzzleStreak: $('puzzle-streak'),
    puzzleBest: $('puzzle-best'),
    puzzleMeter: $('puzzle-meter'),
    puzzleStatus: $('puzzle-status'),
    puzzleExit: $('btn-puzzle-exit'),
    moveList: $('move-list'),
    moveEmpty: $('move-empty'),
    moveCount: $('move-count'),
    capturedWhite: $('captured-white'),
    capturedBlack: $('captured-black'),
    capturedByWhite: $('captured-by-white'),
    capturedByBlack: $('captured-by-black'),
    materialLabel: $('material-label'),
    materialDots: $('material-dots'),
    matchMoves: $('match-moves'),
    matchSide: $('match-side'),
    matchDot: $('match-dot'),
    matchReason: $('match-reason'),
    toast: $('toast'),
    studioPuzzles: $('studio-puzzles'),
    blunderModal: $('modal-blunder'),
    blunderEn: $('blunder-en'),
    blunderTh: $('blunder-th'),
    gameoverModal: $('modal-gameover'),
    gameoverTitle: $('gameover-title'),
    gameoverReason: $('gameover-reason'),
    gameoverReasonTh: $('gameover-reason-th'),
    gameoverIcon: $('gameover-icon'),
    puzzleModal: $('modal-puzzle'),
    puzzleModalBody: $('puzzle-modal-body'),
    puzzleModalBodyTh: $('puzzle-modal-body-th'),
    puzzleModalTitle: $('puzzle-modal-title'),
    promotionModal: $('modal-promotion'),
    confirmModal: $('modal-confirm'),
    confirmTitle: $('confirm-title'),
    confirmBody: $('confirm-body'),
    btnConfirmYes: $('btn-confirm-yes'),
    helpModal: $('modal-help'),
    btnUndo: $('btn-undo'),
    btnHint: $('btn-hint'),
    btnInspect: $('btn-inspect'),
    btnSound: $('btn-sound'),
    soundUse: $('sound-use'),
    toggleGuard: $('toggle-guard'),
    toggleTips: $('toggle-tips'),
    toggleCoords: $('toggle-coords'),
    toggleMotion: $('toggle-motion'),
  };
}

/* ----------------------------- i18n apply -------------------------------- */

function applyStaticTranslations() {
  document.documentElement.lang = UI.lang;
  document.title = UI.lang === 'th'
    ? 'Full 3D Chess Academy & Studio — สตูดิโอหมากรุก 3 มิติ'
    : 'Full 3D Chess Academy & Studio';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    });
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === UI.lang);
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === UI.lang));
  });
  document.body.classList.toggle('hide-alt-tips', !UI.tips);
}

function setLang(lang, { announce = false, persist = true } = {}) {
  UI.lang = lang === 'th' ? 'th' : 'en';
  applyStaticTranslations();
  buildPuzzleList();
  refreshAll();
  if (UI.lastBlunder && !UI.els.blunderModal.hidden) showBlunderModal(UI.lastBlunder);
  if (UI.gameOver && !UI.els.gameoverModal.hidden) showGameOver(true);
  if (UI.puzzle.lastSolved && !UI.els.puzzleModal.hidden) showPuzzleSolved(UI.puzzle.lastSolved);
  if (UI.confirmData && !UI.els.confirmModal.hidden) renderConfirm();
  if (persist) saveState();
  if (announce) {
    toast(UI.lang === 'th' ? 'เปลี่ยนภาษาเป็นไทยแล้ว' : 'Language set to English.');
  }
}

/* ----------------------------- status ------------------------------------ */

function resultText(status) {
  if (!status || !status.over) return '';
  if (status.reason === 'checkmate') return t('result.checkmate', { side: sideLabel(status.winner) });
  return t('result.' + status.reason);
}

function resultTextFor(status, lang) {
  if (!status || !status.over) return '';
  const dict = I18N[lang] || I18N.en;
  const side = status.winner === 'w'
    ? (lang === 'th' ? 'ขาว' : 'White')
    : (lang === 'th' ? 'ดำ' : 'Black');
  if (status.reason === 'checkmate') return dict['result.checkmate'].replace('{side}', side);
  return dict['result.' + status.reason] || '';
}

function turnText() {
  const state = activeState();
  const status = UI.mode === 'puzzle' ? UI.puzzle.status : game.status;
  if (UI.mode === 'puzzle' && UI.puzzle.noteKind === 'solved') return t('status.solved');
  if (UI.mode === 'play' && status && status.over) {
    if (status.result === '1-0') return t('status.whiteWins');
    if (status.result === '0-1') return t('status.blackWins');
    return t('status.draw');
  }
  return state.turn === 'w' ? t('status.whiteToMove') : t('status.blackToMove');
}

function statusChipText() {
  const status = UI.mode === 'puzzle' ? UI.puzzle.status : game.status;
  if (UI.mode === 'puzzle' && UI.puzzle.noteKind === 'solved') return t('status.solved');
  if (UI.mode === 'puzzle') return t('status.drill');
  if (status && status.over) {
    if (status.reason === 'checkmate') return t('status.checkmate');
    if (status.reason === 'stalemate') return t('status.stalemate');
    return t('status.draw');
  }
  if (status && status.check) return t('status.check');
  return t('status.live');
}

function updateStatusBar() {
  const state = activeState();
  const status = UI.mode === 'puzzle' ? UI.puzzle.status : game.status;
  const isOver = UI.mode === 'play' && status && status.over;
  const label = UI.vsBot && UI.botThinking ? t('bot.thinking') : turnText();

  UI.els.turnLabel.textContent = label;
  UI.els.stageTurn.textContent = label;
  UI.els.matchSide.textContent = label;

  UI.els.turnDot.classList.toggle('is-black', !isOver && state.turn === 'b');
  UI.els.matchDot.classList.toggle('is-black', !isOver && state.turn === 'b');

  UI.els.statusChip.textContent = statusChipText();
  UI.els.statusChip.dataset.tone = isOver ? 'over' : status && status.check ? 'check' : UI.mode === 'puzzle' && UI.puzzle.noteKind === 'solved' ? 'live' : 'live';

  UI.els.stageCheck.hidden = !(status && status.check);
  UI.els.stageBot.hidden = !(UI.vsBot && UI.botThinking);

  UI.els.matchMoves.textContent = t('match.moveCount', { n: state.sanMoves.length });

  if (isOver) {
    UI.els.matchReason.hidden = false;
    UI.els.matchReason.textContent = resultText(status);
  } else {
    UI.els.matchReason.hidden = true;
    UI.els.matchReason.textContent = '';
  }
}

/* ----------------------------- move list --------------------------------- */

function updateMoveList() {
  const moves = game.state.sanMoves;
  UI.els.moveCount.textContent = String(moves.length);
  UI.els.moveList.innerHTML = '';
  UI.els.moveEmpty.hidden = moves.length > 0;

  const lastIndex = moves.length - 1;
  for (let i = 0; i < moves.length; i += 2) {
    const tr = document.createElement('tr');
    const numTd = document.createElement('td');
    numTd.className = 'num';
    numTd.textContent = `${i / 2 + 1}.`;
    tr.appendChild(numTd);

    const whiteTd = document.createElement('td');
    whiteTd.className = 'san';
    whiteTd.textContent = moves[i];
    if (i === lastIndex) {
      tr.classList.add('is-latest');
      whiteTd.setAttribute('aria-current', 'true');
    }
    tr.appendChild(whiteTd);

    const blackTd = document.createElement('td');
    blackTd.className = 'san';
    blackTd.textContent = moves[i + 1] || '';
    if (i + 1 === lastIndex) tr.classList.add('is-latest');
    tr.appendChild(blackTd);
    UI.els.moveList.appendChild(tr);
  }

  const status = game.status;
  if (status && status.over) {
    const tr = document.createElement('tr');
    tr.className = 'result-row';
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = `${status.result} · ${resultText(status)}`;
    tr.appendChild(td);
    UI.els.moveList.appendChild(tr);
  }
}

/* ----------------------------- captured ---------------------------------- */

function capturedFor(color) {
  const initial = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
  const missing = { ...initial };
  for (const p of activeState().board) {
    if (p && p.color === color) missing[p.type] -= 1;
  }
  const out = [];
  for (const type of ['Q', 'R', 'B', 'N', 'P']) {
    for (let i = 0; i < Math.max(0, missing[type]); i++) out.push(type);
  }
  return out;
}

function setCaptured(container, pieces, color) {
  if (!container) return;
  container.innerHTML = '';
  if (!pieces.length) {
    const span = document.createElement('span');
    span.className = 'empty-note';
    span.textContent = t('moves.none');
    container.appendChild(span);
    return;
  }
  for (const type of pieces) {
    const span = document.createElement('span');
    span.className = color === 'w' ? 'is-white' : 'is-black';
    span.textContent = GLYPHS[color][type];
    span.title = pieceName(type);
    container.appendChild(span);
  }
}

function updateCaptured() {
  const byWhite = capturedFor('b');
  const byBlack = capturedFor('w');
  setCaptured(UI.els.capturedWhite, byWhite, 'b');
  setCaptured(UI.els.capturedBlack, byBlack, 'w');
  setCaptured(UI.els.capturedByWhite, byWhite, 'b');
  setCaptured(UI.els.capturedByBlack, byBlack, 'w');

  let whiteScore = 0;
  let blackScore = 0;
  for (const p of activeState().board) {
    if (!p) continue;
    if (p.color === 'w') whiteScore += PIECE_VALUE[p.type];
    else blackScore += PIECE_VALUE[p.type];
  }
  const diff = whiteScore - blackScore;
  let label = t('match.even');
  if (diff > 0) label = `${t('match.whiteAhead')} +${diff}`;
  else if (diff < 0) label = `${t('match.blackAhead')} +${-diff}`;
  UI.els.materialLabel.textContent = label;

  UI.els.materialDots.innerHTML = '';
  const total = whiteScore + blackScore;
  const whiteShare = total ? whiteScore / total : 0.5;
  const segments = 12;
  const filled = Math.round(whiteShare * segments);
  for (let i = 0; i < segments; i++) {
    const seg = document.createElement('span');
    if (i < filled) seg.className = 'is-white';
    else seg.className = 'is-black';
    UI.els.materialDots.appendChild(seg);
  }
}

/* ----------------------------- coach ------------------------------------- */

function isCastled(state, color) {
  const king = findKing(state.board, color);
  const home = color === 'w' ? 6 : 62;
  const queenSide = color === 'w' ? 2 : 58;
  return king === home || king === queenSide;
}

function centreCount(state, color) {
  const centre = [27, 28, 35, 36];
  return centre.reduce((n, sq) => {
    const p = state.board[sq];
    return n + (p && p.color === color ? 1 : 0);
  }, 0);
}

function developedCount(state, color) {
  const home = color === 'w' ? [1, 6, 2, 5] : [57, 62, 58, 61];
  let n = 0;
  for (const sq of home) {
    const p = state.board[sq];
    if (!p || p.type === 'P') n++;
  }
  return n;
}

function coachContext() {
  const state = activeState();
  const status = UI.mode === 'puzzle' ? UI.puzzle.status : game.status;
  const color = state.turn;
  const threats = UI.mode === 'play' && status && !status.over ? threatsForKey(state) : { mate: null, best: null };
  const castled = isCastled(state, color);
  const centre = centreCount(state, color);
  const developed = developedCount(state, color);
  const canCastle = legalMoves(state, color).some((m) => m.castle);
  return { state, status, color, threats, castled, centre, developed, canCastle };
}

function pickCoachTip(ctx) {
  if (UI.mode === 'puzzle') {
    const p = currentPuzzle();
    if (!p) return COACH_TIPS.welcome;
    return { en: p.goal.en, th: p.goal.th };
  }
  const { state, status, threats, castled, centre, developed, canCastle } = ctx;
  if (status && status.over) {
    return { en: resultTextFor(status, 'en'), th: resultTextFor(status, 'th') };
  }
  if (status && status.check) return COACH_TIPS.check;
  if (UI.inspectOnly) return COACH_TIPS.inspection;
  if (threats.mate) {
    return {
      en: `You have a mate in one: ${threats.mate.san}. Check every escape square first.`,
      th: `คุณมีรุกจนในหนึ่งตา: ${threats.mate.san} ตรวจช่องหนีให้ครบก่อน`,
    };
  }
  if (threats.best && threats.best.gain >= 3) {
    const b = threats.best;
    return {
      en: `${sideLabel(b.move.color === 'w' ? 'b' : 'w')}'s ${pieceName(b.move.captured)} on ${sqName(b.move.to)} is there for the taking: ${b.san}.`,
      th: `${pieceName(b.move.captured)}ของอีกฝ่ายที่ ${sqName(b.move.to)} กินได้: ${b.san}`,
    };
  }
  if (state.sanMoves.length < 12) {
    if (!castled && canCastle) return COACH_TIPS.castle;
    if (developed < 2) return COACH_TIPS.develop;
    if (centre < 2) return COACH_TIPS.center;
  }
  if (state.sanMoves.length > 40) return COACH_TIPS.endgame;
  const pool = [COACH_TIPS.center, COACH_TIPS.develop, COACH_TIPS.knight, COACH_TIPS.rook, COACH_TIPS.queen, COACH_TIPS.pawns, COACH_TIPS.trade];
  return pool[state.full % pool.length];
}

function coachChecklist(ctx) {
  const { status, castled, centre, developed, threats } = ctx;
  const items = [];
  const add = (en, th, tone = 'ok') => items.push({ en, th, tone });

  if (status && status.check) {
    add('You are in check — move the king, block, or capture.', 'คุณถูกขัด — เดินราชาหนี กันแนว หรือกินตัวรุก', 'danger');
  } else {
    add('Your king is not under immediate check.', 'ราชาของคุณยังไม่ถูกขัดในทันที', 'ok');
  }

  if (castled) add('King is castled — keep the pawns in front of him.', 'ราชาเข้าปราสาทแล้ว — รักษาเบี้ยหน้าเขาไว้', 'ok');
  else if (ctx.canCastle) add('Castling is available. King safety first.', 'เข้าปราสาทได้ ปลอดภัยไว้ก่อน', 'warn');
  else add('Look for a safe way to shelter the king.', 'หาทางป้องกันราชาให้ปลอดภัย', 'muted');

  if (centre >= 2) add(`You hold ${centre} of the 4 centre squares.`, `คุณยึด ${centre} จาก 4 ช่องกลาง`, 'ok');
  else add('Contest the centre: e4, d4, e5, d5.', 'แย่งชิงศูนย์กลาง: e4 d4 e5 d5', 'warn');

  if (developed >= 3) add('Your minor pieces are active.', 'หมากเล็กของคุณออกทำงานแล้ว', 'ok');
  else add('Develop knights and bishops before attacking.', 'พัฒนาม้าและบิชอปก่อนโจมตี', 'muted');

  if (threats.mate) add('Opponent has a mate in one — defend now.', 'อีกฝ่ายมีรุกจนในหนึ่งตา — ป้องกันทันที', 'danger');
  else if (threats.best && threats.best.gain >= 3) add(`Free capture available: ${threats.best.san}.`, `กินฟรีได้: ${threats.best.san}`, 'ok');

  return items.slice(0, 4);
}

let cachedCoachKey = null;
let cachedCoachData = null;

function updateCoach() {
  const state = activeState();
  const key = positionKey(state) + '|' + UI.lang + '|' + UI.mode + '|' + UI.inspectOnly;
  if (key === cachedCoachKey && cachedCoachData) {
    // Still cheap to paint; avoids recomputing threats on every resize.
  }
  const ctx = coachContext();
  const tip = pickCoachTip(ctx);
  const other = UI.lang === 'th' ? 'en' : 'th';

  UI.els.coachPrimary.textContent = tip[UI.lang];
  UI.els.coachPrimary.lang = UI.lang;
  UI.els.coachSecondary.textContent = tip[other];
  UI.els.coachSecondary.lang = other;

  UI.els.coachChecklist.innerHTML = '';
  for (const item of coachChecklist(ctx)) {
    const li = document.createElement('li');
    li.dataset.tone = item.tone;
    li.textContent = item[UI.lang];
    li.lang = UI.lang;
    UI.els.coachChecklist.appendChild(li);
  }

  const lesson = LESSONS[(Math.floor(state.sanMoves.length / 4) + (UI.mode === 'puzzle' ? 2 : 0)) % LESSONS.length];
  UI.els.lessonGlyph.textContent = lesson.glyph;
  UI.els.lessonName.textContent = lesson.name[UI.lang];
  UI.els.lessonBody.textContent = lesson.body[UI.lang];

  cachedCoachKey = key;
  cachedCoachData = ctx;
}

/* ----------------------------- inspector --------------------------------- */

function showInspector(square) {
  const state = activeState();
  const piece = state.board[square];
  if (!piece) return;
  const info = PIECE_INFO[piece.type];

  UI.els.inspector.hidden = false;
  UI.els.inspectorGlyph.textContent = GLYPHS[piece.color][piece.type];
  UI.els.inspectorGlyph.classList.toggle('is-black', piece.color === 'b');
  UI.els.inspectorColor.textContent = sideLabel(piece.color);
  UI.els.inspectorName.textContent = pieceName(piece.type);
  UI.els.inspectorMeta.textContent = `${sqName(square)} · ${info.value} ${t('inspector.points')}`;
  UI.els.inspectorRules.textContent = info[UI.lang];

  UI.els.inspectorTags.innerHTML = '';
  const tags = [
    { text: sideLabel(piece.color), cls: piece.color === 'w' ? 'tag-gold' : 'tag' },
    { text: `${t('inspector.value')}: ${info.value}`, cls: 'tag' },
    { text: t('inspector.' + (piece.type === 'N' ? 'jumps' : piece.type === 'K' || piece.type === 'R' ? 'royal' : piece.type === 'P' ? 'pawn' : 'slides')), cls: 'tag-teal' },
  ];
  for (const tag of tags) {
    const span = document.createElement('span');
    span.className = 'tag ' + (tag.cls === 'tag' ? '' : tag.cls);
    span.textContent = tag.text;
    UI.els.inspectorTags.appendChild(span);
  }
}

function updateInspector() {
  if (UI.selected == null) {
    if (UI.els.inspector) UI.els.inspector.hidden = true;
    return;
  }
  const piece = activeState().board[UI.selected];
  if (!piece) {
    if (UI.els.inspector) UI.els.inspector.hidden = true;
    return;
  }
  showInspector(UI.selected);
}

/* ----------------------------- mode / buttons ---------------------------- */

function updateModeUI() {
  const modeText = UI.mode === 'puzzle'
    ? t('stage.puzzle')
    : UI.inspectLens
      ? t('stage.inspect')
      : t('stage.play');
  UI.els.stageMode.textContent = modeText;
  UI.els.btnInspect.setAttribute('aria-pressed', String(UI.inspectLens));
  UI.els.stage.classList.toggle('is-inspect', UI.inspectLens);
  UI.els.puzzleExit.hidden = UI.mode !== 'puzzle';
}

function updateButtons() {
  const noHistory = UI.mode === 'puzzle' || game.state.history.length === 0;
  UI.els.btnUndo.disabled = noHistory;
  UI.els.btnSound.setAttribute('aria-pressed', String(UI.sound));
  UI.els.soundUse.setAttribute('href', UI.sound ? '#i-sound' : '#i-mute');
  const botTurn = UI.vsBot && (UI.botThinking || game.state.turn === botColor());
  if (UI.els.btnHint) UI.els.btnHint.disabled = botTurn || (game.status && game.status.over);
}

/* ----------------------------- puzzles UI -------------------------------- */

function buildPuzzleList() {
  if (!UI.els.puzzleList) return;
  UI.els.puzzleList.innerHTML = '';
  PUZZLES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'puzzle-item';
    btn.dataset.id = p.id;
    btn.setAttribute('aria-pressed', String(UI.puzzle.activeId === p.id));
    if (UI.puzzle.solvedIds.includes(p.id)) btn.classList.add('is-solved');

    const num = document.createElement('span');
    num.className = 'puzzle-num';
    num.textContent = String(i + 1).padStart(2, '0');

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'puzzle-item-title';
    title.textContent = p.title ? p.title[UI.lang] : p.id;
    const goal = document.createElement('span');
    goal.className = 'puzzle-item-goal';
    goal.textContent = p.goal ? p.goal[UI.lang] : '';
    text.appendChild(title);
    text.appendChild(goal);

    const tag = document.createElement('span');
    tag.className = 'puzzle-tag' + (i === 2 ? ' is-hard' : '');
    tag.textContent = UI.puzzle.solvedIds.includes(p.id) ? '✓' : (i === 2 ? '♞' : '♔');
    tag.setAttribute('aria-hidden', 'true');

    btn.append(num, text, tag);
    UI.els.puzzleList.appendChild(btn);
  });
  UI.els.puzzleTotal.textContent = String(PUZZLES.length);
  if (UI.els.studioPuzzles) UI.els.studioPuzzles.textContent = String(PUZZLES.length);
}

function updatePuzzleUI() {
  if (!UI.els.puzzleSolved) return;
  const solvedCount = PUZZLES.filter((p) => UI.puzzle.solvedIds.includes(p.id)).length;
  UI.els.puzzleSolved.textContent = String(solvedCount);
  UI.els.puzzleStreak.textContent = String(UI.puzzle.streak);
  UI.els.puzzleBest.textContent = String(UI.puzzle.best);

  const pct = PUZZLES.length ? Math.round((solvedCount / PUZZLES.length) * 100) : 0;
  UI.els.puzzleMeter.style.setProperty('--pct', String(pct));
  const label = UI.els.puzzleMeter.querySelector('span');
  if (label) label.textContent = pct + '%';

  UI.els.puzzleList.querySelectorAll('.puzzle-item').forEach((btn) => {
    const solved = UI.puzzle.solvedIds.includes(btn.dataset.id);
    btn.classList.toggle('is-solved', solved);
    btn.setAttribute('aria-pressed', String(UI.puzzle.activeId === btn.dataset.id));
    const tag = btn.querySelector('.puzzle-tag');
    const index = PUZZLES.findIndex((p) => p.id === btn.dataset.id);
    if (tag) tag.textContent = solved ? '✓' : (index === 2 ? '♞' : '♔');
  });

  UI.els.puzzleExit.hidden = UI.mode !== 'puzzle';

  const puzzle = currentPuzzle();
  if (UI.mode !== 'puzzle' || !puzzle) {
    UI.els.puzzleStatus.textContent = t('puzzle.pick');
    UI.els.puzzleStatus.lang = UI.lang;
    return;
  }

  let note;
  switch (UI.puzzle.noteKind) {
    case 'hint': note = puzzle.hint ? puzzle.hint[UI.lang] : t('toast.puzzleHint'); break;
    case 'wrong': note = t('toast.puzzleWrong'); break;
    case 'solved': note = t('puzzle.solvedStatus', { n: UI.puzzle.streak }); break;
    default: note = puzzle.goal ? puzzle.goal[UI.lang] : '';
  }
  UI.els.puzzleStatus.textContent = note;
  UI.els.puzzleStatus.lang = UI.lang;
}

/* ----------------------------- modals ------------------------------------ */

function showConfirm({ titleKey, bodyKey, yesKey, vars = {}, onYes }) {
  UI.confirmData = { titleKey, bodyKey, yesKey, vars, onYes };
  renderConfirm();
  openModal('modal-confirm');
}

function renderConfirm() {
  const d = UI.confirmData;
  if (!d) return;
  const vars = { ...d.vars };
  if (vars.sideColor) {
    vars.side = sideLabel(vars.sideColor);
    delete vars.sideColor;
  }
  if (vars.levelKey) {
    vars.level = t(vars.levelKey);
    delete vars.levelKey;
  }
  UI.els.confirmTitle.textContent = t(d.titleKey, vars);
  UI.els.confirmBody.textContent = t(d.bodyKey, vars);
  UI.els.btnConfirmYes.textContent = t(d.yesKey || 'confirm.yes');
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  const focusTarget = modal.querySelector('button');
  if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 40);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;
  if (!anyModalOpen()) setTimeout(() => maybeBotTurn(300), 90);
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
}

function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

function topModal() {
  const open = [...document.querySelectorAll('.modal')].filter((m) => !m.hidden);
  return open.length ? open[open.length - 1] : null;
}

function showGameOver(repaint = false) {
  const status = UI.gameOver;
  if (!status) return;
  const title = status.reason === 'checkmate'
    ? (status.winner === 'w' ? t('status.whiteWins') : t('status.blackWins'))
    : status.reason === 'stalemate'
      ? t('status.stalemate')
      : t('status.draw');
  UI.els.gameoverTitle.textContent = title;
  UI.els.gameoverReason.textContent = resultTextFor(status, UI.lang);
  UI.els.gameoverReason.lang = UI.lang;
  UI.els.gameoverReasonTh.textContent = resultTextFor(status, UI.lang === 'th' ? 'en' : 'th');
  UI.els.gameoverReasonTh.lang = UI.lang === 'th' ? 'en' : 'th';
  UI.els.gameoverIcon.textContent = status.reason === 'checkmate' ? '♔' : '½';
  if (repaint) return;
  openModal('modal-gameover');
}

/* ----------------------------- toast / flash ----------------------------- */

let toastTimer = null;

function toast(message, tone = 'info') {
  const el = UI.els.toast;
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-show');
    setTimeout(() => { el.hidden = true; }, 260);
  }, 3000);
}

function flashStage() {
  UI.els.stage.classList.remove('is-shake');
  void UI.els.stage.offsetWidth;
  UI.els.stage.classList.add('is-shake');
  setTimeout(() => UI.els.stage.classList.remove('is-shake'), 420);
}

/* ----------------------------- tabs -------------------------------------- */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const active = panel.id === 'panel-' + name;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
}

/* ----------------------------- refresh ----------------------------------- */

function refreshAll() {
  const state = activeState();
  const status = gameStatus(state);
  if (UI.mode === 'puzzle') UI.puzzle.status = status;
  else game.status = status;

  updateStatusBar();
  updateMoveList();
  updateCaptured();
  updateCoach();
  updateInspector();
  updatePuzzleUI();
  updateModeUI();
  updateButtons();
  updateOpponentUI();
  renderHighlights();
  labelsGroup.visible = UI.coords;
  document.body.classList.toggle('hide-alt-tips', !UI.tips);
}

/* ==========================================================================
   7. EVENTS & BOOT
   ========================================================================== */

function bindEvents() {
  // Language
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.lang !== UI.lang) {
        Sound.play('lift');
        setLang(btn.dataset.lang, { announce: true });
      }
    });
  });

  // Sound
  UI.els.btnSound.addEventListener('click', () => {
    UI.sound = !UI.sound;
    Sound.enabled = UI.sound;
    if (UI.sound) { Sound.ensure(); Sound.play('lift'); }
    updateButtons();
    saveState();
    toast(t(UI.sound ? 'toast.soundOn' : 'toast.soundOff'));
  });

  // Help
  document.getElementById('btn-help').addEventListener('click', () => openModal('modal-help'));
  document.getElementById('btn-help-close').addEventListener('click', () => closeModal('modal-help'));

  // Tabs
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('.tab')];
      const i = tabs.indexOf(tab);
      const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  });

  // Puzzle list (delegated)
  UI.els.puzzleList.addEventListener('click', (event) => {
    const item = event.target.closest('.puzzle-item');
    if (item && item.dataset.id) loadPuzzle(item.dataset.id);
  });
  document.getElementById('btn-puzzle-hint').addEventListener('click', showPuzzleHint);
  document.getElementById('btn-puzzle-retry').addEventListener('click', retryPuzzle);
  UI.els.puzzleExit.addEventListener('click', exitPuzzle);
  document.getElementById('btn-puzzle-next').addEventListener('click', () => { closeModal('modal-puzzle'); nextPuzzle(); });
  document.getElementById('btn-puzzle-close').addEventListener('click', () => closeModal('modal-puzzle'));

  // Dock
  document.getElementById('btn-new').addEventListener('click', requestNewGame);
  UI.els.btnUndo.addEventListener('click', undoLast);
  UI.els.btnInspect.addEventListener('click', toggleInspectLens);
  document.getElementById('btn-hint').addEventListener('click', requestHint);

  // Opponent
  document.querySelectorAll('[data-opponent]').forEach((btn) => {
    btn.addEventListener('click', () => {
      Sound.play('lift');
      setVsBot(btn.dataset.opponent === 'bot');
    });
  });
  document.querySelectorAll('[data-side]').forEach((btn) => {
    btn.addEventListener('click', () => setHumanColor(btn.dataset.side));
  });
  document.querySelectorAll('[data-level]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setBotLevel(btn.dataset.level);
      Sound.play('lift');
    });
  });
  document.getElementById('btn-bot-start').addEventListener('click', requestNewGame);

  // Camera
  document.querySelectorAll('[data-cam]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setCamera(btn.dataset.cam === 'reset' ? 'studio' : btn.dataset.cam);
    });
  });
  document.getElementById('btn-cam-cycle').addEventListener('click', () => {
    const idx = cameraCycle.indexOf(UI.cameraPreset);
    setCamera(cameraCycle[(idx + 1) % cameraCycle.length]);
  });

  // Toggles
  UI.els.toggleGuard.addEventListener('change', () => {
    UI.guard = UI.els.toggleGuard.checked;
    saveState();
    if (!UI.guard) toast(t('toast.guardOff'), 'warn');
    updateCoach();
  });
  UI.els.toggleTips.addEventListener('change', () => {
    UI.tips = UI.els.toggleTips.checked;
    document.body.classList.toggle('hide-alt-tips', !UI.tips);
    saveState();
  });
  UI.els.toggleCoords.addEventListener('change', () => {
    UI.coords = UI.els.toggleCoords.checked;
    labelsGroup.visible = UI.coords;
    saveState();
  });
  UI.els.toggleMotion.addEventListener('change', () => {
    UI.motion = UI.els.toggleMotion.checked;
    controls.autoRotate = false;
    saveState();
  });

  // Exports
  ['btn-export-pgn', 'btn-export-pgn-2'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', exportPGN);
  });
  ['btn-export-json', 'btn-export-json-2'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', exportJSON);
  });

  // Coach refresh
  document.getElementById('btn-coach-refresh').addEventListener('click', () => {
    threatsForKey(game.state);
    updateCoach();
    toast(t('toast.coachRefreshed'));
  });

  // Promotion
  document.querySelectorAll('[data-promo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pending = UI.pendingPromo;
      if (!pending) return;
      const move = pending.find((m) => m.promo === btn.dataset.promo);
      closeModal('modal-promotion');
      UI.pendingPromo = null;
      if (!move) return;
      if (UI.mode === 'puzzle') playPuzzleMove(move);
      else commitGameMove(move);
    });
  });
  document.getElementById('btn-promo-cancel').addEventListener('click', () => {
    closeModal('modal-promotion');
    UI.pendingPromo = null;
    renderHighlights();
  });

  // Blunder guard
  document.getElementById('btn-blunder-undo').addEventListener('click', () => {
    closeModal('modal-blunder');
    UI.lastBlunder = null;
    undoLast();
  });
  document.getElementById('btn-blunder-keep').addEventListener('click', () => {
    closeModal('modal-blunder');
    UI.lastBlunder = null;
    toast(t('toast.blunderKept'), 'warn');
    updateCoach();
    if (UI.vsBot) maybeBotTurn(320);
  });

  // Game over
  document.getElementById('btn-gameover-new').addEventListener('click', () => {
    closeModal('modal-gameover');
    startNewGame();
  });
  document.getElementById('btn-gameover-review').addEventListener('click', () => closeModal('modal-gameover'));

  // Confirm
  document.getElementById('btn-confirm-yes').addEventListener('click', () => {
    const data = UI.confirmData;
    UI.confirmData = null;
    closeModal('modal-confirm');
    if (data && typeof data.onYes === 'function') data.onYes();
  });
  document.getElementById('btn-confirm-no').addEventListener('click', () => {
    UI.confirmData = null;
    closeModal('modal-confirm');
  });

  // Inspector close
  document.getElementById('inspector-close').addEventListener('click', () => clearSelection());

  // Modals: backdrop dismiss
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      if (modal.id === 'modal-promotion') {
        UI.pendingPromo = null;
        renderHighlights();
      }
      if (modal.id === 'modal-blunder') UI.lastBlunder = null;
      if (modal.id === 'modal-confirm') UI.confirmData = null;
      closeModal(modal.id);
    });
  });

  // Canvas interaction
  let press = null;
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
  canvasEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    press = { x: e.clientX, y: e.clientY, time: performance.now() };
    idleSince = performance.now();
    hoverRing.material.opacity = 0;
    Sound.ensure();
  });
  canvasEl.addEventListener('pointermove', (e) => {
    idleSince = performance.now();
    if (e.buttons === 0) updateHover(e.clientX, e.clientY);
  });
  canvasEl.addEventListener('pointerleave', () => { hoverRing.material.opacity = 0; });
  canvasEl.addEventListener('pointerup', (e) => {
    if (!press) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    const moved = Math.hypot(dx, dy) > 7 || performance.now() - press.time > 900;
    press = null;
    idleSince = performance.now();
    if (moved) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) onSquareClick(hit.square);
  });

  controls.addEventListener('start', () => {
    idleSince = performance.now();
    camTween.active = false;
    hoverRing.material.opacity = 0;
  });

  // Keyboard
  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (event.key === 'Escape') {
      if (!UI.els.promotionModal.hidden) {
        UI.pendingPromo = null;
        closeModal('modal-promotion');
        renderHighlights();
        return;
      }
      const modal = topModal();
      if (modal) { closeModal(modal.id); return; }
      if (UI.selected != null) clearSelection();
      return;
    }

    if (anyModalOpen()) return;
    const key = event.key.toLowerCase();
    if (key === 'u') { event.preventDefault(); undoLast(); }
    else if (key === 'n') { event.preventDefault(); requestNewGame(); }
    else if (key === 'i') { event.preventDefault(); toggleInspectLens(); }
    else if (key === 'l') { event.preventDefault(); setLang(UI.lang === 'en' ? 'th' : 'en', { announce: true }); }
    else if (key === '1') setCamera('white');
    else if (key === '2') setCamera('black');
    else if (key === '3') setCamera('top');
    else if (event.key === '?') { event.preventDefault(); openModal('modal-help'); }
  });

  // Save on leave
  window.addEventListener('beforeunload', saveState);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveState();
  });

  // First gesture unlocks audio
  document.addEventListener('pointerdown', () => Sound.ensure(), { once: true });
}

function toggleInspectLens() {
  UI.inspectLens = !UI.inspectLens;
  updateModeUI();
  if (UI.selected != null) selectSquare(UI.selected);
  renderHighlights();
  toast(t(UI.inspectLens ? 'toast.inspectOn' : 'toast.inspectOff'));
  Sound.play('lift');
}

/* ----------------------------- boot -------------------------------------- */

function applyPreferences(saved) {
  if (!saved) return;
  UI.lang = saved.lang === 'th' ? 'th' : 'en';
  UI.sound = saved.sound !== false;
  UI.tips = saved.v >= 2 && saved.tips === true;
  UI.guard = saved.guard !== false;
  UI.coords = saved.coords !== false;
  UI.motion = saved.motion !== false;
  UI.vsBot = saved.vsBot === true;
  UI.botLevel = ['easy', 'club', 'strong'].includes(saved.botLevel) ? saved.botLevel : 'club';
  UI.humanColor = saved.humanColor === 'b' ? 'b' : 'w';
  Sound.enabled = UI.sound;
  if (saved.puzzles && Array.isArray(saved.puzzles.solved)) {
    UI.puzzle.solvedIds = saved.puzzles.solved.filter((id) => PUZZLES.some((p) => p.id === id));
    UI.puzzle.streak = Number(saved.puzzles.streak) || 0;
    UI.puzzle.best = Number(saved.puzzles.best) || 0;
  }
}

function showFatal() {
  const el = document.getElementById('cdn-error');
  const load = document.getElementById('loading');
  if (el) el.hidden = false;
  if (load) load.hidden = true;
}

function boot() {
  cacheElements();
  const saved = Store.read();
  applyPreferences(saved);

  UI.els.toggleGuard.checked = UI.guard;
  UI.els.toggleTips.checked = UI.tips;
  UI.els.toggleCoords.checked = UI.coords;
  UI.els.toggleMotion.checked = UI.motion;
  labelsGroup.visible = UI.coords;

  buildPuzzleList();
  applyStaticTranslations();

  const restored = restoreSavedGame(saved);
  game.status = gameStatus(game.state);
  UI.puzzle.noteKind = null;

  bindEvents();
  rebuildPieces({ animate: true });
  refreshAll();
  setCamera(UI.vsBot && UI.humanColor === 'b' ? 'black' : 'white', false);
  resizeScene();

  UI.booted = true;
  window.__CHESS_STUDIO_READY__ = true;
  requestAnimationFrame(renderLoop);

  const loading = document.getElementById('loading');
  setTimeout(() => {
    if (loading) loading.classList.add('is-gone');
    if (restored) toast(t('toast.restored'));
    if (UI.vsBot && !game.status.over && game.state.turn === botColor()) {
      setTimeout(() => maybeBotTurn(320), 700);
    }
  }, 780);

  if (saved && saved.game && saved.game.moves && saved.game.moves.length && !restored) {
    toast(t('toast.invalidSave'), 'warn');
  }
}

try {
  boot();
} catch (err) {
  console.error('The studio could not start', err);
  showFatal();
}

/* Expose a tiny debug surface for tests and curious players. */
window.ChessStudio = {
  game,
  ui: UI,
  puzzles: PUZZLES,
  engine: ENGINE_API,
  scene,
  camera,
  controls,
  renderer,
  rebuildPieces,
  refreshAll,
  loadPuzzle,
  setLang,
  commitGameMove,
  squarePos,
  screenPointForSquare,
  pieceMeshes,
  setCamera,
  selectSquare,
  undoLast,
  threatsForKey,
};
