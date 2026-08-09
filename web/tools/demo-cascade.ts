/*
 * Drives a cascade through the real module machinery and prints each frame.
 *
 * The unit tests use the headless settle()/resolve() shortcuts, which resolve the whole
 * cascade at once. This exercises the animated path instead — Player_check_line calling
 * Player_flash_lines and Player_check_link, one row of falling per two frames — so the
 * frame-level timing is actually observed rather than assumed.
 *
 *   npx vite-node tools/demo-cascade.ts
 */

import { Canvas } from '../src/engine/canvas.js';
import { boardFromAscii, boardToAscii, PLAY_HEIGHT } from '../src/engine/board.js';
import { Executor, Overmind } from '../src/engine/modules.js';
import { PlayerCheckLine, type PlayerEnv } from '../src/engine/player.js';
import { assertWeldInvariant } from '../src/engine/cascade.js';

function canvasFromAscii(rows: string[]): Canvas {
  const src = boardFromAscii(rows);
  const c = new Canvas(0);
  c.occupied.set(src.occupied);
  c.block.set(src.block);
  c.tmp.set(src.tmp);
  return c;
}

function render(c: Canvas): string {
  const rows = boardToAscii(c, { trim: false }).slice(PLAY_HEIGHT - 8);
  return rows.map((r) => `      |${r}|`).join('\n');
}

const FIXTURE = [
  '.........A',
  'BBBBBBBBB.',
  'CCCCCCCCCC',
  'DDDDDDDDD.',
];

console.log('\nQuadra cascade — animated through the real module stack\n');
console.log('Setup: clearing row C drops the lone A into the gap in row D,');
console.log('       which completes it and clears again.\n');
console.log('start');
const canvas = canvasFromAscii(FIXTURE);
console.log(render(canvas));

const overmind = new Overmind();
const env: PlayerEnv = { overmind, videoFrame: 0, levelUp: true, paused: false, sounds: [], notices: [] };
const executor = new Executor();
executor.add(new PlayerCheckLine(canvas, env));
overmind.start(executor);

let previous = render(canvas);
let frame = 0;
const MAX = 400;

while (!executor.done && frame < MAX) {
  overmind.step();
  frame++;
  assertWeldInvariant(canvas);

  const now = render(canvas);
  if (now !== previous) {
    console.log(`\nframe ${String(frame).padStart(3)}  depth=${canvas.depth} complexity=${canvas.complexity}`);
    console.log(now);
    previous = now;
  }
}

console.log(`\nsettled after ${frame} frames`);
console.log(`score ${canvas.score}   lines ${canvas.linesTot}   level ${canvas.level}`);

// Throwing rather than process.exit keeps this free of Node type dependencies and still
// gives a non-zero exit status.
if (!executor.done) throw new Error(`cascade did not terminate within ${MAX} frames`);
