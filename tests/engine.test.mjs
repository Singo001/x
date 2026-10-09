import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSpeller, checkText, suggest, MAX_TEXT } from '../src/engine.js';
import { DEFAULTS, cleanTerms, parseImport, CRYPTO_TERMS } from '../src/settings.js';
import { grammarMatches } from '../src/grammar.js';

const spellers = {};
for (const lang of ['da', 'en']) {
  const [aff, dic] = await Promise.all(['aff', 'dic'].map(ext => readFile(`node_modules/dictionary-${lang}/index.${ext}`, 'utf8')));
  spellers[lang] = createSpeller(aff, dic);
}
function check(text, update = {}) { const settings = { ...DEFAULTS, ...update }; return checkText(text, settings, spellers[settings.language]); }

test('dansk ordbog finder en stavefejl og giver den rigtige rettelse', () => {
  const matches = check('Det er en stavefjel.');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].word, 'stavefjel');
  assert.ok(suggest('stavefjel', spellers.da).includes('stavefejl'));
});
test('dansk grammatik retter brugerens konkrete eksempel', () => {
  const match = check('Jeg er i tvivl om mit grammatik.').find(m => m.rule === 'da-common-gender');
  assert.ok(match);
  assert.deepEqual(match.replacements, ['min grammatik']);
  assert.equal('Jeg er i tvivl om mit grammatik.'.slice(match.offset, match.offset + match.length), 'mit grammatik');
});
test('dansk accepterer æ, ø, å og rigtige bøjningsformer', () => {
  assert.deepEqual(check('Jeg skriver en sætning om mine spørgsmål og gode idéer.'), []);
});
test('engelsk ordbog og grammatik fungerer med sprogvalg', () => {
  const matches = check('She have a apple and a speling mistake.', { language: 'en' });
  assert.ok(matches.some(m => m.replacements.includes('She has')));
  assert.ok(matches.some(m => m.replacements.includes('an apple')));
  assert.ok(matches.some(m => m.word === 'speling'));
  assert.ok(suggest('speling', spellers.en).includes('spelling'));
});
test('ordliste accepterer ord og hele termer, men ikke dele af andre ord', () => {
  assert.equal(check('Zorbquux Zorbquuxxx', { terms: ['zorbquux'] }).length, 1);
  assert.deepEqual(check('mit grammatik', { terms: ['mit grammatik'] }), []);
  assert.deepEqual(check('DeFi HODL tokenomics smart contracts', { terms: CRYPTO_TERMS }), []);
});
test('links, e-mail, hashtags, handles og tickers forbliver urørte', () => {
  assert.deepEqual(check('https://example.com/speling person@xyz.invalid @speling #speling BTC ETH abc123'), []);
});
test('grammatik kan slås fra uden at deaktivere stavekontrol', () => {
  assert.ok(check('mit grammatik stavefjel', { grammar: false }).every(m => m.kind === 'spelling'));
  assert.equal(check('mit grammatik stavefjel', { grammar: false }).length, 1);
  assert.deepEqual(check('stavefjel', { enabled: false }), []);
});
test('rettelsesoffsets passer efter emoji og linjeskift', () => {
  const text = '🚀\nDet er mit grammatik og en stavefjel.';
  const matches = check(text);
  for (const match of matches) assert.ok(['mit grammatik', 'stavefjel'].includes(text.slice(match.offset, match.offset + match.length)));
  assert.equal(matches.length, 2);
});
test('grammatikregler retter mellemrum og bevarer store begyndelsesbogstaver', () => {
  const text = 'Mit grammatik er  god !';
  const matches = grammarMatches(text, 'da');
  assert.ok(matches.some(m => m.replacements.includes('Min grammatik')));
  const space = matches.find(m => m.rule === 'double-space');
  assert.equal(text.slice(space.offset, space.offset + space.length), '  ');
  assert.ok(matches.some(m => m.replacements.includes('d!')));
});
test('import af TXT, CSV og JSON kan eksporteres uden datatab', () => {
  assert.deepEqual(parseImport('DeFi\nHODL\nDeFi\n'), ['DeFi', 'HODL']);
  assert.deepEqual(parseImport('"Layer 2";"smart, contract"\r\nHODL', 'terms.csv'), ['Layer 2', 'smart, contract', 'HODL']);
  assert.deepEqual(parseImport('\uFEFF["DeFi", "HODL"]', 'terms.json'), ['DeFi', 'HODL']);
  assert.deepEqual(parseImport(JSON.stringify(CRYPTO_TERMS), 'export.json'), CRYPTO_TERMS);
});
test('ugyldige importer afvises uden at ændre den eksisterende ordliste', () => {
  assert.throws(() => parseImport('{"terms":[]}', 'bad.json'));
  assert.throws(() => parseImport('["DeFi", 4]', 'bad.json'));
  assert.throws(() => parseImport('"unclosed', 'bad.csv'));
  assert.throws(() => cleanTerms(['x'.repeat(101)]));
  assert.throws(() => cleanTerms(Array.from({ length: 10001 }, (_, i) => `term-${i}`)));
});
test('meget lang tekst begrænses eksplicit', () => {
  assert.deepEqual(check(' '.repeat(MAX_TEXT) + 'stavefjel'), []);
});
