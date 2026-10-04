/*
 * Search for a seed whose piece stream can be stacked into an n-line clean.
 *
 * The shape is a tower of storeys, each missing exactly one well, with the piece that fills that
 * well parked above the tower — one park per storey but the top one. A well is as deep as the
 * piece that fills it is tall, which is four cells over its width: a one-wide well is four rows
 * deep and takes a vertical I. For three such storeys — a twelve-line clean:
 *
 *     rows 16-19   #....#....      two parked I's, over the wells of the storeys below
 *     rows 20-23   ####.#####      missing column 4   <- the fuse
 *     rows 24-27   #####.####      missing column 5   <- a well
 *     rows 28-31   #.########      missing column 1   <- a well
 *
 * No row holds more than nine cells, so nothing clears while it is being built — the whole
 * tower is worth nothing until the last piece. Drop a vertical I into the fuse and the top
 * storey goes; that unsupports both parked I's, which fall one storey each, and the one over
 * the storey now exposed drops into its well and completes it. That storey goes, the remaining
 * park falls again, and so on down. Every storey clears, the board ends empty, and it is all
 * one move: four lines per storey, one cascade step per storey.
 *
 * Ten lines does not divide into four-row storeys, and no rearranging fixes that: ten rows each
 * missing one column is ninety cells, which is not a whole number of tetrominoes. A two-wide
 * well is what makes it come out even. It only needs to be two rows deep, because an O is what
 * falls into it, and the cascade runs through it exactly the same way:
 *
 *     rows 18-19   ..#.......      the I park, over the one-wide well below
 *     rows 20-21   OO#.......      the O park, resting on the tower beside it
 *     rows 22-25   ...#######      missing column 3    <- the fuse
 *     rows 26-29   ##.#######      missing column 2    <- a well, four rows deep
 *     rows 30-31   ..########      missing columns 0-1 <- a well, two rows deep
 *
 * Two four-row storeys is eight lines and fits easily. Three is twelve and stands sixteen rows
 * tall, which leaves four rows of headroom under the spawn box — a fourth storey would collide
 * with the piece as it appears and top the player out, so twelve is the ceiling for that shape.
 *
 * What has to be searched for is the piece stream. Pieces arrive in whatever order the seed's
 * LCG says, they can only be hard-dropped, and every one has to land inside the shape — so most
 * seeds cannot build it. The DFS is exact: a seed it rejects genuinely cannot do it.
 */

import { PIECES } from '../src/engine/pieces.js';
import { COLS, PLAY_LEFT, idx } from '../src/engine/board.js';
import { Random } from '../src/engine/random.js';

/** Rotations that are actually distinct, per piece. O has one, S/Z/I two, J/L/T four. */
const ROTS: readonly number[][] = [[0], [0, 1], [0, 1], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1], [0, 1, 2, 3]];
const O_PIECE = 0;
const I_PIECE = 5;
const FLOOR = 32;
/** Cells in a tetromino, and so the area of every well: width times depth. */
const PLUG_CELLS = 4;

/**
 * The one piece that exactly fills a well of a given width, and where its 4x4 box sits relative
 * to the well's leftmost column. Both of these pieces are their own park: what is dropped into
 * the well during the cascade is the same shape that was parked above the tower to wait for it.
 */
const PLUG: Record<number, { piece: number; rot: number; dx: number }> = {
  1: { piece: I_PIECE, rot: 1, dx: -1 }, // a vertical I's cells sit in column 1 of its box
  2: { piece: O_PIECE, rot: 0, dx: -1 }, // an O's, in columns 1 and 2
};

export interface Shape {
  /** Missing columns per storey, bottom first. The last one is the fuse. */
  wells: number[][];
  /** Rows each storey is worth, bottom first. */
  heights: number[];
  /** Every cell the build has to fill, and nothing else. */
  cells: number[];
  /** Pieces the build takes: the tower, plus one park per well below the fuse. */
  pieces: number;
  /** Lines the trigger is worth — the whole tower. */
  lines: number;
  /** The piece that sets it off, dropped into the fuse. Its landing row is up to the drop. */
  trigger: { piece: number; rot: number; bx: number };
}

export function shapeFor(wells: number[][]): Shape {
  const heights = wells.map((well) => {
    if (!PLUG[well.length]) throw new Error(`no single piece fills a well ${well.length} wide`);
    return PLUG_CELLS / well.length;
  });
  const lines = heights.reduce((a, b) => a + b, 0);
  const towerTop = FLOOR - lines;

  const cells: number[] = [];
  let bottom = FLOOR;
  for (let s = 0; s < wells.length; s++) {
    const top = bottom - heights[s]!;
    for (let r = top; r < bottom; r++)
      for (let col = 0; col < 10; col++) if (!wells[s]!.includes(col)) cells.push(idx(r, PLAY_LEFT + col));
    bottom = top;
  }
  // The parks rest on top of the tower, one per well, each as tall as the well it is waiting for.
  for (let s = 0; s < wells.length - 1; s++)
    for (let r = towerTop - heights[s]!; r < towerTop; r++)
      for (const col of wells[s]!) cells.push(idx(r, PLAY_LEFT + col));

  const fuse = wells[wells.length - 1]!;
  const plug = PLUG[fuse.length]!;
  return {
    wells,
    heights,
    cells,
    pieces: cells.length / 4,
    lines,
    trigger: { piece: plug.piece, rot: plug.rot, bx: PLAY_LEFT + fuse[0]! + plug.dx },
  };
}

/** The parks a build has to pay for, as a count per piece index. */
export function parkCost(wells: number[][]): Map<number, number> {
  const need = new Map<number, number>();
  for (const well of wells.slice(0, -1)) {
    const { piece } = PLUG[well.length]!;
    need.set(piece, (need.get(piece) ?? 0) + 1);
  }
  return need;
}

/** The piece stream a seed produces, in the order the player receives it. */
export function pieceStream(seed: number | bigint, n: number): number[] {
  const rnd = new Random(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rnd.rnd() % 7);
  return out;
}

export interface Placement {
  piece: number;
  rot: number;
  /** Board column of the piece's 4x4 box. */
  bx: number;
  /** Board row the box came to rest at. */
  by: number;
}

/**
 * The real spawn row. Landings are measured from here rather than from somewhere comfortably
 * above, so the search can never propose a placement the player could not have reached — which
 * is how a tower too tall to spawn into shows up as no solution rather than as a recording that
 * tops out on the last piece.
 */
const SPAWN_BY = 10;

/**
 * Each shape, reduced to what a drop needs: the cells relative to the box, and for every box
 * column the offset of that column's lowest cell.
 *
 * This is the whole reason the search is fast enough to run. Falling a piece a row at a time and
 * testing sixteen cells per step costs a few hundred operations per candidate placement, and
 * there are sixty candidates at every one of millions of nodes. A stack has no overhangs from
 * above — a piece is stopped by the topmost filled cell of each column it passes through,
 * whatever is hollow underneath — so the landing row is a minimum over at most four columns.
 */
interface Form {
  /** [rowOffset, colOffset] per cell. */
  cells: [number, number][];
  /** Lowest cell's row offset per box column, or -1 where the piece has no cell. */
  low: number[];
}

const FORMS: Form[][] = PIECES.map((rots) =>
  rots.map((grid) => {
    const cells: [number, number][] = [];
    const low = [-1, -1, -1, -1];
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++)
        if (grid[j]![i]) {
          cells.push([j, i]);
          if (j > low[i]!) low[i] = j;
        }
    return { cells, low };
  }),
);

/**
 * Fill the shape with the stream, in order, by hard drops only.
 *
 * Two things keep this finite. The memo, on (piece index, set of filled cells), collapses the
 * many orders that reach the same partial stack. The far more important one is `buried`: every
 * tetromino's cells are contiguous within each column, so a piece can only reach a cell by
 * falling through everything above it. The moment an unfilled cell of the shape has anything
 * over it, that cell is unreachable forever and the branch is dead — which is what forces the
 * search to stack the tower honestly from the bottom up.
 */
export function solveBuild(shape: Shape, stream: number[], nodeBudget = 500_000): Placement[] | null {
  const slot = new Map<number, number>();
  shape.cells.forEach((at, i) => slot.set(at, i));
  const goal = (1n << BigInt(shape.cells.length)) - 1n;

  const grid = new Uint8Array(36 * COLS);
  /** Topmost filled row per column; FLOOR where the column is empty, 0 for the walls. */
  const height = new Int32Array(COLS).fill(FLOOR);
  for (let c = 0; c < COLS; c++) if (c < PLAY_LEFT || c >= PLAY_LEFT + 10) height[c] = 0;

  const placements: Placement[] = [];
  // One set of dead fill-states per piece index. Keyed by the bigint itself: bigints are
  // primitives, so a Set compares them by value and no string key has to be built per node —
  // which at a few million nodes is most of the search's time.
  const dead: Set<bigint>[] = Array.from({ length: shape.pieces }, () => new Set<bigint>());
  let filled = 0n;
  let nodes = 0;

  /**
   * Did this placement seal an unfilled cell of the shape under itself? Only cells directly
   * beneath the four just placed can newly become unreachable — anything else that was going to
   * be buried already was, and was caught when it happened.
   *
   * Runs with the piece already in `grid`, which matters: a vertical piece sits directly over
   * its own lower half, and asking this before placing would read those cells as empty and
   * reject every I in the tower.
   */
  const buries = (cells: number[]): boolean => {
    for (const at of cells) {
      const below = at + COLS;
      if (slot.has(below) && !grid[below]) return true;
    }
    return false;
  };

  const dfs = (k: number): boolean => {
    if (k === shape.pieces) return filled === goal;
    if (++nodes > nodeBudget) return false;
    if (dead[k]!.has(filled)) return false;

    const piece = stream[k]!;
    for (const rot of ROTS[piece]!) {
      const form = FORMS[piece]![rot]!;
      for (let bx = 0; bx <= COLS - 4; bx++) {
        // Landing row: the tightest of the four columns the box spans.
        let by = FLOOR;
        for (let i = 0; i < 4; i++) {
          if (form.low[i]! < 0) continue;
          const rest = height[bx + i]! - 1 - form.low[i]!;
          if (rest < by) by = rest;
        }
        // Below the spawn row means the stack already reaches the ceiling here.
        if (by < SPAWN_BY) continue;

        const cells: number[] = [];
        let ok = true;
        for (const [j, i] of form.cells) {
          const at = idx(by + j, bx + i);
          if (!slot.has(at)) {
            ok = false;
            break;
          }
          cells.push(at);
        }
        if (!ok) continue;

        const saved: [number, number][] = [];
        for (const at of cells) {
          grid[at] = 1;
          filled |= 1n << BigInt(slot.get(at)!);
          const col = at % COLS;
          const row = (at - col) / COLS;
          if (row < height[col]!) {
            saved.push([col, height[col]!]);
            height[col] = row;
          }
        }
        placements.push({ piece, rot, bx, by });
        if (!buries(cells) && dfs(k + 1)) return true;
        placements.pop();
        for (const at of cells) {
          grid[at] = 0;
          filled &= ~(1n << BigInt(slot.get(at)!));
        }
        // Reverse, so that if a column were ever recorded twice the original value wins.
        for (let s = saved.length - 1; s >= 0; s--) height[saved[s]![0]] = saved[s]![1];
      }
    }
    dead[k]!.add(filled);
    return false;
  };

  return dfs(0) ? placements.slice() : null;
}

export interface Solution {
  seed: number;
  shape: Shape;
  build: Placement[];
  /** Lines the trigger is worth: the whole tower. */
  lines: number;
}

/** Columns 0 through 4 — the half of the well a ten's wells are confined to; see `towers`. */
const LEFT_HALF = 5;

/**
 * Every well arrangement worth trying for a line count, bottom storey first.
 *
 * A multiple of four is a tower of four-row storeys, so this is the orderings of distinct
 * columns, and every column is fair game. Ten is two of those over a two-row storey, and its
 * wells are kept to the left half of the board: the whole event — the parks, the fuse, the
 * cascade dropping through it — then happens on one side, in front of the player rather than
 * strung across the well.
 *
 * The columns are distinct in either case, and have to be. A park sits directly over its own
 * well with the tower in between; if a storey above shared that column, the park would fall
 * through it on the first clear instead of stopping where it is needed.
 */
function* towers(lines: number): Generator<number[][]> {
  if (lines % 4 === 0) {
    const out: number[][] = [];
    const used = new Set<number>();
    function* walk(): Generator<number[][]> {
      if (out.length === lines / 4) {
        yield out.slice();
        return;
      }
      for (let col = 0; col < 10; col++) {
        if (used.has(col)) continue;
        used.add(col);
        out.push([col]);
        yield* walk();
        out.pop();
        used.delete(col);
      }
    }
    yield* walk();
    return;
  }

  if (lines !== 10) throw new Error(`no tower shape for ${lines} lines`);
  for (let pair = 0; pair + 1 < LEFT_HALF; pair++) {
    const wide = [pair, pair + 1];
    for (let mid = 0; mid < LEFT_HALF; mid++) {
      if (wide.includes(mid)) continue;
      for (let fuse = 0; fuse < LEFT_HALF; fuse++) {
        if (fuse === mid || wide.includes(fuse)) continue;
        yield [wide, [mid], [fuse]];
      }
    }
  }
}

/**
 * `tower` skips straight to a known arrangement instead of walking all of them, which is what a
 * re-record wants: sweeping ten-times-nine-times-eight towers is how one was *found*, and
 * repeating that every time the tape is regenerated would cost minutes to reach a conclusion
 * that is already written down.
 */
export function solveSeed(
  seed: number,
  lines: number,
  opts: { nodeBudget?: number; tower?: number[][] } = {},
): Solution | null {
  const { nodeBudget, tower } = opts;
  const arrangements = tower ? [tower] : [...towers(lines)];

  // Every arrangement for a line count is the same storeys in a different order, so the piece
  // count, the trigger and the parks are the same for all of them and can be rejected once.
  const first = shapeFor(arrangements[0]!);
  const stream = pieceStream(seed, first.pieces + 1);
  // The trigger has to be the piece that fills the fuse. Cheapest possible rejection, and it
  // throws away six sevenths of the seeds before any searching happens.
  if (stream[first.pieces] !== first.trigger.piece) return null;
  // So do the parks, and they come out of the build — a stream without enough of the piece a
  // well takes cannot pay for it however it is arranged.
  const build = stream.slice(0, first.pieces);
  for (const [piece, need] of parkCost(arrangements[0]!))
    if (build.filter((p) => p === piece).length < need) return null;

  for (const wells of arrangements) {
    const shape = shapeFor(wells);
    const placements = solveBuild(shape, stream, nodeBudget);
    if (placements) return { seed, shape, build: placements, lines: shape.lines };
  }
  return null;
}

/** First seed at or after `from` whose stream can build the tower. */
export function searchSeeds(
  from: number,
  to: number,
  lines: number,
  onProgress?: (seed: number) => void,
): Solution | null {
  for (let seed = from; seed <= to; seed++) {
    const sol = solveSeed(seed, lines);
    if (sol) return sol;
    if (onProgress && seed % 200 === 0) onProgress(seed);
  }
  return null;
}
