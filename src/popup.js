import { readSettings } from './settings.js';
const enabled = document.querySelector('#enabled');
const grammar = document.querySelector('#grammar');
const feedback = document.querySelector('#feedback');

function render(settings) {
  enabled.checked = settings.enabled; grammar.checked = settings.grammar;
  document.querySelector('#enabled-label').textContent = settings.enabled ? 'Aktiv i dine tekstfelter' : 'Korrektur er sat på pause';
  for (const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === settings.language));
  document.querySelector('#term-count').textContent = settings.terms.length ? `${settings.terms.length} gemte termer · administrer og importer` : 'Egne ord, fagudtryk og kryptotermer';
}
async function save(update) {
  try { await chrome.storage.local.set(update); render(await readSettings()); feedback.className = 'feedback'; feedback.textContent = 'Gemt. Gælder også i åbne tekstfelter.'; }
  catch { feedback.className = 'feedback error'; feedback.textContent = 'Kunne ikke gemme. Prøv igen.'; }
}
enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
grammar.addEventListener('change', () => save({ grammar: grammar.checked }));
for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => save({ language: button.dataset.language }));
document.querySelector('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());
readSettings().then(render).catch(() => { feedback.textContent = 'Indstillingerne kunne ikke indlæses.'; });
