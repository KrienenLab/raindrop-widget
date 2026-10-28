// Raindrop viewer: wires the dataset, the point cloud and the side panel together.
// Open as index.html?data=<dataset folder URL>.
import { Dataset } from './data.js';
import { PointCloudView, SharedCanvas } from './scene.js';
import * as filters from './filters.js';
import { bounds, faceView, niceTicks, readsHighToLow, tickTarget, toXYZ, uprightAngle, validMask } from './positions.js';
import { groupState, treeRows } from './hierarchy.js';
import { clampDegrees, faceRotation, MAX_DEGREES, openingTurnAxis } from './rotation.js';
import { categoryPalette, colorCategories, colorValues, geneColors, quantile, sortedFinite, toHex, COLORMAP_CSS } from './colors.js';

// Create an element with properties and children
function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  Object.assign(element, props);
  element.append(...children);
  return element;
}

// Create an SVG element with attributes and children
function svg(tag, attributes = {}, children = []) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.append(...children);
  return element;
}

// Most views shown at once (a 3 x 4 grid)
const MAX_VIEWS = 12;

// Radius of the axis widget's arrows, in its viewBox units (-60..60)
const WIDGET_RADIUS = 38;

// Distance (pixels) of tick labels and axis names from the axes box edge
const TICK_OFFSET = 16;
const TITLE_OFFSET = 34;

// Widget label for an axis end: the first letter of an anatomical name (anterior -> A), or a generic
// name such as '-x' unchanged
function endLabel(name) {
  return /^[-+]/.test(name) ? name : name.charAt(0).toUpperCase();
}

// Axis widget label for an axis end: as endLabel for anatomical names; for generic names ('-UMAP 1', '+UMAP 1')
// the last word of the high end only ('1'), so labels stay short in the small widget
function widgetEndLabel(name) {
  if (!/^[-+]/.test(name)) return endLabel(name);
  return name.startsWith('+') ? name.slice(1).split(' ').pop() : '';
}

function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Names of an embedding's axes: its own (convert.embedding_axis_labels, e.g. UMAP 1), or the dataset's axis labels
// for manifests written before embeddings had them
function axisLabels(manifest, entry) {
  return entry.labels ?? manifest.axes.labels;
}

// Axis name on the plot: both ends spelled out in the given order (e.g. Anterior-Posterior), or the axis label
// when the ends are generic ('-x', '+x')
function axisTitle(label, ends) {
  return ends.some((name) => /^[-+]/.test(name)) ? label : ends.map(capitalize).join('\u2013');
}

// What a view is colored by, as its legends name it: genes with their scale ('log scale' when the viewer takes the
// log, or the source's own, e.g. 'log2'), and genes of a source other than the first (X's measured genes) with their
// source, e.g. 'Pcp4 (imputed, log scale)'
function colorLabel(color, sources) {
  if (color.kind !== 'gene') return color.name;
  const scale = sources.find((s) => s.name === color.source).scale ?? 'log scale';
  return color.source === sources[0].name ? `${color.name} (${scale})` : `${color.name} (${color.source}, ${scale})`;
}

function formatCount(n) {
  return n.toLocaleString('en-US');
}

// The category codes a checkbox row stands for: one value, or all children of a group (data-codes '3,7,9')
function rowCodes(row) {
  return row.dataset.codes.split(',').map(Number);
}

// One checkbox row for a value or a group of values: state 'all' ticks the box, 'some' shows it partly
// ticked (a group with some of its children ticked)
function checkRow(codes, name, count, rgb, state) {
  const box = el('input', { type: 'checkbox', checked: state === 'all' });
  box.indeterminate = state === 'some';
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = toHex(rgb);
  const row = el('label', { className: 'row' }, [box, swatch, el('span', { className: 'name', textContent: name }),
    el('span', { className: 'count', textContent: formatCount(count) })]);
  row.dataset.codes = codes.join(',');
  row.classList.toggle('empty', count === 0);
  return row;
}

// Checkbox rows (class 'row', data-codes, one checkbox each) inside `container` can be set by dragging: pressing
// a row gives it the opposite of its state, dragging over other rows gives them the same state, and on release
// apply(codes, value) runs once. A press without dragging thus toggles one row. Mouse clicks are taken over
// (the label would toggle the box again); keyboard toggles still reach apply through the change event.
// A group's open/close button is left to its own click handler
function enableDragSelect(container, apply) {
  let drag = null;
  const mark = (row) => {
    row.querySelector('input').checked = drag.value;
    for (const code of rowCodes(row)) drag.codes.add(code);
  };
  container.addEventListener('pointerdown', (event) => {
    const row = event.target.closest('.row');
    if (!row || event.button !== 0 || event.target.closest('.expander')) return;
    event.preventDefault();
    drag = { value: !row.querySelector('input').checked, codes: new Set() };
    mark(row);
  });
  container.addEventListener('pointerover', (event) => {
    const row = event.target.closest('.row');
    if (drag && row) mark(row);
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const { codes, value } = drag;
    drag = null;
    apply([...codes], value);
  });
  // A mouse click (detail > 0) was handled on pointerdown; a keyboard click (detail 0) toggles as usual
  container.addEventListener('click', (event) => {
    if (event.detail > 0 && event.target.closest('.row')) event.preventDefault();
  });
  container.addEventListener('change', (event) => {
    const row = event.target.closest('.row');
    if (row) apply(rowCodes(row), event.target.checked);
  });
}

// Dropdown that sorts a list by name (A-Z) or by number of cells; onChange gets 'name' or 'count'
function sortSelect(initial, onChange) {
  const select = el('select', { className: 'sort', title: 'Sort by name or by number of cells' }, [
    el('option', { value: 'name', textContent: 'A\u2013Z' }),
    el('option', { value: 'count', textContent: 'Count' }),
  ]);
  select.value = initial;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

class App {
  constructor(dataset) {
    this.dataset = dataset;
    this.manifest = dataset.manifest;
    // All views draw into one canvas behind their tiles; see scene.js
    this.canvas = new SharedCanvas(document.getElementById('view'));
    // The views in the grid; the side panel's view and color controls apply to the selected one
    this.views = [];
    this.selected = null;
    // Settings shared by linked views (filters, turn axis, point size, opacities, axes); an unlinked view
    // has its own copy. Made in buildViewControls, from the controls' starting values
    this.palettes = new Map();
    // Two-level hierarchies by child column (e.g. Subclass -> its classes), from --hierarchy in convert.py
    this.hierarchies = new Map((this.manifest.hierarchies ?? []).map((h) => [h.child, h]));
    // Open groups in the legend's tree, per colored column
    this.legendExpanded = new Map();
    this.legendSortBy = 'name';
    this.legendRenders = 0;
    this.rotation = [0, 0, 0];
  }

  async init() {
    const { manifest } = this;
    document.title = `${manifest.name} - Raindrop`;
    document.getElementById('title').textContent = manifest.name;
    this.buildViewControls();
    this.buildColorControls();
    this.buildLegend();
    document.getElementById('add-filter').addEventListener('change', async (event) => {
      if (event.target.value) await this.addFilter(event.target.value);
    });

    const view = this.createView();
    this.select(view);
    await this.setEmbedding(view, manifest.defaults.embedding);
    for (const name of manifest.defaults.filters) await this.addFilter(name);
    const firstCategory = manifest.fields.find((f) => f.kind === 'category');
    await this.setColor(view, { kind: 'field', name: manifest.defaults.color ?? firstCategory?.name });
  }

  palette(field) {
    if (!this.palettes.has(field.name)) this.palettes.set(field.name, categoryPalette(field));
    return this.palettes.get(field.name);
  }

  // Colors of a hierarchy's groups: the parent column's colors where it has them, else generated
  groupPalette(hierarchy) {
    const key = `${hierarchy.parent} › ${hierarchy.child}`;
    if (!this.palettes.has(key)) this.palettes.set(key, categoryPalette({ categories: hierarchy.groups, colors: hierarchy.colors }));
    return this.palettes.get(key);
  }

  // Name shown for a column in filter titles and the add-filter list: 'Class > Subclass' for a hierarchy
  columnTitle(name) {
    const hierarchy = this.hierarchies.get(name);
    return hierarchy ? `${hierarchy.parent} › ${name}` : name;
  }

  // Checkbox rows for a categorical column's values matching `search`: a flat list, or, when the column has a
  // hierarchy, its groups (ticking one ticks all its children; its button opens it, through onToggleGroup)
  // with the open groups' children indented underneath
  categoryRows(field, counts, allowed, sortBy, search, expanded, onToggleGroup) {
    const palette = this.palette(field);
    const state = (code) => (allowed?.[code] ? 'all' : 'none');
    const hierarchy = this.hierarchies.get(field.name);
    if (!hierarchy) {
      return filters.orderCategories(field.categories, counts, sortBy)
        .filter((code) => field.categories[code].toLowerCase().includes(search))
        .map((code) => checkRow([code], field.categories[code], counts[code], palette[code], state(code)));
    }

    const groupColors = this.groupPalette(hierarchy);
    return treeRows(field.categories, counts, hierarchy.parent_of, hierarchy.groups, sortBy, search, expanded).map((row) => {
      if (row.kind === 'child') {
        const child = checkRow(row.codes, field.categories[row.code], row.count, palette[row.code], state(row.code));
        child.classList.add('child');
        return child;
      }
      const group = checkRow(row.codes, hierarchy.groups[row.group], row.count, groupColors[row.group], groupState(row.codes, allowed));
      group.classList.add('group');
      const toggle = el('button', { className: 'expander', textContent: row.open ? '▾' : '▸', title: row.open ? 'Hide its values' : 'Show its values' });
      toggle.addEventListener('click', () => onToggleGroup(row.group));
      group.prepend(toggle);
      return group;
    });
  }

  // The selected view's settings (the linked views' shared settings before any view exists)
  get settings() {
    return this.selected?.settings ?? this.group;
  }

  get filters() {
    return this.settings.filters;
  }

  get turnAxis() {
    return this.settings.turnAxis;
  }

  // Views using a settings object: all linked views for the shared one, or one unlinked view
  viewsWith(settings) {
    return this.views.filter((view) => view.settings === settings);
  }

  // View: number of views, embedding, sides, rotation, axes, point size and the opacity of shown and filtered-out cells.
  // Axes, point size, opacities and the turn axis belong to the selected view's settings
  buildViewControls() {
    const count = document.getElementById('view-count');
    for (let n = 1; n <= MAX_VIEWS; n++) count.append(el('option', { value: n, textContent: n }));
    count.addEventListener('change', () => this.setViewCount(Number(count.value)));
    this.group = {
      filters: [],
      turnAxis: openingTurnAxis(this.manifest.axes.labels, this.manifest.defaults.locked),
      // The point size slider is log2 of the size (0: the default size)
      pointSize: 2 ** Number(document.getElementById('point-size').value),
      shownOpacity: Number(document.getElementById('shown-opacity').value),
      contextOpacity: Number(document.getElementById('context-opacity').value),
      showAxes: document.getElementById('show-axes').checked,
    };

    const select = document.getElementById('embedding');
    for (const e of this.manifest.embeddings) select.append(el('option', { value: e.name, textContent: `${e.name} (${e.dims}D)` }));
    select.addEventListener('change', () => this.setEmbedding(this.selected, select.value));

    this.buildRotationSliders();

    // Each control changes the selected view's settings, and so every view that shares them
    const control = (id, key, read) => {
      const input = document.getElementById(id);
      input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
        this.settings[key] = read(input);
        for (const view of this.viewsWith(this.settings)) this.applySettings(view);
      });
    };
    control('point-size', 'pointSize', (input) => 2 ** Number(input.value));
    control('shown-opacity', 'shownOpacity', (input) => Number(input.value));
    control('context-opacity', 'contextOpacity', (input) => Number(input.value));
    control('show-axes', 'showAxes', (input) => input.checked);
  }

  // Show a view's display settings and turn axis in it
  applySettings(view) {
    const { settings, scene } = view;
    scene.turnAxis = settings.turnAxis;
    scene.setPointSize(settings.pointSize);
    scene.setShownOpacity(settings.shownOpacity);
    scene.setContextOpacity(settings.contextOpacity);
    scene.setAxesVisible(settings.showAxes);
    view.axisLabelsElement.hidden = !settings.showAxes;
    // With a turn axis, the other axes of a 3D view are drawn as locked (2D views do not turn)
    const turning = view.entry?.dims !== 2 && settings.turnAxis !== null;
    view.widgetAxes.forEach(({ group }, axis) => {
      group.classList.toggle('locked', turning && axis !== settings.turnAxis);
    });
  }

  // The side panel shows the selected view's settings: display controls, turn axis and filter panels
  showSettings() {
    const { settings } = this;
    document.getElementById('point-size').value = Math.log2(settings.pointSize);
    document.getElementById('shown-opacity').value = settings.shownOpacity;
    document.getElementById('context-opacity').value = settings.contextOpacity;
    document.getElementById('show-axes').checked = settings.showAxes;
    document.getElementById('filters').replaceChildren(...settings.filters.map((f) => f.panel));
    this.showTurnAxis();
  }

  // A copy of settings for a view being unlinked: its filters start as the group's, with their own panels
  copySettings(settings) {
    const copy = { ...settings };
    copy.filters = settings.filters.map((filter) => {
      const twin = { ...filter, allowed: filter.allowed && filter.allowed.slice(), expanded: new Set(filter.expanded) };
      twin.panel = this.buildFilterPanel(twin);
      return twin;
    });
    return copy;
  }

  // Link button of a view: a linked view shares the group's settings, camera and rotation (with linked views
  // on the same embedding); unlinking gives it a copy to change on its own, and linking it again makes it take
  // the group's settings and the camera of a linked view on its embedding
  toggleLink(view) {
    view.linked = !view.linked;
    view.linkButton.setAttribute('aria-pressed', String(view.linked));
    if (view.linked) {
      view.settings = this.group;
      const partner = this.views.find((v) => v !== view && v.linked && v.entry === view.entry);
      if (partner) view.scene.setViewState(partner.scene.viewState(), view.scene.fit / partner.scene.fit);
    } else {
      view.settings = this.copySettings(this.group);
    }
    this.applySettings(view);
    if (view === this.selected) {
      this.showSettings();
      this.showRotation(view.scene.rotationDegrees());
    }
    this.refresh();
  }

  // A view: its tile (with axis labels, a compact legend and the axis widget over the shared canvas), its
  // scene, and what it shows (embedding, colors), filled in by setEmbedding and setColor
  createView() {
    const axisLabelsElement = el('div', { className: 'axis-labels' });
    const tileLegend = el('div', { className: 'tile-legend' });
    const widgetElement = svg('svg', { class: 'axis-widget', viewBox: '-60 -60 120 120', 'aria-label': 'Orientation of the data axes' });
    const tile = el('div', { className: 'tile' }, [axisLabelsElement, tileLegend, widgetElement]);
    document.getElementById('tiles').append(tile);

    // New views are linked; the link button's press must not select, turn or zoom the view. Its chain icon is
    // drawn with SVG (paths of the Feather 'link' icon, MIT license), as an emoji needs a font that may be missing
    const icon = svg('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      svg('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
      svg('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
    ]);
    const linkButton = el('button', { className: 'link', title: 'Linked views share camera, filters and settings' }, [icon]);
    linkButton.setAttribute('aria-pressed', 'true');
    linkButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    tile.append(linkButton);

    const view = { tile, axisLabelsElement, tileLegend, widgetElement, linkButton, color: null, linked: true, settings: this.group };
    linkButton.addEventListener('click', () => this.toggleLink(view));
    view.scene = new PointCloudView(tile, this.canvas);
    view.widgetAxes = this.buildAxisWidget(widgetElement);
    this.applySettings(view);
    view.scene.onRotate = (degrees) => this.viewTurned(view, degrees);
    view.scene.onCameraChange = () => this.syncFrom(view);
    view.scene.onRender = () => {
      this.updateAxisWidget(view);
      this.updateAxisLabels(view);
    };
    tile.addEventListener('pointerdown', () => this.select(view));
    this.views.push(view);
    this.layoutViews();
    this.showTurnAxis();
    return view;
  }

  // Grid of tiles: 1 view fills the plot, 2 sit side by side, then the smallest n x n or n x (n + 1) grid
  layoutViews() {
    const n = this.views.length;
    const columns = n <= 2 ? n : Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / columns);
    const tiles = document.getElementById('tiles');
    tiles.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    tiles.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    tiles.classList.toggle('several', n > 1);
    // Tiles that moved without changing size still need drawing at their new place
    requestAnimationFrame(() => {
      for (const view of this.views) view.scene.render();
    });
  }

  // Show n views: new ones copy the selected view (embedding, colors, camera and rotation); the last
  // ones are removed when there are fewer
  async setViewCount(n) {
    document.getElementById('view-count').value = n;
    while (this.views.length > n) {
      const view = this.views.pop();
      view.scene.dispose();
      view.tile.remove();
      if (view === this.selected) this.select(this.views[0]);
    }
    const template = this.selected;
    while (this.views.length < n) {
      const view = this.createView();
      await this.setEmbedding(view, template.entry.name);
      await this.setColor(view, template.color);
      view.scene.setViewState(template.scene.viewState(), view.scene.fit / template.scene.fit);
    }
    this.layoutViews();
    this.refresh();
  }

  // Make a view the one the side panel's view and color controls apply to
  select(view) {
    if (this.selected === view) return;
    this.selected = view;
    for (const v of this.views) v.tile.classList.toggle('selected', v === view);
    if (!view.entry) return;
    document.getElementById('embedding').value = view.entry.name;
    this.showViewControls(view);
    this.showColorControls(view);
    this.showSettings();
    this.showRotation(view.scene.rotationDegrees());
    this.refresh();
  }

  // Linked views showing the same embedding as a linked `view`, which move with it
  linkedTo(view) {
    return view.linked ? this.views.filter((v) => v !== view && v.linked && v.entry === view.entry) : [];
  }

  // Copy a view's camera and rotation to the views linked to it. The camera distance is scaled by the distances
  // the two cameras are framed for (fit; a refit after a resize may still be pending), so each keeps its own fit
  syncFrom(view) {
    if (!view || this.syncing) return;
    this.syncing = true;
    const state = view.scene.viewState();
    for (const other of this.linkedTo(view)) other.scene.setViewState(state, other.scene.fit / view.scene.fit);
    this.syncing = false;
  }

  // A drag turned a view: show its angles if it is (or moves with) the selected view, and turn linked views
  viewTurned(view, degrees) {
    this.syncFrom(view);
    if (view === this.selected || this.linkedTo(view).includes(this.selected)) this.showRotation(degrees);
  }

  // Turn about: Any (drags turn the data as a turntable) or one axis (drags turn it only about that axis of its
  // own, and the other sliders are disabled); --locked with two axes opens on the third; the selected view's.
  // Rotation table, one row per axis: a slider that turns the selected view's data about its own axis (wherever it
  // points), a box with the angle turned about it and a button that sets that angle to 0 (turning back by it).
  // Angles run from -360 to 360 degrees with hard ends (typed angles are clamped). Drags add their parts about
  // each axis to the angles. A button below the table returns to the opening side, every angle 0
  buildRotationSliders() {
    const turnAbout = document.getElementById('turn-about');
    turnAbout.append(el('option', { value: '', textContent: 'Any' }));
    this.manifest.axes.labels.forEach((label, axis) => turnAbout.append(el('option', { value: axis, textContent: label })));
    turnAbout.addEventListener('change', () => this.setTurnAxis(turnAbout.value === '' ? null : Number(turnAbout.value)));
    this.rotationInputs = this.manifest.axes.labels.map((label, axis) => {
      const range = { min: -MAX_DEGREES, max: MAX_DEGREES, step: 1, value: 0 };
      const slider = el('input', { type: 'range', ...range, title: `Rotate about the ${label} axis` });
      const number = el('input', { type: 'number', ...range, title: 'Degrees' });
      // Turn about the data's own axis by the change from its current angle
      const set = (degrees) => {
        const scene = this.selected.scene;
        scene.turnAbout(axis, clampDegrees(degrees) - scene.rotationDegrees()[axis]);
        this.showRotation(scene.rotationDegrees());
        this.syncFrom(this.selected);
      };
      slider.addEventListener('input', () => set(Number(slider.value)));
      number.addEventListener('change', () => set(Number(number.value)));
      const reset = el('button', { className: 'reset', textContent: '0', title: `Set ${label} to 0 degrees` });
      reset.addEventListener('click', () => set(0));

      const cells = [slider, number, reset].map((control) => el('td', {}, [control]));
      const header = el('th', { textContent: label });
      document.getElementById('rotation').append(el('tr', {}, [header, ...cells]));
      return { slider, number, header };
    });
    document.getElementById('reset-rotation').addEventListener('click', () => this.resetRotation());
    this.showTurnAxis();
  }

  // Turn the selected view (and the views linked to it) to the given angles (degrees)
  turnSelected(degrees) {
    this.selected.scene.setRotation(degrees);
    this.syncFrom(this.selected);
  }

  // Axis widget of a view: one arrow per data axis, turning with the data, labelled with the first letter of
  // each end; locked axes are drawn grey and dashed. It only shows the orientation (locks are in the table)
  buildAxisWidget(widgetElement) {
    const widgetAxes = [0, 1, 2].map((axis) => {
      const line = svg('line', { class: 'shaft' });
      const head = svg('circle', { r: 4 });
      const labels = [svg('text'), svg('text')];
      const group = svg('g', { class: 'axis', 'data-axis': axis }, [line, head, ...labels]);
      return { group, line, head, labels };
    });
    widgetElement.replaceChildren(...widgetAxes.map((a) => a.group));
    return widgetAxes;
  }

  // Set the axis drags turn about (null: any) in the selected view's settings (so in every view sharing them)
  setTurnAxis(axis) {
    this.settings.turnAxis = axis;
    for (const view of this.viewsWith(this.settings)) this.applySettings(view);
    this.showTurnAxis();
  }

  // Show the selected view's turn axis: the Turn about menu, and the other axes' sliders disabled
  showTurnAxis() {
    const axis = this.turnAxis;
    document.getElementById('turn-about').value = axis === null ? '' : String(axis);
    this.rotationInputs.forEach(({ slider, number }, k) => {
      slider.disabled = axis !== null && k !== axis;
      number.disabled = slider.disabled;
    });
  }

  // Redraw a view's arrows for its rotation and camera; arrows pointing away from the viewer are drawn
  // first (behind) and their far end is faded
  updateAxisWidget(view) {
    if (!view.entry) return;
    const names = view.entry.ends;
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
        label.setAttribute('x', sign * end[0] * 1.35);
        label.setAttribute('y', sign * end[1] * 1.35);
        label.setAttribute('opacity', sign * z < -0.2 ? 0.45 : 1);
        label.textContent = widgetEndLabel(names[axis][i]);
      });
    });
    const order = [0, 1, 2].sort((a, b) => directions[a][2] - directions[b][2]);
    for (const axis of order) view.widgetElement.append(view.widgetAxes[axis].group);
  }

  // Axes labels of a view: round tick values along one edge of the axes box per axis, and the axis name, as
  // HTML over its tile (an axis with no extent, e.g. z of 2D data, gets none)
  buildAxisLabels(view) {
    const { lo, hi } = view.box;
    view.axisLabels = [0, 1, 2].map((axis) => ({
      // About ten ticks until the axis's length on screen is known (setTicks, from updateAxisLabels)
      target: 10,
      ticks: this.makeTicks(lo[axis], hi[axis], 10),
      // The name's text is set with its place (updateAxisLabels), as it depends on the view
      title: hi[axis] > lo[axis] ? el('span', { className: 'axis-title' }) : null,
    }));
    const labels = view.axisLabels.flatMap(({ ticks, title }) => [...ticks.map((t) => t.label), ...(title ? [title] : [])]);
    view.axisLabelsElement.replaceChildren(...labels);
  }

  // Round tick values between lo and hi, about `target` of them (at least two when the axis has a length, as
  // one tick does not show the scale), each with its label element
  makeTicks(lo, hi, target) {
    let values = niceTicks(lo, hi, target);
    for (let more = target + 1; values.length < 2 && hi > lo && more <= 10; more++) values = niceTicks(lo, hi, more);
    return values.map((value) => ({ value, label: el('span', { className: 'tick', textContent: String(value) }) }));
  }

  // Give an axis's labels about `target` ticks, replacing its tick elements when the count changes
  setTicks(view, axis, target) {
    const labels = view.axisLabels[axis];
    if (labels.target === target) return;
    labels.ticks.forEach((t) => t.label.remove());
    labels.target = target;
    labels.ticks = this.makeTicks(view.box.lo[axis], view.box.hi[axis], target);
    view.axisLabelsElement.append(...labels.ticks.map((t) => t.label));
  }

  // Place a view's labels for its rotation and camera. Each axis is labelled along one of its four box
  // edges: preferably an outline edge (exactly one of its two faces toward the camera, so the labels sit
  // outside the picture), and among those the one nearest the bottom left of the screen. Labels are
  // pushed away from the box center
  updateAxisLabels(view) {
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
          const mid = scene.dataToScreen(edge((lo[axis] + hi[axis]) / 2));
          const outline = scene.facesCamera(i, aSide, box) !== scene.facesCamera(j, bSide, box);
          // An outline edge always beats an inner one (screen positions are far below 1e6 pixels)
          const score = (outline ? 1e6 : 0) + mid[1] - mid[0];
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
      this.setTicks(view, axis, tickTarget(Math.hypot(dx, dy)));
      for (const { value, label } of view.axisLabels[axis].ticks) {
        const at = scene.dataToScreen(best.edge(value));
        place(label, [at[0] + out[0] * TICK_OFFSET, at[1] + out[1] * TICK_OFFSET]);
      }
      place(title, [best.mid[0] + out[0] * TITLE_OFFSET, best.mid[1] + out[1] * TITLE_OFFSET]);

      // The name runs along its edge on screen (so a long name beside a vertical edge does not run off the
      // view), turned so it never reads upside down; a vertical name reads bottom to top
      title.style.transform = `translate(-50%, -50%) rotate(${uprightAngle(dx, dy)}deg)`;

      // The ends are named in the order the name is read, so the name agrees with the data on screen (e.g.
      // Anterior-Posterior with anterior on the left, even when the axis runs from posterior); the text is only
      // written when it changes, as this runs every frame
      const ends = view.entry.ends[axis];
      const text = axisTitle(axisLabels(this.manifest, view.entry)[axis], readsHighToLow(dx, dy) ? [...ends].reverse() : ends);
      if (title.textContent !== text) title.textContent = text;
    });
  }

  // Show angles in the sliders and boxes (whole degrees) without turning the view
  showRotation(degrees) {
    this.rotation = degrees.map(clampDegrees);
    this.rotationInputs.forEach(({ slider, number }, axis) => {
      // `|| 0` turns -0 into 0 so the box never shows "-0"
      const shown = Math.round(this.rotation[axis]) || 0;
      slider.value = shown;
      number.value = shown;
    });
  }

  // The reset button: 3D views return to the opening side (every angle 0); 2D views, which do not turn, to the
  // opening zoom and pan
  resetRotation() {
    const view = this.selected;
    if (view.entry.dims === 2) {
      const { axis, side } = this.referenceFace(view.entry);
      this.showFace(view, axis, side);
      return;
    }
    this.showRotation([0, 0, 0]);
    this.turnSelected(this.rotation);
  }

  // Side panel controls of the selected view's embedding: one button per axis end (e.g. Anterior ... Right)
  // turns that side of the data toward the viewer; 2D data has no sides or rotation
  showViewControls(view) {
    // The rotation rows and Turn about options name the embedding's axes (e.g. UMAP 1 for a 3D UMAP)
    const labels = axisLabels(this.manifest, view.entry);
    this.rotationInputs.forEach(({ header }, axis) => { header.textContent = labels[axis]; });
    const options = document.getElementById('turn-about').options;
    labels.forEach((label, axis) => { options[axis + 1].textContent = label; });

    // A table with one column per axis, headed by its ends' letters (e.g. A-P), the low end's button above the
    // high end's
    const ends = view.entry.ends;
    const header = el('tr', {}, ends.map((pair) => el('th', { textContent: pair.map(endLabel).join('\u2013') })));
    const rows = [0, 1].map((i) => el('tr', {}, ends.map((pair, axis) => {
      const button = el('button', { textContent: capitalize(pair[i]), title: `Show the ${pair[i]} side` });
      button.addEventListener('click', () => this.showFace(this.selected, axis, i === 0 ? -1 : 1));
      return el('td', {}, [button]);
    })));
    document.getElementById('faces').replaceChildren(el('thead', {}, [header]), el('tbody', {}, rows));
    document.getElementById('faces').hidden = view.entry.dims === 2;
    document.getElementById('rotation').hidden = view.entry.dims === 2;
    document.getElementById('turn-about-row').hidden = view.entry.dims === 2;
    document.getElementById('drag-hint').hidden = view.entry.dims === 2;
    const reset = document.getElementById('reset-rotation');
    reset.textContent = view.entry.dims === 2 ? 'Reset view' : 'Reset rotation';
    reset.title = view.entry.dims === 2 ? 'Back to the opening zoom and pan' : 'Set every angle to 0 degrees';
  }

  // Show the side at end `side` (-1 low, +1 high) of `axis`: the camera stays at the reference side (with
  // zoom and pan reset) and the data turns, so the sliders show the angles of that side from the reference
  showFace(view, axis, side) {
    const target = faceView(axis, side, view.entry.up, view.entry.roles);
    view.scene.viewFrom(view.reference.direction, view.reference.up);
    const degrees = faceRotation(target, view.reference).map((r) => r * 180 / Math.PI);
    view.scene.setRotation(degrees.map(clampDegrees));
    if (view === this.selected) this.showRotation(degrees);
    this.syncFrom(view);
  }

  // The side the camera looks from, where all angles are 0: the face named by --view if this embedding has
  // it, else the low end of x; 2D data is seen from +z, so x runs right and y up
  referenceFace(entry) {
    if (entry.dims === 2) return { axis: 2, side: 1 };
    const view = this.manifest.defaults.view;
    const axis = entry.ends.findIndex((pair) => pair.includes(view));
    if (axis < 0) return { axis: 0, side: -1 };
    return { axis, side: entry.ends[axis].indexOf(view) === 0 ? -1 : 1 };
  }

  async setEmbedding(view, name) {
    const entry = this.manifest.embeddings.find((e) => e.name === name);
    view.entry = entry;
    const positions = await this.dataset.embedding(name);
    view.valid = validMask(positions, entry.dims);
    const xyz = toXYZ(positions, entry.dims, view.valid);
    view.box = bounds(xyz, view.valid);
    view.scene.setPositions(xyz, view.box, entry.dims === 2);
    view.scene.setUpAxis(entry.up);
    view.scene.setPointSize(view.settings.pointSize);
    this.buildAxisLabels(view);
    // A 2D embedding's widget shows its two axes only (SVG elements ignore `hidden`, so a class drops the third),
    // none of them greyed by the turn axis
    view.widgetAxes[2].group.classList.toggle('absent', entry.dims === 2);
    this.applySettings(view);
    const { axis, side } = this.referenceFace(entry);
    view.reference = faceView(axis, side, entry.dims === 2 ? [0, 1, 0] : entry.up, entry.roles);
    if (view === this.selected) {
      document.getElementById('embedding').value = name;
      this.showViewControls(view);
    }
    this.showFace(view, axis, side);
    if (view.color) await this.setColor(view, view.color);
    this.refresh();
  }

  // Color by: any obs column, or a gene typed into the gene box; applies to the selected view
  buildColorControls() {
    const select = document.getElementById('color-field');
    // A dataset without genes shows no gene box and no '(gene)' entry (the menu's text while a gene colors the view)
    const hasGenes = this.manifest.gene_sources.some((s) => s.genes.length > 0);
    select.append(el('option', { value: '', textContent: '(gene)', disabled: true, hidden: !hasGenes }));
    document.getElementById('gene-box').hidden = !hasGenes;
    for (const f of this.manifest.fields) select.append(el('option', { value: f.name, textContent: f.name }));
    select.addEventListener('change', () => this.setColor(this.selected, { kind: 'field', name: select.value }));

    const sources = document.getElementById('gene-source');
    for (const s of this.manifest.gene_sources) sources.append(el('option', { value: s.name, textContent: s.name }));
    sources.hidden = this.manifest.gene_sources.length < 2;
    const list = document.getElementById('gene-list');
    const fillGeneList = () => {
      const source = this.manifest.gene_sources.find((s) => s.name === sources.value);
      list.replaceChildren(...source.genes.map((g) => el('option', { value: g })));
    };
    sources.addEventListener('change', fillGeneList);
    fillGeneList();
    // showColorControls refills the list when the selected view's gene comes from another source
    this.fillGeneList = fillGeneList;

    const input = document.getElementById('gene');
    input.addEventListener('change', () => {
      const source = this.manifest.gene_sources.find((s) => s.name === sources.value);
      if (source.genes.includes(input.value)) {
        this.setColor(this.selected, { kind: 'gene', source: source.name, name: input.value });
      } else {
        this.setStatus(`${input.value} is not in the ${source.name} genes`);
      }
    });
  }

  // The color controls show what the selected view is colored by
  showColorControls(view) {
    if (!view.color) return;
    document.getElementById('color-field').value = view.color.kind === 'gene' ? '' : view.color.name;
    document.getElementById('gene').value = view.color.kind === 'gene' ? view.color.name : '';
    const sources = document.getElementById('gene-source');
    if (view.color.kind === 'gene' && sources.value !== view.color.source) {
      sources.value = view.color.source;
      this.fillGeneList();
    }
  }

  async setColor(view, color) {
    view.color = color;
    this.setStatus(`Loading ${color.name}...`);
    const rgb = color.kind === 'gene' ? await this.geneColors(view, color) : await this.fieldColors(view, color);
    view.scene.setColors(rgb);
    view.tileLegend.textContent = colorLabel(color, this.manifest.gene_sources);
    if (view === this.selected) {
      this.showColorControls(view);
      this.renderLegend();
    }
    this.setStatus('');
  }

  // Genes: counts are heavy-tailed, so color by log(1 + count). Zero is darkest and the top 1%
  // of expressing cells saturate the scale; the legend still shows counts
  async geneColors(view, color) {
    const values = await this.dataset.geneValues(color.source, color.name);
    const expressed = sortedFinite(values, true);
    view.colorRange = [0, expressed.length ? quantile(expressed, 0.99) : 1];
    const { scale } = this.manifest.gene_sources.find((s) => s.name === color.source);
    return geneColors(values, view.colorRange[1], scale);
  }

  // Categories use the palette; numbers span their middle 98%, so outliers do not wash out the rest
  async fieldColors(view, color) {
    const field = this.dataset.fields.get(color.name);
    const values = await this.dataset.fieldValues(color.name);
    if (field.kind === 'category') return colorCategories(values, this.palette(field));
    const finite = sortedFinite(values);
    view.colorRange = finite.length ? [quantile(finite, 0.01), quantile(finite, 0.99)] : [0, 1];
    return colorValues(values, ...view.colorRange);
  }

  // Filters: one panel per obs column, shared by all views; all panels combine with AND
  async addFilter(name) {
    if (this.filters.some((f) => f.field.name === name)) return this.filters.find((f) => f.field.name === name);
    const field = this.dataset.fields.get(name);
    if (!field) throw new Error(`${name} is not an obs column of this dataset`);
    const filter = {
      field,
      kind: field.kind === 'category' ? 'category' : 'range',
      values: await this.dataset.fieldValues(name),
      allowed: null,
      min: null,
      max: null,
      search: '',
      sortBy: 'name',
      // Open groups when the column has a hierarchy
      expanded: new Set(),
    };
    filter.panel = this.buildFilterPanel(filter);
    document.getElementById('filters').append(filter.panel);
    this.filters.push(filter);
    this.refresh();
    return filter;
  }

  removeFilter(filter) {
    this.filters.splice(this.filters.indexOf(filter), 1);
    filter.panel.remove();
    this.refresh();
  }

  buildFilterPanel(filter) {
    const clear = el('button', { textContent: 'clear', title: 'Show all values' });
    clear.addEventListener('click', () => {
      filter.allowed = null;
      filter.min = null;
      filter.max = null;
      panel.querySelectorAll('input[type=number]').forEach((input) => { input.value = ''; });
      this.refresh();
    });
    const remove = el('button', { textContent: '×', title: 'Remove this filter' });
    remove.addEventListener('click', () => this.removeFilter(filter));
    filter.summary = el('span', { className: 'summary' });
    const header = el('div', { className: 'filter-header' }, [el('strong', { textContent: this.columnTitle(filter.field.name) }), filter.summary, clear, remove]);
    const panel = el('div', { className: 'filter' }, [header]);
    if (filter.kind === 'category') {
      header.insertBefore(sortSelect(filter.sortBy, (by) => {
        filter.sortBy = by;
        this.renderFilterList(filter);
      }), clear);
    }

    if (filter.kind === 'category') {
      const search = el('input', { type: 'search', value: filter.search, placeholder: `Search ${filter.field.categories.length} values` });
      search.addEventListener('input', () => {
        filter.search = search.value.toLowerCase();
        this.renderFilterList(filter);
      });
      filter.list = el('div', { className: 'rows' });
      enableDragSelect(filter.list, (codes, value) => {
        filters.setCategories(filter, filter.field.categories.length, codes, value);
        this.refresh();
      });
      panel.append(search, filter.list);
    } else {
      // Range: empty boxes mean no bound on that side
      const { min, max } = filter.field;
      const bound = (key, placeholder) => {
        const input = el('input', { type: 'number', step: 'any', value: filter[key] ?? '', placeholder: `${key} ${placeholder ?? ''}` });
        input.addEventListener('change', () => {
          filter[key] = input.value === '' ? null : Number(input.value);
          this.refresh();
        });
        return input;
      };
      panel.append(el('div', { className: 'range' }, [bound('min', min), bound('max', max)]));
    }
    return panel;
  }

  // Every value (or group) matching the search, in name order or by how many cells pass the other filters
  renderFilterList(filter) {
    const toggleGroup = (group) => {
      if (!filter.expanded.delete(group)) filter.expanded.add(group);
      this.renderFilterList(filter);
    };
    filter.list.replaceChildren(...this.categoryRows(filter.field, filter.counts, filter.allowed, filter.sortBy,
      filter.search, filter.expanded, toggleGroup));
  }

  // After any filter, embedding or view change: recompute which cells pass in each view (cells without a
  // position differ between embeddings), then update the points, and the counts, panels and legend of the
  // selected view
  refresh() {
    const ready = this.views.filter((view) => view.valid);
    if (!this.selected?.valid) return;
    for (const view of ready) {
      view.keep = filters.computeKeep(view.valid, view.settings.filters);
      this.updatePoints(view);
    }
    this.updateCount();
    this.updateFilterPanels();
    this.updateAddFilterOptions();
    this.renderLegend();
  }

  // Shown cells in color, filtered-out cells as context, cells without a position not at all
  updatePoints(view) {
    const state = new Uint8Array(view.keep.length);
    for (let i = 0; i < state.length; i++) state[i] = view.valid[i] ? (view.keep[i] ? 2 : 1) : 0;
    view.scene.setState(state);
  }

  updateCount() {
    const nShown = filters.countKept(this.selected.keep);
    const nValid = filters.countKept(this.selected.valid);
    document.getElementById('count').textContent = `${formatCount(nShown)} of ${formatCount(nValid)} cells shown`;
  }

  updateFilterPanels() {
    for (const filter of this.filters) {
      if (filter.kind === 'category') {
        // Counts for this filter's values respect every other filter, but not this one
        const others = filters.computeKeep(this.selected.valid, this.filters, filter);
        filter.counts = filters.countCategories(filter.values, filter.field.categories.length, others);
        const nTicked = filter.allowed ? filter.allowed.reduce((a, b) => a + b, 0) : 0;
        filter.summary.textContent = nTicked ? `${nTicked} selected` : 'all';
        this.renderFilterList(filter);
      } else {
        filter.summary.textContent = filters.isActive(filter) ? 'range set' : 'all';
      }
    }
  }

  // Columns that do not have a filter yet can be added
  updateAddFilterOptions() {
    const add = document.getElementById('add-filter');
    const used = new Set(this.filters.map((f) => f.field.name));
    add.replaceChildren(el('option', { value: '', textContent: '+ Add filter...' }),
      ...this.manifest.fields.filter((f) => !used.has(f.name)).map((f) => el('option', { value: f.name, textContent: this.columnTitle(f.name) })));
  }

  // The title row is built once and only its text changes, so using the sort dropdown is not interrupted
  // when a refresh redraws the legend
  buildLegend() {
    this.legendLabel = el('span');
    this.legendSortSelect = sortSelect(this.legendSortBy, (by) => {
      this.legendSortBy = by;
      this.renderLegend();
    });
    // Clear unticks every value of the colored column, like a filter panel's clear
    this.legendClear = el('button', { className: 'clear', textContent: 'clear', title: 'Show all values' });
    this.legendClear.addEventListener('click', () => this.clearFromLegend());
    this.legendBody = el('div');
    enableDragSelect(this.legendBody, (codes, value) => this.setFromLegend(codes, value));
    const legend = document.getElementById('legend');
    legend.replaceChildren(el('div', { className: 'legend-title' }, [this.legendLabel, this.legendSortSelect, this.legendClear]), this.legendBody);
  }

  // Legend of the selected view: every category of its colored column with a checkbox, or a color bar for
  // numbers and genes
  async renderLegend() {
    const view = this.selected;
    if (!view?.color || !view.keep) return;
    // Renders can overlap (category values load asynchronously); only the newest one may draw
    const render = ++this.legendRenders;
    const field = view.color.kind === 'field' ? this.dataset.fields.get(view.color.name) : null;
    const isCategory = field && field.kind === 'category';
    const body = isCategory ? await this.categoryLegend(field) : this.colorbarLegend(view);
    if (render !== this.legendRenders) return;

    this.legendLabel.textContent = colorLabel(view.color, this.manifest.gene_sources);
    this.legendSortSelect.hidden = !isCategory;
    this.legendClear.hidden = !isCategory;
    this.legendBody.replaceChildren(...body);
  }

  colorbarLegend(view) {
    const bar = el('div', { className: 'colorbar' });
    bar.style.background = COLORMAP_CSS;
    const [lo, hi] = view.colorRange.map((v) => Number(v.toPrecision(3)));
    return [bar, el('div', { className: 'colorbar-labels' }, [el('span', { textContent: lo }), el('span', { textContent: `${hi}+` })])];
  }

  // Every value in name or count order, ticked when selected in this column's filter, so several can be
  // picked here. Counts respect the other filters but not this column's own, so ticking one value does not
  // hide or zero the rest; values without cells under the other filters are greyed, not dropped
  async categoryLegend(field) {
    const codes = await this.dataset.fieldValues(field.name);
    const own = this.filters.find((f) => f.field.name === field.name) ?? null;
    const others = filters.computeKeep(this.selected.valid, this.filters, own);
    const counts = filters.countCategories(codes, field.categories.length, others);
    if (!this.legendExpanded.has(field.name)) this.legendExpanded.set(field.name, new Set());
    const expanded = this.legendExpanded.get(field.name);
    const toggleGroup = (group) => {
      if (!expanded.delete(group)) expanded.add(group);
      this.renderLegend();
    };
    return this.categoryRows(field, counts, own?.allowed ?? null, this.legendSortBy, '', expanded, toggleGroup);
  }

  clearFromLegend() {
    const filter = this.filters.find((f) => f.field.name === this.selected.color.name);
    if (!filter) return;
    filter.allowed = null;
    this.refresh();
  }

  // Ticking legend entries ticks them in the selected view's colored column's filter, adding it if needed
  async setFromLegend(codes, value) {
    const filter = await this.addFilter(this.selected.color.name);
    filters.setCategories(filter, filter.field.categories.length, codes, value);
    this.refresh();
  }

  setStatus(message) {
    document.getElementById('status').textContent = message;
  }
}

// Embed mode, for a widget in another page's iframe: a bar over the view's top left with a toggle between compact
// controls (side panel hidden; the cell count, color menu, gene box and reset button in the bar) and the full side
// panel, and a full screen button. controls (compact by default) sets the controls it opens with
const EMBED_CONTROLS = ['compact', 'full'];

function showEmbedBar(controlsMode) {
  const bar = document.getElementById('embed-bar');
  const setCompact = borrowControls(bar);
  bar.append(controlsToggle(setCompact, controlsMode === 'compact'));
  // Browsers refuse full screen in an iframe without allowfullscreen; the button is then left out
  if (document.fullscreenEnabled) bar.append(fullScreenToggle());
  bar.hidden = false;
  passPlainScrollsToPage();
}

// Marks the places of the cell count, color menu, gene box and reset button in the side panel and returns a function
// that switches between compact controls (true: side panel hidden, the controls moved into the bar, where their
// listeners still work) and the full side panel with the controls back in place (false)
function borrowControls(bar) {
  const homes = ['count', 'color-field', 'gene-box', 'reset-rotation'].map((id) => {
    const control = document.getElementById(id);
    const home = document.createComment(id);
    control.before(home);
    return [control, home];
  });
  const controls = el('span', { className: 'bar-controls' });
  bar.append(controls);
  return (isCompact) => {
    document.body.classList.toggle('compact', isCompact);
    if (isCompact) controls.append(...homes.map(([control]) => control));
    else for (const [control, home] of homes) home.after(control);
  };
}

// A button that switches between compact and full controls, starting with compact ones if startCompact
function controlsToggle(setCompact, startCompact) {
  let isCompact = startCompact;
  const button = el('button', { className: 'controls-toggle' });
  const show = () => {
    setCompact(isCompact);
    button.textContent = isCompact ? 'More controls' : 'Fewer controls';
  };
  button.addEventListener('click', () => {
    isCompact = !isCompact;
    show();
  });
  show();
  return button;
}

// Full screen enlarges the widget to the screen; the controls stay as they are
function fullScreenToggle() {
  const button = el('button', { className: 'full-screen', textContent: 'Full screen' });
  button.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    button.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });
  return button;
}

// In a page, a plain scroll over the widget scrolls the page instead of zooming, so readers are not trapped in it;
// Ctrl (or Cmd) + scroll, or a trackpad pinch (a wheel event with ctrlKey), zooms. The listener runs first (capture
// on window) and stops the event before the views' zoom handlers, without preventing its default page scroll
function passPlainScrollsToPage() {
  const view = document.getElementById('view');
  const hint = document.getElementById('zoom-hint');
  hint.textContent = `${/Mac/.test(navigator.platform) ? '\u2318' : 'Ctrl'} + scroll to zoom`;
  let hideHint = null;
  window.addEventListener('wheel', (event) => {
    // Not in full screen: there is no page to scroll
    if (document.fullscreenElement || event.ctrlKey || event.metaKey || !view.contains(event.target)) return;
    event.stopImmediatePropagation();
    hint.hidden = false;
    clearTimeout(hideHint);
    hideHint = setTimeout(() => { hint.hidden = true; }, 1500);
  }, { capture: true });
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('data');
  const controlsMode = params.get('controls') ?? 'compact';
  if (!EMBED_CONTROLS.includes(controlsMode)) {
    document.getElementById('status').textContent = `Unknown controls=${controlsMode}: use controls=compact or controls=full.`;
    return;
  }
  if (params.get('embed') === '1') showEmbedBar(controlsMode);
  else if (params.has('controls')) console.warn('controls= has no effect without embed=1');
  if (!url) {
    document.getElementById('status').textContent = 'Add ?data=<dataset folder URL> to the address to open a dataset.';
    return;
  }
  try {
    const app = new App(await Dataset.load(url));
    await app.init();
  } catch (error) {
    document.getElementById('status').textContent = `Error: ${error.message}`;
    throw error;
  }
}

main();
