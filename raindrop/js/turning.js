// Turning the data from the side panel: a button per axis end that shows that side (#faces), the Turn about menu
// (the axis drags turn about), the rotation table (per axis a slider, an angle box and a 0 button), the reset button
// (Reset rotation; Reset view for 2D embeddings) and the hint on Shift-drags. All act on the selected view, and
// the views linked to it follow (views.js).
//
// Angles here are degrees. Each one is the data's turn about one of its own axes (x, y, z of the embedding, wherever
// they point now: the data's local frame), as scene.js keeps them: PointCloudView.rotationDegrees() reports them,
// turnAbout(axis, degrees) turns about the data's own axis and adds to that angle only, and setRotation(degrees) sets
// all three. The angles add up the turns made, in whatever order, while setRotation applies them as a turn about x,
// then the turned y, then z; so the three angles fix the orientation only when they were all set by setRotation or
// reset to 0. This module only resets them all to 0 (resetRotation) or changes one at a time (the sliders), so the
// angles it shows stay right.
import { clampDegrees, MAX_DEGREES } from './rotation.js';
import { axisLabels, capitalize, endLabel } from './names.js';
import { el } from './ui.js';

export class Turning {
  // manifest: the open dataset's manifest; selectedView(): the view the side panel's controls apply to;
  // selectedSettings(): its settings (turnAxis: index of the axis drags turn about, null for any);
  // viewsWith(settings): the views sharing a settings object; applySettings(view): show its settings in a view;
  // showFace(view, axis, side): turn a view to show one side; referenceFace(entry): the side a view opens on;
  // linkedTo(view): the views that move with a view; syncFrom(view): move them to its camera and rotation
  constructor({ manifest, selectedView, selectedSettings, viewsWith, applySettings, showFace, referenceFace, linkedTo, syncFrom }) {
    this.manifest = manifest;
    this.selectedView = selectedView;
    this.selectedSettings = selectedSettings;
    this.viewsWith = viewsWith;
    this.applySettings = applySettings;
    this.showFace = showFace;
    this.referenceFace = referenceFace;
    this.linkedTo = linkedTo;
    this.syncFrom = syncFrom;
    // The angles the sliders and boxes show (degrees, clamped to +-MAX_DEGREES), set by showRotation
    this.rotation = [0, 0, 0];
  }

  // The selected view's settings and turn axis: getters, so the methods read them for whichever view is selected
  get settings() {
    return this.selectedSettings();
  }

  get turnAxis() {
    return this.settings.turnAxis;
  }

  // Turn about: Any (drags turn the data as a turntable) or one axis (drags turn it only about that axis of its
  // own, and the other sliders are disabled). The menu shows the selected view's turn axis; with --locked naming two
  // axes, a view opens on the third (openingTurnAxis in app.js).
  // Rotation table, one row per axis: a slider that turns the selected view's data about its own axis (wherever it
  // points), a box with the angle turned about it and a button that sets that angle to 0 (turning back by it).
  // Angles run from -MAX_DEGREES to MAX_DEGREES (-360 to 360) with hard ends (typed angles are clamped). Drags add
  // their parts about each axis to the angles. A button below the table returns to the opening side, every angle 0
  buildRotationSliders() {
    const turnAbout = document.getElementById('turn-about');
    turnAbout.append(el('option', { value: '', textContent: 'Any' }));
    this.manifest.axes.labels.forEach((label, axis) => turnAbout.append(el('option', { value: axis, textContent: label })));
    turnAbout.addEventListener('change', () => this.setTurnAxis(turnAbout.value === '' ? null : Number(turnAbout.value)));
    this.rotationInputs = this.manifest.axes.labels.map((label, axis) => {
      const range = { min: -MAX_DEGREES, max: MAX_DEGREES, step: 1, value: 0 };
      const slider = el('input', { type: 'range', ...range, title: `Rotate about the ${label} axis` });
      const number = el('input', { type: 'number', ...range, title: 'Degrees' });
      // Turn about the data's own axis by the change from its current angle: turnAbout adds that change to this
      // axis's angle only, so the angle becomes the one asked for and the other two stay
      const set = (degrees) => {
        const scene = this.selectedView().scene;
        scene.turnAbout(axis, clampDegrees(degrees) - scene.rotationDegrees()[axis]);
        this.showRotation(scene.rotationDegrees());
        this.syncFrom(this.selectedView());
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
    this.selectedView().scene.setRotation(degrees);
    this.syncFrom(this.selectedView());
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
    const view = this.selectedView();
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
      button.addEventListener('click', () => this.showFace(this.selectedView(), axis, i === 0 ? -1 : 1));
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

  // A drag turned a view: show its angles if it is (or moves with) the selected view, and turn linked views
  viewTurned(view, degrees) {
    this.syncFrom(view);
    if (view === this.selectedView() || this.linkedTo(view).includes(this.selectedView())) this.showRotation(degrees);
  }
}
