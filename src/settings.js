export const DEFAULTS = Object.freeze({ enabled: true, language: 'da', grammar: true, terms: [] });
export const CRYPTO_TERMS = ['Bitcoin', 'Ethereum', 'Solana', 'blockchain', 'kryptovaluta', 'kryptovalutaer', 'DeFi', 'Web3', 'HODL', 'NFT', 'NFTs', 'DAO', 'DAOs', 'memecoin', 'memecoins', 'airdrop', 'airdrops', 'staking', 'stablecoin', 'stablecoins', 'tokenomics', 'altcoin', 'altcoins', 'BTC', 'ETH', 'USDC', 'USDT', 'DEX', 'CEX', 'Layer 2', 'smart contract', 'smart contracts', 'wallet', 'wallets'];

export function normalizeTerm(term) {
  return term.trim().normalize('NFC').toLocaleLowerCase('da');
}

export function cleanTerms(terms) {
  if (!Array.isArray(terms)) throw new Error('Ordlisten skal være en liste med ord eller termer.');
  const result = new Map();
  for (const raw of terms) {
    if (typeof raw !== 'string') throw new Error('Alle termer skal være tekst.');
    const term = raw.trim().normalize('NFC').replace(/\s+/g, ' ');
    if (!term) continue;
    if (term.length > 100 || /[\u0000-\u001f\u007f]/u.test(term)) throw new Error('En term må højst indeholde 100 tegn og ingen kontroltegn.');
    result.set(normalizeTerm(term), term);
  }
  if (result.size > 10000) throw new Error('Ordlisten må højst indeholde 10.000 termer.');
  return [...result.values()];
}

export function parseImport(text, filename = '') {
  if (text.length > 2_000_000) throw new Error('Filen er for stor. Vælg en fil under 2 MB.');
  const source = text.replace(/^\uFEFF/u, '').trim();
  if (!source) return [];
  if (/\.json$/i.test(filename) || source.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(source); } catch { throw new Error('JSON-filen er ikke gyldig. Brug en liste som ["DeFi", "HODL"].'); }
    return cleanTerms(parsed);
  }
  // CSV: comma, semicolon or newline; quoted fields may contain separators.
  const terms = [];
  let term = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { term += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && /[,;\r\n]/u.test(char)) { terms.push(term); term = ''; }
    else term += char;
  }
  if (quoted) throw new Error('CSV-filen har et anførselstegn, der ikke er afsluttet.');
  terms.push(term);
  return cleanTerms(terms);
}

export async function readSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { enabled: stored.enabled !== false, language: stored.language === 'en' ? 'en' : 'da', grammar: stored.grammar !== false, terms: cleanTerms(stored.terms) };
}

export async function addTerms(newTerms) {
  // Background is the single writer so concurrent tabs cannot lose additions.
  const settings = await readSettings();
  const terms = cleanTerms([...settings.terms, ...newTerms]);
  await chrome.storage.local.set({ terms });
  return terms;
}
