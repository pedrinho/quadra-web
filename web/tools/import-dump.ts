/*
 * Import a board dumped from the real C++ game and replay it here.
 *
 * A screenshot cannot show which cells are welded to which, and that is exactly what
 * decides how a cascade behaves. The dump carries the raw block[] byte per cell — high
 * nibble colour, low nibble exposed-edge mask — so the position transfers exactly.
 *
 * Produce a dump:
 *     QUADRA_DUMP=1 QUADRADIR=. ./quadra 2>/dev/null | tee /tmp/dump.txt
 *   play until the board looks how you want, then quit.
 *
 * Replay the last position in it, optionally dropping pieces onto it:
 *     npx vite-node tools/import-dump.ts /tmp/dump.txt
 *     npx vite-node tools/import-dump.ts /tmp/dump.txt --drop I:1:9 --drop I:0:0
 *
 * --drop is PIECE:ROT:COLUMN, where PIECE is O S Z J L I T (or 0-6), ROT is 0-3, and
 * COLUMN is the playfield column 0-9 the piece's leftmost cell should land in.
 */

import { readFileSync } from 'node:fs';
import { Canvas } from '../src/engine/canvas.js';
import { Bloc } from '../src/engine/bloc.js';
import { boardToAscii, PLAY_LEFT, PLAY_TOP } from '../src/engine/board.js';
import { parseDumps, applyDumpRows } from '../test/dump.js';
import { Executor, Overmind } from '../src/engine/modules.js';
import { PlayerStamp, type PlayerEnv } from '../src/engine/player.js';
import { CURRENT_NET_VERSION } from '../src/engine/net-version.js';
import { assertWeldInvariant } from '../src/engine/cascade.js';
import { PIECE_NAMES } from '../src/engine/pieces.js';

/** Every dump in the log, oldest first. */
function loadBoards(text: string): Canvas[] {
  return parseDumps(text).map((rows) => {
    const c = new Canvas(0);
    applyDumpRows(c, rows);
    return c;
  });
}

/* ------------------------------------------------------------------------- */

function render(c: Canvas): string {
  const rows = boardToAscii(c, { trim: false });
  return [
    '      +0123456789+',
    ...rows.map((r) => `      |${r}|`),
    `      +${'-'.repeat(10)}+`,
  ].join('\n');
}

function parseDrop(spec: string): { piece: number; rot: number; col: number } {
  const [p, r, col] = spec.split(':');
  const named = PIECE_NAMES.indexOf((p ?? '').toUpperCase() as (typeof PIECE_NAMES)[number]);
  const piece = named >= 0 ? named : Number(p);
  if (!Number.isInteger(piece) || piece < 0 || piece > 6)
    throw new Error(`bad piece in --drop ${spec} (use O S Z J L I T or 0-6)`);
  return { piece, rot: Number(r ?? 0) & 3, col: Number(col ?? 0) };
}

function drop(
  canvas: Canvas,
  env: PlayerEnv,
  overmind: Overmind,
  d: { piece: number; rot: number; col: number },
) {
  const probe = new Bloc(d.piece, -1, 0, 0);
  probe.rot = d.rot;
  let leftmost = 4;
  for (let r = 0; r < 4; r++)
    for (let cc = 0; cc < 4; cc++) if (probe.grid()[r]![cc]) leftmost = Math.min(leftmost, cc);

  const bloc = new Bloc(d.piece, -1, PLAY_LEFT + d.col - leftmost, PLAY_TOP - 2);
  bloc.rot = d.rot;
  canvas.bloc = bloc;

  if (canvas.checkCollide(bloc.quel, bloc.bx, bloc.by, bloc.rot)) {
    console.log(`\n!! ${PIECE_NAMES[d.piece]} rot${d.rot} col${d.col} cannot spawn — board too high`);
    canvas.bloc = null;
    return;
  }
  while (!canvas.checkCollide(bloc.quel, bloc.bx, bloc.by + 1, bloc.rot)) bloc.by++;
  bloc.calcXY();

  console.log(`\n>> drop ${PIECE_NAMES[d.piece]} rot${d.rot} at column ${d.col}`);

  const executor = new Executor();
  executor.add(new PlayerStamp(canvas, env));
  overmind.start(executor);

  let frames = 0;
  let maxChain = 0;
  let lastChain = 0;
  let previous = render(canvas);
  while (!executor.done && frames < 5000) {
    overmind.step();
    frames++;
    assertWeldInvariant(canvas);
    maxChain = Math.max(maxChain, canvas.complexity);
    if (verbose) {
      const now = render(canvas);
      // Print on every clear, and on the frame the stack finishes falling.
      if (canvas.complexity !== lastChain) {
        console.log(`\n   frame ${String(frames).padStart(3)}  CLEAR -> chain ${canvas.complexity}, ${canvas.depth} lines so far`);
        console.log(now);
        lastChain = canvas.complexity;
      }
      previous = now;
    }
  }
  if (!verbose) console.log(render(canvas));
  else void previous;
  console.log(`   settled after ${frames} frames, chain reached ${maxChain}`);
}

/* ------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: vite-node tools/import-dump.ts <dumpfile> [--drop I:1:9 ...]');
  throw new Error('no dump file given');
}

const verbose = args.includes('-v') || args.includes('--verbose');
const drops: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--drop') drops.push(args[i + 1] ?? '');

const boards = loadBoards(readFileSync(file, 'utf8'));
if (boards.length === 0) {
  console.error(`no board dumps found in ${file}`);
  console.error('did you run the game with QUADRA_DUMP=1 ?');
  throw new Error('no dumps');
}

console.log(`\nfound ${boards.length} dump(s) in ${file}; replaying the last one\n`);
const canvas = boards[boards.length - 1]!;
assertWeldInvariant(canvas);
console.log(render(canvas));

const overmind = new Overmind();
const env: PlayerEnv = { overmind, videoFrame: 0, levelUp: true, paused: false, sounds: [], notices: [], netVersion: CURRENT_NET_VERSION };
for (const spec of drops) drop(canvas, env, overmind, parseDrop(spec));

console.log(`\nscore ${canvas.score}   lines ${canvas.linesTot}   level ${canvas.level}\n`);
