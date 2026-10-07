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
 * A position captured from the original C++ game, welds and all. Hand-written fixtures
 * only prove what I thought to write down; this proves the engine handles a board a real
 * player actually built, with the messy grouping real play produces.
 */

const dumpPath = fileURLToPath(new URL('./fixtures/real-board.dump', import.meta.url));

function loadBoard(): Canvas {
  const rows = parseDumps(readFileSync(dumpPath, 'utf8'))[0]!;
  const c = new Canvas(0);
  applyDumpRows(c, rows);
  return c;
}

/** Hard-drop a piece and run the stamp + cascade chain to completion. */
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
  let maxChain = 0;
  while (!executor.done && frames < 5000) {
    overmind.step();
    frames++;
    assertWeldInvariant(canvas);
    maxChain = Math.max(maxChain, canvas.complexity);
  }
  return { frames, maxChain };
}

describe('a real board captured from the C++ game', () => {
  it('imports with its welds intact', () => {
    const c = loadBoard();
    assertWeldInvariant(c);
    expect(boardToAscii(c)).toEqual([
      'A.........',
      'A.B.......',
      'A.B.......',
      'A.B.......',
      'C.B.......',
      'C.D....E..',
      'C.D...FEEG',
      'C.D...FFEG',
      'HHD.IIJFGG',
      '.HHIIJJKKL',
      'MM.NNOJKKL',
      '.MMNNOOPLL',
      '.QQRROSPPP',
      'QQ.RRTSSSU',
      'VV.WTTTUUU',
      '.VVWWWXXXX',
    ]);
  });

  it('cascades six deep when a bar completes the one open row', () => {
    const c = loadBoard();
    // Row 12 is missing only column 3, and column 3 is clear all the way up.
    const { maxChain } = dropAndSettle(c, 5, 1, 3);

    expect(maxChain).toBe(6);
    expect(c.linesTot).toBe(8);
    // 200*8*8 = 12800 for the lines, + 200*(6-1)^2 = 5000 for the chain, +10% for level 1.
    expect(c.score).toBe(19580);
    assertWeldInvariant(c);
  });

  it('leaves the expected rubble', () => {
    const c = loadBoard();
    dropAndSettle(c, 5, 1, 3);
    expect(boardToAscii(c)).toEqual([
      'A.B.......',
      'A.BC...D..',
      'A.BC..EDDF',
      'A.BC..EEDF',
    ]);
  });

  it('does nothing dramatic when the bar goes somewhere useless', () => {
    const c = loadBoard();
    // Column 1 is a well too, but filling it completes no row.
    const { maxChain } = dropAndSettle(c, 5, 1, 1);
    expect(maxChain).toBe(0);
    expect(c.linesTot).toBe(0);
  });
});
