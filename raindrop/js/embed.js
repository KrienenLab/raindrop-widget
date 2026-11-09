// Embed mode (?embed=1), for a widget in another page's iframe: a bar over the view's top left with a toggle between
// compact controls (side panel hidden; the cell count, color menu, gene box and reset button in the bar) and the full
// side panel, and a full screen button. ?controls= (compact by default) sets the controls it opens with. It works on
// index.html's elements by id only, so it needs nothing from the App.
import { el } from './ui.js';

// Values of ?controls=
export const EMBED_CONTROLS = ['compact', 'full'];

// How long the "Ctrl + scroll to zoom" hint stays after the last plain scroll, in milliseconds
const ZOOM_HINT_DURATION_MS = 1500;
// Controls that compact embeds move into the bar (borrowControls); each must exist in index.html before main runs
const BORROWED_CONTROL_IDS = ['count', 'color-field', 'gene-box', 'reset-rotation'];

// Show the embed bar, opening with compact controls if controlsMode is 'compact', and let plain scrolls over the view
// scroll the page
export function showEmbedBar(controlsMode) {
  const bar = document.getElementById('embed-bar');
  const setCompact = borrowControls(bar);
  bar.append(controlsToggle(setCompact, controlsMode === 'compact'));
  // Browsers refuse full screen in an iframe without allowfullscreen; the button is then left out
  if (document.fullscreenEnabled) bar.append(fullScreenToggle());
  bar.hidden = false;
  passPlainScrollsToPage();
}

// Marks the places of the cell count, color menu, gene box and reset button in the side panel and returns a function
// that switches between compact controls (true: side panel hidden, the controls moved into the bar, where their
// listeners still work) and the full side panel with the controls back in place (false)
function borrowControls(bar) {
  const homes = BORROWED_CONTROL_IDS.map((id) => {
    const control = document.getElementById(id);
    const home = document.createComment(id);
    control.before(home);
    return [control, home];
  });
  const controls = el('span', { className: 'bar-controls' });
  bar.append(controls);
  return (isCompact) => {
    document.body.classList.toggle('compact', isCompact);
    if (isCompact) controls.append(...homes.map(([control]) => control));
    else for (const [control, home] of homes) home.after(control);
  };
}

// A button that switches between compact and full controls, starting with compact ones if startCompact
function controlsToggle(setCompact, startCompact) {
  let isCompact = startCompact;
  const button = el('button', { className: 'controls-toggle' });
  const show = () => {
    setCompact(isCompact);
    button.textContent = isCompact ? 'More controls' : 'Fewer controls';
  };
  button.addEventListener('click', () => {
    isCompact = !isCompact;
    show();
  });
  show();
  return button;
}

// Full screen enlarges the widget to the screen; the controls stay as they are
function fullScreenToggle() {
  const button = el('button', { className: 'full-screen', textContent: 'Full screen' });
  button.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    button.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });
  return button;
}

// In a page, a plain scroll over the widget scrolls the page instead of zooming, so readers are not trapped in it;
// Ctrl (or Cmd) + scroll, or a trackpad pinch (a wheel event with ctrlKey), zooms. The listener runs first (capture
// on window) and stops the event before the views' zoom handlers, without preventing its default page scroll
function passPlainScrollsToPage() {
  const view = document.getElementById('view');
  const hint = document.getElementById('zoom-hint');
  hint.textContent = `${/Mac/.test(navigator.platform) ? '\u2318' : 'Ctrl'} + scroll to zoom`;
  let hideHint = null;
  window.addEventListener('wheel', (event) => {
    // Left to the zoom handlers: full screen (no page to scroll), Ctrl/Cmd + scroll and pinches, and scrolls outside
    // the view
    if (document.fullscreenElement || event.ctrlKey || event.metaKey || !view.contains(event.target)) return;
    event.stopImmediatePropagation();
    hint.hidden = false;
    clearTimeout(hideHint);
    hideHint = setTimeout(() => { hint.hidden = true; }, ZOOM_HINT_DURATION_MS);
  }, { capture: true });
}
