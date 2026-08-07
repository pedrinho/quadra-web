/*
 * Guards on the engine itself, rather than on any particular behaviour of it.
 *
 * Both of these fail on changes that look harmless in review. That is the point: a leaderboard
 * built on replays depends on two properties of `src/engine/` that nothing else enforces —
 * that it means the same thing tomorrow as it did today, and that it can run somewhere with no
 * browser in it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Hasher } from '../src/replay/hash.js';
import { SIM_SOURCE_HASH } from '../src/replay/version.js';

const ENGINE = new URL('../src/engine/', import.meta.url);
const sources = readdirSync(ENGINE)
  .filter((name) => name.endsWith('.ts'))
  .sort();
const read = (name: string) => readFileSync(new URL(name, ENGINE), 'utf8');

describe('the simulation is versioned', () => {
  it('has not changed without someone deciding what that means for stored recordings', () => {
    const encoder = new TextEncoder();
    const h = new Hasher();
    for (const name of sources) {
      // The name goes in too, so adding, removing or renaming a module is caught as surely as
      // editing one.
      const bytes = encoder.encode(`${name}\n${read(name)}`);
      h.bytes(bytes, 0, bytes.length);
    }
    const digest = h.digest();
    expect(
      digest,
      `\nsrc/engine/ has changed.\n\n` +
        `  If the change can alter the outcome of a game — piece tables, collision, the\n` +
        `  cascade, scoring, DAS, the input-sampling gate, the RNG — bump SIM_VERSION in\n` +
        `  src/replay/version.ts. That invalidates every stored recording, which is the\n` +
        `  honest outcome: they no longer describe the game this build plays.\n\n` +
        `  If it cannot (a comment, a rename, a type), leave SIM_VERSION alone.\n\n` +
        `  Either way, set SIM_SOURCE_HASH to '${digest}'.\n`,
    ).toBe(SIM_SOURCE_HASH);
  });
});

describe('the simulation is portable', () => {
  // The server verifies submitted runs by running this same code. Anything here that reaches
  // for a browser makes that impossible, and the failure would turn up as a deployment that
  // cannot verify anything rather than as a test.
  const FORBIDDEN =
    /\b(window|document|localStorage|sessionStorage|navigator|requestAnimationFrame|performance|alert|XMLHttpRequest)\b/;

  // Comments count, which is a deliberate false positive: a source that talks about `document`
  // is a source someone was thinking about the DOM in. Reword it.
  it('reaches for nothing a browser has to provide', () => {
    for (const name of sources) {
      const offender = read(name)
        .split('\n')
        .findIndex((line) => FORBIDDEN.test(line));
      expect(offender, `src/engine/${name}:${offender + 1}`).toBe(-1);
    }
  });

  it('imports nothing from outside itself', () => {
    // `settings.ts` imports *from* the engine, and `input/keyboard.ts` imports settings. One
    // import the other way and the engine drags the DOM in behind it.
    for (const name of sources) {
      for (const [, specifier] of read(name).matchAll(/from '([^']+)'/g)) {
        expect(specifier, `src/engine/${name} imports ${specifier}`).toMatch(/^\.\//);
      }
    }
  });

  it('is looking at the files it thinks it is', () => {
    // Cheap insurance against the two tests above passing because the glob found nothing.
    expect(sources).toContain('game.ts');
    expect(sources).toContain('player.ts');
    expect(sources.length).toBeGreaterThan(10);
  });
});
