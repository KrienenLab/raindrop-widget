// Small DOM helpers shared by the viewer's modules. Elements are built with properties (textContent, not
// innerHTML), so names that come from the data are never parsed as HTML. The checkbox rows are shared by the filter
// panels (panels.js) and the legend (legend.js).
import { toHex } from './colors.js';

// Create an element with properties and children
export function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  Object.assign(element, props);
  element.append(...children);
  return element;
}

// Create an SVG element with attributes (set as attributes, as SVG elements have few writable properties) and
// children
export function svg(tag, attributes = {}, children = []) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.append(...children);
  return element;
}

// A count with thousands separators, the same in every locale (e.g. 12,345)
export function formatCount(n) {
  return n.toLocaleString('en-US');
}

// The category codes a checkbox row stands for: one value, or all children of a group (data-codes '3,7,9')
function rowCodes(row) {
  return row.dataset.codes.split(',').map(Number);
}

// One checkbox row for a value or a group of values: state 'all' ticks the box, 'some' shows it partly
// ticked (a group with some of its children ticked); rows of values without cells are greyed (class 'empty')
export function checkRow(codes, name, count, rgb, state) {
  const box = el('input', { type: 'checkbox', checked: state === 'all' });
  box.indeterminate = state === 'some';
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = toHex(rgb);
  const row = el('label', { className: 'row' }, [box, swatch, el('span', { className: 'name', textContent: name }),
    el('span', { className: 'count', textContent: formatCount(count) })]);
  row.dataset.codes = codes.join(',');
  row.classList.toggle('empty', count === 0);
  return row;
}

// Checkbox rows (class 'row', data-codes, one checkbox each) inside `container` can be set by dragging: pressing
// a row gives it the opposite of its state, dragging over other rows gives them the same state, and on release
// apply(codes, value) runs once. A press without dragging thus toggles one row. Mouse clicks are taken over
// (the label would toggle the box again); keyboard toggles still reach apply through the change event.
// A group's open/close button is left to its own click handler
export function enableDragSelect(container, apply) {
  // The drag in progress: the state given to the rows pressed or passed over, and their codes
  let drag = null;
  const mark = (row) => {
    row.querySelector('input').checked = drag.value;
    for (const code of rowCodes(row)) drag.codes.add(code);
  };
  container.addEventListener('pointerdown', (event) => {
    const row = event.target.closest('.row');
    if (!row || event.button !== 0 || event.target.closest('.expander')) return;
    event.preventDefault();
    drag = { value: !row.querySelector('input').checked, codes: new Set() };
    mark(row);
  });
  container.addEventListener('pointerover', (event) => {
    const row = event.target.closest('.row');
    if (drag && row) mark(row);
  });
  // On window, so a release outside the container still ends the drag
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const { codes, value } = drag;
    drag = null;
    apply([...codes], value);
  });
  // A mouse click (detail > 0) was handled on pointerdown; a keyboard click (detail 0) toggles as usual
  container.addEventListener('click', (event) => {
    if (event.detail > 0 && event.target.closest('.row')) event.preventDefault();
  });
  container.addEventListener('change', (event) => {
    const row = event.target.closest('.row');
    if (row) apply(rowCodes(row), event.target.checked);
  });
}

// Dropdown that sorts a list by name (A-Z) or by number of cells; onChange gets 'name' or 'count'
export function sortSelect(initial, onChange) {
  const select = el('select', { className: 'sort', title: 'Sort by name or by number of cells' }, [
    el('option', { value: 'name', textContent: 'A\u2013Z' }),
    el('option', { value: 'count', textContent: 'Count' }),
  ]);
  select.value = initial;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}
