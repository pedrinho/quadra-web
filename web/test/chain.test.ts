import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verify } from '../src/replay/verify.js';
import { decodeTape } from '../src/replay/tape.js';
import { TapePlayer } from '../src/replay/playback.js';
import { SIM_VERSION } from '../src/replay/version.js';

/**
 * A recorded run whose last piece sets off a nine-step cascade.
 *
 * The clean tapes next door prove the cascade *runs*; this one pins how far it goes. The board
 * is a ladder — every row complete but for one cell, and a row of lone cells overhead, each
 * welded down into the row the trigger completes. Clearing that row cuts all of them loose at
 * once; they fall down their own columns, and the one standing over the next hole drops into
 * it, completing the row under it. Nine times over.
 *
 * That is the deepest `tools/find-chain.ts` has found at any beam width, and it is a claim
 * about welding, severing and support all being right at once: get any of the three wrong and
 * this does not chain, it just clears a line. Regenerate with
 * `npx vite-node tools/record-chain.ts`.
 */
describe('the nine-step chain', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../public/assets/chain9.qtape', import.meta.url)));

  it('still verifies against this engine', () => {
    const result = verify(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header.simVersion).toBe(SIM_VERSION);
    expect(result.header.seed).toBe(2n);
  });

  it('replays to the lines and the score it claims', () => {
    const result = verify(bytes);
    if (!result.ok) throw new Error(result.message);
    expect(result.lines).toBe(10);
    // 200·n² for ten lines, +200·(steps-1)² for the eight re-entries, +10% for level one. No
    // clean bonus — the ladder leaves rubble. Drop a cascade step and this lands 3000 short.
    expect(result.score).toBe(36_080);
    expect(result.frames).toBe(830);
    expect(result.level).toBe(1);
    expect(result.stateHash).toBe('4b49517930207cc2');
  });

  it('gets there in one move, nine cascade steps deep', () => {
    const player = new TapePlayer(decodeTape(bytes));
    let bestChain = 0;
    let scoringMoves = 0;
    while (player.step()) {
      // `complexity` is the cascade's own iteration count, and `give_line` resets it on the way
      // out — so this is sampled per frame, exactly as the scoreboard's BEST CHAIN reads it.
      bestChain = Math.max(bestChain, player.game.canvas.complexity);
      for (const notice of player.game.drainNotices()) if (notice.kind === 'clear') scoringMoves++;
      player.game.drainSounds();
    }
    expect(bestChain).toBe(9);
    // Ten lines would also be true of ten separate singles. The claim is one move.
    expect(scoringMoves).toBe(1);
  });
});
