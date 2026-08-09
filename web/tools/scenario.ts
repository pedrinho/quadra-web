/*
 * Scenario runner — set up a board, drop pieces onto it, watch the chain resolve.
 *
 * Everything runs through the real module stack (Player_stamp -> Player_check_line ->
 * Player_flash_lines -> Player_check_link), so timing and welding are the genuine article,
 * not the headless settle() shortcut.
 *
 *   npx vite-node tools/scenario.ts            # list scenarios
 *   npx vite-node tools/scenario.ts zchain     # run one
 *   npx vite-node tools/scenario.ts zchain -q  # summary only, no frame-by-frame
 *
 * Board notation: one character per playfield cell, '.' is empty, and adjacent cells
 * sharing a character are WELDED into one rigid body. Rows are bottom-aligned.
 */

import { Canvas } from '../src/engine/canvas.js';
import { Bloc } from '../src/engine/bloc.js';
import {
  boardFromAscii,
  boardToAscii,
  PLAY_LEFT,
  PLAY_TOP,
  PLAY_HEIGHT,
} from '../src/engine/board.js';
import { Executor, Overmind } from '../src/engine/modules.js';
import { PlayerStamp, type PlayerEnv } from '../src/engine/player.js';
import { assertWeldInvariant } from '../src/engine/cascade.js';
import { PIECE_NAMES } from '../src/engine/pieces.js';
import { formatDump } from '../src/engine/dump.js';

interface Drop {
  /** Piece index: 0=O 1=S 2=Z 3=J 4=L 5=I 6=T */
  piece: number;
  /** Rotation 0..3. */
  rot?: number;
  /** Playfield column (0..9) the piece's leftmost cell should occupy. */
  col: number;
}

interface Scenario {
  name: string;
  description: string;
  board: string[];
  drops: Drop[];
}

/* ------------------------------------------------------------------------- */

const SCENARIOS: Record<string, Scenario> = {
  zchain: {
    name: 'zchain',
    description:
      'Five vertical Z pieces stacked in a well on the left, the rest of the field filled\n' +
      'row by row, and column 9 left open. A vertical bar dropped into that well clears\n' +
      'three rows, severing the Z stack — and the fragments falling into the gaps the Z\n' +
      'staircase left behind complete more rows.',
    // cols 0-1: five vertical Z pieces (A..E), each its own welded group.
    // cols 2-8: filler, one welded bar per row (F..P).
    // col 9:    the well.
    board: [
      '.AFFFFFFF.',
      'AAGGGGGGG.',
      'ABHHHHHHH.',
      'BBIIIIIII.',
      'BCJJJJJJJ.',
      'CCKKKKKKK.',
      'CDLLLLLLL.',
      'DDMMMMMMM.',
      'DENNNNNNN.',
      'EEOOOOOOO.',
      'E.PPPPPPP.',
    ],
    drops: [{ piece: 5, rot: 1, col: 9 }],
  },

  zchain2: {
    name: 'zchain2',
    description:
      'The same Z staircase, but a horizontal bar is laid across the top of the stack\n' +
      'first, then the vertical bar goes into the well.',
    board: [
      '.AFFFFFFF.',
      'AAGGGGGGG.',
      'ABHHHHHHH.',
      'BBIIIIIII.',
      'BCJJJJJJJ.',
      'CCKKKKKKK.',
      'CDLLLLLLL.',
      'DDMMMMMMM.',
      'DENNNNNNN.',
      'EEOOOOOOO.',
      'E.PPPPPPP.',
    ],
    drops: [
      { piece: 5, rot: 0, col: 0 },
      { piece: 5, rot: 1, col: 9 },
    ],
  },

  simple: {
    name: 'simple',
    description: 'Minimal two-stage chain, for sanity checking.',
    board: ['.........A', 'BBBBBBBBB.', 'CCCCCCCCCC', 'DDDDDDDDD.'],
    drops: [],
  },
};

/* ------------------------------------------------------------------------- */

function canvasFromAscii(rows: string[]): Canvas {
  const src = boardFromAscii(rows);
  const c = new Canvas(0);
  c.occupied.set(src.occupied);
  c.block.set(src.block);
  c.tmp.set(src.tmp);
  return c;
}

function render(c: Canvas, height: number): string {
  const rows = boardToAscii(c, { trim: false }).slice(PLAY_HEIGHT - height);
  const ruler = '0123456789';
  return [`      +${ruler}+`, ...rows.map((r) => `      |${r}|`), `      +${'-'.repeat(10)}+`].join(
    '\n',
  );
}

/** Hard-drop a piece into the board and run the full stamp + cascade chain. */
function dropPiece(canvas: Canvas, env: PlayerEnv, overmind: Overmind, drop: Drop, opts: Opts) {
  const rot = drop.rot ?? 0;
  const grid = new Bloc(drop.piece, -1, 0, 0);
  grid.rot = rot;

  // `col` names the leftmost occupied column, but bx positions the 4x4 box, so shift by
  // however much padding the rotation has on its left.
  let leftmost = 4;
  for (let r = 0; r < 4; r++)
    for (let cc = 0; cc < 4; cc++) if (grid.grid()[r]![cc]) leftmost = Math.min(leftmost, cc);

  const bx = PLAY_LEFT + drop.col - leftmost;
  const bloc = new Bloc(drop.piece, -1, bx, PLAY_TOP - 2); // the original spawn row
  bloc.rot = rot;
  canvas.bloc = bloc;

  if (canvas.checkCollide(bloc.quel, bloc.bx, bloc.by, bloc.rot)) {
    console.log(`  !! ${PIECE_NAMES[drop.piece]} rot${rot} col${drop.col} cannot spawn`);
    canvas.bloc = null;
    return;
  }
  while (!canvas.checkCollide(bloc.quel, bloc.bx, bloc.by + 1, bloc.rot)) bloc.by++;
  bloc.calcXY();

  console.log(
    `\n>> drop ${PIECE_NAMES[drop.piece]} rot${rot} at column ${drop.col} ` +
      `(lands with its box at row ${bloc.by})`,
  );

  const executor = new Executor();
  executor.add(new PlayerStamp(canvas, env));
  overmind.start(executor);

  let previous = render(canvas, opts.height);
  console.log(previous);

  let frame = 0;
  while (!executor.done && frame < 2000) {
    overmind.step();
    frame++;
    assertWeldInvariant(canvas);
    const now = render(canvas, opts.height);
    if (now !== previous && !opts.quiet) {
      console.log(
        `\n   frame ${String(frame).padStart(3)}   lines this move: ${canvas.depth}   ` +
          `chain: ${canvas.complexity}`,
      );
      console.log(now);
      previous = now;
    } else {
      previous = now;
    }
  }
  if (opts.quiet) console.log(render(canvas, opts.height));
  console.log(`   settled after ${frame} frames`);
}

interface Opts {
  quiet: boolean;
  height: number;
  dump: boolean;
}

function run(scenario: Scenario, opts: Opts) {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`scenario: ${scenario.name}`);
  console.log(`${'='.repeat(64)}`);
  console.log(scenario.description);

  const canvas = canvasFromAscii(scenario.board);
  if (opts.dump) {
    // Emit in the same format the patched C++ produces, so the importer can be exercised
    // without needing a real game session.
    console.log(formatDump(canvas));
    return;
  }
  const overmind = new Overmind();
  const env: PlayerEnv = { overmind, videoFrame: 0, levelUp: true, paused: false, sounds: [], notices: [] };

  console.log('\nsetup');
  console.log(render(canvas, opts.height));
  assertWeldInvariant(canvas);

  for (const drop of scenario.drops) dropPiece(canvas, env, overmind, drop, opts);

  console.log(
    `\nresult: score ${canvas.score}   lines ${canvas.linesTot}   level ${canvas.level}\n`,
  );
}

const args = process.argv.slice(2);
const quiet = args.includes('-q');
const dump = args.includes('--dump');
const name = args.find((a) => !a.startsWith('-'));

if (!name) {
  console.log('\nscenarios:\n');
  for (const s of Object.values(SCENARIOS))
    console.log(`  ${s.name.padEnd(10)} ${s.description.split('\n')[0]}`);
  console.log('\nusage: npx vite-node tools/scenario.ts <name> [-q]\n');
} else {
  const s = SCENARIOS[name];
  if (!s) {
    console.error(`unknown scenario "${name}"`);
    throw new Error('unknown scenario');
  }
  run(s, { quiet, dump, height: Math.min(PLAY_HEIGHT, s.board.length + 5) });
}
