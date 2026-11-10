// The legend panel right of the plots: what the selected view is colored by, as checkbox rows of a categorical
// column's values (ticking them, or its reverse toggle, sets that column's filter) or as a color bar for numbers and
// genes.
import * as filters from './filters.js';
import { COLORMAP_CSS } from './colors.js';
import { colorLabel } from './names.js';
import { el, enableDragSelect, reverseToggle, showReversed, sortSelect } from './ui.js';

export class Legend {
  // manifest, dataset: the open dataset (data.js); categories: the rows of categorical columns (categories.js);
  // selectedView(): the view the legend follows; selectedFilters(): its filters; addFilter(name): the filter on a
  // column, added if needed (panels.js); refresh(): recompute the cells shown after a filter changes
  constructor({ manifest, dataset, categories, selectedView, selectedFilters, addFilter, refresh }) {
    this.manifest = manifest;
    this.dataset = dataset;
    this.categories = categories;
    this.selectedView = selectedView;
    this.selectedFilters = selectedFilters;
    this.addFilter = addFilter;
    this.refresh = refresh;
    // Open groups in the legend's tree, per colored column
    this.legendExpanded = new Map();
    this.legendSortBy = 'name';
    // Number of renders started, so an older render that finishes late does not draw (renderLegend)
    this.legendRenders = 0;
  }

  // The selected view's filters: a getter, so the methods read this.filters for whichever view is selected
  get filters() {
    return this.selectedFilters();
  }

  // The title row is built once and only its text changes, so using the sort dropdown is not interrupted
  // when a refresh redraws the legend
  buildLegend() {
    this.legendLabel = el('span');
    this.legendSortSelect = sortSelect(this.legendSortBy, (by) => {
      this.legendSortBy = by;
      this.renderLegend();
    });
    // Reverse and clear act on the colored column's filter, as that filter panel's own buttons do
    this.legendReverse = reverseToggle('Hide the ticked values instead of showing them', () => this.reverseFromLegend());
    this.legendClear = el('button', { className: 'clear', textContent: 'clear', title: 'Show all values' });
    this.legendClear.addEventListener('click', () => this.clearFromLegend());
    this.legendBody = el('div');
    enableDragSelect(this.legendBody, (codes, value) => this.setFromLegend(codes, value));
    const legend = document.getElementById('legend');
    legend.replaceChildren(el('div', { className: 'legend-title' }, [this.legendLabel, this.legendSortSelect, this.legendReverse, this.legendClear]), this.legendBody);
  }

  // Legend of the selected view: every category of its colored column with a checkbox (and its filter's reverse
  // state on the toggle and the rows), or a color bar for numbers and genes
  async renderLegend() {
    const view = this.selectedView();
    if (!view?.color || !view.keep) return;
    // Renders can overlap (category values load asynchronously); only the newest one may draw
    const render = ++this.legendRenders;
    const field = view.color.kind === 'field' ? this.dataset.fields.get(view.color.name) : null;
    const isCategory = field && field.kind === 'category';
    const body = isCategory ? await this.categoryLegend(field) : this.colorbarLegend(view);
    if (render !== this.legendRenders) return;

    this.legendLabel.textContent = colorLabel(view.color, this.manifest.gene_sources);
    this.legendSortSelect.hidden = !isCategory;
    this.legendReverse.hidden = !isCategory;
    this.legendClear.hidden = !isCategory;
    const own = isCategory ? this.filters.find((f) => f.field.name === field.name) : null;
    showReversed(this.legendReverse, this.legendBody, Boolean(own?.reversed));
    this.legendBody.replaceChildren(...body);
  }

  // The colormap from the low to the high end of the view's color range (coloring.js), to 3 significant digits;
  // the high end is marked '+' as values above it share its color
  colorbarLegend(view) {
    const bar = el('div', { className: 'colorbar' });
    bar.style.background = COLORMAP_CSS;
    const [lo, hi] = view.colorRange.map((v) => Number(v.toPrecision(3)));
    return [bar, el('div', { className: 'colorbar-labels' }, [el('span', { textContent: lo }), el('span', { textContent: `${hi}+` })])];
  }

  // Every value in name or count order, ticked when selected in this column's filter, so several can be
  // picked here. Counts respect the other filters (each as it is, reversed or not) but not this column's own, so
  // ticking or reversing does not hide or zero the rest, and the counts are the column's filter panel's; values without
  // cells under the other filters are greyed, not dropped
  async categoryLegend(field) {
    const codes = await this.dataset.fieldValues(field.name);
    const own = this.filters.find((f) => f.field.name === field.name) ?? null;
    const others = filters.computeKeep(this.selectedView().valid, this.filters, own);
    const counts = filters.countCategories(codes, field.categories.length, others);
    if (!this.legendExpanded.has(field.name)) this.legendExpanded.set(field.name, new Set());
    const expanded = this.legendExpanded.get(field.name);
    const toggleGroup = (group) => {
      if (!expanded.delete(group)) expanded.add(group);
      this.renderLegend();
    };
    return this.categories.categoryRows(field, counts, own?.allowed ?? null, this.legendSortBy, '', expanded, toggleGroup);
  }

  // Clear: the colored column's filter (if it has one) shows every value again and is no longer reversed
  clearFromLegend() {
    const filter = this.filters.find((f) => f.field.name === this.selectedView().color.name);
    if (!filter) return;
    filter.allowed = null;
    filter.reversed = false;
    this.refresh();
  }

  // Reverse the selected view's colored column's filter, adding it (nothing ticked, so no effect yet) if needed. The
  // toggle is disabled while the filter is added (its values load asynchronously), so a quick second press cannot
  // add the column twice
  async reverseFromLegend() {
    this.legendReverse.disabled = true;
    try {
      const filter = await this.addFilter(this.selectedView().color.name);
      filter.reversed = !filter.reversed;
      this.refresh();
    } finally {
      this.legendReverse.disabled = false;
    }
  }

  // Ticking legend entries ticks them in the selected view's colored column's filter, adding it if needed
  async setFromLegend(codes, value) {
    const filter = await this.addFilter(this.selectedView().color.name);
    filters.setCategories(filter, filter.field.categories.length, codes, value);
    this.refresh();
  }
}
