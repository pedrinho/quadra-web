import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Canvas } from '../src/engine/canvas.js';
import { Bloc } from '../src/engine/bloc.js';
import { boardToAscii, PLAY_LEFT, PLAY_TOP } from '../src/engine/board.js';
import { parseDumps, applyDumpRows } from './dump.js';
import { Executor, Overmind } from '../src/engine/modules.js';
import { PlayerStamp, type PlayerEnv } from '../src/engine/player.js';
import { CURRENT_NET_VERSION } from '../src/engine/net-version.js';
import { assertWeldInvariant } from '../src/engine/cascade.js';

/*
 * Oracle test against the original C++ game.
 *
 * A real position was captured from Quadra 1.3.0 with QUADRA_DUMP=1, before and after a
 * single move. The real game reported Score 22000, Lines 8, and its stats panel counted
 * one "8-lines" clear. This asserts the port reproduces that move exactly — not just the
 * score, but the resulting board cell for cell, including which cells stay welded.
 *
 * Matching the score alone would be weak: several different placements happen to score
 * the same. Matching the board including welds is what pins the behaviour down.
 */

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function loadBoard(name: string): Canvas {
  const rows = parseDumps(readFileSync(fixture(name), 'utf8'))[0]!;
  const c = new Canvas(0);
  applyDumpRows(c, rows);
  return c;
}

/** Hard-drop a piece so its leftmost cell lands in `col`, then run stamp + cascade. */
function dropAndSettle(canvas: Canvas, piece: number, rot: number, col: number) {
  const probe = new Bloc(piece, -1, 0, 0);
  probe.rot = rot;
  let leftmost = 4;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) if (probe.grid()[r]![c]) leftmost = Math.min(leftmost, c);

  const bloc = new Bloc(piece, -1, PLAY_LEFT + col - leftmost, PLAY_TOP - 2);
  bloc.rot = rot;
  canvas.bloc = bloc;
  while (!canvas.checkCollide(bloc.quel, bloc.bx, bloc.by + 1, bloc.rot)) bloc.by++;
  bloc.calcXY();

  const overmind = new Overmind();
  const env: PlayerEnv = { overmind, videoFrame: 0, levelUp: true, paused: false, sounds: [], notices: [], netVersion: CURRENT_NET_VERSION };
  const executor = new Executor();
  executor.add(new PlayerStamp(canvas, env));
  overmind.start(executor);

  let frames = 0;
  let chain = 0;
  while (!executor.done && frames < 5000) {
    overmind.step();
    frames++;
    assertWeldInvariant(canvas);
    chain = Math.max(chain, canvas.complexity);
  }
  return { frames, chain, sounds: env.sounds };
}

describe('oracle — matches the original C++ game on a real position', () => {
  const PIECE_T = 6;

  it('reproduces the board exactly, welds included', () => {
    const board = loadBoard('tchain-before.dump');
    dropAndSettle(board, PIECE_T, 1, 8);

    // boardToAscii relabels groups in scan order, so comparing it compares occupancy AND
    // grouping — two boards with identical filled cells but different welding differ here.
    expect(boardToAscii(board)).toEqual(boardToAscii(loadBoard('tchain-after.dump')));
  });

  it('reports the score the real game displayed', () => {
    const board = loadBoard('tchain-before.dump');
    const { chain } = dropAndSettle(board, PIECE_T, 1, 8);

    expect(chain).toBe(7);
    expect(board.linesTot).toBe(8);
    // 200*8*8 = 12800 for the lines, + 200*(7-1)^2 = 7200 for the chain, +10% at level 1.
    expect(board.score).toBe(22000);
  });

  it('walks the chain up one step per cascade in its sound events', () => {
    // The pitch of the line-clear sound drops 256 per chain step (source/player.cc:762),
    // so on this seven-deep cascade the audio should count 1..7 with no gaps or repeats.
    const board = loadBoard('tchain-before.dump');
    const { sounds } = dropAndSettle(board, PIECE_T, 1, 8);

    const chains = sounds.filter((s) => s.kind === 'lineClear').map((s) => s.chain);
    expect(chains).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // One landing, and a settle for each fall that actually moved something.
    expect(sounds.filter((s) => s.kind === 'land')).toHaveLength(1);
    expect(sounds.filter((s) => s.kind === 'cascadeSettled').length).toBeGreaterThan(0);
    for (const s of sounds) {
      if (s.kind === 'cascadeSettled') expect(s.rowsFallen).toBeGreaterThan(0);
    }
  });

  it('is the only hard drop that reproduces this board', () => {
    // Guards against the match being a coincidence: no other placement lands here.
    const target = boardToAscii(loadBoard('tchain-after.dump')).join('\n');
    const matches: string[] = [];

    for (let piece = 0; piece < 7; piece++) {
      for (let rot = 0; rot < 4; rot++) {
        for (let col = 0; col <= 9; col++) {
          const board = loadBoard('tchain-before.dump');
          const probe = new Bloc(piece, -1, 0, 0);
          probe.rot = rot;
          let leftmost = 4;
          for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++) if (probe.grid()[r]![c]) leftmost = Math.min(leftmost, c);
          const bx = PLAY_LEFT + col - leftmost;
          const test = new Bloc(piece, -1, bx, PLAY_TOP - 2);
          test.rot = rot;
          board.bloc = test;
          if (board.checkCollide(test.quel, test.bx, test.by, test.rot)) continue;
          dropAndSettle(board, piece, rot, col);
          if (boardToAscii(board).join('\n') === target) matches.push(`${piece}:${rot}:${col}`);
        }
      }
    }

    // Rotations 1 and 3 of the T are distinct, so exactly one placement should match.
    expect(matches).toEqual(['6:1:8']);
  });
});
