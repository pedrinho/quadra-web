/*
 * Record the demo the page plays when nobody has set a score yet.
 *
 *   npx vite-node tools/record-demo.ts
 *
 * Deterministic: a fixed seed and a fixed stacker, so re-running it produces the same bytes and
 * a diff means the engine changed. The output is committed, and `test/demo.test.ts` verifies it
 * on every run — a demo that no longer replays would otherwise be a silent lie on the front page.
 *
 * The stacker is not an opponent. It walks each piece to the deepest column and drops it, which
 * is enough to clear lines, set off one cascade and bury itself in about 45 seconds.
 */

import { writeFileSync } from 'node:fs';
import { Action } from '../src/engine/canvas.js';
import { Game } from '../src/engine/game.js';
import { PLAY_BOTTOM, PLAY_LEFT, PLAY_RIGHT } from '../src/engine/board.js';
import { record } from '../src/replay/recorder.js';
import { verify } from '../src/replay/verify.js';

/** Swept for: three lines, a two-deep cascade, a top-out. Same seed the tests use. */
const SEED = 1058;
const OUT = new URL('../public/assets/demo.qtape', import.meta.url).pathname;

const game = new Game({ seed: SEED, shadow: true });
const recorder = record(game, { startedAt: 0, checkpointInterval: 500 });

let piece: unknown = null;
let target = -1;
let held: Action | null = null;

for (let frame = 0; frame < 100_000 && !game.isOver; frame++) {
  const bloc = game.canvas.bloc;
  if (bloc) {
    if (bloc !== piece) {
      piece = bloc;
      let best = PLAY_LEFT;
      let deepest = -1;
      for (let col = PLAY_LEFT; col < PLAY_RIGHT; col++) {
        let row = 0;
        while (row < PLAY_BOTTOM && !game.canvas.isOccupied(row, col)) row++;
        if (row > deepest) {
          deepest = row;
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
  game.drainNotices();
}

const bytes = recorder.bytes();
const result = verify(bytes);
if (!result.ok) throw new Error(`the demo does not verify: ${result.code} ${result.message}`);

writeFileSync(OUT, bytes);
console.log(`wrote ${bytes.length} bytes to public/assets/demo.qtape`);
console.log(
  `  score ${result.score}, ${result.lines} lines, ${result.frames} frames, ` +
    `${(result.simulatedMs / 1000).toFixed(1)}s, ended ${result.over ? 'in a top-out' : 'early'}`,
);
console.log('this is committed — remember to commit the change');
