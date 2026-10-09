function matchRule(text, pattern, create, matches) {
  for (const found of text.matchAll(pattern)) {
    const item = create(found);
    if (item) matches.push({ offset: found.index, length: found[0].length, kind: 'grammar', ...item });
  }
}

function keepCase(original, replacement) {
  if (original.length > 1 && original === original.toLocaleUpperCase() && /\p{L}/u.test(original)) return replacement.toLocaleUpperCase();
  return /^\p{Lu}/u.test(original) ? replacement[0].toLocaleUpperCase() + replacement.slice(1) : replacement;
}

export function grammarMatches(text, language) {
  const matches = [];
  matchRule(text, /(?<![\p{L}])([\p{L}]+)([ \t]+)\1(?![\p{L}])/giu, m => ({ replacements: [m[1]], message: 'Det samme ord står to gange i træk.', rule: 'repeated-word' }), matches);
  matchRule(text, /(\S)([ \t]{2,})(?=\S)/gu, m => ({ offset: m.index + m[1].length, length: m[2].length, replacements: [' '], message: 'Brug ét mellemrum mellem ordene.', rule: 'double-space' }), matches);
  matchRule(text, /([\p{L}\p{N}])([ \t\u00a0]+)(?=[,;!?])/gu, m => ({ offset: m.index + m[1].length, length: m[2].length, replacements: [''], message: 'Fjern mellemrummet før tegnsætningen.', rule: 'space-before-punctuation' }), matches);

  if (language === 'da') {
    const commonGender = 'grammatik|tekst|sætning|mening|besked|konto|adresse|computer|ordliste|idé|ide|fejl|bog|bil|dag';
    const neuter = 'sprog|ord|hus|barn|navn|problem|spørgsmål|svar|projekt|værktøj|eksempel|arbejde|billede';
    matchRule(text, new RegExp(`(?<![\\p{L}])(mit|dit|sit|et)([ \\t\\u00a0]+)(${commonGender})(?![\\p{L}])`, 'giu'), m => ({ replacements: [keepCase(m[1], ({ mit: 'min', dit: 'din', sit: 'sin', et: 'en' })[m[1].toLowerCase()]) + m[2] + m[3]], message: 'Dette navneord er fælleskøn: brug min, din, sin eller en.', rule: 'da-common-gender' }), matches);
    matchRule(text, new RegExp(`(?<![\\p{L}])(min|din|sin|en)([ \\t\\u00a0]+)(${neuter})(?![\\p{L}])`, 'giu'), m => ({ replacements: [keepCase(m[1], ({ min: 'mit', din: 'dit', sin: 'sit', en: 'et' })[m[1].toLowerCase()]) + m[2] + m[3]], message: 'Dette navneord er intetkøn: brug mit, dit, sit eller et.', rule: 'da-neuter-gender' }), matches);
    matchRule(text, /(?<![\p{L}])for og (?=(?:skrive|læse|købe|sælge|lære|lave|være|blive|se|få|gøre|sige|bruge|spise|sove|arbejde)(?![\p{L}]))/giu, m => ({ replacements: [keepCase(m[0], 'for at ')], message: 'Brug “for at” foran denne navnemåde.', rule: 'da-infinitive' }), matches);
    matchRule(text, /(?<![\p{L}])(?:jeg|du|vi|de) er nød til(?![\p{L}])/giu, m => ({ replacements: [m[0].replace(/nød/iu, word => keepCase(word, 'nødt'))], message: 'Udtrykket hedder “er nødt til”.', rule: 'da-noedt' }), matches);
  } else {
    matchRule(text, /\b(he|she|it) (go|have|do|say|want|need|work|like|know|think)(?![\p{L}])/giu, m => {
      if (/\b(?:(?:can|could|will|would|shall|should|may|might|must|do|does|did)(?:n['’]t)?|can['’]t|won['’]t|shan['’]t)\s+$/iu.test(text.slice(0, m.index))) return null;
      const verb = ({ go: 'goes', have: 'has', do: 'does', say: 'says', want: 'wants', need: 'needs', work: 'works', like: 'likes', know: 'knows', think: 'thinks' })[m[2].toLowerCase()];
      return { replacements: [m[1] + ' ' + keepCase(m[2], verb)], message: 'In the present tense, he/she/it takes this verb form.', rule: 'en-third-person' };
    }, matches);
    matchRule(text, /\b(I|you|we|they) (is|was)(?![\p{L}])/giu, m => {
      if (m[1].toLowerCase() === 'i' && m[2].toLowerCase() === 'was') return null;
      return { replacements: [m[1] + ' ' + (m[2].toLowerCase() === 'was' ? 'were' : m[1].toLowerCase() === 'i' ? 'am' : 'are')], message: 'Use the verb form that agrees with the subject.', rule: 'en-be-agreement' };
    }, matches);
    matchRule(text, /\b(a) (apple|orange|egg|idea|example|issue|error|hour|honest)(?![\p{L}])/giu, m => ({ replacements: [keepCase(m[1], 'an') + ' ' + m[2]], message: 'Use “an” before this vowel sound.', rule: 'en-an' }), matches);
    matchRule(text, /\b(an) (user|university|unicorn|European|one)(?![\p{L}])/giu, m => ({ replacements: [keepCase(m[1], 'a') + ' ' + m[2]], message: 'Use “a” before this consonant sound.', rule: 'en-a' }), matches);
    matchRule(text, /(?<![\p{L}])i(?=\s+(?:am|have|will|would|think|know|want|need|like|can)\b)/gu, () => ({ replacements: ['I'], message: 'The pronoun “I” is always capitalized.', rule: 'en-capital-i' }), matches);
  }
  return matches.sort((a, b) => a.offset - b.offset);
}
