// Colors for categories and for continuous values (metadata numbers and genes). Colors are [r, g, b] arrays
// of integers 0..255 (sRGB); per-cell colors are Uint8Arrays with 3 bytes per cell.
// three.js is imported by path rather than by the import map's bare 'three', so node tests can load this file;
// both resolve to the same module in the browser.
import { Color } from '../vendor/three.module.min.js';

// Grey for missing values: NA categories, and NaN numbers
const MISSING_RGB = [190, 190, 190];

// Generated category colors: hues step by the golden angle, 360 * (1 - 1/phi) = 137.508 degrees, so any two
// nearby indices get well separated hues; saturation fixed, lightness alternating between two levels
const GOLDEN_ANGLE_DEGREES = 137.508;
const GENERATED_SATURATION = 0.65;
const GENERATED_LIGHTNESS_ODD = 0.45;
const GENERATED_LIGHTNESS_EVEN = 0.6;

// '#rrggbb' (the '#' optional) to [r, g, b]
export function parseHex(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// [r, g, b] to '#rrggbb'
export function toHex(rgb) {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Color of category i when the dataset gives none: HSL with hue i * golden angle (as a fraction of a turn).
// three.js takes HSL in its linear working color space and getHexString encodes to sRGB, so these colors are
// lighter and paler than CSS hsl() with the same numbers (e.g. i = 0 gives #ef9e9e, CSS gives #db5757)
export function generatedColor(i) {
  const hue = ((i * GOLDEN_ANGLE_DEGREES) % 360) / 360;
  const lightness = i % 2 ? GENERATED_LIGHTNESS_ODD : GENERATED_LIGHTNESS_EVEN;
  return parseHex(new Color().setHSL(hue, GENERATED_SATURATION, lightness).getHexString());
}

// RGB per category of a manifest field: the dataset's own colors where given, grey for a category named 'NA'
// without one, generated colors elsewhere
export function categoryPalette(field) {
  return field.categories.map((name, i) => {
    const color = field.colors && field.colors[i];
    if (color) return parseHex(color);
    if (name === 'NA') return MISSING_RGB;
    return generatedColor(i);
  });
}

// matplotlib's viridis colormap sampled at 9 evenly spaced points, 0, 1/8, ..., 1
const VIRIDIS = [
  [68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141],
  [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37],
];

// Viridis color at t in [0, 1] (clamped), interpolated linearly between the two nearest samples: x is t in
// sample intervals, i the interval's low sample (the last interval for t = 1), f the fraction across it
export function colormap(t) {
  const x = Math.min(Math.max(t, 0), 1) * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
  const f = x - i;
  return VIRIDIS[i].map((c, j) => Math.round(c + f * (VIRIDIS[i + 1][j] - c)));
}

// The colormap as a CSS gradient, for color bars
export const COLORMAP_CSS = `linear-gradient(to right, ${VIRIDIS.map(toHex).join(', ')})`;

// The finite values, sorted ascending; with positiveOnly, only those above zero
export function sortedFinite(values, positiveOnly = false) {
  const kept = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && (!positiveOnly || v > 0)) kept.push(v);
  }
  return kept.sort((a, b) => a - b);
}

// q-th quantile (q in 0..1) of an ascending array, without interpolation: the element at index
// floor(q * n), capped at the last, so q = 1 gives the maximum. Throws on an empty array
export function quantile(sorted, q) {
  if (sorted.length === 0) throw new Error('quantile of an empty array');
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// Per-cell RGB for category codes: palette[code] for each cell
export function colorCategories(codes, palette) {
  const rgb = new Uint8Array(codes.length * 3);
  for (let i = 0; i < codes.length; i++) {
    const c = palette[codes[i]];
    rgb[3 * i] = c[0];
    rgb[3 * i + 1] = c[1];
    rgb[3 * i + 2] = c[2];
  }
  return rgb;
}

// Per-cell RGB for one gene's values from 0 to hi (the gene's top value). Counts (no `scale`) are colored by
// log1p(value) / log1p(hi), so a few high cells do not wash out the rest; values already on a log scale (the
// source's `scale`, e.g. 'log2') are colored linearly. NaN stays NaN and is grey
export function geneColors(values, hi, scale) {
  if (scale) return colorValues(values, 0, hi);
  return colorValues(Float32Array.from(values, Math.log1p), 0, Math.log1p(hi));
}

// Per-cell RGB for numbers: lo maps to the colormap's dark end and hi to its bright end, values outside are
// clamped, non-finite values (NaN, +-Infinity) are grey, and hi <= lo colors every finite value with the dark end
export function colorValues(values, lo, hi) {
  // Look up one of 256 precomputed colors (8-bit steps of t) instead of interpolating per cell:
  // index = round((v - lo) / (hi - lo) * 255), clamped to 0..255
  const table = Array.from({ length: 256 }, (_, i) => colormap(i / 255));
  const scale = hi > lo ? 255 / (hi - lo) : 0;
  const rgb = new Uint8Array(values.length * 3);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const c = Number.isFinite(v) ? table[Math.min(255, Math.max(0, Math.round((v - lo) * scale)))] : MISSING_RGB;
    rgb[3 * i] = c[0];
    rgb[3 * i + 1] = c[1];
    rgb[3 * i + 2] = c[2];
  }
  return rgb;
}
