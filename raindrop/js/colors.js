// Colors for categories and for continuous values (metadata numbers and genes).
// three.js is imported by path rather than by the import map's bare 'three', so node tests can load this file;
// both resolve to the same module in the browser.
import { Color } from '../vendor/three.module.min.js';

const MISSING_RGB = [190, 190, 190];

export function parseHex(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function toHex(rgb) {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Distinct colors for categories without one: step the hue by the golden angle (~137.5 degrees)
// so neighboring categories never get similar hues, and alternate lightness for more contrast
export function generatedColor(i) {
  const hue = ((i * 137.508) % 360) / 360;
  const lightness = i % 2 ? 0.45 : 0.6;
  return parseHex(new Color().setHSL(hue, 0.65, lightness).getHexString());
}

// RGB per category: the dataset's own colors where given, generated ones elsewhere, grey for NA
export function categoryPalette(field) {
  return field.categories.map((name, i) => {
    const color = field.colors && field.colors[i];
    if (color) return parseHex(color);
    if (name === 'NA') return MISSING_RGB;
    return generatedColor(i);
  });
}

// Viridis, sampled at 9 evenly spaced points and interpolated linearly between them
const VIRIDIS = [
  [68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141],
  [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37],
];

export function colormap(t) {
  const x = Math.min(Math.max(t, 0), 1) * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2);
  const f = x - i;
  return VIRIDIS[i].map((c, j) => Math.round(c + f * (VIRIDIS[i + 1][j] - c)));
}

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

// q-th quantile (0..1) of an ascending, non-empty array
export function quantile(sorted, q) {
  if (sorted.length === 0) throw new Error('quantile of an empty array');
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// Per-cell RGB (Uint8Array, 3 per cell) for category codes
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

// Per-cell RGB for numbers scaled from lo (dark) to hi (bright); NaN is grey
export function colorValues(values, lo, hi) {
  // Precompute 256 colors once instead of interpolating per cell
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
