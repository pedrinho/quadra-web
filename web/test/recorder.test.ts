import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game.js';
import { Action, groupsFromBindings } from '../src/engine/canvas.js';
import { boardToAscii } from '../src/engine/board.js';
import { DEFAULT_KEYS } from '../src/settings.js';
import { RecorderBypassError, TapeRecorder, record } from '../src/replay/recorder.js';
import { TapePlayer, replay } from '../src/replay/playback.js';
import { boardHash, stateHash } from '../src/replay/hash.js';
import { EventOp, TapeError, decodeTape, encodeTape } from '../src/replay/tape.js';
import { Autoplayer, SCORING_SEED } from './autoplay.js';

/** Everything about a finished game that a leaderboard, a viewer or a verifier would look at. */
const outcome = (g: Game) => ({
  score: g.canvas.score,
  lines: g.canvas.linesTot,
  level: g.canvas.level,
  frame: g.frame,
  ticks: g.ticks,
  seed: g.canvas.rnd.getSeed(),
  board: boardToAscii(g.canvas),
  boardHash: boardHash(g.canvas),
  stateHash: stateHash(g),
});

/**
 * The scripted pattern from test/game.test.ts, driven through Game's input seam rather than
 * straight at the canvas — which is what the recorder can see, and what a player does.
 */
const scripted = (g: Game, frame: number): void => {
  if (frame % 37 === 0) g.input(Action.Left, true);
  if (frame % 53 === 0) g.input(Action.Left, false);
  if (frame % 71 === 0) g.input(Action.Drop, true);
  if (frame % 73 === 0) g.input(Action.Drop, false);
  if (frame % 91 === 0) g.input(Action.RotateLeft, true);
  if (frame % 97 === 0) g.input(Action.RotateLeft, false);
};

/** A recorded game of the stacker, played until it buries itself or the frames run out. */
const play = (frames = 6000, opts: { seed?: number; checkpointInterval?: number } = {}) => {
  const game = new Game({ seed: opts.seed ?? SCORING_SEED, shadow: true });
  const recorder = record(game, {
    startedAt: 1_770_000_000_000,
    ...(opts.checkpointInterval === undefined
      ? {}
      : { checkpointInterval: opts.checkpointInterval }),
  });
  const player = new Autoplayer(game);
  for (let i = 0; i < frames && !game.isOver; i++) {
    player.frame();
    game.stepFrame(1);
  }
  return { game, recorder };
};

describe('record and replay', () => {
  it('replays to the same game, down to the state hash', () => {
    const { game, recorder } = play();
    const replayed = replay(recorder.tape());
    expect(outcome(replayed)).toEqual(outcome(game));
    // Not a vacuous comparison: the run has to have cleared lines, scored and ended, or none
    // of the code a leaderboard actually depends on was on the path.
    expect(game.canvas.linesTot).toBeGreaterThan(0);
    expect(game.canvas.score).toBeGreaterThan(0);
    expect(game.isOver).toBe(true);
  });

  it('reproduces a game played on a jagged frame cadence, stalls included', () => {
    // Real rAF deltas wander, and a browser that loses the thread for a second makes `advance`
    // skip the backlog rather than simulate it. Both are simulation-visible: the tick/frame
    // interleaving decides when input is sampled, and the skip moves the master clock. This is
    // also the test that would catch the clock going fractional.
    const deltas = [16.7, 16.7, 33.4, 8.2, 16.7, 100.9, 16.7, 16.7, 7.1, 16.7];
    const game = new Game({ seed: 909, shadow: true });
    const recorder = record(game);
    for (let i = 0; i < 1500 && !game.isOver; i++) {
      scripted(game, i);
      game.advance(i === 700 ? 1234.5 : deltas[i % deltas.length]!);
    }
    expect(Number.isInteger(game.frame)).toBe(true);

    const tape = recorder.tape();
    expect(tape.frames.some((f) => f.jump > 0)).toBe(true);
    expect(outcome(replay(tape))).toEqual(outcome(game));
  });

  it('reproduces pausing, retuning and rebinding mid-game', () => {
    // None of these look like input, and all three feed the simulation: pause gates the key
    // handler, the sensitivities become the DAS delays, and the grouping decides which actions
    // share a sticky slot.
    const shared = [...DEFAULT_KEYS];
    shared[Action.RotateRight] = shared[Action.RotateLeft]!;

    const game = new Game({ seed: 4242, hSensitivity: 80, vSensitivity: 80 });
    const recorder = record(game);
    for (let i = 0; i < 2000 && !game.isOver; i++) {
      scripted(game, i);
      if (i === 300) game.setPaused(true);
      if (i === 420) game.setPaused(false);
      if (i === 700) game.setSensitivity(20, 100, false);
      if (i === 900) game.setKeyGroups(groupsFromBindings(shared));
      if (i === 1200) game.setSensitivity(100, 0, true);
      game.stepFrame(1);
    }

    const tape = recorder.tape();
    const ops = tape.frames.flatMap((f) => f.events.map((e) => e.op));
    expect(ops).toContain(EventOp.Pause);
    expect(ops).toContain(EventOp.Reconfig);
    expect(ops).toContain(EventOp.ClearAll);
    expect(outcome(replay(tape))).toEqual(outcome(game));
  });

  it('does not clear sticky keys twice when replaying a rebind', () => {
    // A rebind is recorded as Reconfig + ClearAll. If playback used setKeyGroups, which clears
    // on its own, a key pressed between the two would be wiped on replay but not in the live
    // game — a divergence that only shows up under a very specific press.
    const game = new Game({ seed: 77 });
    const recorder = record(game);
    game.stepFrame(1);
    game.setKeyGroups(groupsFromBindings(DEFAULT_KEYS));
    game.input(Action.Left, true);
    game.stepFrame(1);

    const replayed = replay(recorder.tape());
    expect(replayed.canvas.checkKey(Action.Left)).toBe(game.canvas.checkKey(Action.Left));
    expect(game.canvas.checkKey(Action.Left)).not.toBe(0);
  });

  it('lets a viewer seek anywhere and get the frame the run actually had', () => {
    const { recorder } = play(1200);
    const tape = recorder.tape();

    const straight = new TapePlayer(tape);
    straight.seek(800);
    const at800 = stateHash(straight.game);

    const scrubbed = new TapePlayer(tape);
    scrubbed.seek(1000);
    scrubbed.seek(200);
    scrubbed.seek(800); // backwards then forwards: re-simulated, not rewound
    expect(stateHash(scrubbed.game)).toBe(at800);

    scrubbed.run();
    straight.run();
    expect(stateHash(scrubbed.game)).toBe(stateHash(straight.game));
  });
});

describe('checkpoints', () => {
  it('are recorded periodically and agree with the replay', () => {
    const { recorder } = play(3000, { checkpointInterval: 500 });
    const tape = recorder.tape();
    const checkpoints = tape.frames.flatMap((f) =>
      f.events.filter((e) => e.op === EventOp.Checkpoint),
    );
    expect(checkpoints.length).toBeGreaterThanOrEqual(6);
    expect(() => replay(tape)).not.toThrow();
  });

  it('report the frame a divergence happened on rather than a wrong final score', () => {
    const { recorder } = play(1500, { checkpointInterval: 200 });
    const tape = recorder.tape();
    // Doctor the recording the way a desynced engine would: a mid-run state nothing can reach.
    const index = tape.frames.findIndex(
      (f, i) => i > 400 && f.events.some((e) => e.op === EventOp.Checkpoint),
    );
    const event = tape.frames[index]!.events.find((e) => e.op === EventOp.Checkpoint)!;
    if (event.op === EventOp.Checkpoint) event.lanes = [event.lanes[0] ^ 1, event.lanes[1]];

    try {
      replay(tape);
      expect.unreachable('the doctored checkpoint should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(TapeError);
      expect((err as TapeError).code).toBe('checkpoint-mismatch');
      expect((err as TapeError).message).toContain(`frame ${index}`);
    }
  });

  it('can be switched off, which is the only thing that then differs', () => {
    const { game } = play(600, { checkpointInterval: 0 });
    const { game: withThem } = play(600, { checkpointInterval: 50 });
    expect(outcome(withThem)).toEqual(outcome(game));
  });
});

describe('the bytes', () => {
  it('are canonical, so a recorded tape and an encoded one are the same blob', () => {
    const { recorder } = play(2000);
    const bytes = recorder.bytes();
    expect(encodeTape(decodeTape(bytes))).toEqual(bytes);
  });

  it('can be read mid-game without disturbing the recording', () => {
    const game = new Game({ seed: 31337 });
    const recorder = record(game);
    const prefixes: Uint8Array[] = [];
    for (let i = 0; i < 500; i++) {
      scripted(game, i);
      game.stepFrame(1);
      if (i % 97 === 0) prefixes.push(recorder.bytes());
    }
    // Every snapshot is a valid tape of the game so far, and taking them changed nothing.
    for (const bytes of prefixes) expect(() => decodeTape(bytes)).not.toThrow();
    expect(encodeTape(decodeTape(recorder.bytes()))).toEqual(recorder.bytes());
    expect(recorder.frameCount).toBe(500);
  });

  it('stay small enough to leave recording on for every game', () => {
    const { recorder } = play(4000);
    // Under a byte a frame for active play — a ten-minute run is tens of kilobytes, so there
    // is never a reason to ask the player whether they want to be recorded.
    expect(recorder.bytes().length).toBeLessThan(recorder.frameCount);
  });

  it('collapse an idle stretch to almost nothing', () => {
    const game = new Game({ seed: 1 });
    const recorder = record(game, { checkpointInterval: 0 });
    for (let i = 0; i < 3600; i++) game.stepFrame(1);
    expect(recorder.bytes().length).toBeLessThan(60);
    expect(replay(recorder.tape()).frame).toBe(game.frame);
  });
});

describe('the bypass guard', () => {
  it('stays quiet through ordinary play', () => {
    expect(() => play(3000)).not.toThrow();
  });

  it('refuses to record a game that is already under way', () => {
    const game = new Game({ seed: 5 });
    game.stepFrame(1);
    expect(() => record(game)).toThrow(/frame 1/);
  });

  it('catches input that went round the seam, and says which frame', () => {
    const game = new Game({ seed: 5 });
    record(game);
    game.stepFrame(1);
    game.canvas.pressKey(Action.Left); // straight at the canvas: invisible to the recorder
    expect(() => game.stepFrame(1)).toThrow(RecorderBypassError);
  });

  it('is not fooled by the simulation changing key state itself', () => {
    // Auto-repeat unreleases keys and a new piece clears the soft-drop key when continuous is
    // off. Those are consequences of the tape, not input, and must not read as a bypass.
    const game = new Game({ seed: 8, continuous: false });
    record(game);
    for (let i = 0; i < 2000 && !game.isOver; i++) {
      if (i === 10) game.input(Action.Down, true);
      if (i === 12) game.input(Action.Left, true);
      game.stepFrame(1);
    }
    expect(game.frame).toBeGreaterThan(0);
  });

  it('can be turned off where a throw is worse than an unverifiable tape', () => {
    const game = new Game({ seed: 5 });
    const recorder = new TapeRecorder(game, { guard: false });
    game.attachRecorder(recorder);
    game.canvas.pressKey(Action.Left);
    expect(() => game.stepFrame(1)).not.toThrow();
    // The press is simply missing from the recording, which a replay would then disagree with.
    const events = recorder.tape().frames[0]!.events;
    expect(events.some((e) => e.op === EventOp.Press)).toBe(false);
  });
});

describe('the ghost piece', () => {
  it('cannot affect the simulation', () => {
    // Which is what lets a verifier switch it off, and what makes it safe for two players to
    // disagree about whether they want it. Same argument as the sound queue.
    const run = (shadow: boolean) => {
      const g = new Game({ seed: 555, shadow });
      for (let i = 0; i < 4000 && !g.isOver; i++) {
        scripted(g, i);
        g.stepFrame(1);
      }
      return stateHash(g);
    };
    expect(run(true)).toBe(run(false));
  });

  it('is replayable with the ghost forced off', () => {
    const { game, recorder } = play(2000);
    expect(game.start.shadow).toBe(true);
    expect(stateHash(replay(recorder.tape(), { shadow: false }))).toBe(stateHash(game));
  });
});
