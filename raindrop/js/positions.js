// Cell positions: which cells can be drawn, and where the data sits in space.
// Plain functions over typed arrays, so they run in the browser and in node tests.
// Positions are in the data frame: the embedding's own axes and units (e.g. mm for CCF coordinates).

// Axis ticks: about one per this many CSS px of axis on screen, and never fewer or more than these counts
const PIXELS_PER_TICK = 70;
const MIN_TICKS = 2;
const MAX_TICKS = 10;

// 1 for cells whose coordinates are all finite, else 0 (single-cell data in a joint object has NaN positions);
// `positions` holds `dims` numbers per cell, cell-major
export function validMask(positions, dims) {
  const n = positions.length / dims;
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let ok = 1;
    for (let d = 0; d < dims; d++) {
      if (!Number.isFinite(positions[i * dims + d])) ok = 0;
    }
    valid[i] = ok;
  }
  return valid;
}

// x, y, z per cell for the GPU: 2D data gets z = 0, and cells without a position sit at the
// origin (they are never drawn, but NaN must not reach the GPU)
export function toXYZ(positions, dims, valid) {
  const xyz = new Float32Array(valid.length * 3);
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) continue;
    for (let d = 0; d < dims; d++) xyz[i * 3 + d] = positions[i * dims + d];
  }
  return xyz;
}

// Bounding box of the valid cells (data units): low and high corner, center, and extent = the largest side.
// With no valid cell, lo stays Infinity and hi -Infinity
export function bounds(xyz, valid) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) continue;
    for (let d = 0; d < 3; d++) {
      lo[d] = Math.min(lo[d], xyz[i * 3 + d]);
      hi[d] = Math.max(hi[d], xyz[i * 3 + d]);
    }
  }
  return { center: lo.map((l, d) => (l + hi[d]) / 2), extent: Math.max(...lo.map((l, d) => hi[d] - l)), lo, hi };
}

// How many ticks an axis this many CSS px long on screen should get: one per PIXELS_PER_TICK, rounded, kept
// within [MIN_TICKS, MAX_TICKS] so a view zoomed far out does not crowd its labels
export function tickTarget(pixels) {
  return Math.min(MAX_TICKS, Math.max(MIN_TICKS, Math.round(pixels / PIXELS_PER_TICK)));
}

// Round tick values inside [lo, hi] (both ends included), in the data's own units, spaced so that [lo, hi] spans at
// most `target` steps. The step is the smallest of 1, 2, 5 or 10 times power = 10^floor(log10(raw)) that is at least
// raw = (hi - lo) / target, so the ticks are multiples of the step. Empty when hi <= lo (or either is NaN)
export function niceTicks(lo, hi, target = 10) {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const ticks = [];
  // The 1e-9 step tolerance keeps a tick at hi despite rounding in i * step; toFixed(10) removes float noise
  // such as 0.30000000000000004
  for (let i = Math.ceil(lo / step); i * step <= hi + 1e-9 * step; i++) ticks.push(Number((i * step).toFixed(10)));
  return ticks;
}

// Unit vector (data frame) toward one anatomical end, e.g. 'A' (anterior), of an embedding whose axes have
// roles such as ['LR', 'PA', 'VD']. Each role names its axis's low end first (PA runs from posterior at low
// values to anterior at high values), so the end is -1 along that axis when it comes first, else +1
function roleEndDirection(roles, end) {
  const axis = roles.findIndex((role) => role.includes(end));
  const direction = [0, 0, 0];
  direction[axis] = roles[axis][0] === end ? -1 : 1;
  return direction;
}

// Screen up when looking along up's own axis (e.g. a dorsal view): anterior when the axes have anatomical
// roles, else the low end of the first other axis (anterior only for AP DV LR data such as the mouse CCF)
function topViewUp(upAxis, roles) {
  if (roles) return roleEndDirection(roles, 'A');
  const screenUp = [0, 0, 0];
  screenUp[[0, 1, 2].find((a) => a !== upAxis)] = -1;
  return screenUp;
}

// How to see one face of the data, as two unit vectors in the data frame: `direction` points from the center
// to the camera, which sits beyond end `side` (-1 low, +1 high) of `axis`; `up` is the screen's up. Screen up
// is the data's `up` (dorsal, for anatomical data), except when looking along up's own axis (the axis of up's
// largest component): see topViewUp. `roles` are the axes' anatomical roles from the manifest (null if unknown)
export function faceView(axis, side, up, roles = null) {
  const direction = [0, 0, 0];
  direction[axis] = side;
  const upAxis = up.reduce((best, v, i) => (Math.abs(v) > Math.abs(up[best]) ? i : best), 0);
  if (upAxis !== axis) return { direction, up };
  return { direction, up: topViewUp(upAxis, roles) };
}

// Point size 1 is a point this many times smaller (in diameter) than the data's largest side
export const EXTENT_PER_UNIT_POINT_SIZE = 200;

// Diameter in CSS px of a point of relative size `size` (2^slider) at the data's center when the view is framed:
// size * extent / EXTENT_PER_UNIT_POINT_SIZE data units, at the framing distance fitDistance, where the tile's height
// (tileCssHeight CSS px) shows 2 tan(fov / 2) world units per unit of distance. The size boxes show it; it does not
// follow zoom, as it names the framed size
export function framedDiameterPx(size, extent, fitDistance, tileCssHeight, fovDegrees) {
  const pxPerUnitAtDistance1 = tileCssHeight / (2 * Math.tan(fovDegrees * Math.PI / 360));
  return size * extent / EXTENT_PER_UNIT_POINT_SIZE * pxPerUnitAtDistance1 / fitDistance;
}

// Direction of an edge in degrees, in [-180, 180]: the screen angle from the +x axis toward the edge, which
// goes from its low end to its high end by (dx, dy) in screen px, x right and y down. With y down,
// atan2(dy, dx) grows clockwise on screen
function edgeAngle(dx, dy) {
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

// Whether an upright name along that edge reads from its high end to its low end: text reads left to right, or
// bottom to top when vertical, so this holds when the edge points left (|angle| > 90) or straight down
// (angle = 90); straight up (-90) reads low end first
export function readsHighToLow(dx, dy) {
  const angle = edgeAngle(dx, dy);
  return angle >= 90 || angle < -90;
}

// Angle (degrees clockwise, in [-90, 90)) that turns a name to run along that edge without reading upside
// down: the edge's angle, turned by half a turn when it points left or straight down
export function uprightAngle(dx, dy) {
  const angle = edgeAngle(dx, dy);
  if (angle >= 90) return angle - 180;
  if (angle < -90) return angle + 180;
  return angle;
}
