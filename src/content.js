import { readSettings } from './settings.js';
import { findEditor, snapshot, rangeFor, replaceText, mirrorFor } from './editor.js';

const host = document.createElement('div');
host.dataset.ordklar = 'overlay';
Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
const root = host.attachShadow({ mode: 'open' });
const css = document.createElement('style');
css.textContent = `
  :host { all: initial; color-scheme: light; }
  * { box-sizing: border-box; }
  .mark { position: fixed; border-bottom: 2px dotted #e15a61; pointer-events: none; }
  .mark.grammar { border-color: #8260da; }
  .tip { position: fixed; width: 290px; padding: 17px; border: 1px solid #e2e8e3; border-radius: 16px; box-shadow: 0 12px 45px #172c2424; background: #fff; color: #233b30; font: 13px/1.5 system-ui,sans-serif; pointer-events: auto; }
  .tip[hidden] { display: none; }
  .heading { display: flex; align-items: center; gap: 7px; color: #6b776e; font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #e15a61; }
  .dot.grammar { background: #8260da; }
  .word { font-size: 17px; font-weight: 650; margin: 9px 0 4px; overflow-wrap: anywhere; }
  .message { color: #6b776e; margin: 0 0 12px; }
  .suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  button { font: inherit; cursor: pointer; border: 1px solid #dce8df; background: #eff6f0; color: #226440; border-radius: 8px; padding: 7px 10px; }
  button:hover { background: #dfeee2; }
  button:focus-visible { outline: 2px solid #326e4c; outline-offset: 2px; }
  .secondary { background: transparent; border: none; padding: 4px 0; text-align: left; color: #6b776e; }
  .footer { border-top: 1px solid #edf0ed; padding-top: 9px; display: flex; justify-content: space-between; gap: 8px; }
  .status { position: fixed; background: #fff; border: 1px solid #dbe4dd; border-radius: 20px; padding: 4px 9px; font: 11px system-ui,sans-serif; color: #55675a; pointer-events: none; box-shadow: 0 2px 8px #172c2410; }
`;
const marks = document.createElement('div');
const tip = document.createElement('div');
tip.className = 'tip';
tip.hidden = true;
tip.setAttribute('role', 'dialog');
tip.setAttribute('aria-label', 'Ordklar rettelser');
const status = document.createElement('div');
status.className = 'status';
status.hidden = true;
status.setAttribute('role', 'status');
root.append(css, marks, tip, status);
document.documentElement.append(host);

let settings = { enabled: true };
let editor = null, data = null, matches = [], hitboxes = [], timer, layoutFrame, hideTimer, revision = 0, displayed = null;
let composing = false;
const ignored = new Set();
const resize = new ResizeObserver(() => scheduleLayout());
const mutation = new MutationObserver(() => scheduleCheck());

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'Ordklar kunne ikke svare. Genindlæs siden.');
  return result;
}

function closeTip() { tip.hidden = true; displayed = null; clearTimeout(hideTimer); }
function clearMarks() { marks.replaceChildren(); hitboxes = []; closeTip(); }

function activate(next) {
  if (next === editor) return;
  revision++;
  clearTimeout(timer);
  mutation.disconnect(); resize.disconnect();
  editor = next; matches = []; data = null; ignored.clear(); clearMarks(); status.hidden = true;
  if (!next) return;
  resize.observe(next);
  if (!('value' in next)) mutation.observe(next, { subtree: true, childList: true, characterData: true });
  scheduleCheck(0);
}

function scheduleCheck(delay = 450) {
  revision++;
  clearTimeout(timer);
  clearMarks();
  status.hidden = true;
  if (!settings.enabled || !editor?.isConnected || composing) return;
  timer = setTimeout(check, delay);
}

async function check() {
  if (!editor?.isConnected || !settings.enabled) return;
  const current = revision, target = editor;
  const next = snapshot(target);
  if (!next.text.trim()) { matches = []; data = next; status.hidden = true; return; }
  status.textContent = 'Kontrollerer…'; status.hidden = false; placeStatus();
  try {
    const result = await send({ type: 'CHECK', text: next.text });
    if (current !== revision || editor !== target || snapshot(target).text !== next.text) return;
    data = next;
    matches = result.matches.filter(match => !ignored.has(`${match.rule}:${next.text.slice(match.offset, match.offset + match.length)}`));
    status.textContent = result.truncated ? 'Kun de første 12.000 tegn' : matches.length ? `${matches.length} forslag · ${result.language === 'da' ? 'DA' : 'EN'}` : '✓ Ingen forslag';
    status.hidden = false;
    layout();
  } catch (error) {
    if (current !== revision) return;
    status.textContent = 'Ordklar: genindlæs siden'; status.title = error.message; status.hidden = false; placeStatus();
  }
}

function placeStatus() {
  if (!editor?.isConnected) { status.hidden = true; return; }
  const rect = editor.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > innerHeight) { status.hidden = true; return; }
  status.style.left = `${Math.max(8, Math.min(innerWidth - 185, rect.right - 170))}px`;
  status.style.top = `${Math.max(4, Math.min(innerHeight - 27, rect.bottom + 5))}px`;
}

function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => { layoutFrame = null; layout(); });
}

function layout() {
  marks.replaceChildren(); hitboxes = [];
  if (!editor?.isConnected) { activate(null); return; }
  placeStatus();
  if (!data || !settings.enabled || data.text !== snapshot(editor).text) return;
  const bounds = editor.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return;
  const mirror = 'value' in editor ? mirrorFor(editor, data) : null;
  try {
    for (const match of matches) {
      let range;
      if (mirror) {
        range = document.createRange();
        range.setStart(mirror.text, match.offset); range.setEnd(mirror.text, match.offset + match.length);
      } else range = rangeFor(data, match.offset, match.length);
      if (!range) continue;
      for (const rect of range.getClientRects()) {
        const left = Math.max(rect.left, bounds.left, 0), right = Math.min(rect.right, bounds.right, innerWidth);
        const top = Math.max(rect.top, bounds.top, 0), bottom = Math.min(rect.bottom, bounds.bottom, innerHeight);
        if (right - left < 1 || bottom - top < 3) continue;
        const mark = document.createElement('div');
        mark.className = `mark ${match.kind}`;
        mark.dataset.word = data.text.slice(match.offset, match.offset + match.length);
        Object.assign(mark.style, { left: `${left}px`, top: `${bottom - 2}px`, width: `${right - left}px`, height: '2px' });
        marks.append(mark);
        hitboxes.push({ left, right, top, bottom, match });
      }
    }
  } finally { mirror?.mirror.remove(); }
  if (displayed) {
    const box = hitboxes.find(h => h.match === displayed);
    if (box) positionTip(box); else closeTip();
  }
}

function positionTip(box) {
  const width = Math.min(290, innerWidth - 16);
  tip.style.width = `${width}px`;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, box.left))}px`;
  const height = tip.getBoundingClientRect().height;
  const below = box.bottom + 9;
  tip.style.top = `${Math.max(8, below + height < innerHeight ? below : box.top - height - 9)}px`;
}

function button(label, action, className = '') {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = label; element.className = className;
  element.addEventListener('mousedown', event => event.preventDefault());
  element.addEventListener('click', action);
  return element;
}

async function showTip(box) {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (displayed === box.match) return;
  const match = box.match, current = revision, currentData = data;
  displayed = match;
  tip.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'heading';
  const dot = document.createElement('span'); dot.className = `dot ${match.kind}`;
  heading.append(dot, match.kind === 'spelling' ? 'Ordklar · stavning' : 'Ordklar · grammatik');
  const word = document.createElement('div'); word.className = 'word'; word.textContent = currentData.text.slice(match.offset, match.offset + match.length);
  const message = document.createElement('p'); message.className = 'message'; message.textContent = match.message;
  const suggestions = document.createElement('div'); suggestions.className = 'suggestions';
  const footer = document.createElement('div'); footer.className = 'footer';
  footer.append(button('Ignorer her', () => {
    ignored.add(`${match.rule}:${word.textContent}`);
    matches = matches.filter(item => !(item.rule === match.rule && currentData.text.slice(item.offset, item.offset + item.length) === word.textContent));
    closeTip(); layout();
  }, 'secondary'));
  if (match.kind === 'spelling') footer.append(button('+ Gem i ordliste', async () => {
    try { await send({ type: 'ADD_TERMS', terms: [word.textContent] }); closeTip(); scheduleCheck(0); }
    catch (error) { message.textContent = error.message; }
  }, 'secondary'));
  tip.append(heading, word, message, suggestions, footer); tip.hidden = false;
  function render(replacements) {
    if (displayed !== match || current !== revision) return;
    suggestions.replaceChildren();
    for (const replacement of replacements) suggestions.append(button(replacement.trim() || 'Ét mellemrum', () => {
      if (replaceText(editor, currentData, match, replacement)) { closeTip(); scheduleCheck(100); }
      else { message.textContent = 'Teksten blev ændret. Kontrollerer igen…'; scheduleCheck(0); }
    }));
    if (!replacements.length) suggestions.textContent = 'Ingen sikre staveforslag. Du kan gemme ordet.';
    positionTip(box);
  }
  if (match.kind === 'spelling') {
    suggestions.textContent = 'Finder forslag…'; positionTip(box);
    try { const result = await send({ type: 'SUGGEST', word: match.word }); render(result.replacements); }
    catch (error) { if (displayed === match) { suggestions.textContent = error.message; positionTip(box); } }
  } else render(match.replacements);
}

document.addEventListener('focusin', event => {
  if (event.composedPath().includes(host)) return;
  activate(findEditor(event));
}, true);
document.addEventListener('input', event => {
  const target = findEditor(event);
  if (target) { activate(target); scheduleCheck(); }
}, true);
document.addEventListener('compositionstart', () => { composing = true; scheduleCheck(); }, true);
document.addEventListener('compositionend', () => { composing = false; scheduleCheck(); }, true);
document.addEventListener('pointermove', event => {
  if (event.composedPath().includes(host)) { clearTimeout(hideTimer); hideTimer = null; return; }
  const box = hitboxes.find(h => event.clientX >= h.left && event.clientX <= h.right && event.clientY >= h.top - 2 && event.clientY <= h.bottom + 3);
  if (box) showTip(box);
  else if (!tip.hidden && !hideTimer) hideTimer = setTimeout(() => { hideTimer = null; closeTip(); }, 260);
}, true);
tip.addEventListener('pointerenter', () => { clearTimeout(hideTimer); hideTimer = null; });
tip.addEventListener('pointerleave', () => { hideTimer = setTimeout(() => { hideTimer = null; closeTip(); }, 260); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeTip();
  if (event.altKey && event.shiftKey && event.code === 'KeyO' && hitboxes.length) { event.preventDefault(); showTip(hitboxes[0]).then(() => tip.querySelector('button')?.focus()); }
}, true);
document.addEventListener('scroll', () => { closeTip(); scheduleLayout(); }, true);
window.addEventListener('resize', () => { closeTip(); scheduleLayout(); });
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'local') return;
  settings = await readSettings(); ignored.clear(); scheduleCheck(0);
});
readSettings().then(value => { settings = value; scheduleCheck(0); });
// Some editors already have focus when the extension loads.
if (document.activeElement instanceof HTMLElement) activate(findEditor({ composedPath: () => [document.activeElement] }));
