// Cell filtering. Plain functions over typed arrays, so they run in the browser and in node tests.
//
// A filter is one of
//   {field, kind: 'category', values: integer codes per cell, allowed: Uint8Array per category, or null}
//   {field, kind: 'range', values: Float32Array per cell, min: number or null, max: number or null}
// A category filter with nothing ticked (allowed === null) or a range with no bounds restricts nothing.
// All active filters combine with AND.

export function isActive(filter) {
  if (filter.kind === 'category') return filter.allowed !== null;
  return filter.min !== null || filter.max !== null;
}

// Clear keep[i] for every cell that fails the filter
export function applyFilter(filter, keep) {
  const values = filter.values;
  if (filter.kind === 'category') {
    const allowed = filter.allowed;
    for (let i = 0; i < keep.length; i++) {
      if (keep[i] && !allowed[values[i]]) keep[i] = 0;
    }
  } else {
    const lo = filter.min ?? -Infinity;
    const hi = filter.max ?? Infinity;
    // Written as !(inside) so NaN values fail an active range
    for (let i = 0; i < keep.length; i++) {
      if (keep[i] && !(values[i] >= lo && values[i] <= hi)) keep[i] = 0;
    }
  }
}

// 1 for cells that pass every active filter (except `skip`) and are set in `base`, else 0
export function computeKeep(base, filters, skip = null) {
  const keep = base.slice();
  for (const filter of filters) {
    if (filter !== skip && isActive(filter)) applyFilter(filter, keep);
  }
  return keep;
}

// Number of kept cells in each category
export function countCategories(codes, nCategories, keep) {
  const counts = new Uint32Array(nCategories);
  for (let i = 0; i < codes.length; i++) {
    if (keep[i]) counts[codes[i]]++;
  }
  return counts;
}

export function countKept(keep) {
  let n = 0;
  for (let i = 0; i < keep.length; i++) n += keep[i];
  return n;
}

// Natural order: numbers inside names compare by value, so '2 Foo' sorts before '10 Bar'
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Category indices in name order, or by count (largest first, ties in name order)
export function orderCategories(names, counts, by) {
  const byName = (a, b) => NATURAL.compare(names[a], names[b]);
  const compare = by === 'count' ? (a, b) => counts[b] - counts[a] || byName(a, b) : byName;
  return names.map((_, i) => i).sort(compare);
}

// Tick (value true) or untick the given categories; with none ticked the filter turns off (allowed = null)
export function setCategories(filter, nCategories, codes, value) {
  if (filter.allowed === null) filter.allowed = new Uint8Array(nCategories);
  for (const code of codes) filter.allowed[code] = value ? 1 : 0;
  if (!filter.allowed.some((a) => a)) filter.allowed = null;
}
