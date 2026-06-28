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
  const lower = word.toLowerCase();
  if (wordSet.has(lower)) return true;
  // Try uppercase (acronyms stored in uppercase form, e.g., EITB)
  const upper = word.toUpperCase();
  if (upper !== lower && wordSet.has(upper)) return true;
  return false;
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

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d+([.,]\d+)*$/.test(tok.word)) continue;
    if (/^https?:\/\//.test(tok.word)) continue;
    if (/@/.test(tok.word)) continue;
    if (tok.word.length < 2) continue;
    if (tok.word === tok.word.toUpperCase() && tok.word.length > 1) continue;

    // Skip short suffixes attached to numbers: "%42koa" splits to "42"+"koa"
    // "koa", "ekoa", "ko" are valid Basque suffixes, not standalone words
    if (tok.word.length <= 5 && i > 0 && /^\d+([.,]\d+)*$/.test(tokens[i-1].word)) {
      continue;
    }

    // First: check entire word (case-insensitive)
    if (spell(tok.word)) continue;

    // If it has hyphens, check each part independently
    if (tok.word.includes('-')) {
      const parts = tok.word.split('-');
      if (parts.every(p => p.length < 2 || spell(p))) continue;
    }

    // If all-caps followed by lowercase hyphenated suffix (EiTB-ko → check EITB + -ko)
    // already handled by the hyphen split above

    errors.push({ ...tok, suggestions: suggest(tok.word) || [] });
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

export function autoCorrect(text) {
  if (!wordSet) return { text, changes: 0, corrections: [] };

  const errors = checkSpelling(text);
  if (errors.length === 0) return { text, changes: 0, corrections: [] };

  // Sort by position (descending) so we can replace from right to left
  // without messing up indices
  const sorted = [...errors].sort((a, b) => b.start - a.start);

  let result = text;
  const corrections = [];
  for (const err of sorted) {
    if (err.suggestions.length > 0) {
      const original = err.word;
      const corrected = err.suggestions[0];
      result = result.slice(0, err.start) + corrected + result.slice(err.end);
      corrections.push({ start: err.start, end: err.start + corrected.length, original, corrected });
    }
  }

  return {
    text: result,
    changes: corrections.length,
    corrections,  // sorted descending by position (same as iteration order)
  };
}

/**
 * Annotate auto-corrected text: wraps corrected words in green <span>.
 * Used together with annotateSpelling for remaining errors.
 */
export function annotateCorrections(text, corrections) {
  if (!corrections || corrections.length === 0) return escapeHtml(text);

  // corrections are sorted descending — reverse for left-to-right annotation
  const ascending = [...corrections].reverse();
  let html = '';
  let cursor = 0;

  for (const c of ascending) {
    html += escapeHtml(text.slice(cursor, c.start));
    html += `<span class="spell-corrected" title="${escapeAttr(c.original + ' → ' + c.corrected)}">${escapeHtml(c.corrected)}</span>`;
    cursor = c.end;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}

/**
 * Combined annotation: green for corrected words, red for remaining errors.
 */
export function annotateBoth(text, corrections, errors) {
  // Build a list of all spans (corrections + errors), sorted by position
  const spans = [
    ...corrections.map(c => ({ ...c, type: 'correction' })),
    ...errors.map(e => ({ ...e, type: 'error' })),
  ].sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;

  for (const s of spans) {
    html += escapeHtml(text.slice(cursor, s.start));
    if (s.type === 'correction') {
      html += `<span class="spell-corrected" title="${escapeAttr(s.original + ' → ' + s.corrected)}">${escapeHtml(s.corrected)}</span>`;
    } else {
      const suggestions = (s.suggestions || []).map(w => escapeHtml(w)).join(',');
      html += `<span class="spell-error" title="${escapeAttr('Zuzenketak / Suggestions: ' + (s.suggestions || []).join(', '))}" data-suggestions="${escapeAttr(suggestions)}" data-word="${escapeAttr(s.word)}">${escapeHtml(s.word)}</span>`;
    }
    cursor = s.end;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
