// Two-level lists (e.g. subclasses grouped by class) for filter panels and the legend. Plain functions,
// so they run in the browser and in node tests.
import { orderCategories } from './filters.js';

// Rows to draw: one per group, with the summed count of its children, followed by its children's rows when
// the group is open. Children are category codes; parentOf[code] is the index of the code's group in `groups`.
// A group is open when it is in `expanded` (a Set of group indices), or when a search is typed and the group
// or one of its children matches it (case-insensitive substring; `search` must already be lower case). A
// matching group shows all of its children, otherwise only matching children are shown, and a group with no
// match is left out. Groups and children are sorted by name or by count (filters.orderCategories). Each row's
// `codes` lists the categories it stands for: all of a group's children, or the child itself
export function treeRows(names, counts, parentOf, groups, sortBy, search, expanded) {
  // Children of each group, and each group's count as the sum of its children's
  const children = groups.map(() => []);
  parentOf.forEach((group, code) => children[group].push(code));
  const groupCounts = children.map((codes) => codes.reduce((sum, code) => sum + counts[code], 0));
  // Rank of every child in the overall sort order, to sort the children within each group the same way
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

// Whether 'all', 'some' or 'none' of a group's children are ticked in a filter (allowed = null: nothing
// ticked); a group without children is 'none'
export function groupState(codes, allowed) {
  const ticked = allowed ? codes.filter((code) => allowed[code]).length : 0;
  if (ticked === 0) return 'none';
  return ticked === codes.length ? 'all' : 'some';
}
