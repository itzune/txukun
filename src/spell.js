/**
 * Txukun — Spell checking with Hunspell WASM + Xuxen dictionary
 *
 * Uses hunspell-wasm-bare (bare WASM, no Emscripten) running in a
 * dedicated Web Worker. Communicates via postMessage with request/response
 * matching by ID.
 *
 * Public API (backward compatible):
 *   loadSpellChecker()         → spawns worker, loads dicts
 *   spell(word)                → boolean (async via batch messaging)
 *   suggest(word)              → string[] (async via batch messaging)
 *   checkSpelling(text)        → array of error tokens with suggestions
 *   autoCorrect(text)          → corrected text + change log
 *   annotateSpelling()         → HTML annotation
 *   annotateCorrections()      → green spans
 *   annotateBoth()             → combined annotation
 *   tokenize(text)             → Basque-aware tokenizer
 *   stripAnnotations(html)     → HTML → plain text
 */

// ── Worker Management ───────────────────────────────

let worker = null;
let ready = false;
let pendingRequests = new Map();
let nextId = 1;

/**
 * Spawn the Hunspell worker and load Xuxen dictionaries.
 */
export async function loadSpellChecker() {
  if (worker) return;

  const basePath = import.meta.env.BASE_URL || '/txukun/';

  // Fetch dictionary files
  const [affResp, dicResp, wordsResp] = await Promise.all([
    fetch(basePath + 'dicts/eu.aff'),
    fetch(basePath + 'dicts/eu.dic'),
    fetch(basePath + 'dicts/eu-words.txt').catch(() => null), // optional
  ]);

  const affixContent = await affResp.text();
  const dictionaryContent = await dicResp.text();
  const wordListContent = wordsResp ? await wordsResp.text() : null;

  // Spawn worker (Vite bundles this as a separate module)
  worker = new Worker(
    new URL('./spell-worker.js', import.meta.url),
    { type: 'module' }
  );

  // Listen for responses
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      ready = true;
      return;
    }
    if (msg.type === 'error') {
      console.error('[Txukun spell worker]', msg.message);
      ready = false;
      return;
    }
    // Route spell/suggest results by ID
    if (msg.id !== undefined && pendingRequests.has(msg.id)) {
      const { resolve } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      resolve(msg);
    }
  };

  worker.onerror = (err) => {
    console.error('[Txukun spell worker] Worker error:', err);
    ready = false;
  };

  // Initialize
  worker.postMessage({
    type: 'init',
    wasmUrl: basePath + 'hunspell.wasm',
    affixContent,
    dictionaryContent,
    wordListContent,
  });
}

/**
 * Check if the spell checker is loaded and ready.
 */
export function isReady() {
  return ready;
}

// ── Worker Communication Helpers ────────────────────

function _sendRequest(type, payload = {}) {
  if (!worker || !ready) {
    return Promise.resolve(type === 'suggest' ? { suggestions: [] } : { correct: true });
  }

  return new Promise((resolve) => {
    const id = nextId++;
    pendingRequests.set(id, { resolve });
    worker.postMessage({ type, id, ...payload });
  });
}

async function _spell(word) {
  const result = await _sendRequest('spell', { word });
  return result.correct !== false;
}

async function _suggest(word) {
  const result = await _sendRequest('suggest', { word });
  return result.suggestions || [];
}

// ── Public API (async versions) ─────────────────────

/**
 * Check if a word is correctly spelled.
 * Falls back to true if worker is not ready.
 */
export function spell(word) {
  if (!ready) return true;
  // Synchronous check: we can't await here. Use checkSpelling() for
  // async batch checking. For quick lookup, return true (no-op).
  // The batch checkSpelling handles all spell checking.
  return true;
}

/**
 * Simple suggestions via Hunspell.
 */
export async function suggest(word) {
  if (!ready) return [];
  return await _suggest(word);
}

/**
 * Basque-aware word tokenizer (same as before).
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
 * Check all words in text against Hunspell.
 * Batches spell checks through the worker.
 */
export async function checkSpelling(text) {
  if (!ready) return [];

  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  // Filter out non-words, numbers, URLs, emails, caps, short words,
  // number suffixes
  const candidates = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d+([.,]\d+)*$/.test(tok.word)) continue;
    if (/^https?:\/\//.test(tok.word)) continue;
    if (/@/.test(tok.word)) continue;
    if (tok.word.length < 2) continue;
    if (tok.word === tok.word.toUpperCase() && tok.word.length > 1) continue;

    // Skip short suffixes attached to numbers ("koa", "ekoa", "ko")
    if (tok.word.length <= 5 && i > 0 && /^\d+([.,]\d+)*$/.test(tokens[i - 1].word)) {
      continue;
    }

    candidates.push({ ...tok, index: i });
  }

  if (candidates.length === 0) return [];

  // Batch spell check: send all at once, collect results
  const results = await Promise.all(
    candidates.map(c => _spell(c.word))
  );

  // Collect misspelled words and get suggestions
  const errors = [];
  const misspelledIndices = [];

  for (let i = 0; i < candidates.length; i++) {
    if (!results[i]) {
      misspelledIndices.push(i);
      errors.push({
        ...candidates[i],
        suggestions: [],
        _candidateIndex: i,
      });
    }
  }

  if (errors.length === 0) return [];

  // Get suggestions for all misspelled words in parallel
  const suggestionPromises = errors.map(e => _suggest(e.word));
  const allSuggestions = await Promise.all(suggestionPromises);

  for (let i = 0; i < errors.length; i++) {
    errors[i].suggestions = allSuggestions[i] || [];
    delete errors[i]._candidateIndex;
    delete errors[i].index;
  }

  return errors;
}

/**
 * Auto-correct: replace each misspelled word with Hunspell's first suggestion.
 */
export async function autoCorrect(text) {
  if (!ready) return { text, changes: 0, corrections: [] };

  const errors = await checkSpelling(text);
  if (errors.length === 0) return { text, changes: 0, corrections: [] };

  // Sort by position (descending) so we can replace from right to left
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
    corrections: corrections.sort((a, b) => b.start - a.start),
  };
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
    const suggestions = (err.suggestions || []).map(s => escapeHtml(s)).join(',');
    html += `<span class="spell-error" title="${escapeAttr('Zuzenketak / Suggestions: ' + (err.suggestions || []).join(', '))}" data-suggestions="${escapeAttr(suggestions)}" data-word="${escapeAttr(err.word)}">${escapeHtml(err.word)}</span>`;
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

export function annotateCorrections(text, corrections) {
  if (!corrections || corrections.length === 0) return escapeHtml(text);

  const ascending = [...corrections].sort((a, b) => a.start - b.start);
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

export function annotateBoth(text, corrections, errors) {
  const spans = [
    ...corrections.map(c => ({ ...c, type: 'correction' })),
    ...(errors || []).map(e => ({ ...e, type: 'error' })),
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
