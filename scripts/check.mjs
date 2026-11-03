#!/usr/bin/env node
/* Verification suite for Full 3D Chess Academy & Studio.
   No dependencies. Run with: node scripts/check.mjs */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ engine */

const source = read('script.js');
const engineCode = source.split('/* ENGINE:START */')[1]?.split('/* ENGINE:END */')[0];
if (!engineCode) {
  console.error('Engine markers not found in script.js');
  process.exit(1);
}
const E = new Function(engineCode + '\nreturn ENGINE_API;')();

const findMove = (state, from, to, promo = null) =>
  E.legalMoves(state).find((m) => m.from === E.nameToSq(from) && m.to === E.nameToSq(to) &&
    (promo ? m.promo === promo : !m.promo));

section('Engine · move generation');
let s = E.createState();
check('start position has 20 legal moves', E.legalMoves(s).length === 20, String(E.legalMoves(s).length));
check('perft depth 1 = 20', E.perft(E.createState(), 1) === 20);
check('perft depth 2 = 400', E.perft(E.createState(), 2) === 400);
check('perft depth 3 = 8902', E.perft(E.createState(), 3) === 8902);
const kiwipete = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
check('Kiwipete depth 1 = 48', E.perft(E.createState(kiwipete), 1) === 48);
check('Kiwipete depth 2 = 2039', E.perft(E.createState(kiwipete), 2) === 2039);

section('Engine · special rules');
s = E.createState('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
const epMove = findMove(s, 'e5', 'd6');
check('en passant is generated', !!epMove && epMove.ep === true);
if (epMove) {
  const san = E.moveToSAN(s, epMove);
  E.applyMove(s, epMove);
  check('en passant removes the captured pawn', s.board[E.nameToSq('d5')] === null && s.board[E.nameToSq('d6')]?.type === 'P');
  check('en passant SAN', san === 'exd6', san);
  E.undoMove(s);
  check('en passant undo restores the pawn', s.board[E.nameToSq('d5')]?.type === 'P' && s.board[E.nameToSq('d6')] === null);
}

s = E.createState('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
const castles = E.legalMoves(s).filter((m) => m.castle);
check('both castling moves are legal', castles.length === 2, String(castles.length));
const kingSide = castles.find((m) => m.castle === 'K');
if (kingSide) {
  check('castling SAN is O-O', E.moveToSAN(s, kingSide) === 'O-O');
  E.applyMove(s, kingSide);
  check('kingside castle moves king and rook', s.board[E.nameToSq('g1')]?.type === 'K' && s.board[E.nameToSq('f1')]?.type === 'R' && s.board[E.nameToSq('h1')] === null);
  E.undoMove(s);
  check('castle undo restores king and rook', s.board[E.nameToSq('e1')]?.type === 'K' && s.board[E.nameToSq('h1')]?.type === 'R');
}

s = E.createState('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
const promos = E.legalMoves(s).filter((m) => m.from === E.nameToSq('a7') && m.to === E.nameToSq('a8'));
check('promotion offers four pieces', promos.length === 4, String(promos.length));
const qPromo = promos.find((m) => m.promo === 'Q');
if (qPromo) {
  check('promotion SAN uses =Q', E.moveToSAN(s, qPromo) === 'a8=Q+');
  E.applyMove(s, qPromo);
  check('promotion places the chosen piece', s.board[E.nameToSq('a8')]?.type === 'Q');
  E.undoMove(s);
  check('promotion undo restores the pawn', s.board[E.nameToSq('a7')]?.type === 'P');
}

section('Engine · check, mate and draws');
s = E.createState();
for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
  const m = findMove(s, from, to);
  if (!m) { check(`fool's mate move ${from}${to}`, false, 'missing'); break; }
  E.applyMove(s, m);
}
let st = E.gameStatus(s);
check('fool’s mate is checkmate for Black', st.over && st.reason === 'checkmate' && st.result === '0-1', JSON.stringify(st));

s = E.createState('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
st = E.gameStatus(s);
check('stalemate is detected', st.over && st.reason === 'stalemate' && st.result === '1/2-1/2', JSON.stringify(st));

s = E.createState();
for (const [from, to] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) {
  const m = findMove(s, from, to);
  E.applyMove(s, m);
}
st = E.gameStatus(s);
check('threefold repetition is detected', st.over && st.reason === 'threefold', JSON.stringify(st));

s = E.createState('4k3/8/8/8/8/8/8/4K3 w - - 100 80');
st = E.gameStatus(s);
check('fifty-move draw is detected', st.over && st.reason === 'fifty', JSON.stringify(st));

s = E.createState('4k3/8/8/8/8/8/8/4KB2 w - - 0 1');
check('king and bishop is insufficient material', E.insufficientMaterial(s.board));

s = E.createState();
const italian = [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['g8', 'f6'], ['e1', 'g1']];
const sanList = [];
for (const [from, to] of italian) {
  const m = findMove(s, from, to);
  if (!m) { check(`Italian move ${from}${to}`, false, 'missing'); break; }
  sanList.push(E.moveToSAN(s, m));
  E.applyMove(s, m);
}
check('SAN sequence matches the Italian game', sanList.join(' ') === 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O', sanList.join(' '));

s = E.createState('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
const rookMove = findMove(s, 'h1', 'h8');
check('rook to the eighth rank gives check', E.moveToSAN(s, rookMove).endsWith('+'), E.moveToSAN(s, rookMove));

/* --------------------------------------------------------------------- UI */

section('Interface · translations');
const i18nCode = source.split('const I18N = ')[1]?.split('\nconst PIECE_INFO')[0];
if (!i18nCode) {
  check('i18n dictionary found', false);
} else {
  const dict = new Function('return ' + i18nCode.replace(/;\s*$/, ''))();
  const enKeys = Object.keys(dict.en).sort();
  const thKeys = Object.keys(dict.th).sort();
  const missingTh = enKeys.filter((k) => !(k in dict.th));
  const extraTh = thKeys.filter((k) => !(k in dict.en));
  check('English and Thai dictionaries are symmetric', missingTh.length === 0 && extraTh.length === 0,
    `missing th: ${missingTh.join(', ')} | extra th: ${extraTh.join(', ')}`);
  check('dictionary is reasonably complete', enKeys.length >= 120, String(enKeys.length));

  const html = read('index.html');
  const staticKeys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const attrKeys = [...html.matchAll(/data-i18n-attr="([^"]+)"/g)]
    .flatMap((m) => m[1].split(';'))
    .map((pair) => pair.split(':')[1]?.trim())
    .filter(Boolean);
  const missingStatic = [...new Set([...staticKeys, ...attrKeys])].filter((k) => !(k in dict.en));
  check('every static translation key exists', missingStatic.length === 0, missingStatic.join(', '));

  const usedKeys = [...source.matchAll(/\bt\('([a-z0-9.]+)'/gi)].map((m) => m[1])
    .filter((k) => !k.endsWith('.'));
  const missingDynamic = [...new Set(usedKeys)].filter((k) => !(k in dict.en) && !k.startsWith('piece.'));
  check('every dynamic translation key exists', missingDynamic.length === 0, missingDynamic.join(', '));
}

section('Interface · markup and assets');
const html = read('index.html');
check('index.html links style.css', /href="style\.css"/.test(html));
check('index.html loads script.js as a module', /type="module" src="script\.js"/.test(html));
check('Three.js is pinned to an exact version', /three@\d+\.\d+\.\d+/.test(html));
check('import map provides three/addons/', /"three\/addons\/"/.test(html));

const ids = [...source.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
const missingIds = [...new Set(ids)].filter((id) => !new RegExp(`id="${id}"`).test(html));
check('all element ids referenced by script exist', missingIds.length === 0, missingIds.join(', '));

const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const duplicateIds = htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i);
check('no duplicate element ids', duplicateIds.length === 0, [...new Set(duplicateIds)].join(', '));

section('Puzzles');
const puzzleJson = html.match(/<script type="application\/json" id="puzzle-data">([\s\S]*?)<\/script>/);
check('puzzle JSON block exists', !!puzzleJson);
let puzzles = [];
if (puzzleJson) {
  try {
    puzzles = JSON.parse(puzzleJson[1]);
    check('puzzle JSON parses', true);
  } catch (err) {
    check('puzzle JSON parses', false, err.message);
  }
}
check('three drills are provided', puzzles.length === 3, String(puzzles.length));
check('puzzle ids are unique', new Set(puzzles.map((p) => p.id)).size === puzzles.length);
check('every drill is bilingual', puzzles.every((p) => p.title?.en && p.title?.th && p.goal?.en && p.goal?.th &&
  p.hint?.en && p.hint?.th && p.explanation?.en && p.explanation?.th));
check('every drill has a UCI solution', puzzles.every((p) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(p.uci || '')));

for (const puzzle of puzzles) {
  let ps;
  try {
    ps = E.createState(puzzle.fen);
  } catch (err) {
    check(`drill ${puzzle.id}: FEN is legal`, false, err.message);
    continue;
  }
  check(`drill ${puzzle.id}: FEN is legal`, true);
  check(`drill ${puzzle.id}: side to move matches`, ps.turn === puzzle.side, `${ps.turn} vs ${puzzle.side}`);
  check(`drill ${puzzle.id}: side not to move is not in check`, !E.inCheck(ps, puzzle.side === 'w' ? 'b' : 'w'));

  const from = E.nameToSq(puzzle.uci.slice(0, 2));
  const to = E.nameToSq(puzzle.uci.slice(2, 4));
  const promo = puzzle.uci.length > 4 ? puzzle.uci[4].toUpperCase() : null;
  const move = E.legalMoves(ps).find((m) => m.from === from && m.to === to && (promo ? m.promo === promo : !m.promo));
  check(`drill ${puzzle.id}: solution is a legal move`, !!move);
  if (!move) continue;
  const san = E.moveToSAN(ps, move);
  check(`drill ${puzzle.id}: SAN matches the stored solution`, san === puzzle.solution, `${san} vs ${puzzle.solution}`);
  const before = JSON.parse(JSON.stringify(ps.board));
  E.applyMove(ps, move);
  if (puzzle.solution.endsWith('#')) {
    const status = E.gameStatus(ps);
    check(`drill ${puzzle.id}: solution checkmates`, status.over && status.reason === 'checkmate', JSON.stringify(status));
  }
  E.undoMove(ps);
  check(`drill ${puzzle.id}: board restores after the solution`, JSON.stringify(ps.board) === JSON.stringify(before));
}

section('Release documents');
const requiredDocs = ['README.md', 'AGENTS.md', 'LICENSE', 'CHANGELOG.md', 'state.json', '.nojekyll', 'docs/ARCHITECTURE.md', 'docs/TESTING.md', 'docs/DEPLOYMENT.md'];
for (const doc of requiredDocs) {
  check(`${doc} exists`, existsSync(path.join(root, doc)));
}
check('.nojekyll is empty', existsSync(path.join(root, '.nojekyll')) && read('.nojekyll').length === 0);

// Relative Markdown links resolve.
const mdFiles = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'docs/ARCHITECTURE.md', 'docs/TESTING.md', 'docs/DEPLOYMENT.md'];
const broken = [];
for (const file of mdFiles) {
  if (!existsSync(path.join(root, file))) continue;
  const body = read(file);
  for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:/.test(target) || target.startsWith('mailto:')) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), target);
    if (!existsSync(resolved)) broken.push(`${file} → ${target}`);
  }
}
check('relative Markdown links resolve', broken.length === 0, broken.join(', '));

if (existsSync(path.join(root, 'state.json'))) {
  try {
    const state = JSON.parse(read('state.json'));
    check('state.json parses', true);
    check('state.json records elapsed time', typeof state.session?.elapsedSeconds === 'number' && state.session.elapsedSeconds > 0);
    check('state.json records token usage', typeof state.usage?.totalTokens === 'number' && state.usage.totalTokens > 0);
    check('state.json credits OpenCode', /opencode/i.test(state.credits?.tool || ''));
    check('state.json credits the model', /DeepSeek/i.test(state.credits?.model || ''));
  } catch (err) {
    check('state.json parses', false, err.message);
  }
}

section('Result');
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
