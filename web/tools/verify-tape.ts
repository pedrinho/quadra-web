/*
 * Check a recording the way a server would, from the command line.
 *
 *   npx vite-node tools/verify-tape.ts run.qtape
 *   npx vite-node tools/verify-tape.ts run.txt --json     # machine-readable, exit 1 if invalid
 *
 * The file may be raw tape bytes — `GET /v1/runs/<id>/tape` serves exactly that — or the same
 * bytes as base64 text, for a recording pasted into a bug report. Which is the point of having
 * this at all: when a run is disputed, the answer is not an opinion, it is this command.
 */

import { readFileSync } from 'node:fs';
import { TICK_MS } from '../src/engine/game.js';
import { verify } from '../src/replay/verify.js';
import { TapePlayer } from '../src/replay/playback.js';
import { decodeTape, EventOp } from '../src/replay/tape.js';

const NAMES: Record<number, string> = {
  [EventOp.Press]: 'presses',
  [EventOp.Release]: 'releases',
  [EventOp.ClearAll]: 'key clears',
  [EventOp.Pause]: 'pauses',
  [EventOp.Reconfig]: 'setting changes',
  [EventOp.Checkpoint]: 'checkpoints',
};

const args = process.argv.slice(2);
const json = args.includes('--json');
const path = args.find((a) => !a.startsWith('-'));

if (!path) {
  console.error('usage: vite-node tools/verify-tape.ts <tape file> [--json]');
  process.exit(2);
}

const raw = readFileSync(path);
const bytes = looksBinary(raw) ? new Uint8Array(raw) : new Uint8Array(Buffer.from(raw.toString('utf8').trim(), 'base64'));

const started = performance.now();
const result = verify(bytes);
const took = performance.now() - started;

if (json) {
  console.log(JSON.stringify({ ...result, ms: took }, replacer, 2));
  process.exit(result.ok ? 0 : 1);
}

if (!result.ok) {
  console.error(`INVALID (${result.code})`);
  console.error(`  ${result.message}`);
  console.error(`  after ${result.frame} frames${result.at === undefined ? '' : `, byte ${result.at}`}`);
  process.exit(1);
}

const seconds = (result.ticks * TICK_MS) / 1000;
console.log('VALID');
console.log(`  score        ${result.score.toLocaleString()}`);
console.log(`  lines        ${result.lines}`);
console.log(`  level        ${result.level}`);
console.log(`  played       ${formatDuration(seconds)} over ${result.frames} frames`);
console.log(`  ended        ${result.over ? 'topped out' : 'tape stops mid-game'}`);
console.log(`  seed         ${result.header.seed}`);
console.log(`  sim version  ${result.header.simVersion}`);
console.log(`  started      ${result.header.startedAt ? new Date(result.header.startedAt).toISOString() : 'unrecorded'}`);
console.log(`  size         ${bytes.length} bytes (${(bytes.length / result.frames).toFixed(2)}/frame)`);
console.log(`  state        ${result.stateHash}`);
console.log(`  verified in  ${took.toFixed(1)} ms`);

// What the player actually did, which is all the file contains.
const tape = decodeTape(bytes);
const counts = new Map<string, number>();
for (const frame of tape.frames) {
  for (const event of frame.events) counts.set(NAMES[event.op], (counts.get(NAMES[event.op]) ?? 0) + 1);
}
const summary = [...counts].map(([name, n]) => `${n} ${name}`).join(', ');
console.log(`  input        ${summary || 'none'}`);

// Where the run stood at each of its own checkpoints, since those are the only claims a tape
// makes about its middle rather than its end.
const marks = tape.frames.flatMap((f, i) =>
  f.events.filter((e) => e.op === EventOp.Checkpoint).map(() => i),
);
if (marks.length > 1) {
  console.log('\n  checkpoints');
  const player = new TapePlayer(tape);
  for (const at of marks) {
    player.seek(at);
    console.log(
      `    frame ${String(at).padStart(6)}  score ${String(player.game.canvas.score).padStart(7)}` +
        `  lines ${String(player.game.canvas.linesTot).padStart(3)}`,
    );
  }
}

/** Tape bytes start with the "QTAP" magic; base64 of it does not. */
function looksBinary(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x41 && buf[2] === 0x54 && buf[3] === 0x51;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m > 0 ? `${m}m ${(seconds % 60).toFixed(0)}s` : `${seconds.toFixed(1)}s`;
}

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
