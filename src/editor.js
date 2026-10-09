const BLOCKS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'PRE']);

export function findEditor(event) {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest('[data-ordklar-ignore], [contenteditable="false"]')) return null;
    if (node instanceof HTMLTextAreaElement) return node.disabled || node.readOnly ? null : node;
    if (node instanceof HTMLInputElement) {
      return ['text', 'search'].includes(node.type) && !node.disabled && !node.readOnly ? node : null;
    }
    if (node.isContentEditable) {
      let root = node;
      while (root.parentElement?.isContentEditable) root = root.parentElement;
      return root;
    }
  }
  return null;
}

export function snapshot(editor) {
  if ('value' in editor) return { text: editor.value, parts: [] };
  const parts = [];
  let text = '';
  function append(value, node, virtual = false, readonly = false) {
    if (!value) return;
    parts.push({ node, start: text.length, end: text.length + value.length, virtual, readonly });
    text += value;
  }
  function walk(node, readonly = false) {
    if (node.nodeType === Node.TEXT_NODE) { append(node.data, node, false, readonly); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (['SCRIPT', 'STYLE'].includes(node.tagName) || node.hidden || node.getAttribute('aria-hidden') === 'true') return;
    readonly ||= node.getAttribute('contenteditable') === 'false';
    if (node.tagName === 'BR') { append('\n', node, true, readonly); return; }
    const block = node !== editor && BLOCKS.has(node.tagName);
    if (block && text && !text.endsWith('\n')) append('\n', node, true, readonly);
    for (const child of node.childNodes) walk(child, readonly);
    if (block && text && !text.endsWith('\n')) append('\n', node, true, readonly);
  }
  walk(editor);
  return { text, parts };
}

export function rangeFor(data, offset, length) {
  const end = offset + length;
  if (data.parts.some(p => p.readonly && p.start < end && p.end > offset)) return null;
  const first = data.parts.find(p => !p.virtual && offset >= p.start && offset < p.end);
  const last = data.parts.find(p => !p.virtual && end > p.start && end <= p.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, offset - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

export function replaceText(editor, data, match, replacement) {
  if (!editor.isConnected || snapshot(editor).text !== data.text) return false;
  editor.focus({ preventScroll: true });
  if ('value' in editor) {
    const value = data.text.slice(0, match.offset) + replacement + data.text.slice(match.offset + match.length);
    // Use the native setter so React's value tracker sees the following input event.
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(editor, value);
    editor.setSelectionRange(match.offset + replacement.length, match.offset + replacement.length);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: replacement }));
    return true;
  }
  const range = rangeFor(data, match.offset, match.length);
  if (!range) return false;
  const selection = editor.getRootNode().getSelection?.() || document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  // Chromium's editing command keeps undo history and emits a native input event.
  const changed = document.execCommand('insertText', false, replacement);
  return changed && snapshot(editor).text === data.text.slice(0, match.offset) + replacement + data.text.slice(match.offset + match.length);
}

export function mirrorFor(editor, data) {
  const mirror = document.createElement('div');
  const style = getComputedStyle(editor);
  const rect = editor.getBoundingClientRect();
  for (const name of ['box-sizing', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'direction', 'tab-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']) mirror.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(mirror.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden', borderStyle: 'solid', whiteSpace: editor instanceof HTMLInputElement || editor.wrap === 'off' ? 'pre' : 'pre-wrap', overflowWrap: 'break-word' });
  const text = document.createTextNode(data.text || ' ');
  mirror.append(text);
  document.documentElement.append(mirror);
  // The textarea's vertical scrollbar reduces its line width.
  if (editor instanceof HTMLTextAreaElement) mirror.style.paddingRight = `${parseFloat(style.paddingRight) + Math.max(0, editor.offsetWidth - editor.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth))}px`;
  mirror.scrollTop = editor.scrollTop;
  mirror.scrollLeft = editor.scrollLeft;
  return { mirror, text };
}
