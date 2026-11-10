// Cell filtering. Plain functions over typed arrays, so they run in the browser and in node tests.
//
// A filter is one of
//   {field, kind: 'category', values: integer codes per cell, allowed: Uint8Array per category, or null, reversed}
//   {field, kind: 'range', values: Float32Array per cell, min: number or null, max: number or null, reversed}
// A reversed filter (reversed true) keeps the cells the same filter unreversed drops: the values not ticked, or those
// outside the range. A category filter with nothing ticked (allowed === null) or a range with no bounds restricts
// nothing, reversed or not. All active filters combine with AND. Keep masks are Uint8Arrays with 1 (kept) or 0 per
// cell.

// Whether the filter restricts anything (see above)
export function isActive(filter) {
  if (filter.kind === 'category') return filter.allowed !== null;
  return filter.min !== null || filter.max !== null;
}

// Clear keep[i] for every cell that fails the filter, in place. A range is closed, min <= value <= max,
// a missing bound being open-ended. A cell fails when its test (value ticked, or inside the range) equals `reversed`:
// unreversed, cells not ticked (outside) fail; reversed, ticked (inside) cells fail
export function applyFilter(filter, keep) {
  const values = filter.values;
  const reversed = Boolean(filter.reversed);
  if (filter.kind === 'category') {
    const allowed = filter.allowed;
    for (let i = 0; i < keep.length; i++) {
      if (keep[i] && Boolean(allowed[values[i]]) === reversed) keep[i] = 0;
    }
  } else {
    const lo = filter.min ?? -Infinity;
    const hi = filter.max ?? Infinity;
    // NaN is never inside, so it fails an active range and passes it reversed
    for (let i = 0; i < keep.length; i++) {
      if (keep[i] && (values[i] >= lo && values[i] <= hi) === reversed) keep[i] = 0;
    }
  }
}

// New keep mask: 1 for cells that are set in `base` and pass every active filter except `skip` (a panel's
// own filter, so the panel can count what its other choices would give); `base` is not changed
export function computeKeep(base, filters, skip = null) {
  const keep = base.slice();
  for (const filter of filters) {
    if (filter !== skip && isActive(filter)) applyFilter(filter, keep);
  }
  return keep;
}

// Number of kept cells in each category (codes must be below nCategories)
export function countCategories(codes, nCategories, keep) {
  const counts = new Uint32Array(nCategories);
  for (let i = 0; i < codes.length; i++) {
    if (keep[i]) counts[codes[i]]++;
  }
  return counts;
}

// Number of kept cells (sums the 0/1 mask)
export function countKept(keep) {
  let n = 0;
  for (let i = 0; i < keep.length; i++) n += keep[i];
  return n;
}

// Natural order: numbers inside names compare by value, so '2 Foo' sorts before '10 Bar'; case and accents
// are ignored ('base' sensitivity)
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Category indices in name order (by = 'name', or anything but 'count'), or by count (by = 'count': largest
// first, ties in name order)
export function orderCategories(names, counts, by) {
  const byName = (a, b) => NATURAL.compare(names[a], names[b]);
  const compare = by === 'count' ? (a, b) => counts[b] - counts[a] || byName(a, b) : byName;
  return names.map((_, i) => i).sort(compare);
}

// Tick (value true) or untick the given category codes, changing `filter` in place; when nothing is left
// ticked the filter turns off (allowed = null)
export function setCategories(filter, nCategories, codes, value) {
  if (filter.allowed === null) filter.allowed = new Uint8Array(nCategories);
  for (const code of codes) filter.allowed[code] = value ? 1 : 0;
  if (!filter.allowed.some((a) => a)) filter.allowed = null;
}
