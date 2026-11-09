// Axes of a view: tick values and axis names placed along the axes box's edges, and the axis widget (one arrow
// per data axis, turning with the data). Both are redrawn after every frame (app.js sets the scene's onRender).
// They read and fill these fields of a view (app.createView, app.setEmbedding): scene (scene.js), entry (its
// manifest embedding), box (bounds of its positions, data units), axisLabelsElement and widgetElement (its tile's
// labels <div> and widget <svg>), widgetAxes (from buildAxisWidget) and axisLabels (from buildAxisLabels).
import { niceTicks, readsHighToLow, tickTarget, uprightAngle } from './positions.js';
import { axisLabels, axisTitle, widgetEndLabel } from './names.js';
import { el, svg } from './ui.js';

// The axis widget's SVG draws in a square viewBox from -WIDGET_HALF_SIZE to +WIDGET_HALF_SIZE units about its
// center. style.css sizes the widget at 56 to 130 CSS px, so one unit is 0.47 to 1.08 CSS px (and its 13px labels,
// sized in viewBox units, render at about 6 to 14 CSS px)
export const WIDGET_HALF_SIZE = 60;
// Radius of the arrows, in viewBox units
const WIDGET_RADIUS = 38;
// Radius of an arrow's head, in viewBox units
const WIDGET_HEAD_RADIUS = 4;
// End labels sit beyond the arrows' ends, at this multiple of the arrow's end point: 1.35 x 38 = 51 units from the
// center, and with half a 13-unit label added about 58, inside the viewBox's 60
const WIDGET_LABEL_DISTANCE = 1.35;
// A label whose end points away from the viewer (its toward-viewer component below -WIDGET_FAR_DEPTH) is faded to
// WIDGET_FAR_OPACITY
const WIDGET_FAR_DEPTH = 0.2;
const WIDGET_FAR_OPACITY = 0.45;

// Distance (CSS px) of tick labels and axis names from the axes box edge
const TICK_OFFSET_PX = 16;
const TITLE_OFFSET_PX = 34;
// Ticks per axis until its length on screen is known (setTicks, from updateAxisLabels)
const OPENING_TICKS = 10;
// makeTicks asks for up to this many ticks when fewer than two fit an axis that has a length
const MAX_FALLBACK_TICKS = 10;
// Added to an outline edge's score so it beats any inner edge (screen positions are far below 1e6 px)
const OUTLINE_SCORE = 1e6;

// Axis widget of a view: one arrow per data axis, turning with the data, labelled with the first letter of
// each end; locked axes are drawn grey and dashed. It only shows the orientation. Returns, per axis, its
// group and the line, head and two end labels updateAxisWidget moves
export function buildAxisWidget(widgetElement) {
  const widgetAxes = [0, 1, 2].map((axis) => {
    const line = svg('line', { class: 'shaft' });
    const head = svg('circle', { r: WIDGET_HEAD_RADIUS });
    const labels = [svg('text'), svg('text')];
    const group = svg('g', { class: 'axis', 'data-axis': axis }, [line, head, ...labels]);
    return { group, line, head, labels };
  });
  widgetElement.replaceChildren(...widgetAxes.map((a) => a.group));
  return widgetAxes;
}

// Redraw a view's arrows for its rotation and camera; arrows pointing away from the viewer are drawn
// first (behind) and their far end is faded
export function updateAxisWidget(view) {
  if (!view.entry) return;
  const names = view.entry.ends;
  // Per axis [right, up, toward the viewer] in the camera frame; SVG y runs down, so y is negated
  const directions = view.scene.axisScreenDirections();
  view.widgetAxes.forEach(({ line, head, labels }, axis) => {
    const [x, y, z] = directions[axis];
    const end = [x * WIDGET_RADIUS, -y * WIDGET_RADIUS];
    line.setAttribute('x1', -end[0]);
    line.setAttribute('y1', -end[1]);
    line.setAttribute('x2', end[0]);
    line.setAttribute('y2', end[1]);
    head.setAttribute('cx', end[0]);
    head.setAttribute('cy', end[1]);
    // Low end label opposite the arrow head, high end label beyond it
    labels.forEach((label, i) => {
      const sign = i === 0 ? -1 : 1;
      label.setAttribute('x', sign * end[0] * WIDGET_LABEL_DISTANCE);
      label.setAttribute('y', sign * end[1] * WIDGET_LABEL_DISTANCE);
      label.setAttribute('opacity', sign * z < -WIDGET_FAR_DEPTH ? WIDGET_FAR_OPACITY : 1);
      label.textContent = widgetEndLabel(names[axis][i]);
    });
  });
  // SVG draws later children on top: append the axes from farthest to nearest
  const order = [0, 1, 2].sort((a, b) => directions[a][2] - directions[b][2]);
  for (const axis of order) view.widgetElement.append(view.widgetAxes[axis].group);
}

// Axes labels of a view: round tick values along one edge of the axes box per axis, and the axis name, as
// HTML over its tile (an axis with no extent, e.g. z of 2D data, gets none)
export function buildAxisLabels(view) {
  const { lo, hi } = view.box;
  view.axisLabels = [0, 1, 2].map((axis) => ({
    target: OPENING_TICKS,
    ticks: makeTicks(lo[axis], hi[axis], OPENING_TICKS),
    // The name's text is set with its place (updateAxisLabels), as it depends on the view
    title: hi[axis] > lo[axis] ? el('span', { className: 'axis-title' }) : null,
  }));
  const labels = view.axisLabels.flatMap(({ ticks, title }) => [...ticks.map((t) => t.label), ...(title ? [title] : [])]);
  view.axisLabelsElement.replaceChildren(...labels);
}

// Round tick values between lo and hi, about `target` of them (at least two when the axis has a length, as
// one tick does not show the scale), each with its label element
function makeTicks(lo, hi, target) {
  let values = niceTicks(lo, hi, target);
  for (let more = target + 1; values.length < 2 && hi > lo && more <= MAX_FALLBACK_TICKS; more++) values = niceTicks(lo, hi, more);
  return values.map((value) => ({ value, label: el('span', { className: 'tick', textContent: String(value) }) }));
}

// Give an axis's labels about `target` ticks, replacing its tick elements when the count changes
function setTicks(view, axis, target) {
  const labels = view.axisLabels[axis];
  if (labels.target === target) return;
  labels.ticks.forEach((t) => t.label.remove());
  labels.target = target;
  labels.ticks = makeTicks(view.box.lo[axis], view.box.hi[axis], target);
  view.axisLabelsElement.append(...labels.ticks.map((t) => t.label));
}

// Place a view's labels for its rotation and camera (tile CSS px, y down). Each axis is labelled along one of
// its four box edges: preferably an outline edge (exactly one of its two faces toward the camera, so the labels
// sit outside the picture), and among those the one nearest the bottom left of the screen. Labels are pushed
// away from the box center. `manifest` names the axes of embeddings without their own names (axisLabels)
export function updateAxisLabels(view, manifest) {
  if (!view.axisLabels || view.axisLabelsElement.hidden) return;
  const { scene, box } = view;
  const { lo, hi } = box;
  const middle = scene.dataToScreen(box.center);
  const place = (element, at) => {
    element.style.left = `${at[0]}px`;
    element.style.top = `${at[1]}px`;
  };
  view.axisLabels.forEach(({ title }, axis) => {
    if (!title) return;
    // The axis's four edges run along it at the low or high end (a, b) of each other axis (i, j); edge(value)
    // is the edge's point at `value` along the axis (data frame)
    const [i, j] = [0, 1, 2].filter((d) => d !== axis);
    let best = null;
    for (const [a, aSide] of [[lo[i], -1], [hi[i], 1]]) {
      for (const [b, bSide] of [[lo[j], -1], [hi[j], 1]]) {
        const edge = (value) => {
          const point = [0, 0, 0];
          point[axis] = value;
          point[i] = a;
          point[j] = b;
          return point;
        };
        // Score: outline first, then lower (y grows down) and further left on screen
        const mid = scene.dataToScreen(edge((lo[axis] + hi[axis]) / 2));
        const outline = scene.facesCamera(i, aSide, box) !== scene.facesCamera(j, bSide, box);
        const score = (outline ? OUTLINE_SCORE : 0) + mid[1] - mid[0];
        if (!best || score > best.score) best = { score, edge, mid };
      }
    }
    // Unit vector from the box center to the chosen edge on screen: labels sit outside the box
    const away = [best.mid[0] - middle[0], best.mid[1] - middle[1]];
    const length = Math.hypot(...away) || 1;
    const out = away.map((v) => v / length);

    // Ticks fit the edge's length on screen (fewer when zoomed out), then sit along it
    const from = scene.dataToScreen(best.edge(lo[axis]));
    const to = scene.dataToScreen(best.edge(hi[axis]));
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    setTicks(view, axis, tickTarget(Math.hypot(dx, dy)));
    for (const { value, label } of view.axisLabels[axis].ticks) {
      const at = scene.dataToScreen(best.edge(value));
      place(label, [at[0] + out[0] * TICK_OFFSET_PX, at[1] + out[1] * TICK_OFFSET_PX]);
    }
    place(title, [best.mid[0] + out[0] * TITLE_OFFSET_PX, best.mid[1] + out[1] * TITLE_OFFSET_PX]);

    // The name runs along its edge on screen (so a long name beside a vertical edge does not run off the
    // view), turned so it never reads upside down; a vertical name reads bottom to top
    title.style.transform = `translate(-50%, -50%) rotate(${uprightAngle(dx, dy)}deg)`;

    // The ends are named in the order the name is read, so the name agrees with the data on screen (e.g.
    // Anterior-Posterior with anterior on the left, even when the axis runs from posterior); the text is only
    // written when it changes, as this runs every frame
    const ends = view.entry.ends[axis];
    const text = axisTitle(axisLabels(manifest, view.entry)[axis], readsHighToLow(dx, dy) ? [...ends].reverse() : ends);
    if (title.textContent !== text) title.textContent = text;
  });
}
