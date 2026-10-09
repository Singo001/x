import nspell from 'nspell';
import { grammarMatches } from './grammar.js';
import { normalizeTerm } from './settings.js';

export const MAX_TEXT = 12000;

export function createSpeller(aff, dic) {
  const speller = nspell(aff, dic);
  // Stavekontrolden lists irregular forms as Hunspell morphology (al:er,
  // al:mit, ...). nspell does not consume those fields, so register the
  // dictionary's own alternatives explicitly, without changing its files.
  for (const found of dic.matchAll(/(?:^|\s)al:([^\s]+)/gu)) speller.add(found[1]);
  return speller;
}

function overlaps(a, b) { return a.offset < b.offset + b.length && b.offset < a.offset + a.length; }

export function acceptedRanges(text, terms) {
  const normalized = text.toLocaleLowerCase('da');
  const ranges = [];
  for (const term of terms) {
    const needle = normalizeTerm(term);
    if (!needle) continue;
    let index = normalized.indexOf(needle);
    while (index !== -1) {
      const before = text.slice(0, index).match(/[\p{L}\p{N}_]$/u);
      const after = /^[\p{L}\p{N}_]/u.test(text.slice(index + needle.length));
      if (!before && !after) ranges.push({ offset: index, length: needle.length });
      index = normalized.indexOf(needle, index + needle.length);
    }
  }
  return ranges;
}

export function checkText(text, settings, speller) {
  if (!settings.enabled) return [];
  text = text.slice(0, MAX_TEXT);
  const accepted = acceptedRanges(text, settings.terms);
  const hidden = [...text.matchAll(/https?:\/\/\S+|www\.\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|[@#][\p{L}\p{N}_]+/gu)].map(m => ({ offset: m.index, length: m[0].length }));
  const result = settings.grammar ? grammarMatches(text, settings.language).filter(m => ![...accepted, ...hidden].some(range => overlaps(m, range))) : [];
  for (const found of text.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu)) {
    const word = found[0];
    const match = { offset: found.index, length: word.length };
    if (word.length < 2 || word.length > 64 || /^[A-ZÆØÅ]{2,6}$/u.test(word) || [...accepted, ...hidden, ...result].some(range => overlaps(match, range))) continue;
    // A word inside a ticker, identifier or number is not ordinary prose.
    if (/[\p{N}_]/u.test(text[found.index - 1] || '') || /[\p{N}_]/u.test(text[found.index + word.length] || '')) continue;
    if (speller.correct(word.normalize('NFC').replace(/’/gu, "'"))) continue;
    result.push({ ...match, kind: 'spelling', word, replacements: [], message: settings.language === 'da' ? 'Ordet findes ikke i den danske ordbog.' : 'This word is not in the English dictionary.', rule: 'spelling' });
    if (result.length >= 100) break;
  }
  return result.sort((a, b) => a.offset - b.offset).slice(0, 100);
}

export function suggest(word, speller) {
  return speller.suggest(word.normalize('NFC').replace(/’/gu, "'")).slice(0, 5);
}
