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

// Tier 1 frequency re-ranking state.
// Lowercase word → raw corpus count, from public/dicts/eu-words-freq.txt.
// Built once in loadSpellChecker(); used by rankCandidates() in autoCorrect().
let freqMap = new Map();

/**
 * Spawn the Hunspell worker and load Xuxen dictionaries.
 */
export async function loadSpellChecker() {
  if (worker) return;

  const basePath = import.meta.env.BASE_URL || '/txukun/';

  // Fetch dictionary files. eu-words-freq.txt doubles as the detection
  // word list (same 160k words, "word\tcount" per line) and the frequency
  // map for Tier 1 re-ranking — one fetch instead of two (drops the
  // redundant 1.6MB eu-words.txt fetch).
  const [affResp, dicResp, freqResp] = await Promise.all([
    fetch(basePath + 'dicts/eu.aff'),
    fetch(basePath + 'dicts/eu.dic'),
    fetch(basePath + 'dicts/eu-words-freq.txt').catch(() => null), // optional
  ]);

  const affixContent = await affResp.text();
  const dictionaryContent = await dicResp.text();
  const freqContent = freqResp ? await freqResp.text() : null;

  // Build frequency map (main thread) for Tier 1 re-ranking.
  freqMap = new Map();
  if (freqContent) {
    for (const line of freqContent.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab <= 0) continue;
      const word = line.slice(0, tab).trim().toLowerCase();
      const count = parseInt(line.slice(tab + 1), 10);
      if (word) freqMap.set(word, Number.isFinite(count) ? count : 0);
    }
  }

  // Spawn worker (Vite bundles this as a separate module)
  worker = new Worker(
    new URL('./spell-worker.js', import.meta.url),
    { type: 'module' }
  );

  // Listen for responses
  const readyPromise = new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        ready = true;
        resolve();
        return;
      }
      if (msg.type === 'error') {
        console.error('[Txukun spell worker]', msg.message);
        ready = false;
        reject(new Error(msg.message));
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
      reject(err);
    };
  });

  // Initialize
  worker.postMessage({
    type: 'init',
    wasmUrl: basePath + 'hunspell.wasm',
    affixContent,
    dictionaryContent,
    // Passed as wordListContent: the worker splits on '\t' to take the
    // word column (same 160k words as the legacy eu-words.txt).
    wordListContent: freqContent,
  });

  // Wait for the worker to be fully initialized
  await readyPromise;
}

/**
 * Check if the spell checker is loaded and ready.
 */
export function isReady() {
  return ready;
}

// ── Frequency re-ranking (Tier 1) ───────────────────
//
// Re-ranks correction candidates by corpus frequency + edit distance
// instead of blindly taking Hunspell's suggestions[0]. The candidate
// pool is (edit-distance-1 variants ∩ wordlist) ∪ (Hunspell suggestions):
// Hunspell alone never proposes the correct word for cases like
// `batzutan` (it returns `batsutan`, `batzotan` — never `batzuetan`),
// so edit-distance generation against the wordlist is required.
//
// See CORRECTOR_STRATEGY.md §5 (Tier 1) and §9 (verified evidence).

// Scoring weights — named constants for later grid-search. β weights
// corpus frequency (raw count, log-scaled); δ weights edit distance as a
// noisy-channel prior. Frequency dominates (Tier 1 intent), edit distance
// breaks ties. Starting values per the strategy (§7).
export const SCORE_BETA = 0.3;
export const SCORE_DELTA = 0.5;

// Lowercase Basque alphabet for edit-distance generation. Includes
// diacritics so a substitution like n→ñ can surface `iñaki` from `inaki`.
const EU_ALPHABET = 'abcdefghijklmnopqrstuvwxyzáéíóúüñçàèìòùâêîôû';

/**
 * Generate all edit-distance-1 variants of a word (Norvig-style:
 * deletions, transpositions, substitutions, insertions). Lowercases the
 * input. Does NOT filter by dictionary — the caller filters against the
 * wordlist/freqMap. The original word is never included.
 */
export function edits1(word) {
  const w = (word || '').toLowerCase();
  const splits = [];
  for (let i = 0; i <= w.length; i++) splits.push([w.slice(0, i), w.slice(i)]);

  const results = new Set();
  for (const [a, b] of splits) {
    if (b.length > 0) results.add(a + b.slice(1));               // deletion
    if (b.length > 1) results.add(a + b[1] + b[0] + b.slice(2)); // transposition
    for (const c of EU_ALPHABET) {
      if (b.length > 0) results.add(a + c + b.slice(1));         // substitution
      results.add(a + c + b);                                    // insertion
    }
  }
  results.delete(w);
  return results;
}

/**
 * Levenshtein edit distance (iterative DP, case-insensitive).
 */
export function levenshtein(a, b) {
  a = (a || '').toLowerCase();
  b = (b || '').toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

/**
 * Restore the case pattern of `source` onto `target` (which arrives
 * lowercased from the wordlist). ALL-CAPS → uppercase; Title-case →
 * capitalized first letter; all-lower or mixed → lowercase.
 */
export function matchCase(source, target) {
  if (!source || !target) return target;
  const letters = [...source].filter(ch => /\p{L}/u.test(ch));
  if (letters.length === 0) return target;
  const isUpper = ch => ch.toLowerCase() !== ch && ch.toUpperCase() === ch;
  const upperCount = letters.filter(isUpper).length;

  if (upperCount === letters.length && letters.length > 1) {
    return target.toUpperCase();                                    // ALL CAPS
  }
  if (isUpper(letters[0]) && letters.slice(1).every(ch => !isUpper(ch))) {
    const t = target.toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);                 // Title case
  }
  return target.toLowerCase();                                      // lower / mixed
}

/**
 * Build and score the Tier 1 candidate pool for `typed`.
 *   pool = (edits1(typed) ∩ wordlist) ∪ hunspellSuggestions
 * scored as  score = β·log(freq+1) + δ·(1/(1+edit_distance)).
 *
 * Confidence gate: a candidate is eligible only if corpus-attested
 * (freq > 0) OR within edit distance 1 — prevents forcing a rare,
 * zero-frequency, edit-distance-2 word onto the user.
 *
 * @param {string} typed                 misspelled word (any case)
 * @param {string[]} hunspellSuggestions Hunspell's suggestions (secondary)
 * @param {Map<string,number>} [fmap]    freq map; defaults to module freqMap
 * @returns {{word:string, score:number}[]}  sorted desc by score, case-matched.
 *          Empty array → no confident candidate (caller leaves word unchanged).
 */
export function getRankedCandidates(typed, hunspellSuggestions, fmap) {
  if (!typed) return [];
  const map = fmap && fmap.size ? fmap : freqMap;
  const typedLower = typed.toLowerCase();

  // Edit-distance-1 variants (computed once), filtered to real words.
  const ed1Variants = edits1(typedLower);
  const pool = new Set(); // lowercase candidate words
  for (const v of ed1Variants) {
    if (map.has(v)) pool.add(v);
  }

  // Hunspell suggestions (secondary source) — may surface forms that
  // edit-distance generation misses (affix/REP suggestions). Accepted even
  // if absent from our wordlist, since Hunspell's rules validate them.
  if (Array.isArray(hunspellSuggestions)) {
    for (const s of hunspellSuggestions) {
      if (!s) continue;
      const sLow = s.toLowerCase();
      if (sLow !== typedLower) pool.add(sLow);
    }
  }

  const ranked = [];
  for (const cand of pool) {
    const freq = map.get(cand) ?? 0;
    const ed = ed1Variants.has(cand) ? 1 : levenshtein(typedLower, cand);
    // Confidence gate: corpus-attested OR within edit distance 1.
    if (freq <= 0 && ed !== 1) continue;
    const score = SCORE_BETA * Math.log(freq + 1) + SCORE_DELTA * (1 / (1 + ed));
    ranked.push({ word: cand, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.map(c => ({ word: matchCase(typed, c.word), score: c.score }));
}

/**
 * Pick the best correction — convenience wrapper around getRankedCandidates.
 * @returns {{word:string, score:number}|null}
 */
export function rankCandidates(typed, hunspellSuggestions, fmap) {
  const ranked = getRankedCandidates(typed, hunspellSuggestions, fmap);
  return ranked.length > 0 ? ranked[0] : null;
}

/**
 * Full two-tier re-ranking for a spell error, using the surrounding text
 * for BERTeus bidirectional context.
 *
 *   Tier 1 (fast): frequency + edit distance via getRankedCandidates().
 *   Tier 2 (slow): BERTeus masked embedding similarity, lazy-loaded.
 *
 * The BERT model is only invoked when ≥2 candidates exist and BERT is
 * ready (or can be loaded). If BERT is unavailable, degrades to Tier 1.
 *
 * @param {string} fullText   full plain-text context (for BERTeus)
 * @param {{word:string, start:number, end:number, suggestions:string[]}} err
 * @returns {Promise<{word:string, score:number}|null>}
 */
export async function getBestCorrection(fullText, err) {
  const ranked = getRankedCandidates(err.word, err.suggestions, freqMap);
  if (ranked.length === 0) return null;
  let best = ranked[0];

  // Tier 2: BERTeus re-ranking when multiple candidates exist.
  if (ranked.length >= 2) {
    let bert = null;
    try { bert = await getBERT(); } catch (e) { /* degrade to Tier 1 */ }
    if (bert && !bert.isBERTFailed()) {
      if (!bert.isBERTReady()) {
        await bert.initBERT();
      }
      if (bert.isBERTReady()) {
        const candidates = ranked.slice(0, 5).map(c => c.word.toLowerCase());
        const bertScores = await bert.bertRerank(fullText, err.start, err.end, candidates);
        let bestCombined = -Infinity;
        for (let i = 0; i < ranked.length && i < bertScores.length; i++) {
          const combined = ranked[i].score + bert.BERT_WEIGHT * bertScores[i];
          if (combined > bestCombined) {
            bestCombined = combined;
            best = ranked[i];
          }
        }
      }
    }
  }

  return best;
}

// BERTeus re-ranking is loaded dynamically (lazy) so the 193MB model
// bundle (119MB ONNX + 74MB embeddings) is only fetched when a spell
// error with multiple candidates is first encountered. See bert-rerank.js.
let bertModule = null;
async function getBERT() {
  if (!bertModule) bertModule = await import('./bert-rerank.js');
  return bertModule;
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
 * Auto-correct: replace each misspelled word with the best candidate.
 *
 * Two-tier re-ranking:
 *   Tier 1 (fast): frequency + edit distance via getRankedCandidates().
 *   Tier 2 (slow): BERTeus masked embedding similarity, lazy-loaded on first use.
 *
 * The BERT model is only invoked when:
 *   1. It has finished loading (non-blocking — degrades to Tier 1 otherwise)
 *   2. There are ≥2 candidates (a single candidate needs no re-ranking)
 *
 * Combined score = tier1_score + BERT_WEIGHT × cosine_sim
 *
 * Words with no confident candidate are left unchanged (safe degradation).
 */
export async function autoCorrect(text) {
  if (!ready) return { text, changes: 0, corrections: [] };

  const errors = await checkSpelling(text);
  if (errors.length === 0) return { text, changes: 0, corrections: [] };

  // Sort by position (descending) so we can replace from right to left.
  // This preserves the start positions of remaining (leftward) errors.
  const sorted = [...errors].sort((a, b) => b.start - a.start);

  let result = text;
  const corrections = [];
  for (const err of sorted) {
    // Use the shared two-tier re-ranking (Tier 1 freq + Tier 2 BERTeus).
    // Pass `result` (partially corrected) so BERTeus sees up-to-date context.
    const best = await getBestCorrection(result, err);

    if (best) {
      const original = err.word;
      const corrected = best.word;
      result = result.slice(0, err.start) + corrected + result.slice(err.end);
      corrections.push({ start: err.start, end: err.start + corrected.length, original, corrected });
    }
    // No confident candidate → leave the word unchanged (safe degradation).
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

/**
 * Annotate finalOutput with combined corrections and errors.
 *
 * corrections[] has positions in the ORIGINAL (pre-correction) text.
 * remaining[] has positions in the finalOutput (post-correction) text.
 *
 * Strategy: tokenize finalOutput. For each token, check if it appears
 * as corrected text in corrections[]. If yes → green span.
 * Otherwise, if the token is in remaining[] → red span.
 */
export function annotateWithCorrections(finalOutput, corrections, remaining) {
  // Build a map of corrected-word → original-word for quick lookup
  const correctedMap = new Map(); // correctedLower → { original, corrected }
  for (const c of corrections) {
    correctedMap.set(c.corrected.toLowerCase(), c);
  }

  // Build a map of misspelled-word → error object for suggestions
  const remainingMap = new Map();
  for (const e of remaining) {
    remainingMap.set(e.word.toLowerCase(), e);
  }

  const tokens = tokenize(finalOutput);
  if (tokens.length === 0) return escapeHtml(finalOutput);

  let html = '';
  let cursor = 0;

  for (const tok of tokens) {
    // Text between cursor and token
    html += escapeHtml(finalOutput.slice(cursor, tok.start));
    
    const lower = tok.word.toLowerCase();
    if (correctedMap.has(lower)) {
      const c = correctedMap.get(lower);
      html += `<span class="spell-corrected" title="${escapeAttr(c.original + ' → ' + c.corrected)}">${escapeHtml(tok.word)}</span>`;
    } else if (remainingMap.has(lower)) {
      const err = remainingMap.get(lower);
      const suggestions = (err.suggestions || []).map(w => escapeHtml(w)).join(',');
      html += `<span class="spell-error" title="${escapeAttr('Zuzenketak / Suggestions: ' + (err.suggestions || []).join(', '))}" data-suggestions="${escapeAttr(suggestions)}" data-word="${escapeAttr(tok.word)}">${escapeHtml(tok.word)}</span>`;
    } else {
      html += escapeHtml(tok.word);
    }

    cursor = tok.end;
  }

  html += escapeHtml(finalOutput.slice(cursor));
  return html;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}
