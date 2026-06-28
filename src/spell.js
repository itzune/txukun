/**
 * Txukun — Spell checking with Hunspell WASM + Xuxen Basque dictionary
 *
 * Uses hunspell-asm (Hunspell compiled to WebAssembly) with the
 * dictionary-eu (Xuxen) affix + dictionary files.
 */

let spellChecker = null;

/**
 * Load the Hunspell spell checker with the Basque dictionary.
 * Dictionary files are ~5 MB (2.7 MB .aff + 2.3 MB .dic).
 */
export async function loadSpellChecker() {
  if (spellChecker) return spellChecker;

  // Load Hunspell WASM module (dynamic import)
  const hunspellFactory = await import('hunspell-asm');
  const factory = await hunspellFactory.loadModule();

  // Load dictionary files from public/dicts/
  // These are copied from node_modules/dictionary-eu at build time.
  const basePath = import.meta.env.BASE_URL || '/txukun/';
  const [affResp, dicResp] = await Promise.all([
    fetch(basePath + 'dicts/eu.aff'),
    fetch(basePath + 'dicts/eu.dic'),
  ]);

  const affBuffer = new Uint8Array(await affResp.arrayBuffer());
  const dicBuffer = new Uint8Array(await dicResp.arrayBuffer());

  // Mount dictionary files
  const affPath = factory.mountBuffer(affBuffer, 'eu.aff');
  const dicPath = factory.mountBuffer(dicBuffer, 'eu.dic');

  spellChecker = factory.create(affPath, dicPath);

  return spellChecker;
}

/**
 * Check if a word is correctly spelled.
 */
export function spell(word) {
  if (!spellChecker) return true; // default to OK if not loaded
  return spellChecker.spell(word);
}

/**
 * Get spelling suggestions for a word.
 * Returns array of suggested words, or empty array if none.
 */
export function suggest(word) {
  if (!spellChecker) return [];
  return spellChecker.suggest(word) || [];
}

/**
 * Basque-aware word tokenizer.
 *
 * Handles:
 * - Apostrophes: d', l', n', t', s', z' (Basque contractions stay attached)
 * - Hyphens in compound words: jaiotze-urtea
 * - Numbers: keep together
 * - URLs/emails: keep together
 */
const WORD_RE = /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛçÇ'\-]+|\d+(?:[.,]\d+)*|https?:\/\/\S+|[\w.-]+@[\w.-]+/g;

/**
 * Tokenize text into word-like tokens, skipping punctuation, whitespace.
 */
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
 * Check all words in a text against the spell checker.
 * Returns array of misspelled tokens with suggestions.
 */
export function checkSpelling(text) {
  if (!spellChecker) return [];

  const tokens = tokenize(text);
  const errors = [];

  for (const tok of tokens) {
    // Skip pure numbers, URLs, emails
    if (/^\d+([.,]\d+)*$/.test(tok.word)) continue;
    if (/^https?:\/\//.test(tok.word)) continue;
    if (/@/.test(tok.word)) continue;

    // Skip words shorter than 2 chars
    if (tok.word.length < 2) continue;

    // Skip ALL-CAPS words (likely acronyms)
    if (tok.word === tok.word.toUpperCase() && tok.word.length > 1) continue;

    if (!spell(tok.word)) {
      errors.push({
        ...tok,
        suggestions: suggest(tok.word),
      });
    }
  }

  return errors;
}

/**
 * Annotate text with HTML spans for misspelled words.
 * Uses <span class="spell-error"> with data-suggestions for hover/click interaction.
 *
 * Returns HTML string suitable for innerHTML.
 */
export function annotateSpelling(text, errors) {
  if (!errors || errors.length === 0) return escapeHtml(text);

  // Sort errors by position (already sorted by tokenize, but be safe)
  const sorted = [...errors].sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;

  for (const err of sorted) {
    // Text before this error
    html += escapeHtml(text.slice(cursor, err.start));

    // The misspelled word with annotation
    const suggestions = err.suggestions.map(s => escapeHtml(s)).join(',');
    html += `<span class="spell-error" title="${escapeAttr('Zuzenketak / Suggestions: ' + err.suggestions.join(', '))}" data-suggestions="${escapeAttr(suggestions)}" data-word="${escapeAttr(err.word)}">${escapeHtml(err.word)}</span>`;

    cursor = err.end;
  }

  // Remaining text
  html += escapeHtml(text.slice(cursor));

  return html;
}

/**
 * Strip HTML annotations to get plain text back.
 */
export function stripAnnotations(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

// ── Helpers ─────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
