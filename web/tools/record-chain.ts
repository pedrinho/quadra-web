/*
 * Record a run that ends in the deepest cascade this engine will give up — a chain.
 *
 *   npx vite-node tools/record-chain.ts                    # re-record it
 *   npx vite-node tools/record-chain.ts search 1 200       # sweep seeds for a deeper one
 *
 * The shape and the search live in tools/find-chain.ts. This file is only the hands: it takes
 * the drops the search found and plays them through `Game.input`, one tap at a time, exactly as
 * a person at a keyboard would — rotate, walk the piece across, hard drop. Nothing here reaches
 * into the board, so what comes out is a recording of play rather than of the engine being
 * posed, and `verify` re-simulates it from the seed alone.
 *
 * Re-recording re-runs the search rather than storing its answer. It is deterministic, so the
 * bytes come out the same, and it costs a minute — which is the price of the tape and the tool
 * agreeing about what they claim, instead of a table of coordinates nobody can check.
 */

import { writeFileSync } from 'node:fs';
import { Action } from '../src/engine/canvas.js';
import { Game } from '../src/engine/game.js';
import { boardToAscii } from '../src/engine/board.js';
import { record } from '../src/replay/recorder.js';
import { verify } from '../src/replay/verify.js';
import { PIECE_NAMES } from '../src/engine/pieces.js';
import type { Notice } from '../src/engine/notices.js';
import { searchSeed, searchSeeds, WIDTHS, type Placement } from './find-chain.js';

/**
 * The seed and the search width that produced the recorded run, both found by the `search` mode
 * below. The width is pinned rather than swept because a re-record wants the answer, not the
 * derivation: sweeping every width costs minutes to arrive somewhere already written down.
 */
const KNOWN = { seed: 2, beam: 120, pieces: 34 };

if (process.argv[2] === 'search') {
  const from = Number(process.argv[3] ?? 1);
  const to = Number(process.argv[4] ?? 100);
  const widths = process.argv[5] ? process.argv[5].split(',').map(Number) : WIDTHS;
  const found = searchSeeds(from, to, {
    widths,
    pieces: KNOWN.pieces,
    onBest: (f) =>
      console.log(
        `seed ${f.seed}: chain ${f.cascade.steps}, ${f.cascade.lines} lines, ` +
          `${f.build.length} pieces${f.cascade.clean ? ', board ends clean' : ''}`,
      ),
  });
  if (!found) console.log(`no seed in [${from}, ${to}] chained at all`);
  else console.log(`\nbest: seed ${found.seed}, chain ${found.cascade.steps}`);
  process.exit(0);
}

const SEED = Number(process.argv[2] ?? KNOWN.seed);
const solution = searchSeed(SEED, { beam: KNOWN.beam, pieces: KNOWN.pieces });
if (!solution) throw new Error(`seed ${SEED} does not chain`);

const CHAIN = solution.cascade.steps;
const OUT = new URL(`../public/assets/chain${CHAIN}.qtape`, import.meta.url).pathname;

const game = new Game({ seed: SEED, shadow: true });
const recorder = record(game, { startedAt: 0, checkpointInterval: 500 });

/** Everything the game announced, so the size of the move can be checked and not just its lines. */
const notices: Notice[] = [];

/**
 * The deepest the cascade loop went round, sampled every frame — which is exactly how the
 * scoreboard's BEST CHAIN reads it, since `give_line` resets `complexity` on its way out.
 */
let bestChain = 0;

/** One rendered frame. Every input below lands on a frame boundary, like a real keypress. */
const frame = (): void => {
  game.stepFrame(1);
  game.drainSounds();
  notices.push(...game.drainNotices());
  bestChain = Math.max(bestChain, game.canvas.complexity);
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

console.log(`\nthe ladder, ${solution.build.length} pieces in and not one line cleared:\n`);
for (const row of boardToAscii(game.canvas)) console.log(`      |${row}|`);

play(solution.trigger);

// The cascade is animated: sixteen frames of flash per step, then the fall, then the next step.
until('the score', () => game.canvas.linesTot > 0, 6000);
for (let i = 0; i < 120; i++) frame();

const bytes = recorder.bytes();
const result = verify(bytes);
if (!result.ok) throw new Error(`the run does not verify: ${result.code} ${result.message}`);

// The claim is one move worth a long chain, not a lot of separate clears, so check what the
// game itself announced as well as what the cascade counter reached.
const clears = notices.filter((n): n is Extract<Notice, { kind: 'clear' }> => n.kind === 'clear');
if (clears.length !== 1) throw new Error(`${clears.length} scoring moves, wanted exactly one`);
if (bestChain !== CHAIN) throw new Error(`the chain reached ${bestChain}, the search promised ${CHAIN}`);
if (result.lines !== solution.cascade.lines) {
  throw new Error(`cleared ${result.lines} lines, the search promised ${solution.cascade.lines}`);
}

writeFileSync(OUT, bytes);
console.log(`\nwrote ${bytes.length} bytes to public/assets/chain${CHAIN}.qtape`);
console.log(
  `  seed ${SEED}, beam ${KNOWN.beam}, ${solution.build.length} pieces then the trigger\n` +
    `  chain ${bestChain}, ${result.lines} lines in one move, score ${result.score}, ` +
    `${result.frames} frames, ${(result.simulatedMs / 1000).toFixed(1)}s\n` +
    `  ${result.stateHash}`,
);
console.log('this is committed — remember to commit the change');
