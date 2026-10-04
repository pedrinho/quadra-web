/*
 * Record a run that ends in one enormous move: every line on the board at once, board empty.
 *
 *   npx vite-node tools/record-clean.ts 8            # re-record the eight-line clean
 *   npx vite-node tools/record-clean.ts 12           # the twelve
 *   npx vite-node tools/record-clean.ts 10           # the ten, which stacks against the left wall
 *   npx vite-node tools/record-clean.ts 12 search    # sweep for a seed that can build it
 *
 * The shape and the seed search live in tools/find-clean.ts. This file is only the hands: it
 * takes the placements the search found and plays them through `Game.input`, one tap at a time,
 * exactly as a person at a keyboard would — rotate, walk the piece across, hard drop. Nothing
 * here reaches into the board, so what comes out is a recording of play rather than of the
 * engine being posed, and `verify` re-simulates it from the seed alone.
 *
 * The tape stops a moment after the score lands, so it replays as an unfinished run: the player
 * got their lines and stopped. Deterministic — re-running it produces the same bytes.
 */

import { writeFileSync } from 'node:fs';
import { Action } from '../src/engine/canvas.js';
import { Game } from '../src/engine/game.js';
import { boardToAscii } from '../src/engine/board.js';
import { record } from '../src/replay/recorder.js';
import { verify } from '../src/replay/verify.js';
import { PIECE_NAMES } from '../src/engine/pieces.js';
import type { Notice } from '../src/engine/notices.js';
import { pieceStream, searchSeeds, solveSeed, type Placement } from './find-clean.js';

/**
 * Seed and tower arrangement that are known to work, so a plain re-record goes straight to the
 * answer instead of re-deriving it. Both were found by the `search` mode below.
 */
const KNOWN: Record<number, { seed: number; tower: number[][] }> = {
  8: { seed: 2, tower: [[0], [2]] },
  10: { seed: 9, tower: [[0, 1], [3], [2]] },
  12: { seed: 77, tower: [[0], [9], [4]] },
};

const LINES = Number(process.argv[2] ?? 12);
if (!KNOWN[LINES]) {
  throw new Error(`lines must be 8, 10 or 12 — a four-row storey is the tallest that will spawn`);
}

/** "0+1, 2, 3" — the missing columns of each storey, bottom first, fuse last. */
const wellsToString = (wells: number[][]): string => wells.map((w) => w.join('+')).join(', ');

if (process.argv[3] === 'search') {
  const from = Number(process.argv[4] ?? 1);
  const to = Number(process.argv[5] ?? 20_000);
  const found = searchSeeds(from, to, LINES, (s) => console.log(`  ...${s}`));
  if (!found) console.log(`no seed in [${from}, ${to}] can build a ${LINES}-line tower by hard drops`);
  else {
    const names = pieceStream(found.seed, found.build.length + 1).map((p) => PIECE_NAMES[p]).join('');
    console.log(`seed ${found.seed}: storeys missing ${wellsToString(found.shape.wells)} (fuse last)`);
    console.log(`  ${names}`);
  }
  process.exit(0);
}

const known = KNOWN[LINES]!;
const SEED = Number(process.argv[3] ?? known.seed);
const OUT = new URL(`../public/assets/clean${LINES}.qtape`, import.meta.url).pathname;

const solution = solveSeed(SEED, LINES, SEED === known.seed ? { tower: known.tower } : {});
if (!solution) {
  throw new Error(`seed ${SEED} cannot build a ${LINES}-line tower — try \`record-clean.ts ${LINES} search\``);
}

const game = new Game({ seed: SEED, shadow: true });
const recorder = record(game, { startedAt: 0, checkpointInterval: 500 });

/** Everything the game announced, so the shape of the clear can be checked and not just its size. */
const notices: Notice[] = [];

/** One rendered frame. Every input below lands on a frame boundary, like a real keypress. */
const frame = (): void => {
  game.stepFrame(1);
  game.drainSounds();
  notices.push(...game.drainNotices());
};

/**
 * A tap: down on one frame, up on the next, then a frame for the simulation to act on it. The
 * third frame is not padding — entering a module costs a frame, so a fresh piece does not read
 * the keyboard until two frames after it appears, and rotations fire on the release.
 */
const tap = (action: Action): void => {
  game.input(action, true);
  frame();
  game.input(action, false);
  frame();
  frame();
};

/** Run frames until the predicate holds. Throws rather than record a run that went wrong. */
const until = (what: string, ok: () => boolean, budget = 2000): void => {
  for (let i = 0; i < budget; i++) {
    if (ok()) return;
    frame();
  }
  throw new Error(`gave up waiting for ${what} after ${budget} frames`);
};

/** Rotate to `rot`, walk to `bx`, drop. The piece is still near the ceiling throughout. */
function play(p: Placement): void {
  until('a piece', () => game.canvas.bloc !== null);
  if (game.isOver) throw new Error('topped out mid-build');
  const bloc = game.canvas.bloc!;
  if (bloc.quel !== p.piece) {
    throw new Error(`expected ${PIECE_NAMES[p.piece]}, the game gave ${PIECE_NAMES[bloc.quel]}`);
  }

  // Tap until the piece is where it should be rather than counting taps: a rotation the
  // simulation refused would otherwise go unnoticed and quietly build a different stack.
  for (let guard = 0; bloc.rot !== p.rot; guard++) {
    if (guard >= 8) throw new Error(`${PIECE_NAMES[p.piece]} would not rotate to ${p.rot}`);
    tap(Action.RotateRight);
  }
  for (let guard = 0; bloc.bx !== p.bx; guard++) {
    if (guard >= 20) throw new Error(`${PIECE_NAMES[p.piece]} would not walk to bx ${p.bx}`);
    tap(bloc.bx < p.bx ? Action.Right : Action.Left);
  }

  // Held, not tapped: the drop fires on the press, and the press has to survive until the frame
  // the piece actually reads the keyboard.
  game.input(Action.Drop, true);
  until('the piece to land', () => game.canvas.bloc !== bloc);
  game.input(Action.Drop, false);
}

for (const p of solution.build) play(p);

console.log(`\nthe tower, ${solution.build.length} pieces in and not one line cleared:\n`);
for (const row of boardToAscii(game.canvas)) console.log(`      |${row}|`);

play({ ...solution.shape.trigger, by: 0 });

// The cascade is animated: sixteen frames of flash per step, then the fall, then the score.
until('the score', () => game.canvas.linesTot > 0, 4000);
for (let i = 0; i < 60; i++) frame();

const bytes = recorder.bytes();
const result = verify(bytes);
if (!result.ok) throw new Error(`the run does not verify: ${result.code} ${result.message}`);

// N lines total would also be true of N separate singles. What is being claimed here is one move
// worth all of them, so check the announcement the game itself made.
const clears = notices.filter((n): n is Extract<Notice, { kind: 'clear' }> => n.kind === 'clear');
if (clears.length !== 1) throw new Error(`${clears.length} scoring moves, wanted exactly one`);
if (clears[0]!.depth !== LINES) throw new Error(`the move was worth ${clears[0]!.depth} lines, wanted ${LINES}`);
if (!notices.some((n) => n.kind === 'clean')) throw new Error('the board never announced a clean');
if (!game.canvas.isClean()) throw new Error('the board did not end clean');
if (result.lines !== LINES) throw new Error(`cleared ${result.lines} lines, wanted ${LINES}`);

writeFileSync(OUT, bytes);
console.log(`\nwrote ${bytes.length} bytes to public/assets/clean${LINES}.qtape`);
console.log(
  `  seed ${SEED}, storeys missing ${wellsToString(solution.shape.wells)} (fuse last)\n` +
    `  score ${result.score}, ${result.lines} lines in one move, ${result.frames} frames, ` +
    `${(result.simulatedMs / 1000).toFixed(1)}s\n` +
    `  board ends clean, ${result.stateHash}`,
);
console.log('this is committed — remember to commit the change');
