import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { parseRec } from '../src/replay/rec.js';
import { playRec } from '../src/replay/rec-playback.js';
import { RECORDINGS, canPlay } from '../src/museum/recordings.js';

/**
 * The museum's recordings, held to their own files.
 *
 * Every line the museum prints about a recording — when it was played, how long it ran, which
 * version wrote it, who played and what they scored — is in the recording's summary, written by
 * the game that recorded it. So each entry is checked against that rather than trusted, and the
 * one that says it plays here is played.
 */

const dir = new URL('../public/museum/rec/', import.meta.url);
const read = (file: string) => new Uint8Array(readFileSync(new URL(file, dir)));

describe('the museum recordings', () => {
  it('lists every file in the folder, once', () => {
    const files = RECORDINGS.map((r) => r.file).sort();
    expect(new Set(files).size).toBe(files.length);
    expect(new Set(RECORDINGS.map((r) => r.id)).size).toBe(RECORDINGS.length);
    expect(files).toEqual(readdirSync(dir).sort());
  });

  for (const rec of RECORDINGS) {
    it(`${rec.file} says what the museum says about it`, async () => {
      const demo = await parseRec(read(rec.file));
      const summary = demo.summary;
      if (!summary) throw new Error('no summary');

      expect(demo.packetFormat).toBe(rec.form === 'packet');
      expect(summary.get('quadra_version')).toBe(rec.quadra);
      expect(Number(summary.get('version'))).toBe(rec.protocol);
      expect(Number(summary.get('duration'))).toBe(rec.duration);
      const played = new Date(Number(summary.get('time')) * 1000).toISOString().slice(0, 10);
      expect(played).toBe(rec.played);
      expect(summary.get('name') || undefined).toBe(rec.server);

      const players = [];
      for (let i = 0; summary.has(`players/${i}/name`); i++) {
        players.push({
          name: summary.get(`players/${i}/name`),
          score: Number(summary.get(`players/${i}/score`)),
        });
      }
      expect(players).toEqual(rec.players);
    });
  }

  it('plays the ones it offers to play', () => {
    expect(RECORDINGS.filter(canPlay).map((r) => r.id)).toEqual(['pedrinhu-854975', 'buk14clean']);
  });

  // Buk14clean is replayed in rec.test.ts. This is the other one, and the longer: twelve minutes
  // from 2003, which reached the world top 100.
  it('replays pedrinhu to the score the world list printed', async () => {
    const demo = await parseRec(read('pedrinhu-854975.rec'));
    const outcome = playRec(demo);
    expect(outcome.score).toBe(854975);
    expect(outcome.lines).toBe(343);
    expect(outcome.level).toBe(23);
    expect(outcome.complete).toBe(true);
  });

  // The game wrote the host's addresses into later recordings, in the summary and in the game
  // information packet. Files published here have had any public ones blanked; a LAN or loopback
  // address identifies nobody.
  it('publishes no public network address', () => {
    const quad = /\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b(?!\.)/g;
    for (const rec of RECORDINGS) {
      const text = inflateSync(read(rec.file).subarray(4)).toString('latin1');
      const found = [...text.matchAll(quad)]
        .filter(([, a, b]) => !(a === '127' || a === '10' || (a === '192' && b === '168')))
        .map(([q]) => q);
      expect(found, rec.file).toEqual([]);
    }
  });
});
