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

// Enter in a number box (or Android's Done key, which sends Enter) also leaves it, so a phone's on-screen keyboard
// closes and the picture shows. The box's own 'change' handler still applies the value, once: this runs before
// Enter's default action, so leaving the box fires 'change' (if the value changed) and Enter then finds nothing left
// to commit
export function blurOnEnter(input) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
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
// Touches are left to the browser: a finger swiping over the rows scrolls the list, and a tap toggles its row as a
// click on the label does, reaching apply through the change event. A drag the browser cancels (pointercancel, e.g.
// a pen that starts scrolling) applies nothing. A group's open/close button is left to its own click handler
export function enableDragSelect(container, apply) {
  // The drag in progress: the state given to the rows pressed or passed over, their codes, and each marked box's
  // state before (for a cancelled drag); and the pointer type of the last press in the container, for the click
  // that follows it ('touch': let the label toggle its box)
  let drag = null;
  let pressType = null;
  const mark = (row) => {
    const box = row.querySelector('input');
    if (!drag.before.has(box)) drag.before.set(box, box.checked);
    box.checked = drag.value;
    for (const code of rowCodes(row)) drag.codes.add(code);
  };
  container.addEventListener('pointerdown', (event) => {
    pressType = event.pointerType;
    const row = event.target.closest('.row');
    if (!row || event.button !== 0 || event.target.closest('.expander') || event.pointerType === 'touch') return;
    event.preventDefault();
    drag = { value: !row.querySelector('input').checked, codes: new Set(), before: new Map() };
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
  // A cancelled drag applies nothing, and the boxes it marked go back to their states before it
  window.addEventListener('pointercancel', () => {
    if (!drag) return;
    for (const [box, checked] of drag.before) box.checked = checked;
    drag = null;
  });
  // A mouse or pen click (detail > 0) was handled on pointerdown; a keyboard click (detail 0) and a tap toggle as usual
  container.addEventListener('click', (event) => {
    if (event.detail > 0 && pressType !== 'touch' && event.target.closest('.row')) event.preventDefault();
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
