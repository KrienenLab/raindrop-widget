// The legend panel right of the plots: what the selected view is colored by, as checkbox rows of a categorical
// column's values (ticking them sets that column's filter) or as a color bar for numbers and genes.
import * as filters from './filters.js';
import { COLORMAP_CSS } from './colors.js';
import { colorLabel } from './names.js';
import { el, enableDragSelect, sortSelect } from './ui.js';

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
    this.legendClear.hidden = !isCategory;
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
  // picked here. Counts respect the other filters but not this column's own, so ticking one value does not
  // hide or zero the rest; values without cells under the other filters are greyed, not dropped
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

  // Clear: the colored column's filter (if it has one) shows every value again
  clearFromLegend() {
    const filter = this.filters.find((f) => f.field.name === this.selectedView().color.name);
    if (!filter) return;
    filter.allowed = null;
    this.refresh();
  }

  // Ticking legend entries ticks them in the selected view's colored column's filter, adding it if needed
  async setFromLegend(codes, value) {
    const filter = await this.addFilter(this.selectedView().color.name);
    filters.setCategories(filter, filter.field.categories.length, codes, value);
    this.refresh();
  }
}
