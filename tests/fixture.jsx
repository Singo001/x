import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor as DraftEditor, EditorState } from 'draft-js';
for (const name of ['textarea', 'editable']) document.querySelector(`#${name}`).addEventListener('input', event => {
  document.querySelector(`#${name}-state`).textContent = 'value' in event.target ? event.target.value : event.target.textContent;
});

function Editor() {
  const [textarea, setTextarea] = useState('');
  const [editorState, setEditorState] = useState(() => EditorState.createEmpty());
  return <>
    <textarea id="react-textarea" aria-label="React tekstfelt" value={textarea} onChange={event => setTextarea(event.target.value)} />
    <output id="react-textarea-state">{textarea}</output>
    <div id="react-editor" data-testid="tweetTextarea_0"><DraftEditor editorState={editorState} onChange={setEditorState} ariaLabel="X-lignende editor" /></div>
    <output id="react-editor-state">{editorState.getCurrentContent().getPlainText()}</output>
  </>;
}
createRoot(document.querySelector('#react-root')).render(<Editor />);
const shadow = document.querySelector('#shadow-root').attachShadow({mode:'open'});
shadow.innerHTML = '<h2>Open Shadow DOM</h2><textarea id="shadow-textarea" style="font:18px/1.7 system-ui;width:90%;height:120px"></textarea>';
