// Cell positions: which cells can be drawn, and where the data sits in space.
// Plain functions over typed arrays, so they run in the browser and in node tests.

// 1 for cells whose coordinates are all finite (single-cell data in a joint object has NaN positions)
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

// Bounding box of the valid cells: low and high corner, center, and largest side
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

// About `target` (default 10) round tick values inside [lo, hi], in the data's own units: the step is 1, 2 or 5 times a
// power of ten, the smallest such step that gives at most `target` intervals. toFixed removes float noise
// such as 0.30000000000000004
// How many ticks an axis this many pixels long on screen should get: about one per 70 px, between 2 and 10, so
// a view zoomed far out does not crowd its labels
export function tickTarget(pixels) {
  return Math.min(10, Math.max(2, Math.round(pixels / 70)));
}

export function niceTicks(lo, hi, target = 10) {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
  const ticks = [];
  for (let i = Math.ceil(lo / step); i * step <= hi + 1e-9 * step; i++) ticks.push(Number((i * step).toFixed(10)));
  return ticks;
}

// Unit vector toward one anatomical end, e.g. 'A' (anterior), of an embedding whose axes have roles such as
// ['LR', 'PA', 'VD'] (each names its axis's low end first: PA runs from posterior to anterior)
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

// How to see one face of the data: the camera sits beyond end `side` (-1 low, +1 high) of `axis`,
// looking at the center. Screen up is `up` (dorsal, for anatomical data), except when looking along up's
// own axis: see topViewUp. `roles` are the axes' anatomical roles from the manifest (null or missing if unknown)
export function faceView(axis, side, up, roles = null) {
  const direction = [0, 0, 0];
  direction[axis] = side;
  const upAxis = up.reduce((best, v, i) => (Math.abs(v) > Math.abs(up[best]) ? i : best), 0);
  if (upAxis !== axis) return { direction, up };
  return { direction, up: topViewUp(upAxis, roles) };
}

// Direction (degrees, clockwise on screen) of an edge whose low end goes to its high end by (dx, dy), x right and
// y down
function edgeAngle(dx, dy) {
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

// Whether an upright name along that edge reads from its high end to its low end: text reads left to right, or
// bottom to top when vertical, so this holds when the low end is to the right, or on top of a vertical edge
export function readsHighToLow(dx, dy) {
  const angle = edgeAngle(dx, dy);
  return angle >= 90 || angle < -90;
}

// Angle (degrees, in [-90, 90)) that turns a name to run along that edge without reading upside down
export function uprightAngle(dx, dy) {
  const angle = edgeAngle(dx, dy);
  if (angle >= 90) return angle - 180;
  if (angle < -90) return angle + 180;
  return angle;
}
