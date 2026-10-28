// Rotation angles. The data's orientation is three angles (a, b, c) about its x, y and z axes, applied as
// R = Rx(a) Ry(b) Rz(c) (three.js Euler order 'XYZ'), the angles the rotation sliders show.
// Plain functions over [x, y, z] arrays, so they run in node tests too.

// The axis drags turn about when the viewer opens, from the manifest's locked axis labels (convert.py --locked):
// the one left free when two are locked, or null (any, a turntable) when none are
export function openingTurnAxis(labels, locked) {
  if (locked.length === 0) return null;
  const free = labels.filter((label) => !locked.includes(label));
  if (locked.length !== 2 || free.length !== 1) {
    throw new Error(`locked axes ${locked.join(', ')}: lock two axes (leaving one to turn about) or none`);
  }
  return labels.indexOf(free[0]);
}

// A drag's recent movement (pixels) after one more move: earlier movement fades with the distance moved since
// (to half in about 14 px for `fadePixels` 20), so the sum follows the last several pixels of the drag at any
// rate of pointer events, and a few pixels of wobble across it do not outweigh it
export function recentMovement(recent, move, fadePixels = 20) {
  const keep = Math.exp(-Math.hypot(move[0], move[1]) / fadePixels);
  return [recent[0] * keep + move[0], recent[1] * keep + move[1]];
}

// Main direction of a pointer movement from `from` to `to` (pixels): 'x' (sideways) or 'y' (up/down), or null
// until it has moved `threshold` pixels along either, so the first jitter of a drag does not decide it
export function dragDirection(from, to, threshold = 4) {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  if (Math.max(dx, dy) < threshold) return null;
  return dx >= dy ? 'x' : 'y';
}

// Angle (radians) the pointer swept about `center` going from `previous` to `current` (pixels, y down), counter-
// clockwise on screen positive, taken the short way round (within -pi..pi), as when turning a knob
export function knobTurn(previous, current, center) {
  const angle = ([x, y]) => Math.atan2(center[1] - y, x - center[0]);
  const change = angle(current) - angle(previous);
  return change - 2 * Math.PI * Math.round(change / (2 * Math.PI));
}

// The sliders' hard ends: two full turns either way
export const MAX_DEGREES = 360;

export function clampDegrees(angle) {
  return Math.min(MAX_DEGREES, Math.max(-MAX_DEGREES, angle));
}

// Dragged angles (radians) past two full turns continue from 0: a whole turn is taken off (or added), which
// is the same orientation, so dragging can keep spinning within the sliders' range
export function wrapTurns(angles) {
  const turn = 2 * Math.PI;
  return angles.map((a) => (a > turn ? a - turn : a < -turn ? a + turn : a));
}

// Euler angles read from an orientation lie within (-180, 180] (y within [-90, 90]), so they would jump as the
// data turns past those. The same orientation is also (a + pi, pi - b, c + pi), and any angle plus a whole
// turn: of these, return the angles closest to `previous` (radians), so the sliders move continuously
export function continuousAngles(angles, previous) {
  const [a, b, c] = angles;
  const nearest = (candidate) => candidate.map((v, i) => v + 2 * Math.PI * Math.round((previous[i] - v) / (2 * Math.PI)));
  const candidates = [nearest([a, b, c]), nearest([a + Math.PI, Math.PI - b, c + Math.PI])];
  const distance = (candidate) => candidate.reduce((sum, v, i) => sum + Math.abs(v - previous[i]), 0);
  return distance(candidates[0]) <= distance(candidates[1]) ? candidates[0] : candidates[1];
}

// Rotation matrix (rows) of the angles (radians): Rx(a) Ry(b) Rz(c), written out as three.js does for 'XYZ'
export function anglesToMatrix([a, b, c]) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

// Angles (radians) of a rotation matrix (rows), inverting anglesToMatrix as three.js does: sin(b) is the top
// right entry; when b is +-90 degrees only a + c is defined, and c is taken as 0
function matrixToAngles(m) {
  const b = Math.asin(Math.min(1, Math.max(-1, m[0][2])));
  if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), b, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), b, 0];
}

// The data's angles (radians, closest to 0) that show the `target` side (positions.faceView) to a camera
// placed for the `reference` side. A camera's rows (right, up, back; back points from the data to the
// camera, right = up x back) map data to screen, so turning the data by R = C_reference' C_target and
// viewing it from the reference camera looks the same as viewing the unturned data from the target camera
export function faceRotation(target, reference) {
  const rows = ({ direction, up }) => [cross(up, direction), up, direction];
  const ref = rows(reference);
  const tgt = rows(target);
  const turn = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ref[0][i] * tgt[0][j] + ref[1][i] * tgt[1][j] + ref[2][i] * tgt[2][j]));
  return continuousAngles(matrixToAngles(turn), [0, 0, 0]);
}

function cross(u, v) {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
