// WebGL point cloud: one point per cell, drawn by three.js.
//
// Each cell has a state: 0 = not drawn (no position), 1 = context (filtered out, drawn grey or in its color at its
// own size and opacity), 2 = shown (passes the filters, drawn in its color). Two Points objects share one geometry,
// each drawn opaque at 100% with points of a pixel or more, else transparent (updateBlending). Shown points of a pixel
// or more write depth at any opacity; context points only when opaque. The first object draws shown cells, the
// second context cells after them, so translucent context never hides shown cells.
//
// Frames: data (the embedding's axes, data units); world = the data turned about its center by the data's
// rotation (`model`); camera (three.js: x right, y up, looking down -z); screen = the tile in CSS px, x right
// and y down. Angles are radians unless a name says degrees. The canvas is device px = CSS px *
// devicePixelRatio; three.js's setSize/setViewport take CSS px, gl_PointSize is in device px.
//
// Rotation turns the data itself about its center, never the camera, so one orientation drives both the
// picture and the sliders. Left-dragging works like a turntable that can also tip over: left/right spins the
// data about its own up axis (dorsal), up/down tilts it about the screen's horizontal axis, with no stop at any
// angle. Spins and tilts never roll the data about the line of sight, however they combine. TrackballControls
// (with its own rotation off, as it rolls the view on sideways drags) handles zoom and pan.
//
// Several views can be shown at once (a grid): one WebGL canvas (SharedCanvas) lies behind them all, and each
// view draws only into the rectangle of its tile, an element over the canvas that also takes its mouse input.
//
// Hover: pointing at a shown cell (or tapping it on a touch screen) reports it through onHover, for the page's label.
// The cells are looked up in a screen grid (picking.js) built on the first lookup after the picture changed.
import * as THREE from 'three';
import { TrackballControls } from '../vendor/TrackballControls.js';
import { EXTENT_PER_UNIT_POINT_SIZE, framedDiameterPx } from './positions.js';
import { dragDirection, knobTurn, recentMovement, wrapTurns } from './rotation.js';
import { buildScreenGrid, makeProjection, nearestCell, projectShownCells } from './picking.js';

// White page behind the points
const BACKGROUND_COLOR = 0xffffff;
// Light grey edges of the axes box
const AXES_BOX_COLOR = 0xb8b8b8;
// Camera's vertical field of view (degrees)
const FIELD_OF_VIEW_DEGREES = 40;
// Clipping planes (world units) until viewFrom frames the data and sets them from its distance
const PLACEHOLDER_NEAR = 0.01;
const PLACEHOLDER_FAR = 1000;
// Cell states drawn by each Points object (see the top of the file)
const CONTEXT_STATE = 1;
const SHOWN_STATE = 2;
// Opacity context cells start with, before setContextOpacity
const CONTEXT_OPACITY = 0.08;
// Mid grey (each channel 128 of 255) for cells until setColors gives their colors
const UNSET_COLOR = 128;
// addTurns: a turn whose sin(angle / 2) is below this is no turn (its axis is undefined)
const MIN_TURN_SINE = 1e-12;
// 2D wheel zoom: the camera distance is scaled by exp(deltaY * this), assuming deltaY is in px of scrolling
// (deltaMode is not checked)
const WHEEL_ZOOM_PER_PIXEL = 0.002;
// zoomAt keeps the camera distance between fit / MAX_ZOOM_IN and fit * MAX_ZOOM_OUT
const MAX_ZOOM_IN = 500;
const MAX_ZOOM_OUT = 4;
// Clipping planes from the camera's distance d to its target: near = d / CLIP_NEAR_DIVISOR, far = d *
// CLIP_FAR_MULTIPLE. clipForDistance (2D zoom and pan, and linked views through setViewState) adds CLIP_FAR_RADII
// data radii r to far, so the far side of the data stays in when zoomed close; 3D zoom (TrackballControls) keeps
// the planes viewFrom set. Depth precision depends on far / near = 1000 + 400 r / d: about 1000 at the fitted
// distance, about 6e4 at the closest 2D zoom
const CLIP_NEAR_DIVISOR = 100;
const CLIP_FAR_MULTIPLE = 10;
const CLIP_FAR_RADII = 4;
// The framing distance leaves this much more room than a tight fit, for the axes labels around the data
const FRAME_MARGIN = 1.12;
// Hover: a cell counts as pointed at within this many CSS px of the pointer, or within its drawn radius if larger
const HOVER_RADIUS_PX = 4;
// A touch that moves at most this many CSS px between down and up is a tap (more is a drag that turns or pans)
const TAP_SLOP_PX = 8;

// Vertex shader. A cell is drawn by this Points object only if its state equals uDrawState (states are whole
// numbers, compared with a margin of 0.5 as floats). Point size (gl_PointSize, device px, the point's diameter)
// follows perspective: a point of uSize data units at camera distance z (= -mvPosition.z, camera space looks down
// -z) is uSize * uScale / z device px, uScale being device px per data unit at distance 1 (see resize). A point
// smaller than a pixel is drawn one pixel wide and its opacity scaled by vCover, the fraction of the pixel it
// would cover (size squared: the area of the point's size x size bounding square in pixel areas; the drawn disc
// covers pi/4 of that)
const VERTEX_SHADER = `
  attribute vec3 color;
  attribute float state;
  uniform float uDrawState;
  uniform float uSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vDraw;
  varying float vCover;
  void main() {
    vColor = color;
    vDraw = abs(state - uDrawState) < 0.5 ? 1.0 : 0.0;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float size = uSize * uScale / -mvPosition.z;
    gl_PointSize = vDraw > 0.5 ? max(1.0, size) : 0.0;
    vCover = min(1.0, size * size);
  }
`;

// Fragment shader. Round points: gl_PointCoord runs 0..1 across the square sprite, so c is the offset from its
// center and dot(c, c) > 0.25 (radius 0.5 squared) is outside the inscribed disc. With uGrey (context cells, unless
// they keep their colors) cells are drawn in one mid grey (0.55) whatever their color; alpha is the object's opacity
// times the pixel coverage
const FRAGMENT_SHADER = `
  uniform float uOpacity;
  uniform float uGrey;
  varying vec3 vColor;
  varying float vDraw;
  varying float vCover;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (vDraw < 0.5 || dot(c, c) > 0.25) discard;
    vec3 rgb = uGrey > 0.5 ? vec3(0.55) : vColor;
    gl_FragColor = vec4(rgb, uOpacity * vCover);
  }
`;

// One WebGL canvas behind all views, filling `host`; a single context is cheaper than one per view, and
// browsers allow only a limited number of contexts per page
export class SharedCanvas {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(BACKGROUND_COLOR);
    // Each view clears and draws only its own rectangle
    this.renderer.setScissorTest(true);
    this.renderer.domElement.className = 'shared-canvas';
    host.prepend(this.renderer.domElement);
    this.views = new Set();
    // The browser may clear the canvas after showing a frame, so a frame that drew only one view would
    // blank the others: any change asks for a redraw, and the next frame draws every view
    this.needsDraw = false;
    // setAnimationLoop calls this once per display frame (requestAnimationFrame). TrackballControls moves
    // cameras in update(), which must run every frame; drawing happens only on frames after a requestDraw
    this.renderer.setAnimationLoop(() => {
      for (const view of this.views) view.controls.update();
      if (!this.needsDraw) return;
      this.needsDraw = false;
      for (const view of this.views) view.draw();
    });
    new ResizeObserver(() => this.resize()).observe(host);
  }

  requestDraw() {
    this.needsDraw = true;
  }

  // Canvas to the host's size (CSS px), then each view to its tile's
  resize() {
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
    for (const view of this.views) view.resize();
  }
}

export class PointCloudView {
  // container: the view's tile, an element over the shared canvas; canvas: the SharedCanvas
  constructor(container, canvas) {
    this.container = container;
    this.canvas = canvas;
    this.renderer = canvas.renderer;
    canvas.views.add(this);

    // Camera and its zoom/pan controls; the aspect ratio and clipping planes are set by resize and viewFrom
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, PLACEHOLDER_NEAR, PLACEHOLDER_FAR);
    this.controls = new TrackballControls(this.camera, container);
    this.controls.noRotate = true;
    // No drifting after the mouse is released: the view stays where it was left
    this.controls.staticMoving = true;
    this.controls.addEventListener('change', () => {
      this.render();
      this.onCameraChange();
    });

    // The two Points objects share the geometry and the scale uniform (the same object, so one write updates
    // both); each has its own size, set by setPointSize and setContextPointSize. Context is drawn after shown
    // (renderOrder 1): blending over it while translucent, depth-tested against it like any opaque object at 100%
    // (three.js draws opaque objects before transparent ones)
    this.geometry = new THREE.BufferGeometry();
    this.uniforms = { uScale: { value: 1 } };
    this.shown = this.makePoints(SHOWN_STATE, 1, false);
    this.context = this.makePoints(CONTEXT_STATE, CONTEXT_OPACITY, true);
    this.context.renderOrder = 1;

    // Rotations turn `model` about the data center: `model` sits at the center and holds the
    // points shifted back by the center, so its rotation pivots there
    this.model = new THREE.Group();
    this.points = new THREE.Group();
    this.points.add(this.shown, this.context);
    this.model.add(this.points);
    this.scene.add(this.model);

    // Axes box: the twelve edges of the data's bounding box, in data coordinates, so it turns with the data
    this.axesBox = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: AXES_BOX_COLOR }));
    this.points.add(this.axesBox);

    // Callbacks set by the page: onRotate(degrees) after a drag turned the data; onRender after every drawn
    // frame (e.g. to redraw the axis widget); onCameraChange when zoom or pan moved the camera; onResize after the
    // tile's size, and so the framed point size, changed; onHover(cell, pointer) when the pointer or a tap points at
    // a shown cell (its index; pointer in tile CSS px), or at none (cell -1: hide the label)
    this.onRotate = () => {};
    this.onRender = () => {};
    this.onCameraChange = () => {};
    this.onResize = () => {};
    this.onHover = () => {};
    // The data's turns (radians) about its own x, y and z axes, as the sliders show them: every turn adds its
    // parts about each axis of the data as it points then (see addTurns), so they depend on the order of turns;
    // and the data axis that drags turn about (null: any, as a turntable; see turnByDrag)
    this.angles = [0, 0, 0];
    this.turnAxis = null;
    // Data direction that sideways drags spin about (see setUpAxis)
    this.upAxis = new THREE.Vector3(0, 1, 0);
    this.listenForDrags();
    this.listenFor2DNavigation();
    // Hover: the projected shown cells and their screen grid (buffers kept for the next build), whether they are
    // out of date (from any change of the picture, see render, until the next lookup), the animation frame of a
    // pending lookup (null: none), and whether a cell is being reported
    this.projection = null;
    this.pickGrid = null;
    this.pickStale = true;
    this.pickMatrix = new THREE.Matrix4();
    this.pendingLookup = null;
    this.hovering = false;
    this.listenForHover();

    this.pointSize = 1;
    this.contextPointSize = 1;
    new ResizeObserver(() => this.resize()).observe(container);
  }

  // A Points object drawing the cells in `drawState`. Context points start transparent and do not write depth,
  // so they blend over shown points without hiding any; shown points start opaque (see updateBlending).
  // Culling is off: three.js would cull by the geometry's bounding sphere, which it computes once and does not
  // recompute when setPositions replaces the positions
  makePoints(drawState, opacity, isContext) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uDrawState: { value: drawState },
        uOpacity: { value: opacity },
        uGrey: { value: isContext ? 1 : 0 },
        uSize: { value: 1 },
        uScale: this.uniforms.uScale,
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: isContext,
      depthWrite: !isContext,
      // Context cells pass the depth test only when strictly nearer, so shown cells stay on top at equal depth: in 2D
      // every cell lies at z = 0, in 3D sectioned data seen along its section axis puts a section at one depth, and
      // anywhere points whose depths fall in one step of the depth buffer tie. This holds while shown cells write
      // depth (opaque, points of a pixel or more)
      depthFunc: isContext ? THREE.LessDepth : THREE.LessEqualDepth,
    });
    const points = new THREE.Points(this.geometry, material);
    points.frustumCulled = false;
    return points;
  }

  // xyz: Float32Array of n * 3 (see positions.js); box (positions.bounds) frames the camera and the axes box.
  // Colors and states are kept when the cell count is unchanged, otherwise reset to grey and not drawn (state 0)
  setPositions(xyz, box, is2D) {
    const { center, extent } = box;
    const n = xyz.length / 3;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
    if (!this.geometry.getAttribute('color') || this.geometry.getAttribute('color').count !== n) {
      // Colors: one byte per channel, normalized to 0..1 in the shader
      this.geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(n * 3).fill(UNSET_COLOR), 3, true));
      this.geometry.setAttribute('state', new THREE.BufferAttribute(new Float32Array(n), 1));
    }
    this.center = center;
    this.extent = extent;
    // Half the box diagonal: a sphere this size holds the data and its axes box at any rotation
    this.radius = Math.hypot(...box.hi.map((h, d) => h - box.lo[d])) / 2;
    this.setAxesBox(box.lo, box.hi);
    // `model` at the center, the points shifted back by it (see the constructor)
    this.model.position.set(...center);
    this.points.position.set(...center.map((c) => -c));
    this.is2D = is2D;
    // 2D views zoom about the pointer themselves (listenFor2DNavigation); TrackballControls zooms about the center
    this.controls.noZoom = is2D;
    this.setPointSize(this.pointSize);
    this.setContextPointSize(this.contextPointSize);
  }

  // The bounding box's 12 edges, as pairs of end points (data units): for each axis, the 4 edges along it at
  // the low/high ends of the other two axes i and j
  setAxesBox(lo, hi) {
    const corners = [lo, hi];
    const vertices = [];
    for (let axis = 0; axis < 3; axis++) {
      const [i, j] = [0, 1, 2].filter((d) => d !== axis);
      for (const a of corners) {
        for (const b of corners) {
          for (const end of corners) {
            const point = [0, 0, 0];
            point[axis] = end[axis];
            point[i] = a[i];
            point[j] = b[j];
            vertices.push(...point);
          }
        }
      }
    }
    this.axesBox.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  }

  setAxesVisible(visible) {
    this.axesBox.visible = visible;
    this.render();
  }

  // Whether the bounding box face at the low (side -1) or high (side +1) end of `axis` faces the camera:
  // its outward normal, turned with the data (world frame), points toward the camera from the face's center
  facesCamera(axis, side, box) {
    this.model.updateMatrixWorld();
    const center = [...box.center];
    center[axis] = side < 0 ? box.lo[axis] : box.hi[axis];
    const centerWorld = this.points.localToWorld(new THREE.Vector3(...center));
    const normal = new THREE.Vector3();
    normal.setComponent(axis, side);
    normal.applyQuaternion(this.model.quaternion);
    return normal.dot(this.camera.position.clone().sub(centerWorld)) > 0;
  }

  // A point in data coordinates as tile CSS px (y down): data -> world -> normalized device coordinates
  // (-1..1, y up) by the camera, then x from [-1, 1] to [0, width] and y flipped from [1, -1] to [0, height]
  dataToScreen(point) {
    this.model.updateMatrixWorld();
    const ndc = this.points.localToWorld(new THREE.Vector3(...point)).project(this.camera);
    return [(ndc.x + 1) / 2 * this.container.clientWidth, (1 - ndc.y) / 2 * this.container.clientHeight];
  }

  // rgb: one byte per channel per cell, n * 3 values
  setColors(rgb) {
    const attribute = this.geometry.getAttribute('color');
    attribute.array.set(rgb);
    attribute.needsUpdate = true;
    this.render();
  }

  // state: one value per cell, 0 (not drawn), 1 (context) or 2 (shown)
  setState(state) {
    const attribute = this.geometry.getAttribute('state');
    attribute.array.set(state);
    attribute.needsUpdate = true;
    this.render();
  }

  // Point diameter in data units: size 1 is 1/EXTENT_PER_UNIT_POINT_SIZE of the data's largest side. For a cube
  // framed by frameDistance in a tile at least as wide as tall, the tile's height shows 2 tan(20 deg) / sin(20 deg)
  // * (sqrt(3) / 2) * FRAME_MARGIN = 2.06 sides, so size 1 is about tile height / 413 device px: one pixel in a
  // tile 400 device px tall; smaller points fade (see VERTEX_SHADER)
  setPointSize(size) {
    this.pointSize = size;
    this.shown.material.uniforms.uSize.value = size * this.extent / EXTENT_PER_UNIT_POINT_SIZE;
    this.render();
  }

  // Point size of context (filtered-out) cells, on the same scale as setPointSize's
  setContextPointSize(size) {
    this.contextPointSize = size;
    this.context.material.uniforms.uSize.value = size * this.extent / EXTENT_PER_UNIT_POINT_SIZE;
    this.render();
  }

  // Whether context cells are drawn in their colors rather than grey
  setContextColors(keep) {
    this.context.material.uniforms.uGrey.value = keep ? 0 : 1;
    this.render();
  }

  // Turn the data about its center to the given angles (degrees): about its own x axis, then its own (turned)
  // y axis, then its own z axis (three.js Euler order 'XYZ'), so each angle is a turn about the data's own axis
  setRotation(degrees) {
    this.angles = degrees.map((d) => THREE.MathUtils.degToRad(d));
    this.model.rotation.set(...this.angles);
    this.render();
  }

  // Turn the data by `degrees` about its own axis `axis` (0, 1, 2), wherever that axis points now
  turnAbout(axis, degrees) {
    const radians = THREE.MathUtils.degToRad(degrees);
    const local = new THREE.Vector3();
    local.setComponent(axis, 1);
    // Multiplying on the right turns about the data's own (local) axis
    this.model.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(local, radians));
    this.angles[axis] += radians;
    this.render();
  }

  // Add a turn of the data from orientation `before` to its current one to the angles: its rotation vector's
  // parts about each data axis (as they pointed before; drags turn by small steps).
  // The turn in the world frame is q = current * before^-1. A unit quaternion is (axis * sin(angle / 2),
  // cos(angle / 2)), so with w >= 0 (the short way round) angle = 2 acos(w) and the rotation vector
  // axis * angle = (x, y, z) * angle / sin(angle / 2)
  addTurns(before) {
    const turn = this.model.quaternion.clone().multiply(before.clone().invert());
    if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
    // min(1, w): rounding can leave w just above 1, outside acos's domain
    const angle = 2 * Math.acos(Math.min(1, turn.w));
    const sine = Math.sin(angle / 2);
    if (sine < MIN_TURN_SINE) return;
    const vector = new THREE.Vector3(turn.x, turn.y, turn.z).multiplyScalar(angle / sine);
    // The data's axes in the world frame before the turn; the vector's part along each is that axis's turn
    const axes = [0, 1, 2].map((k) => new THREE.Vector3().setComponent(k, 1).applyQuaternion(before));
    this.angles = wrapTurns(this.angles.map((a, k) => a + vector.dot(axes[k])));
  }

  // The data's turns (degrees) about its own x, y and z axes, as setRotation takes them
  rotationDegrees() {
    return this.angles.map((r) => THREE.MathUtils.radToDeg(r));
  }

  // Left-drag turns the data (3D only); onRotate then reports the new angles, e.g. to the sliders.
  // With Shift held, a drag moves in one direction at a time, the main direction of its recent movement
  // (rotation.recentMovement and rotation.dragDirection): a slightly diagonal drag only spins or only tilts, and
  // turning the drag the other way switches direction after a few pixels
  listenForDrags() {
    const tile = this.container;
    // Drag state: the last pointer position (null when no drag), the faded recent movement and the Shift
    // direction ('x', 'y' or null)
    let last = null;
    let recent = [0, 0];
    let shiftDirection = null;
    // Pointer positions in tile CSS px, whatever element under the pointer received the event
    const at = (event) => {
      const rect = tile.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    tile.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && !this.is2D) last = at(event);
    });
    tile.addEventListener('pointermove', (event) => {
      if (!last) return;
      const current = at(event);
      const move = [current[0] - last[0], current[1] - last[1]];
      let previous = last;
      if (event.shiftKey) {
        recent = recentMovement(recent, move);
        const direction = dragDirection([0, 0], recent);
        last = current;
        if (!direction) return;
        // The move along the direction only, ending at the real pointer: knob turns measure the pointer's angle
        // about the tile center, so a shortened move must still end where the pointer is. When the direction is
        // first known or switches, the recent movement along it is used, so no movement is lost
        const k = direction === 'x' ? 0 : 1;
        const along = direction === shiftDirection ? move[k] : recent[k];
        shiftDirection = direction;
        previous = [...current];
        previous[k] -= along;
      } else {
        recent = [0, 0];
        shiftDirection = null;
      }
      this.turnByDrag(previous, current);
      last = current;
    });
    const stop = () => {
      last = null;
      recent = [0, 0];
      shiftDirection = null;
    };
    tile.addEventListener('pointerup', stop);
    tile.addEventListener('pointercancel', stop);
  }

  // Hover: a mouse or pen move with no button pressed (a pressed one drags: turns, pans or zooms), a mouse release,
  // or a touch tap asks for a lookup of the cell under the pointer on the next animation frame, so there is at most
  // one per frame; a move before it only updates the pointer. Leaving the tile withdraws the label (a touch is
  // followed by pointerleave on release, so touches are left out; a mouse released outside the tile gets its
  // pointerleave then, as TrackballControls captures the pointer while pressed). A press cancels a pending lookup.
  // A tap is one finger down and up again, never more than TAP_SLOP_PX from where it went down, with no other finger
  // down meanwhile (a pinch);
  // pointercancel ends it without a lookup. Pens tap like mice: no label until they hover
  listenForHover() {
    const tile = this.container;
    // The pointer of the pending lookup; the touches down (pointerId -> where), and whether the current touch
    // gesture can still be a tap (one finger that has not moved more than TAP_SLOP_PX from where it went down)
    let pointer = null;
    const touches = new Map();
    let tapping = false;
    const at = (event) => {
      const rect = tile.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const lookUpSoon = (event) => {
      pointer = at(event);
      if (this.pendingLookup === null) {
        this.pendingLookup = requestAnimationFrame(() => {
          this.pendingLookup = null;
          this.reportCellAt(pointer);
        });
      }
    };
    const cancel = () => {
      cancelAnimationFrame(this.pendingLookup);
      this.pendingLookup = null;
    };
    tile.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'touch') {
        if (event.buttons === 0) lookUpSoon(event);
        return;
      }
      const start = touches.get(event.pointerId);
      const [x, y] = at(event);
      if (start && Math.hypot(x - start[0], y - start[1]) > TAP_SLOP_PX) tapping = false;
    });
    tile.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      cancel();
      this.hovering = false;
      this.onHover(-1);
    });
    tile.addEventListener('pointerdown', (event) => {
      cancel();
      if (event.pointerType !== 'touch') return;
      // The first finger may start a tap; a second one makes the gesture a pinch
      tapping = touches.size === 0;
      touches.set(event.pointerId, at(event));
    });
    tile.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'touch') {
        if (event.buttons === 0) lookUpSoon(event);
        return;
      }
      const start = touches.get(event.pointerId);
      touches.delete(event.pointerId);
      if (start && tapping) lookUpSoon(event);
    });
    tile.addEventListener('pointercancel', (event) => {
      touches.delete(event.pointerId);
      tapping = false;
    });
  }

  // Report the cell under `pointer` (tile CSS px), or none, through onHover
  reportCellAt(pointer) {
    const cell = this.cellAt(pointer);
    this.hovering = cell >= 0;
    this.onHover(cell, pointer);
  }

  // The shown cell to label at `pointer` (tile CSS px), or -1: the one nearest the camera within the pick radius
  // (picking.nearestCell). The radius is HOVER_RADIUS_PX, or the radius of a shown point at the target's distance if
  // larger: its diameter in device px as in VERTEX_SHADER, / devicePixelRatio for CSS px, / 2. Cells nearer than the
  // target are drawn larger than that, so their edges may not count. Filtered-out cells are skipped even when,
  // opaque, they are drawn over shown ones. None while shown cells are not drawn (opacity 0) or before positions
  // are set
  cellAt(pointer) {
    if (!this.shown.visible || !this.geometry.getAttribute('state')) return -1;
    const distance = this.camera.position.distanceTo(this.controls.target);
    const diameterDevicePx = this.shown.material.uniforms.uSize.value * this.uniforms.uScale.value / distance;
    const diameterPx = diameterDevicePx / this.renderer.getPixelRatio();
    const radiusPx = Math.max(HOVER_RADIUS_PX, diameterPx / 2);
    if (this.pickStale) this.buildPickGrid(Math.ceil(radiusPx));
    return nearestCell(this.projection, this.pickGrid, pointer[0], pointer[1], radiusPx);
  }

  // Project the shown cells to the tile and sort them into buckets of bucketPx (picking.js), reusing the previous
  // buffers (new ones when the cell count changed). The matrix maps data to clip: the points' placement in the world
  // (data center shifted and turned with `model`), then world to camera (matrixWorldInverse), then the projection.
  // render() only asks for a frame, and three.js updates these matrices when it draws, so they are updated here
  // first. Cost: about 30-70 ms at 750k shown cells (node, job 7402990), paid on the first lookup after each change,
  // so a mouse moving during a scroll zoom rebuilds once per frame (a possible optimization: wait for the picture to
  // settle)
  buildPickGrid(bucketPx) {
    const { clientWidth: width, clientHeight: height } = this.container;
    const xyz = this.geometry.getAttribute('position').array;
    const state = this.geometry.getAttribute('state').array;
    this.model.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const matrix = this.pickMatrix
      .multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      .multiply(this.points.matrixWorld);
    if (this.projection?.cells.length !== state.length) this.projection = makeProjection(state.length);
    projectShownCells(this.projection, xyz, state, SHOWN_STATE, matrix.elements, width, height);
    this.pickGrid = buildScreenGrid(this.pickGrid, this.projection, width, height, bucketPx);
    this.pickStale = false;
  }

  // A cell's color as drawn when shown: [r, g, b], 0..255 (setColors)
  cellColor(cell) {
    const { array } = this.geometry.getAttribute('color');
    return [array[3 * cell], array[3 * cell + 1], array[3 * cell + 2]];
  }

  // The data direction (e.g. toward dorsal) that sideways drags spin the data about
  setUpAxis(up) {
    this.upAxis.set(...up).normalize();
  }

  // 2D views: the mouse wheel zooms about the pointer and a left drag pans (3D views turn on left drags and zoom
  // and pan with TrackballControls)
  listenFor2DNavigation() {
    const tile = this.container;
    let last = null;
    const at = (event) => {
      const rect = tile.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    // Not passive, so preventDefault can stop the page from scrolling
    tile.addEventListener('wheel', (event) => {
      if (!this.is2D) return;
      event.preventDefault();
      // Scrolling up (negative deltaY) zooms in; 100 px of scrolling scales the distance by e^-0.2
      this.zoomAt(at(event), Math.exp(event.deltaY * WHEEL_ZOOM_PER_PIXEL));
    }, { passive: false });
    tile.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && this.is2D) last = at(event);
    });
    tile.addEventListener('pointermove', (event) => {
      if (!last) return;
      const current = at(event);
      this.panBy(current[0] - last[0], current[1] - last[1]);
      last = current;
    });
    const stop = () => { last = null; };
    tile.addEventListener('pointerup', stop);
    tile.addEventListener('pointercancel', stop);
  }

  // Scale the camera's distance by `factor` about the point under `pointer` (tile CSS px), so that point stays
  // under the pointer; the distance stays within fit / MAX_ZOOM_IN to fit * MAX_ZOOM_OUT.
  // The point P is where the ray from the camera through the pointer meets the plane through the target facing
  // the camera (world frame). Camera and target both move to P + s * (old - P): the camera keeps its
  // orientation and P stays on the same ray through it, so P stays on the same pixel, while the distance to
  // the target scales by s
  zoomAt(pointer, factor) {
    const { clientWidth: width, clientHeight: height } = this.container;
    const distance = this.camera.position.distanceTo(this.controls.target);
    // s: the factor after limiting the new distance
    const limited = THREE.MathUtils.clamp(distance * factor, this.fit / MAX_ZOOM_IN, this.fit * MAX_ZOOM_OUT) / distance;
    // Pointer to normalized device coordinates (-1..1, y up)
    const ndc = new THREE.Vector2(pointer[0] / width * 2 - 1, 1 - pointer[1] / height * 2);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const facing = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, this.controls.target);
    const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) return;
    this.camera.position.sub(point).multiplyScalar(limited).add(point);
    this.controls.target.sub(point).multiplyScalar(limited).add(point);
    this.cameraMoved();
  }

  // Move the camera and its target by a pointer move of (dx, dy) tile CSS px, so the data follows the pointer.
  // At the target's distance d the tile's height shows 2 d tan(fov / 2) world units, which gives world units per
  // px; the camera moves against the pointer along its own right and up axes (screen y points down)
  panBy(dx, dy) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const perPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / this.container.clientHeight;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const shift = right.multiplyScalar(-dx * perPixel).add(up.multiplyScalar(dy * perPixel));
    this.camera.position.add(shift);
    this.controls.target.add(shift);
    this.cameraMoved();
  }

  // After 2D zoom or pan moved the camera: clipping planes for its distance, then redraw and tell linked views
  cameraMoved() {
    this.clipForDistance();
    this.camera.updateMatrixWorld();
    this.render();
    this.onCameraChange();
  }

  // Clipping planes for the camera's distance from its target (see CLIP_NEAR_DIVISOR), so a close 2D zoom is not
  // clipped (3D zoom does not come here)
  clipForDistance() {
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = distance / CLIP_NEAR_DIVISOR;
    this.camera.far = distance * CLIP_FAR_MULTIPLE + this.radius * CLIP_FAR_RADII;
    this.camera.updateProjectionMatrix();
  }

  // Turn the data for a pointer move from `previous` to `current` (tile CSS px, y down). A drag across
  // the full height of the view turns it by 360 degrees: horizontal movement spins it about its up axis,
  // vertical movement tilts it about the screen's horizontal axis (world space, from the camera). The up axis
  // is taken pointing up the screen (reversed once the data is upside down), so the side facing the viewer
  // always follows the pointer. Tilts about a fixed screen axis and spins about the data's own axis never
  // combine into a roll. With a turn axis set, drags turn the data only about that axis of its own (see
  // below). Each drag adds its parts about the data's axes to the angles (addTurns); an angle taken past two
  // full turns continues from 0 (rotation.wrapTurns), so drags can keep spinning.
  // Signs (right-hand rule): a positive turn about up carries the side facing the viewer to the right, a
  // positive turn about screen right carries it down, matching positive dx and dy
  turnByDrag(previous, current) {
    const radiansPerPixel = 2 * Math.PI / this.container.clientHeight;
    const spin = (current[0] - previous[0]) * radiansPerPixel;
    const tiltAngle = (current[1] - previous[1]) * radiansPerPixel;
    if (spin === 0 && tiltAngle === 0) return;
    // The camera's up and right axes and the data's up axis, in the world frame
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = this.upAxis.clone().applyQuaternion(this.model.quaternion);
    if (up.dot(screenUp) < 0) up.negate();

    // The new orientation: world-frame turns are multiplied on the left (premultiply)
    const orientation = this.model.quaternion.clone();
    if (this.turnAxis !== null) {
      // One axis: drags across it roll it like a rolling pin (the turn's part about it), and circling the view's
      // center turns it like a knob, weighted by how much the axis points at the viewer, so it turns even when
      // it points straight at the viewer, where no straight drag turns about it. Turns about one axis add up
      // exactly, so the data never drifts about the others. The knob turn is counterclockwise-positive on screen,
      // which is a positive turn about the axis toward the viewer
      const axis = this.dataAxis(this.turnAxis);
      const toViewer = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
      const center = [this.container.clientWidth / 2, this.container.clientHeight / 2];
      const angle = up.multiplyScalar(spin).add(screenRight.multiplyScalar(tiltAngle)).dot(axis)
        + knobTurn(previous, current, center) * axis.dot(toViewer);
      orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    } else {
      // Spin first, then tilt, each as an exact rotation, so no roll builds up over many small moves
      orientation
        .premultiply(new THREE.Quaternion().setFromAxisAngle(up, spin))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(screenRight, tiltAngle));
    }

    // Apply it, add the turn to the angles and report them
    const before = this.model.quaternion.clone();
    this.model.quaternion.copy(orientation);
    this.addTurns(before);
    this.render();
    this.onRotate(this.rotationDegrees());
  }

  // Data axis k (0, 1, 2) as a world-space unit vector, after the data's rotation
  dataAxis(k) {
    const axis = new THREE.Vector3();
    axis.setComponent(k, 1);
    return axis.applyQuaternion(this.model.quaternion);
  }

  // Each data axis in the camera frame: [right, up, toward the viewer] components of its unit vector (world to
  // camera is the inverse of the camera's orientation)
  axisScreenDirections() {
    const toCamera = this.camera.quaternion.clone().invert();
    return [0, 1, 2].map((k) => this.dataAxis(k).applyQuaternion(toCamera).toArray());
  }

  // Opacity of shown cells: opaque ones hide what lies behind them; fainter ones blend over what was drawn before
  // them, but still write depth, so cells behind them drawn later stay hidden (updateBlending); at 0 they are not
  // drawn at all
  setShownOpacity(opacity) {
    this.shown.material.uniforms.uOpacity.value = opacity;
    this.shown.visible = opacity > 0;
    this.render();
  }

  // A Points object's points blend when translucent or smaller than a pixel at the target's distance (the shader
  // fades those by their area, which only shows when blending); otherwise they are opaque. Shown and context points
  // follow the same rule, so filtered-out cells at 100% hide what is behind them. Depth writes:
  // - shown points a pixel or more wide keep them when translucent, so the nearest cell is the last layer blended in
  //   each pixel: a fragment passes the depth test only if nearer than all that passed before it (cells behind show
  //   through only where drawn earlier; RAIN-22 option A);
  // - sub-pixel shown points do not, as their faint dots must add up to show the density;
  // - context points (the faint group, one alpha) write depth only when opaque.
  // Checked before each drawn frame, as zooming changes their size on screen; the material is recompiled only when
  // this switches
  updateBlending(points) {
    const { material } = points;
    const distance = this.camera.position.distanceTo(this.controls.target);
    // Point diameter in device px at the target's distance, as in VERTEX_SHADER
    const pixels = material.uniforms.uSize.value * this.uniforms.uScale.value / distance;
    const blend = material.uniforms.uOpacity.value < 1 || pixels < 1;
    const depthWrite = points === this.shown ? pixels >= 1 : !blend;
    if (material.transparent === blend && material.depthWrite === depthWrite) return;
    material.transparent = blend;
    material.depthWrite = depthWrite;
    material.needsUpdate = true;
  }

  // Diameter in CSS px of a point of relative size `size` when the view is framed (positions.framedDiameterPx), for
  // the size boxes
  framedDiameter(size) {
    return framedDiameterPx(size, this.extent, this.fit, this.container.clientHeight, this.camera.fov);
  }

  // Opacity of context cells; at 0 they are not drawn at all
  setContextOpacity(opacity) {
    this.context.material.uniforms.uOpacity.value = opacity;
    this.context.visible = opacity > 0;
    this.render();
  }

  // Place the camera in `direction` (world frame) from the data center (see positions.faceView), with `up`
  // pointing up, at the framing distance, which becomes the fit that zoom limits and refit refer to
  viewFrom(direction, up) {
    const distance = this.frameDistance();
    this.fit = distance;
    this.controls.target.set(...this.center);
    this.camera.up.set(...up);
    this.camera.position.set(...this.center.map((c, d) => c + direction[d] * distance));
    this.camera.near = distance / CLIP_NEAR_DIVISOR;
    this.camera.far = distance * CLIP_FAR_MULTIPLE;
    this.camera.updateProjectionMatrix();
    // TrackballControls turns the camera to look at its target
    this.controls.update();
    this.render();
  }

  // Follow the tile's size (skipped while it is hidden, at size 0)
  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.refit();
    this.controls.handleResize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Device px per data unit at distance 1, so point sizes follow the zoom: at distance 1 the tile's height
    // (device px) shows 2 tan(fov / 2) world units
    const pixelHeight = height * this.renderer.getPixelRatio();
    this.uniforms.uScale.value = pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.render();
    this.onResize();
  }

  // Camera distance at which the data's bounding sphere fits the tile, times FRAME_MARGIN for the axes labels: the
  // sphere fits a view cone of half-angle h at distance radius / sin(h), where h is the smaller of the
  // vertical half-angle and the horizontal one (tan(h) = tan(vertical half-angle) * width / height). A tile of
  // size 0 counts as 1 px, so the result stays finite
  frameDistance() {
    const { clientWidth: width, clientHeight: height } = this.container;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(width, 1) / Math.max(height, 1));
    return this.radius / Math.sin(Math.min(vertical, horizontal)) * FRAME_MARGIN;
  }

  // When the tile is resized, move the camera along its line of sight so the data keeps the same fit (and the
  // user's zoom stays relative to it): the camera's offset from its target, and the clipping planes, scale by
  // new fit / old fit
  refit() {
    const fit = this.frameDistance();
    const ratio = fit / this.fit;
    // Before any data is shown the fit is unknown and the ratio is not a number: nothing to keep then
    if (Number.isFinite(ratio) && ratio !== 1) {
      const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(ratio);
      this.camera.position.copy(this.controls.target).add(offset);
      this.camera.near *= ratio;
      this.camera.far *= ratio;
    }
    if (Number.isFinite(fit)) this.fit = fit;
  }

  // Camera (position, up, target) and rotation, which linked views copy with setViewState
  viewState() {
    return {
      position: this.camera.position.clone(),
      up: this.camera.up.clone(),
      target: this.controls.target.clone(),
      angles: [...this.angles],
      quaternion: this.model.quaternion.clone(),
    };
  }

  // `scale` multiplies the camera's distance from its target, so a view framed for a different tile size keeps
  // its own fit
  setViewState(state, scale = 1) {
    this.camera.position.copy(state.position).sub(state.target).multiplyScalar(scale).add(state.target);
    this.camera.up.copy(state.up);
    this.controls.target.copy(state.target);
    this.camera.lookAt(state.target);
    // A linked view zoomed far in must not clip the data
    this.clipForDistance();
    this.angles = [...state.angles];
    this.model.quaternion.copy(state.quaternion);
    this.render();
  }

  // Ask for the next frame to draw every view (see SharedCanvas). Every change of the picture (camera, rotation,
  // positions, states, sizes, opacities, colors, tile size or place) comes here, so the hover grid is dropped and a
  // reported cell is withdrawn: the next pointer move or tap looks up again
  render() {
    this.canvas.requestDraw();
    this.pickStale = true;
    if (this.hovering) {
      this.hovering = false;
      this.onHover(-1);
    }
  }

  // Draw into the tile's rectangle of the shared canvas. setViewport and setScissor take CSS px from the
  // canvas's bottom-left corner (WebGL counts y up; three.js scales by the pixel ratio), so the tile's bottom
  // edge is measured from the host's bottom
  draw() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    const tile = this.container.getBoundingClientRect();
    const host = this.canvas.host.getBoundingClientRect();
    const left = tile.left - host.left;
    const bottom = host.height - (tile.top - host.top) - height;
    this.renderer.setViewport(left, bottom, width, height);
    this.renderer.setScissor(left, bottom, width, height);
    this.updateBlending(this.shown);
    this.updateBlending(this.context);
    this.renderer.render(this.scene, this.camera);
    this.onRender();
  }

  // Stop drawing this view and free its GPU buffers (its tile is removed by the caller)
  dispose() {
    this.canvas.views.delete(this);
    cancelAnimationFrame(this.pendingLookup);
    this.projection = null;
    this.pickGrid = null;
    this.pickStale = true;
    this.controls.dispose();
    this.geometry.dispose();
    this.axesBox.geometry.dispose();
    for (const points of [this.shown, this.context]) points.material.dispose();
  }
}
