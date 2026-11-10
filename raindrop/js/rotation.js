// Rotation angles. The data's orientation is three angles (a, b, c) about its x, y and z axes, applied as
// R = Rx(a) Ry(b) Rz(c) (three.js Euler order 'XYZ'), the angles the rotation sliders show. R maps the data
// frame (the embedding's axes) to the world frame (where the camera is): world = R * data, as column vectors.
// Angles are radians unless a name says degrees. Screen positions are CSS px, x right and y down.
// Plain functions over [x, y, z] arrays, so they run in node tests too.

// recentMovement: earlier movement fades by a factor e per this many px moved since (to half in
// 20 * ln 2 = 14 px)
const DRAG_FADE_PIXELS = 20;
// dragDirection: px a pointer must move along x or y before its main direction counts
const DRAG_DIRECTION_THRESHOLD_PIXELS = 4;
// matrixToAngles: |sin b| at or above this counts as b = +-90 degrees (gimbal lock); three.js's
// Euler.setFromRotationMatrix uses the same value
const GIMBAL_LOCK_SIN = 0.9999999;

// The axis drags turn about when the viewer opens, from the manifest's locked axis labels (convert.py --locked):
// the index (into `labels`) of the one left free when two are locked, or null (any, a turntable) when none are.
// Throws for any other choice: one or three locked, or labels that leave no single free axis
export function openingTurnAxis(labels, locked) {
  if (locked.length === 0) return null;
  const free = labels.filter((label) => !locked.includes(label));
  if (locked.length !== 2 || free.length !== 1) {
    throw new Error(`locked axes ${locked.join(', ')}: lock two axes (leaving one to turn about) or none`);
  }
  return labels.indexOf(free[0]);
}

// A drag's recent movement [dx, dy] (px) after one more move: the earlier sum is multiplied by
// exp(-|move| / fadePixels) before the move is added, so it fades with the distance moved since, not with
// time. The sum then follows the last several px of the drag at any rate of pointer events, and a few px of
// wobble across it do not outweigh it
export function recentMovement(recent, move, fadePixels = DRAG_FADE_PIXELS) {
  const keep = Math.exp(-Math.hypot(move[0], move[1]) / fadePixels);
  return [recent[0] * keep + move[0], recent[1] * keep + move[1]];
}

// Main direction of a pointer movement from `from` to `to` (px): 'x' (sideways) or 'y' (up/down; a tie goes to
// 'x'), or null until it has moved `threshold` px along either, so the first jitter of a drag does not decide it
export function dragDirection(from, to, threshold = DRAG_DIRECTION_THRESHOLD_PIXELS) {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  if (Math.max(dx, dy) < threshold) return null;
  return dx >= dy ? 'x' : 'y';
}

// Angle (radians) the pointer swept about `center` going from `previous` to `current` (px, y down), as when
// turning a knob. Each point's angle is atan2(-dy, dx), y flipped so counterclockwise on screen is positive;
// the change is wrapped by a whole number of turns into [-pi, pi), i.e. taken the short way round
export function knobTurn(previous, current, center) {
  const angle = ([x, y]) => Math.atan2(center[1] - y, x - center[0]);
  const change = angle(current) - angle(previous);
  return change - 2 * Math.PI * Math.round(change / (2 * Math.PI));
}

// The sliders' hard ends (degrees): one full turn either way, so the slider spans two turns
export const MAX_DEGREES = 360;

// An angle (degrees) limited to [-MAX_DEGREES, MAX_DEGREES]
export function clampDegrees(angle) {
  return Math.min(MAX_DEGREES, Math.max(-MAX_DEGREES, angle));
}

// Dragged angles (radians) past a full turn (above 2 pi or below -2 pi) continue from near 0: a whole turn is
// taken off (or added), which is the same orientation, so dragging can keep spinning within the sliders'
// range. Exactly +-2 pi is kept; one turn is enough because drags change angles in small steps
export function wrapTurns(angles) {
  const turn = 2 * Math.PI;
  return angles.map((a) => (a > turn ? a - turn : a < -turn ? a + turn : a));
}

// Euler angles read from an orientation lie within [-pi, pi] (b within [-pi/2, pi/2]), so they would jump as the
// data turns past those. The same orientation is also (a + pi, pi - b, c + pi): Rx(a + pi) = Rx(a) Rx(pi) and Rz(c +
// pi) = Rz(pi) Rz(c), and Rx(pi) Ry(pi - b) Rz(pi) = diag(1, -1, -1) Ry(pi - b) diag(-1, -1, 1) = Ry(b), and any
// angle plus whole turns. Of these, return the angles closest to `previous` (radians; sum of absolute differences),
// so the sliders move continuously
export function continuousAngles(angles, previous) {
  const [a, b, c] = angles;
  // Each angle shifted by the whole turns that bring it nearest to its previous value
  const nearest = (candidate) => candidate.map((v, i) => v + 2 * Math.PI * Math.round((previous[i] - v) / (2 * Math.PI)));
  const candidates = [nearest([a, b, c]), nearest([a + Math.PI, Math.PI - b, c + Math.PI])];
  const distance = (candidate) => candidate.reduce((sum, v, i) => sum + Math.abs(v - previous[i]), 0);
  return distance(candidates[0]) <= distance(candidates[1]) ? candidates[0] : candidates[1];
}

// Rotation matrix (array of rows, data frame to world frame) of the angles (radians): the product
// Rx(a) Ry(b) Rz(c) multiplied out, as three.js does for Euler order 'XYZ'
export function anglesToMatrix([a, b, c]) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}

// Angles (radians) of a rotation matrix (rows), inverting anglesToMatrix as three.js does. From its entries:
// m[0][2] = sin b; -m[1][2] / m[2][2] = sin a / cos a; -m[0][1] / m[0][0] = sin c / cos c. At gimbal lock
// (cos b = 0) only a + c is defined: c is taken as 0, and then m[2][1] / m[1][1] = sin a / cos a
function matrixToAngles(m) {
  const b = Math.asin(Math.min(1, Math.max(-1, m[0][2])));
  if (Math.abs(m[0][2]) < GIMBAL_LOCK_SIN) return [Math.atan2(-m[1][2], m[2][2]), b, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), b, 0];
}

// The data's angles (radians, the solution closest to 0) that show the `target` side (positions.faceView) to
// a camera placed for the `reference` side.
// A camera for a view has, in the world frame, the rows C = [right; up; back] (back = the view's direction,
// from the data to the camera; right = up x back, as x = y x z), and C maps world coordinates to camera ones.
// Turned data seen by the reference camera is C_ref R data; unturned data seen by the target camera is
// C_tgt data. These are equal for R = C_ref^T C_tgt (C is orthonormal, so its inverse is its transpose):
// turn[i][j] = sum over k of C_ref[k][i] * C_tgt[k][j]
export function faceRotation(target, reference) {
  const rows = ({ direction, up }) => [cross(up, direction), up, direction];
  const ref = rows(reference);
  const tgt = rows(target);
  const turn = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ref[0][i] * tgt[0][j] + ref[1][i] * tgt[1][j] + ref[2][i] * tgt[2][j]));
  return continuousAngles(matrixToAngles(turn), [0, 0, 0]);
}

// Cross product u x v
function cross(u, v) {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
