/**
 * Txukun — Analysis bridge
 *
 * Runs the existing detection models and produces a unified list of
 * suggestion errors in the shape the editor / suggestions panel expect:
 *
 *   { id, from, to, original, suggestion, category, title, status }
 *
 * category: 'grammar' | 'spelling' | 'cappunct'
 *
 * All models run on the ORIGINAL text independently (Grammarly-style:
 * overlapping suggestions are resolved by position). Errors are sorted
 * by position and de-overlapped (earliest, then longest span wins).
 */

import { correctCapPunct, isModelReady, isSpellReady } from './models.js';
import { checkSpelling } from './spell.js';
import { correctGrammar, detectGrammar, isGectorReady, initGector } from './gector.js';

let errCounter = 0;
const nextId = () => `e${++errCounter}`;

/**
 * Analyze the full text and return an array of error objects.
 * @param {string} text
 * @returns {Promise<Array>}
 */
export async function analyzeText(text) {
  if (!text || !text.trim()) return [];

  // Run the three detectors in parallel (each degrades gracefully).
  const [grammarErrors, spellingErrors, capPunctErrors] = await Promise.all([
    detectGrammarErrors(text),
    detectSpellingErrors(text),
    detectCapPunctErrors(text),
  ]);

  let all = [...grammarErrors, ...spellingErrors, ...capPunctErrors];
  // Sort by position; longer spans first when tied
  all.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  // Remove overlaps (keep earliest, then longest)
  all = dedupeOverlaps(all);
  return all;
}

// ── Grammar (GECToR) ────────────────────────────────────────────────
//
// GECToR's correctGrammar() returns the full corrected text. We diff it
// against the original (word-level LCS) to extract per-span changes,
// each becoming a grammar suggestion with original character offsets.

async function detectGrammarErrors(text) {
  const errors = [];
  try {
    if (!isGectorReady()) {
      await initGector();
      if (!isGectorReady()) return errors;
    }
    const { corrected } = await correctGrammar(text);
    if (!corrected || corrected === text) return errors;

    const changes = diffWords(text, corrected);
    for (const ch of changes) {
      if (ch.type !== 'replace') continue; // insertions/deletions rare in GECToR-eus
      errors.push({
        id: nextId(),
        from: ch.fromOffset,
        to: ch.toOffset,
        original: ch.fromText,
        suggestion: ch.toText,
        category: 'grammar',
        title: grammarTitle(ch.fromText, ch.toText),
        status: 'pending',
      });
    }
  } catch (err) {
    console.warn('[analyze] grammar detection failed:', err);
  }
  return errors;
}

function grammarTitle(original, suggestion) {
  if (suggestion.split(/\s+/).length > original.split(/\s+/).length) return 'Hitza gehitu';
  if (suggestion.split(/\s+/).length < original.split(/\s+/).length) return 'Hitza kendu';
  if (suggestion.toLowerCase() === original.toLowerCase()) return 'Maiuskula';
  return 'Gramatika';
}

// ── Spelling (Hunspell + BERTeus re-rank) ────────────────────────────

async function detectSpellingErrors(text) {
  const errors = [];
  try {
    if (!isSpellReady()) return errors;
    const spellErrors = await checkSpelling(text);
    if (!Array.isArray(spellErrors)) return errors;

    for (const err of spellErrors) {
      if (!err.suggestions || err.suggestions.length === 0) continue;
      const original = text.slice(err.start, err.end);
      const suggestion = err.suggestions[0];
      if (suggestion === original) continue;
      errors.push({
        id: nextId(),
        from: err.start,
        to: err.end,
        original,
        suggestion,
        category: 'spelling',
        title: 'Ortografia',
        status: 'pending',
      });
    }
  } catch (err) {
    console.warn('[analyze] spelling detection failed:', err);
  }
  return errors;
}

// ── Capitalization & punctuation (MarianMT) ─────────────────────────
//
// MarianMT rewrites the whole text with restored caps/punctuation. We
// diff its output against the input; only case/punctuation-only changes
// (not word substitutions, which constrainCapPunct already filtered)
// become 'cappunct' suggestions.

async function detectCapPunctErrors(text) {
  const errors = [];
  try {
    if (!isModelReady()) return errors;
    const corrected = await correctCapPunct(text);
    if (!corrected || corrected === text) return errors;

    const changes = diffWords(text, corrected);
    for (const ch of changes) {
      if (ch.type !== 'replace') continue;
      if (!isCasePunctOnly(ch.fromText, ch.toText)) continue;
      errors.push({
        id: nextId(),
        from: ch.fromOffset,
        to: ch.toOffset,
        original: ch.fromText,
        suggestion: ch.toText,
        category: 'cappunct',
        title: capPunctTitle(ch.fromText, ch.toText),
        status: 'pending',
      });
    }
  } catch (err) {
    console.warn('[analyze] cap-punct detection failed:', err);
  }
  return errors;
}

function capPunctTitle(from, to) {
  if (from.toLowerCase() === to.toLowerCase()) return 'Maiuskula';
  return 'Puntuazioa';
}

// ── Word-level LCS diff ──────────────────────────────────────────────
//
// Tokenizes both texts into words (with whitespace preserved as separate
// tokens), runs an LCS alignment, and emits {type, fromText, toText,
// fromOffset, toOffset} for each replace/insert/delete. Matches carry
// the original character offsets so suggestions map back to the source.

function tokenizeWithOffsets(text) {
  const tokens = [];
  const re = /(\s+|\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ text: m[0], from: m.index, to: m.index + m[0].length });
  }
  return tokens;
}

function diffWords(originalText, correctedText) {
  const a = tokenizeWithOffsets(originalText);
  const b = tokenizeWithOffsets(correctedText);
  // Only compare non-whitespace tokens for alignment, but we operate on
  // full token arrays so offsets stay valid.
  const aWords = a.map((t, i) => ({ t, i })).filter((x) => /\S/.test(x.t.text));
  const bWords = b.map((t, i) => ({ t, i })).filter((x) => /\S/.test(x.t.text));

  const n = aWords.length;
  const mm = bWords.length;

  // LCS DP table
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(mm + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = mm - 1; j >= 0; j--) {
      dp[i][j] =
        aWords[i].t.text.toLowerCase() === bWords[j].t.text.toLowerCase()
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack to build the edit script
  const changes = [];
  let i = 0,
    j = 0;
  while (i < n && j < mm) {
    if (aWords[i].t.text.toLowerCase() === bWords[j].t.text.toLowerCase()) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // aWords[i] deleted (or replaced if bWords[j] also consumed next)
      if (j < mm && dp[i + 1][j + 1] < dp[i + 1][j]) {
        // pure delete
        changes.push({
          type: 'delete',
          fromText: aWords[i].t.text,
          toText: '',
          fromOffset: aWords[i].t.from,
          toOffset: aWords[i].t.to,
        });
      } else {
        // replace aWords[i] with bWords[j]
        changes.push({
          type: 'replace',
          fromText: aWords[i].t.text,
          toText: bWords[j].t.text,
          fromOffset: aWords[i].t.from,
          toOffset: aWords[i].t.to,
        });
        j++;
      }
      i++;
    } else {
      // bWords[j] inserted
      changes.push({
        type: 'insert',
        fromText: '',
        toText: bWords[j].t.text,
        fromOffset: aWords[i] ? aWords[i].t.from : originalText.length,
        toOffset: aWords[i] ? aWords[i].t.from : originalText.length,
      });
      j++;
    }
  }
  while (j < mm) {
    changes.push({
      type: 'insert',
      fromText: '',
      toText: bWords[j].t.text,
      fromOffset: originalText.length,
      toOffset: originalText.length,
    });
    j++;
  }
  while (i < n) {
    changes.push({
      type: 'delete',
      fromText: aWords[i].t.text,
      toText: '',
      fromOffset: aWords[i].t.from,
      toOffset: aWords[i].t.to,
    });
    i++;
  }
  return changes;
}

function isCasePunctOnly(a, b) {
  if (a === b) return false;
  const strip = (s) => s.replace(/[^\p{L}]/gu, '').toLowerCase();
  return strip(a) === strip(b) && strip(a).length > 0;
}

// ── Overlap resolution ───────────────────────────────────────────────

function dedupeOverlaps(errors) {
  const out = [];
  let lastEnd = -1;
  for (const e of errors) {
    if (e.from < lastEnd) continue; // overlaps previous accepted error
    out.push(e);
    lastEnd = e.to;
  }
  return out;
}

// ── Detection-only heatmap (GECToR detect head) ────────────────────
//
// Returns per-word P(INCORRECT) aligned to character positions. Used by
// the editor to highlight suspect words even before the user runs a full
// analysis (or to supplement the suggestion cards).

export async function detectHeatmap(text) {
  try {
    if (!isGectorReady()) {
      await initGector();
      if (!isGectorReady()) return [];
    }
    const { detections } = await detectGrammar(text);
    return detections || [];
  } catch (err) {
    console.warn('[analyze] heatmap detection failed:', err);
    return [];
  }
}
