/**
 * Txukun — Spell checking with pre-built Basque word list
 *
 * Uses a 130k-word Set extracted from Xuxen dictionary at build time.
 * No affix rules — catches hallucinations and obvious typos.
 * ~1.3MB word list, O(1) lookups via Set.
 */

let wordSet = null;
let wordFreq = null; // Map word → frequency

/**
 * Load the word list and build a Set.
 */
export async function loadSpellChecker() {
  if (wordSet) return;

  const basePath = import.meta.env.BASE_URL || '/txukun/';
  const [wordsResp, freqResp] = await Promise.all([
    fetch(basePath + 'dicts/eu-words.txt'),
    fetch(basePath + 'dicts/eu-words-freq.txt'),
  ]);

  const text = await wordsResp.text();
  const freqText = await freqResp.text();

  wordSet = new Set(text.split('\n'));

  // Build frequency map (used for sorting suggestions)
  wordFreq = new Map();
  for (const line of freqText.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) {
      wordFreq.set(line.slice(0, tab), parseInt(line.slice(tab + 1), 10) || 0);
    }
  }
}

/**
 * Check if a word is correctly spelled.
 */
export function spell(word) {
  if (!wordSet) return true;
  if (wordSet.has(word)) return true;
  // Case-insensitive fallback (dictionary is lowercase)
  return wordSet.has(word.toLowerCase());
}

/**
 * Simple suggestions: Levenshtein distance on words starting with same letter.
 */
export function suggest(word) {
  if (!wordSet) return [];
  const lower = word.toLowerCase();
  const candidates = [];

  for (const w of wordSet) {
    if (w.length < 2) continue;
    if (w.length < lower.length - 2 || w.length > lower.length + 3) continue;

    const wLower = w.toLowerCase();
    if (wLower === lower) continue;

    const dist = levenshtein(lower, wLower);
    if (dist > 2) continue;

    candidates.push({ word: w, dist });
  }

  candidates.sort((a, b) => a.dist - b.dist || (wordFreq.get(b.word) || 0) - (wordFreq.get(a.word) || 0));
  return candidates.slice(0, 5).map(c => c.word);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] !== b[j - 1] ? 1 : 0)
      );
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Basque-aware word tokenizer.
 */
const WORD_RE = /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛçÇ'\-]+|\d+(?:[.,]\d+)*|https?:\/\/\S+|[\w.-]+@[\w.-]+/g;

export function tokenize(text) {
  const tokens = [];
  let match;
  while ((match = WORD_RE.exec(text)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * Check all words in text against the spell checker.
 * Returns array of misspelled tokens with suggestions.
 */
export function checkSpelling(text) {
  if (!wordSet) return [];

  const tokens = tokenize(text);
  const errors = [];

  for (const tok of tokens) {
    if (/^\d+([.,]\d+)*$/.test(tok.word)) continue;
    if (/^https?:\/\//.test(tok.word)) continue;
    if (/@/.test(tok.word)) continue;
    if (tok.word.length < 2) continue;
    if (tok.word === tok.word.toUpperCase() && tok.word.length > 1) continue;

    if (!spell(tok.word)) {
      errors.push({ ...tok, suggestions: suggest(tok.word) || [] });
    }
  }

  return errors;
}

/**
 * Annotate text with HTML spans for misspelled words.
 */
export function annotateSpelling(text, errors) {
  if (!errors || errors.length === 0) return escapeHtml(text);

  const sorted = [...errors].sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;

  for (const err of sorted) {
    html += escapeHtml(text.slice(cursor, err.start));
    const suggestions = err.suggestions.map(s => escapeHtml(s)).join(',');
    html += `<span class="spell-error" title="${escapeAttr('Zuzenketak / Suggestions: ' + err.suggestions.join(', '))}" data-suggestions="${escapeAttr(suggestions)}" data-word="${escapeAttr(err.word)}">${escapeHtml(err.word)}</span>`;
    cursor = err.end;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}

export function stripAnnotations(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
