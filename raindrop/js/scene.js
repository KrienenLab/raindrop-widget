// WebGL point cloud: one point per cell, drawn by three.js.
//
// Each cell has a state: 0 = not drawn (no position), 1 = context (filtered out, drawn faint grey),
// 2 = shown (passes the filters, drawn in its color). Two Points objects share one geometry:
// the first draws shown cells opaque, the second draws context cells transparent on top,
// without writing depth, so faint context never hides shown cells.
//
// Rotation turns the data itself about its center, never the camera, so one orientation drives both the
// picture and the sliders. Left-dragging works like a turntable that can also tip over: left/right spins the
// data about its own up axis (dorsal), up/down tilts it about the screen's horizontal axis, with no stop at any
// angle. Spins and tilts never roll the data about the line of sight, however they combine. TrackballControls
// (with its own rotation off, as it rolls the view on sideways drags) handles zoom and pan.
//
// Several views can be shown at once (a grid): one WebGL canvas (SharedCanvas) lies behind them all, and each
// view draws only into the rectangle of its tile, an element over the canvas that also takes its mouse input.
import * as THREE from 'three';
import { TrackballControls } from '../vendor/TrackballControls.js';
import { dragDirection, knobTurn, recentMovement, wrapTurns } from './rotation.js';

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
    // uSize is in data units; uScale converts it to pixels at distance 1, so points shrink with distance. A point
    // smaller than a pixel is drawn one pixel wide, its opacity scaled by the fraction of the pixel it covers
    float size = uSize * uScale / -mvPosition.z;
    gl_PointSize = vDraw > 0.5 ? max(1.0, size) : 0.0;
    vCover = min(1.0, size * size);
  }
`;

const FRAGMENT_SHADER = `
  uniform float uOpacity;
  uniform float uContext;
  varying vec3 vColor;
  varying float vDraw;
  varying float vCover;
  void main() {
    // Round points: drop the corners of the square sprite
    vec2 c = gl_PointCoord - 0.5;
    if (vDraw < 0.5 || dot(c, c) > 0.25) discard;
    vec3 rgb = uContext > 0.5 ? vec3(0.55) : vColor;
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
    this.renderer.setClearColor(0xffffff);
    // Each view clears and draws only its own rectangle
    this.renderer.setScissorTest(true);
    this.renderer.domElement.className = 'shared-canvas';
    host.prepend(this.renderer.domElement);
    this.views = new Set();
    // The browser may clear the canvas after showing a frame, so a frame that drew only one view would
    // blank the others: any change asks for a redraw, and the next frame draws every view
    this.needsDraw = false;
    // TrackballControls moves cameras in update(), which must run every frame
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

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.controls = new TrackballControls(this.camera, container);
    this.controls.noRotate = true;
    // No drifting after the mouse is released: the view stays where it was left
    this.controls.staticMoving = true;
    this.controls.addEventListener('change', () => {
      this.render();
      this.onCameraChange();
    });

    this.geometry = new THREE.BufferGeometry();
    this.uniforms = { uSize: { value: 1 }, uScale: { value: 1 } };
    this.shown = this.makePoints(2, 1, false);
    this.context = this.makePoints(1, 0.08, true);
    this.context.renderOrder = 1;

    // Rotations turn `model` about the data center: `model` sits at the center and holds the
    // points shifted back by the center, so its rotation pivots there
    this.model = new THREE.Group();
    this.points = new THREE.Group();
    this.points.add(this.shown, this.context);
    this.model.add(this.points);
    this.scene.add(this.model);

    // Axes box: the twelve edges of the data's bounding box, in data coordinates, so it turns with the data
    this.axesBox = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xb8b8b8 }));
    this.points.add(this.axesBox);
    this.onRotate = () => {};
    // Called after every frame, e.g. to redraw the axis widget, and when zoom or pan moved the camera
    this.onRender = () => {};
    this.onCameraChange = () => {};
    // The data's turns (radians) about its own x, y and z axes, as the sliders show them: every turn adds its
    // parts about each axis of the data as it points then (see addTurns), so they depend on the order of turns;
    // and the data axis that drags turn about (null: any, as a turntable; see turnByDrag)
    this.angles = [0, 0, 0];
    this.turnAxis = null;
    // Data direction that sideways drags spin about (see setUpAxis)
    this.upAxis = new THREE.Vector3(0, 1, 0);
    this.listenForDrags();
    this.listenFor2DNavigation();

    this.pointSize = 1;
    new ResizeObserver(() => this.resize()).observe(container);
  }

  makePoints(drawState, opacity, isContext) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uDrawState: { value: drawState },
        uOpacity: { value: opacity },
        uContext: { value: isContext ? 1 : 0 },
        uSize: this.uniforms.uSize,
        uScale: this.uniforms.uScale,
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: isContext,
      depthWrite: !isContext,
    });
    const points = new THREE.Points(this.geometry, material);
    points.frustumCulled = false;
    return points;
  }

  // xyz: Float32Array of n * 3 (see positions.js); box (positions.bounds) frames the camera and the axes box
  setPositions(xyz, box, is2D) {
    const { center, extent } = box;
    const n = xyz.length / 3;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
    if (!this.geometry.getAttribute('color') || this.geometry.getAttribute('color').count !== n) {
      this.geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(n * 3).fill(128), 3, true));
      this.geometry.setAttribute('state', new THREE.BufferAttribute(new Float32Array(n), 1));
    }
    this.center = center;
    this.extent = extent;
    // Half the box diagonal: a sphere this size holds the data and its axes box at any rotation
    this.radius = Math.hypot(...box.hi.map((h, d) => h - box.lo[d])) / 2;
    this.setAxesBox(box.lo, box.hi);
    this.model.position.set(...center);
    this.points.position.set(...center.map((c) => -c));
    this.is2D = is2D;
    // 2D views zoom about the pointer themselves (listenFor2DNavigation); TrackballControls zooms about the center
    this.controls.noZoom = is2D;
    this.setPointSize(this.pointSize);
  }

  // The bounding box's 12 edges: for each axis, the 4 edges along it at the low/high ends of the other two
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
  // its outward normal, turned with the data, points toward the camera from the face's center
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

  // A point in data coordinates as canvas pixels (y down), after the data's rotation and the camera
  dataToScreen(point) {
    this.model.updateMatrixWorld();
    const ndc = this.points.localToWorld(new THREE.Vector3(...point)).project(this.camera);
    return [(ndc.x + 1) / 2 * this.container.clientWidth, (1 - ndc.y) / 2 * this.container.clientHeight];
  }

  setColors(rgb) {
    const attribute = this.geometry.getAttribute('color');
    attribute.array.set(rgb);
    attribute.needsUpdate = true;
    this.render();
  }

  setState(state) {
    const attribute = this.geometry.getAttribute('state');
    attribute.array.set(state);
    attribute.needsUpdate = true;
    this.render();
  }

  // Size 1 is a point 1/400 of the data's largest extent across
  setPointSize(size) {
    this.pointSize = size;
    // Size 1 is 1/200 of the data's extent: about one pixel for a full-window view of the data, so points
    // smaller than that fade only at smaller sizes or in smaller tiles
    this.uniforms.uSize.value = size * this.extent / 200;
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
  // parts about each data axis (as they pointed before; drags turn by small steps)
  addTurns(before) {
    const turn = this.model.quaternion.clone().multiply(before.clone().invert());
    // The short way round, then the rotation vector: axis times angle
    if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
    const angle = 2 * Math.acos(Math.min(1, turn.w));
    const sine = Math.sin(angle / 2);
    if (sine < 1e-12) return;
    const vector = new THREE.Vector3(turn.x, turn.y, turn.z).multiplyScalar(angle / sine);
    const axes = [0, 1, 2].map((k) => new THREE.Vector3().setComponent(k, 1).applyQuaternion(before));
    this.angles = wrapTurns(this.angles.map((a, k) => a + vector.dot(axes[k])));
  }

  // The data's turns (degrees) about its own x, y and z axes, as setRotation takes them
  rotationDegrees() {
    return this.angles.map((r) => THREE.MathUtils.radToDeg(r));
  }

  // Left-drag turns the data (3D only); onRotate then reports the new angles, e.g. to the sliders
  // With Shift held, a drag moves in one direction at a time, the main direction of its recent movement
  // (rotation.recentMovement and rotation.dragDirection): a slightly diagonal drag only spins or only tilts, and
  // turning the drag the other way switches direction after a few pixels
  listenForDrags() {
    const tile = this.container;
    let last = null;
    let recent = [0, 0];
    let shiftDirection = null;
    // Pointer positions relative to the tile, whatever element under the pointer received the event
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
        // The move along the direction only, ending at the pointer (so knob turns stay centered on it). When the
        // direction is first known or switches, the recent movement along it is used, so no movement is lost
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
    tile.addEventListener('wheel', (event) => {
      if (!this.is2D) return;
      event.preventDefault();
      // Scrolling up (negative deltaY) zooms in; 100 px of scrolling scales the distance by e^-0.2
      this.zoomAt(at(event), Math.exp(event.deltaY * 0.002));
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

  // Scale the camera's distance by `factor` about the point under `pointer` (tile pixels) on the plane through the
  // target facing the camera, so that point stays under the pointer; the distance stays within 1/500 to 4 times
  // the framing distance
  zoomAt(pointer, factor) {
    const { clientWidth: width, clientHeight: height } = this.container;
    const distance = this.camera.position.distanceTo(this.controls.target);
    const limited = THREE.MathUtils.clamp(distance * factor, this.fit / 500, this.fit * 4) / distance;
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

  // Move the camera and its target by a pointer move of (dx, dy) tile pixels, so the data follows the pointer
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

  // After zoom or pan moved the camera: clipping planes for its distance, then redraw and tell linked views
  cameraMoved() {
    this.clipForDistance();
    this.camera.updateMatrixWorld();
    this.render();
    this.onCameraChange();
  }

  // Clipping planes for the camera's distance from its target, so a close zoom is not clipped
  clipForDistance() {
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = distance / 100;
    this.camera.far = distance * 10 + this.radius * 4;
    this.camera.updateProjectionMatrix();
  }

  // Turn the data for a pointer move from `previous` to `current` (canvas pixels, y down). A drag across
  // the full height of the view turns it by 360 degrees: horizontal movement spins it about its up axis,
  // vertical movement tilts it about the screen's horizontal axis (world space, from the camera). The up axis
  // is taken pointing up the screen (reversed once the data is upside down), so the side facing the viewer
  // always follows the pointer. Tilts about a fixed screen axis and spins about the data's own axis never
  // combine into a roll. With a turn axis set, drags turn the data only about that axis of its own (see
  // below). Each drag adds its parts about the data's axes to the angles (addTurns); an angle taken past two
  // full turns continues from 0 (rotation.wrapTurns), so drags can keep spinning
  turnByDrag(previous, current) {
    const radiansPerPixel = 2 * Math.PI / this.container.clientHeight;
    const spin = (current[0] - previous[0]) * radiansPerPixel;
    const tiltAngle = (current[1] - previous[1]) * radiansPerPixel;
    if (spin === 0 && tiltAngle === 0) return;
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = this.upAxis.clone().applyQuaternion(this.model.quaternion);
    if (up.dot(screenUp) < 0) up.negate();

    const orientation = this.model.quaternion.clone();
    if (this.turnAxis !== null) {
      // One axis: drags across it roll it like a rolling pin (the turn's part about it), and circling the view's
      // center turns it like a knob, weighted by how much the axis points at the viewer, so it turns even when
      // it points straight at the viewer, where no straight drag turns about it. Turns about one axis add up
      // exactly, so the data never drifts about the others
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

  // Each data axis as seen by the camera: [right, up, toward the viewer] components of its unit vector
  axisScreenDirections() {
    const toCamera = this.camera.quaternion.clone().invert();
    return [0, 1, 2].map((k) => this.dataAxis(k).applyQuaternion(toCamera).toArray());
  }

  // Opacity of shown cells: opaque ones hide what lies behind them (depth written); fainter ones blend, so
  // dense regions look darker, and no longer hide other points
  setShownOpacity(opacity) {
    this.shown.material.uniforms.uOpacity.value = opacity;
    this.render();
  }

  // Shown points blend (without depth writes) when translucent or smaller than a pixel at the target's distance
  // (the shader fades those by their area); otherwise they are opaque. Checked before each frame, as zooming
  // changes their size on screen
  updateShownBlending() {
    const { material } = this.shown;
    const distance = this.camera.position.distanceTo(this.controls.target);
    const pixels = this.uniforms.uSize.value * this.uniforms.uScale.value / distance;
    const blend = material.uniforms.uOpacity.value < 1 || pixels < 1;
    if (material.transparent === blend) return;
    material.transparent = blend;
    material.depthWrite = !blend;
    material.needsUpdate = true;
  }

  setContextOpacity(opacity) {
    this.context.material.uniforms.uOpacity.value = opacity;
    this.context.visible = opacity > 0;
    this.render();
  }

  // Place the camera in `direction` from the data center (see positions.faceView), with `up` pointing up
  viewFrom(direction, up) {
    const distance = this.frameDistance();
    this.fit = distance;
    this.controls.target.set(...this.center);
    this.camera.up.set(...up);
    this.camera.position.set(...this.center.map((c, d) => c + direction[d] * distance));
    this.camera.near = distance / 100;
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.refit();
    this.controls.handleResize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Pixels per data unit at distance 1, so point sizes follow the zoom
    const pixelHeight = height * this.renderer.getPixelRatio();
    this.uniforms.uScale.value = pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.render();
  }

  // Camera distance at which the data's bounding sphere fits the tile with a margin for the axes labels: the
  // sphere fits a view cone of half-angle h at distance radius / sin(h), where h is the smaller of the
  // vertical half-angle and the horizontal one (tan(h) = tan(vertical half-angle) * width / height)
  frameDistance() {
    const { clientWidth: width, clientHeight: height } = this.container;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(width, 1) / Math.max(height, 1));
    return this.radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
  }

  // When the tile is resized, move the camera along its line of sight so the data keeps the same fit (and the
  // user's zoom stays relative to it)
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

  // Ask for the next frame to draw every view (see SharedCanvas)
  render() {
    this.canvas.requestDraw();
  }

  // Draw into the tile's rectangle of the shared canvas (WebGL counts y from the bottom)
  draw() {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    const tile = this.container.getBoundingClientRect();
    const host = this.canvas.host.getBoundingClientRect();
    const left = tile.left - host.left;
    const bottom = host.height - (tile.top - host.top) - height;
    this.renderer.setViewport(left, bottom, width, height);
    this.renderer.setScissor(left, bottom, width, height);
    this.updateShownBlending();
    this.renderer.render(this.scene, this.camera);
    this.onRender();
  }

  // Stop drawing this view and free its GPU buffers (its tile is removed by the caller)
  dispose() {
    this.canvas.views.delete(this);
    this.controls.dispose();
    this.geometry.dispose();
    this.axesBox.geometry.dispose();
    for (const points of [this.shown, this.context]) points.material.dispose();
  }
}
