import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { verify } from '../src/replay/verify.js';
import { SIM_VERSION } from '../src/replay/version.js';

/**
 * The recording the front page plays when nobody has scored yet.
 *
 * It is committed, so it can rot: any change to the simulation makes it replay to a different
 * game, and the page would go on presenting the old score beside the new board without a word.
 * Checking it here means that shows up as a failing test rather than as a quiet lie on the
 * front page. Regenerate with `npx vite-node tools/record-demo.ts`.
 */
describe('the bundled demonstration', () => {
  const bytes = new Uint8Array(readFileSync(new URL('../public/assets/demo.qtape', import.meta.url)));

  it('still verifies against this engine', () => {
    const result = verify(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header.simVersion).toBe(SIM_VERSION);
    expect(result.over).toBe(true);
  });

  it('is still worth watching', () => {
    const result = verify(bytes);
    if (!result.ok) throw new Error(result.message);
    // The point of the demo is that something happens in it: lines clear and a score appears.
    expect(result.score).toBeGreaterThan(0);
    expect(result.lines).toBeGreaterThan(0);
    // Long enough to show the mechanic, short enough to loop on a front page.
    expect(result.simulatedMs).toBeGreaterThan(20_000);
    expect(result.simulatedMs).toBeLessThan(180_000);
  });

  it('stays small enough to ship on the critical path', () => {
    expect(bytes.length).toBeLessThan(4096);
  });
});
