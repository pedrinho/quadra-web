/*
 * Given a board before a move and the board after it, work out which piece placement
 * produced it — by trying every one and comparing the result.
 *
 * This is the sharpest oracle test available: it checks the engine reproduces a real
 * position exactly, welds and all, not merely that the score lines up.
 *
 *   npx vite-node tools/find-move.ts before.txt after.txt
 */

import { readFileSync } from 'node:fs';
import { Canvas } from '../src/engine/canvas.js';
import { Bloc } from '../src/engine/bloc.js';
import { boardToAscii, PLAY_LEFT, PLAY_TOP } from '../src/engine/board.js';
import { parseDumps, applyDumpRows } from '../src/engine/dump.js';
import { Executor, Overmind } from '../src/engine/modules.js';
import { PlayerStamp, type PlayerEnv } from '../src/engine/player.js';
import { PIECE_NAMES, PIECES } from '../src/engine/pieces.js';

function load(path: string): Canvas {
  const rows = parseDumps(readFileSync(path, 'utf8'))[0]!;
  const c = new Canvas(0);
  applyDumpRows(c, rows);
  return c;
}

function attempt(before: Canvas, piece: number, rot: number, col: number) {
  // Fresh copy each time.
  const c = new Canvas(0);
  c.occupied.set(before.occupied);
  c.block.set(before.block);
  c.tmp.set(before.tmp);

  const probe = new Bloc(piece, -1, 0, 0);
  probe.rot = rot;
  let leftmost = 4;
  for (let r = 0; r < 4; r++)
    for (let cc = 0; cc < 4; cc++) if (probe.grid()[r]![cc]) leftmost = Math.min(leftmost, cc);

  const bx = PLAY_LEFT + col - leftmost;
  const bloc = new Bloc(piece, -1, bx, PLAY_TOP - 2);
  bloc.rot = rot;
  c.bloc = bloc;
  if (c.checkCollide(bloc.quel, bloc.bx, bloc.by, bloc.rot)) return null;
  while (!c.checkCollide(bloc.quel, bloc.bx, bloc.by + 1, bloc.rot)) bloc.by++;
  bloc.calcXY();

  const overmind = new Overmind();
  const env: PlayerEnv = { overmind, videoFrame: 0, levelUp: true, paused: false, sounds: [] };
  const ex = new Executor();
  ex.add(new PlayerStamp(c, env));
  overmind.start(ex);

  let frames = 0;
  let chain = 0;
  while (!ex.done && frames < 5000) {
    overmind.step();
    frames++;
    chain = Math.max(chain, c.complexity);
  }
  return { canvas: c, chain, frames, ascii: boardToAscii(c).join('\n') };
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('usage: vite-node tools/find-move.ts <before.txt> <after.txt>');
  throw new Error('missing arguments');
}

const before = load(beforePath);
const target = boardToAscii(load(afterPath)).join('\n');

console.log('\ntarget board (from the real game):\n');
console.log(target.split('\n').map((r) => `      |${r}|`).join('\n'));

const exact: string[] = [];
const nearMisses: { label: string; lines: number; chain: number; score: number }[] = [];

for (let piece = 0; piece < 7; piece++) {
  for (let rot = 0; rot < 4; rot++) {
    // Skip duplicate rotations for pieces that only have two distinct ones.
    if (rot >= 2 && JSON.stringify(PIECES[piece]![rot]) === JSON.stringify(PIECES[piece]![rot - 2]))
      continue;
    for (let col = 0; col <= 9; col++) {
      const r = attempt(before, piece, rot, col);
      if (!r) continue;
      const label = `${PIECE_NAMES[piece]} rot${rot} col${col}`;
      if (r.ascii === target) exact.push(`${label}  (chain ${r.chain}, ${r.canvas.linesTot} lines, ${r.canvas.score} pts)`);
      else if (r.canvas.linesTot > 0)
        nearMisses.push({
          label,
          lines: r.canvas.linesTot,
          chain: r.chain,
          score: r.canvas.score,
        });
    }
  }
}

console.log(`\n${'='.repeat(60)}`);
if (exact.length) {
  console.log(`EXACT MATCH — the engine reproduces the real board cell for cell:\n`);
  for (const e of exact) console.log(`   ${e}`);
} else {
  console.log('NO EXACT MATCH from any hard drop.');
  console.log('\nBest line-clearing candidates:\n');
  nearMisses
    .sort((a, b) => b.lines - a.lines || b.chain - a.chain)
    .slice(0, 12)
    .forEach((m) => console.log(`   ${m.label.padEnd(16)} ${m.lines} lines, chain ${m.chain}, ${m.score} pts`));
}
console.log(`${'='.repeat(60)}\n`);
