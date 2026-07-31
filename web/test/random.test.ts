import { describe, it, expect } from 'vitest';
import { Random } from '../src/engine/random.js';

/*
 * Golden vectors captured from the original C++ (source/random.cc) compiled with clang++
 * on arm64 macOS, where sizeof(time_t) == 8. Regenerate with tools/oracle/rnd.cc if the
 * reference implementation ever changes.
 *
 * These exist because the LCG is 64-bit, not 32-bit. A `Math.imul`-based port passes
 * casual inspection and produces a completely different piece stream.
 */

const RND: Record<string, number[]> = {
  '0': [12, 63237, 49417, 39239, 27301, 34759, 43864, 18291, 54955, 13981, 63820, 27441],
  '1': [29087, 40876, 57465, 6886, 21239, 32477, 30893, 16107, 54575, 64949, 44876, 30717],
  '12345': [63237, 49417, 39239, 27301, 34759, 43864, 18291, 54955, 13981, 63820, 27441, 34539],
  '987654321': [40876, 33888, 25802, 53239, 6932, 18629, 9972, 12831, 10391, 43871, 37157, 18623],
  '-42': [24020, 19376, 39116, 21776, 19759, 65067, 64369, 44492, 5389, 36029, 7518, 20919],
};

const PIECES: Record<string, number[]> = {
  '0': [5, 6, 4, 4, 1, 4, 2, 0, 5, 2, 1, 1, 1, 5, 4, 0, 4, 2, 1, 3],
  '1': [2, 3, 2, 5, 1, 4, 2, 0, 3, 3, 6, 1, 4, 2, 1, 4, 1, 1, 4, 5],
  '12345': [6, 4, 4, 1, 4, 2, 0, 5, 2, 1, 1, 1, 5, 4, 0, 4, 2, 1, 3, 4],
  '987654321': [3, 1, 0, 4, 2, 2, 4, 0, 3, 2, 1, 3, 6, 6, 3, 0, 1, 0, 4, 2],
  '-42': [3, 0, 0, 6, 5, 2, 4, 0, 6, 0, 0, 3, 6, 3, 1, 1, 4, 1, 4, 0],
};

const CRAP: Record<string, number[]> = {
  '0': [12345, 56661, 50532, 20310, 30288, 33810, 40070, 37972, 8890, 6945, 63175, 4082],
  '1': [32422, 748, 14713, 18543, 17187, 2697, 32787, 25433, 29169, 49573, 21929, 63594],
  '12345': [5758, 58202, 19857, 18064, 19894, 48656, 53948, 28829, 45797, 58229, 1233, 59238],
  '987654321': [45462, 38005, 51770, 53443, 32733, 18348, 31734, 53951, 38109, 35578, 50867, 39382],
  '-42': [21079, 47997, 64655, 16012, 19868, 47504, 15055, 22959, 21463, 45821, 4277, 2989],
};

describe('Random — bit-exact with C++ source/random.cc', () => {
  for (const [seed, expected] of Object.entries(RND)) {
    it(`rnd() matches for seed ${seed}`, () => {
      const r = new Random(Number(seed));
      expect(Array.from({ length: expected.length }, () => r.rnd())).toEqual(expected);
    });
  }

  for (const [seed, expected] of Object.entries(PIECES)) {
    it(`piece stream rnd()%7 matches for seed ${seed}`, () => {
      const r = new Random(Number(seed));
      expect(Array.from({ length: expected.length }, () => r.rnd() % 7)).toEqual(expected);
    });
  }

  for (const [seed, expected] of Object.entries(CRAP)) {
    it(`crapRnd() matches for seed ${seed}`, () => {
      const r = new Random(Number(seed));
      expect(Array.from({ length: expected.length }, () => r.crapRnd())).toEqual(expected);
    });
  }

  it('masks results to the requested width', () => {
    const r = new Random(12345);
    for (let i = 0; i < 100; i++) expect(r.rnd(127)).toBeLessThanOrEqual(127);
  });

  it('never returns a negative value, even from a negative seed', () => {
    const r = new Random(-999999);
    for (let i = 0; i < 100; i++) expect(r.rnd()).toBeGreaterThanOrEqual(0);
  });
});
