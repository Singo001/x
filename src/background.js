import { createSpeller, checkText, suggest, MAX_TEXT } from './engine.js';
import { readSettings, addTerms, cleanTerms } from './settings.js';

const dictionaries = new Map();
let termQueue = Promise.resolve();

async function dictionary(language) {
  if (!dictionaries.has(language)) {
    const pending = Promise.all(['aff', 'dic'].map(async ext => {
      const response = await fetch(chrome.runtime.getURL(`dictionaries/${language}/index.${ext}`));
      if (!response.ok) throw new Error('Den lokale ordbog kunne ikke indlæses.');
      return response.text();
    })).then(([aff, dic]) => createSpeller(aff, dic)).catch(error => { dictionaries.delete(language); throw error; });
    dictionaries.set(language, pending);
  }
  return dictionaries.get(language);
}

async function handle(message) {
  if (message.type === 'CHECK') {
    const settings = await readSettings();
    if (typeof message.text !== 'string') throw new Error('Teksten mangler.');
    if (!settings.enabled) return { matches: [], language: settings.language };
    const speller = await dictionary(settings.language);
    return { matches: checkText(message.text, settings, speller), language: settings.language, truncated: message.text.length > MAX_TEXT };
  }
  if (message.type === 'SUGGEST') {
    if (typeof message.word !== 'string' || message.word.length > 64) throw new Error('Ordet er for langt.');
    const settings = await readSettings();
    return { replacements: suggest(message.word, await dictionary(settings.language)) };
  }
  if (message.type === 'ADD_TERMS') {
    const terms = cleanTerms(message.terms);
    const update = termQueue.then(() => addTerms(terms));
    termQueue = update.catch(() => {});
    return { terms: await update };
  }
  if (message.type === 'REMOVE_TERM') {
    const [term] = cleanTerms([message.term]);
    const update = termQueue.then(async () => {
      const settings = await readSettings();
      const terms = settings.terms.filter(item => item.toLocaleLowerCase('da') !== term.toLocaleLowerCase('da'));
      await chrome.storage.local.set({ terms });
      return terms;
    });
    termQueue = update.catch(() => {});
    return { terms: await update };
  }
  if (message.type === 'PING') return { ok: true };
  throw new Error('Ukendt handling.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message).then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
