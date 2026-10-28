// Two-level lists (e.g. subclasses grouped by class) for filter panels and the legend. Plain functions,
// so they run in the browser and in node tests.
import { orderCategories } from './filters.js';

// Rows to draw: one per group, with the summed count of its children, followed by its children's rows when
// the group is open. A group is open when it is in `expanded`, or when a search is typed and the group or
// one of its children matches it; a matching group shows all of its children, otherwise only matching
// children are shown. Groups and children are sorted by name or by count (filters.orderCategories)
export function treeRows(names, counts, parentOf, groups, sortBy, search, expanded) {
  const children = groups.map(() => []);
  parentOf.forEach((group, code) => children[group].push(code));
  const groupCounts = children.map((codes) => codes.reduce((sum, code) => sum + counts[code], 0));
  const childOrder = orderCategories(names, counts, sortBy);
  const rank = new Map(childOrder.map((code, i) => [code, i]));

  const rows = [];
  for (const group of orderCategories(groups, groupCounts, sortBy)) {
    const codes = children[group].sort((a, b) => rank.get(a) - rank.get(b));
    let shown = codes;
    let open = expanded.has(group);
    if (search) {
      const groupMatches = groups[group].toLowerCase().includes(search);
      shown = groupMatches ? codes : codes.filter((code) => names[code].toLowerCase().includes(search));
      if (shown.length === 0) continue;
      open = true;
    }
    rows.push({ kind: 'group', group, codes, count: groupCounts[group], open });
    if (open) {
      for (const code of shown) rows.push({ kind: 'child', code, codes: [code], count: counts[code] });
    }
  }
  return rows;
}

// Whether all, some or none of a group's children are ticked in a filter (allowed = null: nothing ticked)
export function groupState(codes, allowed) {
  const ticked = allowed ? codes.filter((code) => allowed[code]).length : 0;
  if (ticked === 0) return 'none';
  return ticked === codes.length ? 'all' : 'some';
}
