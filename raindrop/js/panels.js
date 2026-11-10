// Filters: one panel per obs column in the side panel, added from the add-filter menu; a categorical column's panel
// lists its values with checkboxes, a numeric column's has min and max boxes. All panels combine with AND
// (filters.js) and belong to the selected view's settings.
import * as filters from './filters.js';
import { el, enableDragSelect, sortSelect } from './ui.js';

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

  // The add-filter menu adds a panel for the column picked (its options: updateAddFilterOptions)
  listenForAddFilter() {
    document.getElementById('add-filter').addEventListener('change', async (event) => {
      if (event.target.value) await this.addFilter(event.target.value);
    });
  }

  // A filter on obs column `name`, with its panel: the existing one if the column has one. A filter starts with
  // nothing ticked and no bounds, so it shows every cell
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

  // A filter's panel: a header (column title, summary, sort menu for categories, clear and remove buttons), then a
  // search box and checkbox rows (rows can be set by dragging over them) or the min and max boxes
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
    const header = el('div', { className: 'filter-header' }, [el('strong', { textContent: this.categories.columnTitle(filter.field.name) }), filter.summary, clear, remove]);
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
    filter.list.replaceChildren(...this.categories.categoryRows(filter.field, filter.counts, filter.allowed, filter.sortBy,
      filter.search, filter.expanded, toggleGroup));
  }

  // Each panel's summary ('all', 'n selected', 'range set') and a categorical panel's rows and counts, for the
  // selected view
  updateFilterPanels() {
    for (const filter of this.filters) {
      if (filter.kind === 'category') {
        // Counts for this filter's values respect every other filter, but not this one
        const others = filters.computeKeep(this.selectedView().valid, this.filters, filter);
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
      ...this.manifest.fields.filter((f) => !used.has(f.name)).map((f) => el('option', { value: f.name, textContent: this.categories.columnTitle(f.name) })));
  }
}
