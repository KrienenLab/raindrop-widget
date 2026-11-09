// Categorical obs columns as the viewer shows them: their colors, made once per column and shared by every view (so a
// category has the same color in all of them), their titles, and their checkbox rows in filter panels and the legend.
import * as filters from './filters.js';
import { categoryPalette } from './colors.js';
import { groupState, treeRows } from './hierarchy.js';
import { checkRow, el } from './ui.js';

export class Categories {
  // hierarchies: the manifest's two-level hierarchies (convert.py --hierarchy), if any
  constructor(hierarchies) {
    // RGB per category code, by column name (and per group of a hierarchy, by 'parent › child')
    this.palettes = new Map();
    // Two-level hierarchies by child column (e.g. Subclass -> its classes)
    this.hierarchies = new Map((hierarchies ?? []).map((h) => [h.child, h]));
  }

  // RGB of each category of a manifest field (colors.categoryPalette: the dataset's own colors where given,
  // generated ones elsewhere), made on first use
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

  // Name shown for a column in filter titles and the add-filter list: 'Class › Subclass' for a hierarchy
  columnTitle(name) {
    const hierarchy = this.hierarchies.get(name);
    return hierarchy ? `${hierarchy.parent} › ${name}` : name;
  }

  // Checkbox rows for a categorical column's values matching `search` (lower case): a flat list, or, when the column
  // has a hierarchy, its groups (ticking one ticks all its children; its button opens it, through onToggleGroup)
  // with the open groups' children indented underneath. counts: cells per code; allowed: the column filter's ticked
  // codes (null: none ticked); sortBy: 'name' or 'count'; expanded: the open groups
  categoryRows(field, counts, allowed, sortBy, search, expanded, onToggleGroup) {
    const palette = this.palette(field);
    const state = (code) => (allowed?.[code] ? 'all' : 'none');
    const hierarchy = this.hierarchies.get(field.name);
    if (!hierarchy) {
      return filters.orderCategories(field.categories, counts, sortBy)
        .filter((code) => field.categories[code].toLowerCase().includes(search))
        .map((code) => checkRow([code], field.categories[code], counts[code], palette[code], state(code)));
    }

    // Group rows take the group's color and are ticked when all their children are, partly when some are
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
}
