import { readSettings, cleanTerms, normalizeTerm, parseImport, CRYPTO_TERMS } from './settings.js';

const $ = selector => document.querySelector(selector);
let settings;
let queue = Promise.resolve();

function feedback(text, error = false) { $('#feedback').textContent = text; $('#feedback').className = `feedback${error ? ' error' : ''}`; }
async function message(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response?.ok) throw new Error(response?.error || 'Handlingen kunne ikke gennemføres.');
  return response;
}

function renderTerms() {
  $('#count').textContent = `${settings.terms.length} ${settings.terms.length === 1 ? 'term' : 'termer'}`;
  const needle = normalizeTerm($('#search').value);
  const visible = settings.terms.filter(term => normalizeTerm(term).includes(needle)).sort((a, b) => a.localeCompare(b, 'da'));
  $('#terms').replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const icon = document.createElement('div'); icon.className = 'empty-icon'; icon.textContent = 'Aa';
    const heading = document.createElement('h3'); heading.textContent = needle ? 'Ingen termer matcher' : 'Her er plads til dine ord';
    const description = document.createElement('p'); description.textContent = needle ? 'Prøv en anden søgning.' : 'Tilføj den første term, eller importer en ordliste.';
    empty.append(icon, heading, description); $('#terms').append(empty); return;
  }
  for (const term of visible) {
    const chip = document.createElement('div'); chip.className = 'term';
    const text = document.createElement('span'); text.className = 'term-text'; text.textContent = term;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Fjern ${term}`);
    remove.addEventListener('click', () => enqueue(async () => {
      await message({ type: 'REMOVE_TERM', term });
      feedback(`“${term}” er fjernet.`);
    }));
    chip.append(text, remove); $('#terms').append(chip);
  }
}

async function refresh() {
  settings = await readSettings();
  $('#language').value = settings.language; $('#enabled').checked = settings.enabled; $('#grammar').checked = settings.grammar;
  renderTerms();
}
function enqueue(action) { queue = queue.then(action).then(refresh).catch(error => feedback(error.message, true)); return queue; }
async function add(terms) {
  const before = (await readSettings()).terms.length;
  const result = await message({ type: 'ADD_TERMS', terms: cleanTerms(terms) });
  const added = result.terms.length - before;
  feedback(added ? `${added} ${added === 1 ? 'ny term er' : 'nye termer er'} gemt.` : 'Disse termer er allerede i ordlisten.');
}

$('#add-form').addEventListener('submit', event => { event.preventDefault(); enqueue(async () => { await add([$('#new-term').value]); $('#new-term').value = ''; $('#new-term').focus(); }); });
$('#search').addEventListener('input', () => renderTerms());
$('#crypto').addEventListener('click', () => enqueue(() => add(CRYPTO_TERMS)));
for (const name of ['language', 'enabled', 'grammar']) $(`#${name}`).addEventListener('change', () => {
  const value = name === 'language' ? $('#language').value : $(`#${name}`).checked;
  enqueue(async () => { await chrome.storage.local.set({ [name]: value }); feedback('Indstillingen er gemt.'); });
});

async function importFile(file) {
  if (!file) return;
  if (!/\.(txt|csv|json)$/i.test(file.name)) throw new Error('Vælg en TXT-, CSV- eller JSON-fil.');
  if (file.size > 2_000_000) throw new Error('Filen er for stor. Vælg en fil under 2 MB.');
  await add(parseImport(await file.text(), file.name));
}
$('#dropzone').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', () => { const file = $('#file').files[0]; enqueue(() => importFile(file)); $('#file').value = ''; });
for (const name of ['dragenter', 'dragover']) $('#dropzone').addEventListener(name, event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('#dropzone').addEventListener(name, event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); });
$('#dropzone').addEventListener('drop', event => { const file = event.dataTransfer.files[0]; enqueue(() => importFile(file)); });
$('#export').addEventListener('click', async () => {
  const current = await readSettings();
  const url = URL.createObjectURL(new Blob([JSON.stringify(current.terms, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'ordklar-ordliste.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); feedback('Ordlisten er eksporteret som JSON.');
});

let demoRevision = 0;
$('#demo').addEventListener('input', () => { demoRevision++; $('#demo-output').replaceChildren(); });
$('#check-demo').addEventListener('click', async () => {
  const text = $('#demo').value, current = ++demoRevision;
  $('#demo-output').textContent = 'Kontrollerer…';
  try {
    const result = await message({ type: 'CHECK', text });
    if (current !== demoRevision) return;
    $('#demo-output').replaceChildren();
    if (!(await readSettings()).enabled) { $('#demo-output').textContent = 'Slå korrektur til i indstillingerne for at kontrollere teksten.'; return; }
    if (!result.matches.length) $('#demo-output').textContent = 'Ingen forslag til denne tekst.';
    for (const match of result.matches) {
      const row = document.createElement('div'); row.className = 'demo-result';
      const label = document.createElement('div'); label.textContent = `${text.slice(match.offset, match.offset + match.length)} · ${match.message}`; row.append(label);
      const replacements = match.kind === 'spelling' ? (await message({ type: 'SUGGEST', word: match.word })).replacements : match.replacements;
      if (current !== demoRevision) return;
      for (const replacement of replacements) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button soft'; button.textContent = replacement.trim() || 'Ét mellemrum';
        button.addEventListener('click', () => {
          if ($('#demo').value !== text) { $('#demo-output').replaceChildren(); return; }
          $('#demo').value = text.slice(0, match.offset) + replacement + text.slice(match.offset + match.length);
          $('#check-demo').click();
        }); row.append(button);
      }
      $('#demo-output').append(row);
    }
    if (result.truncated) $('#demo-output').append('Kun de første 12.000 tegn er kontrolleret.');
  } catch (error) { if (current === demoRevision) $('#demo-output').textContent = error.message; }
});
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') refresh().catch(error => feedback(error.message, true)); });
refresh().catch(error => feedback(error.message, true));
