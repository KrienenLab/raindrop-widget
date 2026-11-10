// The grid of views: the side panel's Views menu (1 to MAX_VIEWS views), the tiles' layout, and linking. Linked views
// share one settings object, the group's (App's shared settings: filters, turn axis, point size, opacities, axes), and
// those on the same embedding share camera and rotation; each tile's link button unlinks its view, giving it its own
// copy of the settings.
import { el, svg } from './ui.js';

// Most views shown at once (a 3 x 4 grid)
const MAX_VIEWS = 12;

// Width and height of the link button's chain icon, in CSS pixels
const LINK_ICON_SIZE_PX = 14;

export class ViewGrid {
  // views: App's list of views, which setViewCount shortens (the new views are pushed by createView);
  // selectedView(): the view the side panel's controls apply to; sharedSettings(): the linked views' settings;
  // createView(), setEmbedding(view, name), setColor(view, color), select(view): make, fill and select a view;
  // applySettings(view): show its settings in a view; showSettings(): show the selected view's settings in the side
  // panel; showRotation(degrees): show angles in the rotation table (turning.js); refresh(): recompute the cells
  // shown; buildFilterPanel(filter): a filter's side panel element (panels.js)
  constructor({ views, selectedView, sharedSettings, createView, setEmbedding, setColor, select, applySettings,
    showSettings, showRotation, refresh, buildFilterPanel }) {
    this.views = views;
    this.selectedView = selectedView;
    this.sharedSettings = sharedSettings;
    this.createView = createView;
    this.setEmbedding = setEmbedding;
    this.setColor = setColor;
    this.select = select;
    this.applySettings = applySettings;
    this.showSettings = showSettings;
    this.showRotation = showRotation;
    this.refresh = refresh;
    this.buildFilterPanel = buildFilterPanel;
    // True while syncFrom moves the linked views, whose own camera changes then call syncFrom again
    this.syncing = false;
  }

  // The Views menu: 1 to MAX_VIEWS
  buildViewCount() {
    const count = document.getElementById('view-count');
    for (let n = 1; n <= MAX_VIEWS; n++) count.append(el('option', { value: n, textContent: n }));
    count.addEventListener('change', () => this.setViewCount(Number(count.value)));
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
      view.settings = this.sharedSettings();
      const partner = this.views.find((v) => v !== view && v.linked && v.entry === view.entry);
      if (partner) view.scene.setViewState(partner.scene.viewState(), view.scene.fit / partner.scene.fit);
    } else {
      view.settings = this.copySettings(this.sharedSettings());
    }
    this.applySettings(view);
    if (view === this.selectedView()) {
      this.showSettings();
      this.showRotation(view.scene.rotationDegrees());
    }
    this.refresh();
  }

  // Add a view's link button to its tile (pressed: linked; new views are linked). Its press must not select, turn
  // or zoom the view. Its chain icon is drawn with SVG (paths of the Feather 'link' icon, MIT license), as an emoji
  // needs a font that may be missing
  buildLinkButton(tile) {
    const icon = svg('svg', { viewBox: '0 0 24 24', width: LINK_ICON_SIZE_PX, height: LINK_ICON_SIZE_PX, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      svg('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
      svg('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
    ]);
    const linkButton = el('button', { className: 'link', title: 'Linked views share camera, filters and settings' }, [icon]);
    linkButton.setAttribute('aria-pressed', 'true');
    linkButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    tile.append(linkButton);
    return linkButton;
  }

  // Grid of tiles: 1 view fills the plot, 2 sit side by side, then ceil(sqrt(n)) columns and as many rows as
  // needed, the smallest k x k or k x (k + 1) grid (3-4 views: 2 x 2, 5-6: 3 x 2, 7-9: 3 x 3, 10-12: 4 x 3).
  // The class 'several' shows the tiles' outlines, legends and link buttons (style.css)
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
      if (view === this.selectedView()) this.select(this.views[0]);
    }
    const template = this.selectedView();
    while (this.views.length < n) {
      const view = this.createView();
      await this.setEmbedding(view, template.entry.name);
      await this.setColor(view, template.color);
      // The template's camera, its distance scaled by the two views' framing distances (fit), as in syncFrom
      view.scene.setViewState(template.scene.viewState(), view.scene.fit / template.scene.fit);
    }
    this.layoutViews();
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
}
