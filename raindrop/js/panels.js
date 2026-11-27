/*
raindrop: a browser viewer for single-cell and spatial data
Copyright (C) 2026 Ning Wang

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Filters: one panel per obs column in the side panel, added from the add-filter menu; a categorical column's panel
// lists its values with checkboxes, a numeric column's has min and max boxes. All panels combine with AND
// (filters.js) and belong to the settings of the view they were added for; the side panel shows the selected view's.
import * as filters from './filters.js';
import { el, enableDragSelect, reportErrors, reverseToggle, showReversed, sortSelect } from './ui.js';

export class FilterPanels {
  // manifest, dataset: the open dataset (data.js); categories: column titles and rows (categories.js);
  // selectedFilters(): the selected view's filters; selectedView(): the view the side panel's controls apply to;
  // refresh(): recompute the cells shown after a filter changes
  constructor({ manifest, dataset, categories, selectedFilters, selectedView, refresh }) {
    this.manifest = manifest;
    this.dataset = dataset;
    this.categories = categories;
    this.selectedFilters = selectedFilters;
    this.selectedView = selectedView;
    this.refresh = refresh;
  }

  // The selected view's filters: a getter, so the methods read this.filters for whichever view is selected
  get filters() {
    return this.selectedFilters();
  }

  // The add-filter menu adds a filter on the column picked to the selected view (its options:
  // updateAddFilterOptions; pickFilter). Picking the prompt does nothing
  listenForAddFilter() {
    const add = document.getElementById('add-filter');
    add.addEventListener('change', () => reportErrors(async () => {
      if (add.value) await this.pickFilter(this.selectedView(), add.value);
    }));
  }

  // A column picked in the add-filter menu for a view: its filter is added once its values load. Only the view's
  // newest pick adds (view.loads.filter counts them): one that finishes after a later pick, or fails after it, is
  // dropped, as the menu has moved on from it. The count is per view: picks made in two linked views both add to
  // their shared filters (selecting a view puts the menu back on its prompt). A failed newest pick puts the menu back
  // on its prompt and rejects (the handler shows the error, see reportErrors)
  async pickFilter(view, name) {
    const load = ++view.loads.filter;
    let values;
    try {
      values = await this.dataset.fieldValues(name);
    } catch (error) {
      if (load !== view.loads.filter) return;
      if (view === this.selectedView()) document.getElementById('add-filter').value = '';
      throw error;
    }
    if (load !== view.loads.filter) return;
    this.addLoadedFilter(view, this.dataset.fields.get(name), values);
  }

  // The filter on obs column `name` in a view's settings (the selected view's by default), added with its panel once
  // the column's values load if those settings have none. For the dataset's starting filters and the legend, which use
  // the filter returned; never dropped
  async addFilter(name, view = this.selectedView()) {
    const field = this.dataset.fields.get(name);
    if (!field) throw new Error(`${name} is not an obs column of this dataset`);
    return this.addLoadedFilter(view, field, await this.dataset.fieldValues(name));
  }

  // The filter on `field` in a view's settings (those it has now, after the download: an unlinked view's own), or a new
  // one with its panel. Checked once the values are loaded, so two requests for one column add one panel. The panel is
  // shown now if those are the selected view's settings, otherwise when a view using them is selected (showSettings).
  // A new filter starts with nothing ticked, no bounds and not reversed, so it shows every cell
  addLoadedFilter(view, field, values) {
    const { filters } = view.settings;
    const existing = filters.find((f) => f.field.name === field.name);
    if (existing) return existing;
    const filter = {
      field,
      kind: field.kind === 'category' ? 'category' : 'range',
      values,
      allowed: null,
      min: null,
      max: null,
      reversed: false,
      search: '',
      sortBy: 'name',
      // Open groups when the column has a hierarchy
      expanded: new Set(),
    };
    filter.panel = this.buildFilterPanel(filter);
    if (filters === this.filters) document.getElementById('filters').append(filter.panel);
    filters.push(filter);
    this.refresh();
    return filter;
  }

  removeFilter(filter) {
    this.filters.splice(this.filters.indexOf(filter), 1);
    filter.panel.remove();
    this.refresh();
  }

  // A filter's panel: a header (column title, summary, sort menu for categories, reverse toggle, clear and remove
  // buttons), then a search box and checkbox rows (rows can be set by dragging over them) or the min and max boxes.
  // The panel shows the filter's reverse state from the start, as an unlinked view's copy may be reversed
  buildFilterPanel(filter) {
    const hidden = filter.kind === 'category' ? 'the ticked values' : 'the cells in the range';
    filter.reverseToggle = reverseToggle(`Hide ${hidden} instead of showing them`, () => {
      filter.reversed = !filter.reversed;
      this.refresh();
    });
    // Clear returns the panel to a new one's state: nothing ticked, no bounds, not reversed
    const clear = el('button', { textContent: 'clear', title: 'Show all values' });
    clear.addEventListener('click', () => {
      filter.allowed = null;
      filter.min = null;
      filter.max = null;
      filter.reversed = false;
      panel.querySelectorAll('input[type=number]').forEach((input) => { input.value = ''; });
      this.refresh();
    });
    const remove = el('button', { textContent: '×', title: 'Remove this filter' });
    remove.addEventListener('click', () => this.removeFilter(filter));
    filter.summary = el('span', { className: 'summary' });
    const header = el('div', { className: 'filter-header' }, [el('strong', { textContent: this.categories.columnTitle(filter.field.name) }), filter.summary, filter.reverseToggle, clear, remove]);
    const panel = el('div', { className: 'filter' }, [header]);
    showReversed(filter.reverseToggle, panel, filter.reversed);
    if (filter.kind === 'category') {
      header.insertBefore(sortSelect(filter.sortBy, (by) => {
        filter.sortBy = by;
        this.renderFilterList(filter);
      }), filter.reverseToggle);
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
    filter.list.replaceChildren(...this.categories.categoryRows(filter.field, filter.counts, filter.allowed, filter.sortBy,
      filter.search, filter.expanded, toggleGroup));
  }

  // Each panel's reverse state, summary ('all'; 'n selected' or, reversed, 'hiding n of N'; 'range set' or, reversed,
  // 'hiding range') and a categorical panel's rows and counts, for the selected view
  updateFilterPanels() {
    for (const filter of this.filters) {
      showReversed(filter.reverseToggle, filter.panel, filter.reversed);
      if (filter.kind === 'category') {
        // Counts for this filter's values respect every other filter (each as it is, reversed or not), but not this
        // one: beside a hidden value is the number of its cells this filter hides
        const nValues = filter.field.categories.length;
        const others = filters.computeKeep(this.selectedView().valid, this.filters, filter);
        filter.counts = filters.countCategories(filter.values, nValues, others);
        const nTicked = filter.allowed ? filter.allowed.reduce((a, b) => a + b, 0) : 0;
        const ticked = filter.reversed ? `hiding ${nTicked} of ${nValues}` : `${nTicked} selected`;
        filter.summary.textContent = nTicked ? ticked : 'all';
        this.renderFilterList(filter);
      } else {
        const set = filter.reversed ? 'hiding range' : 'range set';
        filter.summary.textContent = filters.isActive(filter) ? set : 'all';
      }
    }
  }

  // Columns that do not have a filter yet can be added
  updateAddFilterOptions() {
    const add = document.getElementById('add-filter');
    const used = new Set(this.filters.map((f) => f.field.name));
    add.replaceChildren(el('option', { value: '', textContent: '+ Add filter...' }),
      ...this.manifest.fields.filter((f) => !used.has(f.name)).map((f) => el('option', { value: f.name, textContent: this.categories.columnTitle(f.name) })));
  }
}
