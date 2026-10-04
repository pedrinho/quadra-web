/*
 * Search for a run that ends in the longest possible cascade — a chain.
 *
 * A chain is `Canvas.complexity`: how many times the clear/fall/clear loop went round for one
 * move. The score pays 200·(steps-1)² for it, and the board shows it as BEST CHAIN.
 *
 * The shape that produces a long one, worked out against the engine and then found by this
 * search, is a ladder. Every row is complete but for a single cell, the hole one column over
 * from the row below it. The row above the ladder is full but for one cell, and above *that*
 * sits a row of lone cells, one directly over each hole column, each welded down into the row
 * below so nothing has fallen yet.
 *
 *     rows 20     .abcdef...      the springs: one lone cell per hole column
 *     row  21     Tabcdefzzz      full but for column 0 — the trigger goes here
 *     row  22     FFFFFF.FFF      hole at column 6
 *     row  23     EEEEE.EEEE      hole at column 5
 *      ...            ...
 *     row  31     A.AAAAAAAA      hole at column 1
 *
 * Fill the last cell of row 21 and it clears, which severs every spring at once. Each falls
 * down its own column and stops on the first cell under it, so only the one standing over the
 * next hole down reaches it. That completes one row, which clears, which drops every remaining
 * spring another row, which lands the next one in its hole. One row per iteration, all the way
 * to the floor: the chain is as deep as the ladder is tall.
 *
 * Two things bound it. Nothing falls differently from its neighbours until a clear severs it,
 * and the only clear with the whole ladder still standing above it is the trigger's — so every
 * spring has to hang off that one row, and that row is ten cells wide. And a spring has to be a
 * *lone* cell: two cells of one piece side by side up there stay welded and fall as a pair,
 * which lands them on the stack instead of in a hole. Nine iterations is what those two add up
 * to, and nine is what the search finds; it has not found ten at any width.
 *
 * The search is a beam over hard drops of one seed's piece stream. It never lets a line
 * complete while building — the whole tower has to be worth nothing until the last piece — and
 * it scores a position by actually dropping the next piece every way it can and running the
 * cascade, so what it reports is what the engine does, not what this comment claims.
 */

import { Board, PLAY_BOTTOM, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, boardToAscii } from '../src/engine/board.js';
import { clearFullLines, settle } from '../src/engine/cascade.js';
import { PIECES } from '../src/engine/pieces.js';
import { Random } from '../src/engine/random.js';

/** Rotations that are actually distinct, per piece. O has one, S/Z/I two, J/L/T four. */
const ROTS: readonly number[][] = [[0], [0, 1], [0, 1], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1], [0, 1, 2, 3]];

/**
 * The real spawn row. Every landing is measured from here, so the search can never propose a
 * stack the player could not have reached — a tower too tall to spawn into comes back as no
 * solution rather than as a recording that tops out.
 */
const SPAWN_BY = 10;

/**
 * How many pieces to build with before the trigger. The ladder that chains nine is twenty-five
 * pieces; the rest is room for a seed that needs longer to get there.
 */
const BUILD_PIECES = 34;

export interface Placement {
  piece: number;
  rot: number;
  /** Board column of the piece's 4x4 box. */
  bx: number;
  /** Board row the box came to rest at. */
  by: number;
}

export function pieceStream(seed: number, n: number): number[] {
  const rnd = new Random(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rnd.rnd() % 7);
  return out;
}

function clone(b: Board): Board {
  const n = new Board();
  n.occupied.set(b.occupied);
  n.block.set(b.block);
  n.tmp.set(b.tmp);
  n.moved.set(b.moved);
  n.blinded.set(b.blinded);
  n.bflash.set(b.bflash);
  return n;
}

/** Where a hard drop from the spawn row comes to rest, or null if the piece cannot spawn there. */
function landing(b: Board, piece: number, rot: number, bx: number): number | null {
  if (b.checkCollide(piece, bx, SPAWN_BY, rot)) return null;
  let by = SPAWN_BY;
  while (!b.checkCollide(piece, bx, by + 1, rot)) by++;
  return by;
}

/** Stamp a landed piece. The piece table entries are the exposed-edge masks, so this welds it. */
function stamp(b: Board, p: Placement): void {
  const grid = PIECES[p.piece]![p.rot]!;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const mask = grid[j]![i]!;
      if (mask) b.setCell(p.by + j, p.bx + i, mask, (p.piece % 7) + 1);
    }
}

function anyRowComplete(b: Board): boolean {
  for (let j = PLAY_TOP; j < PLAY_BOTTOM; j++) {
    let full = true;
    for (let i = PLAY_LEFT; i < PLAY_RIGHT && full; i++) if (!b.isOccupied(j, i)) full = false;
    if (full) return true;
  }
  return false;
}

export interface Cascade {
  /** Iterations of the clear/fall loop — the chain. */
  steps: number;
  lines: number;
  clean: boolean;
}

/** Run the cascade on a copy and report what it did. */
export function cascadeOf(b: Board): Cascade {
  const board = clone(b);
  let steps = 0;
  let lines = 0;
  for (;;) {
    const cleared = clearFullLines(board);
    if (!cleared.count) break;
    steps++;
    lines += cleared.count;
    settle(board);
  }
  return { steps, lines, clean: board.isClean() };
}

/**
 * How ladder-shaped a position is. The search needs a gradient long before any arrangement
 * chains at all, and this is it: rows missing exactly one cell are the rungs, and a hole with
 * a cell directly over it is a rung with something standing on it that can fall in later.
 */
function ladderness(b: Board): {
  rungs: number;
  covered: number;
  cells: number;
  waste: number;
  shared: number;
} {
  let rungs = 0;
  let covered = 0;
  let cells = 0;
  let waste = 0;
  // Two rungs sharing a hole column have to be served one after the other by the same shaft,
  // which works — the recorded run does it twice — but it is fiddly and the beam finds ladders
  // faster when nudged away from it. A bias, not a rule.
  const holeCols = new Set<number>();
  let shared = 0;
  // The topmost row with anything in it is the surface being worked on; it is allowed to be
  // ragged. Every row under it is finished, and a finished row that is more than one cell
  // short is a row that can never clear.
  let surface = PLAY_BOTTOM;
  for (let j = PLAY_TOP; j < PLAY_BOTTOM && surface === PLAY_BOTTOM; j++)
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) if (b.isOccupied(j, i)) surface = j;

  for (let j = PLAY_TOP; j < PLAY_BOTTOM; j++) {
    let filled = 0;
    let holeCol = -1;
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) {
      if (b.isOccupied(j, i)) filled++;
      else holeCol = i;
    }
    cells += filled;
    if (filled === 0) continue;
    if (filled === 9) {
      rungs++;
      // A hole with a cell over it is a rung something can still fall into.
      if (b.isOccupied(j - 1, holeCol)) covered++;
      if (holeCols.has(holeCol)) shared++;
      holeCols.add(holeCol);
    } else if (j > surface) {
      waste += 9 - filled;
    }
  }
  return { rungs, covered, cells, waste, shared };
}

/** Occupancy fingerprint, so the beam does not spend its width on the same position twice. */
function fingerprint(b: Board): string {
  let out = '';
  for (let j = PLAY_TOP; j < PLAY_BOTTOM; j++) {
    let bits = 0;
    for (let i = PLAY_LEFT; i < PLAY_RIGHT; i++) if (b.isOccupied(j, i)) bits |= 1 << (i - PLAY_LEFT);
    out += String.fromCharCode(bits);
  }
  return out;
}

export interface Found {
  seed: number;
  /** The build, in stream order. */
  build: Placement[];
  /** The last piece, the one the chain hangs off. */
  trigger: Placement;
  cascade: Cascade;
}

interface State {
  board: Board;
  build: Placement[];
  rank: number;
}

/**
 * Beam search over the stream. At every depth each surviving position is scored by dropping
 * the *next* piece every legal way and running the real cascade, so the number this returns
 * has already happened in the engine once.
 */
export function searchSeed(
  seed: number,
  opts: { pieces?: number; beam?: number } = {},
): Found | null {
  const { pieces = BUILD_PIECES, beam = 60 } = opts;
  const stream = pieceStream(seed, pieces + 1);

  let states: State[] = [{ board: new Board(), build: [], rank: 0 }];
  let best: Found | null = null;

  /** The deepest chain the next piece can set off from here, and the drop that does it. */
  const trigger = (board: Board, piece: number): { at: Placement; cascade: Cascade } | null => {
    let found: { at: Placement; cascade: Cascade } | null = null;
    for (const rot of ROTS[piece]!) {
      for (let bx = 0; bx <= PLAY_RIGHT - 1; bx++) {
        const by = landing(board, piece, rot, bx);
        if (by === null || by < SPAWN_BY) continue;
        const at = { piece, rot, bx, by };
        const after = clone(board);
        stamp(after, at);
        const cascade = cascadeOf(after);
        if (!found || cascade.steps > found.cascade.steps) found = { at, cascade };
      }
    }
    return found;
  };

  for (let k = 0; k < pieces; k++) {
    const piece = stream[k]!;
    const next = stream[k + 1]!;
    const children: State[] = [];
    const seen = new Set<string>();

    for (const state of states) {
      for (const rot of ROTS[piece]!) {
        for (let bx = 0; bx <= PLAY_RIGHT - 1; bx++) {
          const by = landing(state.board, piece, rot, bx);
          if (by === null || by < SPAWN_BY) continue;
          const placement = { piece, rot, bx, by };
          const board = clone(state.board);
          stamp(board, placement);
          // Nothing may clear while the tower is going up: the move being searched for is the
          // last piece, and a line that goes early is a line the chain does not get to use.
          if (anyRowComplete(board)) continue;
          // Two different drops often leave the same cells; only the welds differ, and the
          // beam is better spent on different shapes than on the same shape twice.
          const print = fingerprint(board);
          if (seen.has(print)) continue;
          seen.add(print);

          const { rungs, covered, cells, waste, shared } = ladderness(board);
          children.push({
            board,
            build: [...state.build, placement],
            rank: rungs * 1000 + covered * 300 - shared * 700 - waste * 100 + cells * 3,
          });
        }
      }
    }
    if (!children.length) break;

    // Shape alone decides who is worth simulating; then the survivors are re-ranked by what
    // the next piece can actually do from there, which is the thing being maximised.
    children.sort((a, b) => b.rank - a.rank);
    const shortlist = children.slice(0, beam * 3);
    for (const state of shortlist) {
      const shot = trigger(state.board, next);
      if (!shot) continue;
      state.rank += shot.cascade.steps * 20_000;
      if (!best || shot.cascade.steps > best.cascade.steps) {
        best = { seed, build: state.build, trigger: shot.at, cascade: shot.cascade };
      }
    }
    shortlist.sort((a, b) => b.rank - a.rank);
    states = shortlist.slice(0, beam);
  }
  return best;
}

/** Render a board the way the tools do, for reporting. */
export function draw(build: Placement[]): string[] {
  const board = new Board();
  for (const p of build) stamp(board, p);
  return boardToAscii(board);
}

/**
 * Beam search is not monotone in its width — a wider beam keeps positions that crowd out the
 * one that would have gone deepest, and the same seed really does chain further at 120 than at
 * 300. So the honest search is several widths, best answer wins.
 */
export const WIDTHS = [40, 60, 120, 300, 800] as const;

export function searchBest(
  seed: number,
  opts: { pieces?: number; widths?: readonly number[] } = {},
): Found | null {
  const { pieces = BUILD_PIECES, widths = WIDTHS } = opts;
  let best: Found | null = null;
  for (const beam of widths) {
    const found = searchSeed(seed, { pieces, beam });
    if (found && (!best || found.cascade.steps > best.cascade.steps)) best = found;
  }
  return best;
}

/** Sweep a range of seeds, keeping the deepest chain any of them can be played into. */
export function searchSeeds(
  from: number,
  to: number,
  opts: { pieces?: number; widths?: readonly number[]; onBest?: (f: Found) => void } = {},
): Found | null {
  const { pieces = BUILD_PIECES, widths = WIDTHS } = opts;
  let best: Found | null = null;
  for (let seed = from; seed <= to; seed++) {
    const found = searchBest(seed, { pieces, widths });
    if (found && (!best || found.cascade.steps > best.cascade.steps)) {
      best = found;
      opts.onBest?.(found);
    }
  }
  return best;
}
