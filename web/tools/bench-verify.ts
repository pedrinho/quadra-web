/*
 * How fast can a server check a submitted run?
 *
 *   npx vite-node tools/bench-verify.ts
 *
 * The answer decides the shape of the backend: Cloudflare's free Workers plan allows 10 ms of
 * CPU per request, the paid plan 30 s. If verification of a realistic run lands well under the
 * paid ceiling it can happen inline on submission; if not it has to be queued.
 *
 * Reported per tape: bytes, frames, ticks, and the throughput. Ticks are the unit that costs —
 * a frame with no ticks is nearly free — so ticks/second is the number to quote.
 */

import { Game } from '../src/engine/game.js';
import { Action } from '../src/engine/canvas.js';
import { Random } from '../src/engine/random.js';
import { record } from '../src/replay/recorder.js';
import { TICK_MS } from '../src/engine/game.js';
import { verify } from '../src/replay/verify.js';

/** Walk each piece to the deepest column and drop it. Same crude stacker the tests use. */
function stack(game: Game, frames: number): void {
  const PLAY_LEFT = 4;
  const PLAY_RIGHT = 14;
  const PLAY_BOTTOM = 32;
  let piece: unknown = null;
  let target = -1;
  let held: Action | null = null;
  for (let i = 0; i < frames && !game.isOver; i++) {
    const bloc = game.canvas.bloc;
    if (bloc) {
      if (bloc !== piece) {
        piece = bloc;
        let best = PLAY_LEFT;
        let bestRow = -1;
        for (let col = PLAY_LEFT; col < PLAY_RIGHT; col++) {
          let row = 0;
          while (row < PLAY_BOTTOM && !game.canvas.isOccupied(row, col)) row++;
          if (row > bestRow) {
            bestRow = row;
            best = col;
          }
        }
        target = best;
        game.input(Action.Drop, false);
      }
      const want = bloc.bx < target ? Action.Right : bloc.bx > target ? Action.Left : null;
      if (want !== held) {
        if (held !== null) game.input(held, false);
        if (want !== null) game.input(want, true);
        held = want;
      }
      if (want === null) game.input(Action.Drop, true);
    }
    game.stepFrame(1);
    game.drainSounds();
  }
}

/** Idle survives far longer than the stacker does, which is how a long tape gets made. */
function idle(game: Game, frames: number): void {
  const rng = new Random(7n);
  for (let i = 0; i < frames && !game.isOver; i++) {
    if (rng.rnd(0xff) < 6) game.input(Action.Left, i % 2 === 0);
    game.stepFrame(1);
    game.drainSounds();
  }
}

function tape(name: string, seed: number, frames: number, drive: (g: Game, n: number) => void) {
  const game = new Game({ seed, shadow: true });
  const recorder = record(game, { guard: false });
  drive(game, frames);
  return { name, bytes: recorder.bytes(), frames: game.frame, ticks: game.ticks };
}

const cases = [
  tape('stacker, played to a top-out', 1058, 100_000, stack),
  tape('mostly idle, a long session', 20260730, 100_000, idle),
];

console.log('verification throughput\n');
for (const c of cases) {
  // One untimed pass first: a cold run measures the JIT, not the engine.
  verify(c.bytes);
  const runs = 5;
  const started = performance.now();
  let result;
  for (let i = 0; i < runs; i++) result = verify(c.bytes);
  const each = (performance.now() - started) / runs;
  if (!result?.ok) throw new Error(`bench tape did not verify: ${JSON.stringify(result)}`);

  const played = (c.ticks * TICK_MS) / 1000;
  console.log(`${c.name}`);
  console.log(`  ${c.bytes.length} bytes, ${c.frames} frames, ${c.ticks} ticks (${played.toFixed(0)}s played)`);
  console.log(`  verified in ${each.toFixed(1)} ms — ${Math.round(c.ticks / (each / 1000)).toLocaleString()} ticks/s`);
  console.log(`  ${(c.bytes.length / c.frames).toFixed(2)} bytes/frame, score ${result.score}`);
  // What a ten-minute submitted run would cost at this rate.
  console.log(`  a 10-minute run (60,000 ticks) would take ~${((60_000 / c.ticks) * each).toFixed(0)} ms\n`);
}
