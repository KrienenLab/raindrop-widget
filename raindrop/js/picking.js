// Which cell lies under the pointer, for the hover label: the shown cells projected to the tile once per change of
// the picture, sorted into a grid of square screen buckets, so a lookup reads only the few buckets around the pointer
// instead of every cell. Plain functions over typed arrays (no three.js, no DOM), so they run in node tests.
//
// Frames: data (the embedding's axes) -> clip by one 4x4 matrix (projection * camera view * the data's placement);
// NDC = clip xyz / w, each -1..1 inside the view; tile CSS px with x right and y down, as in scene.js.

// Depths (w) closer than this fraction of the nearer one count as equal, and the cell nearer the pointer wins. In
// 2D every cell lies at z = 0 and the camera looks straight at that plane, so w is the same for all cells up to
// float rounding (about 1e-7 relative)
const DEPTH_TIE_FRACTION = 1e-5;

// Buffers for the projected shown cells, reused while the cell count stays the same (a rebuild per change would
// otherwise allocate 16 bytes per cell): cells (index into the data), x and y (tile CSS px), depth (clip w, the
// distance from the camera along its line of sight). `count` says how many are filled
export function makeProjection(n) {
  return { cells: new Uint32Array(n), x: new Float32Array(n), y: new Float32Array(n), depth: new Float32Array(n), count: 0 };
}

// Fill `projection` with the cells whose state is `shownState` that the GPU would draw: in front of the camera
// (w > 0) with NDC x, y and z inside -1..1 (z outside lies beyond the clipping planes). `matrix` maps data to clip,
// 16 numbers column-major (three.js Matrix4.elements): clip row r = m[r] x + m[4 + r] y + m[8 + r] z + m[12 + r].
// NDC to tile px: x from [-1, 1] to [0, width], y flipped from [1, -1] to [0, height]
export function projectShownCells(projection, xyz, state, shownState, matrix, width, height) {
  const m = matrix;
  let count = 0;
  for (let i = 0; i < state.length; i++) {
    if (state[i] !== shownState) continue;
    const x = xyz[3 * i];
    const y = xyz[3 * i + 1];
    const z = xyz[3 * i + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(w > 0)) continue;
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1 || Math.abs(nz) > 1) continue;
    projection.cells[count] = i;
    projection.x[count] = (nx + 1) / 2 * width;
    projection.y[count] = (1 - ny) / 2 * height;
    projection.depth[count] = w;
    count++;
  }
  projection.count = count;
  return projection;
}

// Sort the projected cells into square buckets of bucketPx CSS px (a counting sort): the cells of bucket b are
// order[start[b]] .. order[start[b + 1] - 1], positions into the projection, with b = row * columns + column (`next`
// is working space). `grid` is a previous result whose buffers are reused when they are large enough (null at first)
export function buildScreenGrid(grid, projection, width, height, bucketPx) {
  const columns = Math.max(1, Math.ceil(width / bucketPx));
  const rows = Math.max(1, Math.ceil(height / bucketPx));
  const buckets = columns * rows;
  const { count } = projection;
  const start = grid?.start.length >= buckets + 1 ? grid.start.fill(0) : new Uint32Array(buckets + 1);
  const order = grid?.order.length >= count ? grid.order : new Uint32Array(projection.cells.length);
  // The bucket of projected cell k; px exactly at the right or bottom edge go into the last column or row
  const bucketOf = (k) => Math.min(rows - 1, Math.floor(projection.y[k] / bucketPx)) * columns
    + Math.min(columns - 1, Math.floor(projection.x[k] / bucketPx));
  // Count each bucket's cells in start[b + 1], sum them so start[b] is where bucket b begins, then place each cell
  // at its bucket's next free slot (next[b] runs from start[b] up)
  for (let k = 0; k < count; k++) start[bucketOf(k) + 1]++;
  for (let b = 0; b < buckets; b++) start[b + 1] += start[b];
  const next = grid?.next.length >= buckets ? grid.next : new Uint32Array(buckets);
  next.set(start.subarray(0, buckets));
  for (let k = 0; k < count; k++) order[next[bucketOf(k)]++] = k;
  return { start, order, next, columns, rows, bucketPx };
}

// The cell (index into the data) to label at pointer (px, py), tile CSS px: of the projected cells within radiusPx
// of the pointer, the one nearest the camera (smallest depth), ties (DEPTH_TIE_FRACTION) going to the one nearer the
// pointer; -1 when none is that close. Reads the buckets overlapping the square of side 2 radiusPx about the pointer
export function nearestCell(projection, grid, px, py, radiusPx) {
  const { start, order, columns, rows, bucketPx } = grid;
  const clampColumn = (c) => Math.min(columns - 1, Math.max(0, c));
  const clampRow = (r) => Math.min(rows - 1, Math.max(0, r));
  const [c0, c1] = [clampColumn(Math.floor((px - radiusPx) / bucketPx)), clampColumn(Math.floor((px + radiusPx) / bucketPx))];
  const [r0, r1] = [clampRow(Math.floor((py - radiusPx) / bucketPx)), clampRow(Math.floor((py + radiusPx) / bucketPx))];
  let best = -1;
  let bestDepth = Infinity;
  let bestDistance2 = Infinity;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const b = r * columns + c;
      for (let s = start[b]; s < start[b + 1]; s++) {
        const k = order[s];
        const distance2 = (projection.x[k] - px) ** 2 + (projection.y[k] - py) ** 2;
        if (distance2 > radiusPx * radiusPx) continue;
        const depth = projection.depth[k];
        const tie = Math.abs(depth - bestDepth) <= DEPTH_TIE_FRACTION * Math.min(depth, bestDepth);
        if (tie ? distance2 < bestDistance2 : depth < bestDepth) {
          best = k;
          bestDepth = depth;
          bestDistance2 = distance2;
        }
      }
    }
  }
  return best < 0 ? -1 : projection.cells[best];
}
