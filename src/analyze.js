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
 * All models run on PLAIN TEXT (markdown stripped) so they never see
 * syntax markers like #, **, [], etc. Error offsets are mapped back to
 * raw-markdown positions for the editor. Errors are sorted by position
 * and de-overlapped (earliest, then longest span wins).
 */

// ── Markdown stripping with offset mapping ──────────────────────────
//
// Idaztian's getContent() returns raw markdown source. All three models
// (MarianMT, GECToR, Hunspell) were trained on plain text, so we strip
// markdown syntax before passing text to them, then map the resulting
// error offsets back to markdown positions for the editor decorations.

/**
 * Strip markdown syntax markers from text, returning plain text + a
 * position map so error offsets can be translated back to markdown.
 *
 * Strips: headings, bold, italic, strikethrough, inline code, links,
 * images, blockquotes, list markers, horizontal rules, code fences.
 *
 * Also returns `headingRanges`: plain-text [start, end] offsets for each
 * heading line's content, so callers can suppress punctuation hints
 * inside headings (which shouldn't get trailing dots).
 *
 * @param {string} md - Raw markdown source
 * @returns {{ text: string, map: number[], headingRanges: Array<[number, number]> }}
 */
function stripMarkdown(md) {
  let plain = '';
  const map = [];
  let i = 0;
  let inCodeBlock = false;
  let inHeading = false;
  let headingStart = 0;
  const headingRanges = [];
  const len = md.length;

  while (i < len) {
    // ── Code fence: toggle state, skip entire line ──
    if (md.startsWith('```', i)) {
      inCodeBlock = !inCodeBlock;
      const eol = md.indexOf('\n', i);
      i = eol === -1 ? len : eol + 1;
      continue;
    }

    // ── Inside code block: skip entire line ──
    if (inCodeBlock) {
      const eol = md.indexOf('\n', i);
      i = eol === -1 ? len : eol + 1;
      continue;
    }

    // ── Start of line: strip block-level markers ──
    if (i === 0 || md[i - 1] === '\n') {
      let j = i;

      // Blockquote markers (> or >> ...)
      let bq;
      while ((bq = md.slice(j).match(/^>{1,}\s*/))) j += bq[0].length;

      // Heading markers (# to ######)
      const h = md.slice(j).match(/^#{1,6}\s+/);
      if (h) {
        j += h[0].length;
        inHeading = true;
        headingStart = plain.length;
      }

      // List markers (- * + or 1.)
      const l = md.slice(j).match(/^([-*+]\s+|\d+\.\s+)/);
      if (l) j += l[0].length;

      // Horizontal rule (entire line is --- / *** / ___)
      const hr = md.slice(j).match(/^(-{3,}|\*{3,}|_{3,})\s*$/);
      if (hr) {
        const eol = md.indexOf('\n', j);
        i = eol === -1 ? len : eol + 1;
        continue;
      }

      i = j;
    }

    // ── Image ![alt](url) — skip entirely ──
    if (md[i] === '!' && md[i + 1] === '[') {
      const closeBracket = md.indexOf('](', i + 2);
      if (closeBracket !== -1) {
        const closeParen = md.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          i = closeParen + 1;
          continue;
        }
      }
    }

    // ── Link [text](url) — keep text, drop URL ──
    if (md[i] === '[') {
      const closeBracket = md.indexOf('](', i + 1);
      if (closeBracket !== -1) {
        const closeParen = md.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          for (let k = i + 1; k < closeBracket; k++) {
            plain += md[k];
            map.push(k);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // ── Inline code `text` — keep content ──
    if (md[i] === '`') {
      const end = md.indexOf('`', i + 1);
      if (end !== -1) {
        for (let k = i + 1; k < end; k++) {
          plain += md[k];
          map.push(k);
        }
        i = end + 1;
        continue;
      }
    }

    // ── Bold **text** or __text__ — keep content ──
    if ((md[i] === '*' && md[i + 1] === '*') || (md[i] === '_' && md[i + 1] === '_')) {
      const marker = md.slice(i, i + 2);
      const end = md.indexOf(marker, i + 2);
      if (end !== -1) {
        for (let k = i + 2; k < end; k++) {
          plain += md[k];
          map.push(k);
        }
        i = end + 2;
        continue;
      }
    }

    // ── Strikethrough ~~text~~ — keep content ──
    if (md[i] === '~' && md[i + 1] === '~') {
      const end = md.indexOf('~~', i + 2);
      if (end !== -1) {
        for (let k = i + 2; k < end; k++) {
          plain += md[k];
          map.push(k);
        }
        i = end + 2;
        continue;
      }
    }

    // ── Italic *text* or _text_ — keep content ──
    // (must come after bold/strikethrough; require non-space after opener)
    if (
      (md[i] === '*' || md[i] === '_') &&
      md[i + 1] !== md[i] &&
      md[i + 1] &&
      md[i + 1] !== ' ' &&
      md[i + 1] !== '\n'
    ) {
      const ch = md[i];
      let end = i + 1;
      while (end < len && !(md[end] === ch && md[end + 1] !== ch && md[end - 1] !== ch)) {
        end++;
      }
      if (end < len) {
        for (let k = i + 1; k < end; k++) {
          plain += md[k];
          map.push(k);
        }
        i = end + 1;
        continue;
      }
    }

    // ── Regular character ──
    // Record heading range at end of heading line (before the newline).
    if (md[i] === '\n' && inHeading) {
      headingRanges.push([headingStart, plain.length]);
      inHeading = false;
    }
    plain += md[i];
    map.push(i);
    i++;
  }

  // Heading at EOF (no trailing newline)
  if (inHeading) {
    headingRanges.push([headingStart, plain.length]);
  }

  return { text: plain, map, headingRanges };
}

/**
 * Map a plain-text offset to a markdown offset.
 * @param {number} plainOffset - offset in stripped text
 * @param {number[]} map - map[plainIdx] = mdIdx
 * @param {boolean} isEnd - true for exclusive end offset ("to")
 * @returns {number} offset in original markdown
 */
function mapOffset(plainOffset, map, isEnd = false) {
  if (map.length === 0) return plainOffset;
  if (isEnd) {
    if (plainOffset >= map.length) return map[map.length - 1] + 1;
    if (plainOffset <= 0) return map[0];
    return map[plainOffset - 1] + 1;
  }
  if (plainOffset >= map.length) return map[map.length - 1] + 1;
  return map[Math.max(0, plainOffset)];
}

/**
 * Build a leading-context snippet for a card: a few words before the
 * error, bounded by the current paragraph (newline). Returns empty
 * string if the error is at the start of its paragraph.
 *
 * @param {string} plainText - stripped plain text
 * @param {number} from - error start offset (in plain text)
 * @returns {string}
 */
function buildContext(plainText, from) {
  const paraStart = plainText.lastIndexOf('\n', from - 1) + 1;
  const ctxStart = Math.max(paraStart, from - 28);
  let ctx = plainText.slice(ctxStart, from);
  if (ctxStart > paraStart) ctx = '\u2026' + ctx;
  return ctx.trimEnd();
}

import { correctCapPunct, isModelReady, isSpellReady } from './models.js';
import { checkSpelling, getBestCorrection } from './spell.js';
import { correctGrammar, detectGrammar, isGectorReady, initGector } from './gector.js';

let errCounter = 0;
const nextId = () => `e${++errCounter}`;

/**
 * Analyze the full text and return an array of error objects.
 *
 * Markdown syntax is stripped before passing to models (they were
 * trained on plain text). Error offsets are mapped back to raw-markdown
 * positions so editor decorations land on the right characters.
 *
 * @param {string} mdText - raw markdown from the editor
 * @returns {Promise<Array>}
 */
export async function analyzeText(mdText) {
  if (!mdText || !mdText.trim()) return [];

  // Strip markdown → plain text + offset map + heading ranges
  const { text: plainText, map, headingRanges } = stripMarkdown(mdText);
  if (!plainText.trim()) return [];

  // Run the three detectors SEQUENTIALLY on plain text — ONNX Runtime
  // Web (WASM) cannot execute multiple sessions concurrently.
  const grammarErrors = await detectGrammarErrors(plainText);
  const spellingErrors = await detectSpellingErrors(plainText);
  let capPunctErrors = await detectCapPunctErrors(plainText, headingRanges);

  // Merge overlapping spelling + cap-punct errors: when both touch the
  // same word and cap-punct is a pure capitalization change (e.g.
  // sentence-initial), apply the capitalization to the spelling suggestion
  // and drop the redundant cap-punct hint.
  //   spelling: laister→laster, cap-punct: laister→Laister  →  laister→Laster
  capPunctErrors = mergeSpellingCapPunct(spellingErrors, capPunctErrors);

  // Build context snippets (in plain text, paragraph-bounded) BEFORE
  // mapping offsets to markdown. This keeps context clean (no markdown
  // markers) and prevents bleeding across paragraph boundaries.
  const allPlain = [...grammarErrors, ...spellingErrors, ...capPunctErrors];
  for (const e of allPlain) {
    e.context = buildContext(plainText, e.from);
  }

  // Map offsets from plain text → markdown
  let all = allPlain.map((e) => ({
    ...e,
    from: mapOffset(e.from, map, false),
    to: mapOffset(e.to, map, true),
  }));

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
      // Use the shared two-tier re-ranking (Tier 1 freq + Tier 2 BERTeus)
      // instead of blindly taking Hunspell's suggestions[0].
      const best = await getBestCorrection(text, err);
      if (!best) continue;
      const original = text.slice(err.start, err.end);
      const suggestion = best.word;
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

async function detectCapPunctErrors(text, headingRanges = []) {
  const errors = [];
  try {
    if (!isModelReady()) return errors;
    const corrected = await correctCapPunct(text);
    if (!corrected || corrected === text) return errors;

    const changes = diffWords(text, corrected);
    for (const ch of changes) {
      if (ch.type !== 'replace') continue;
      if (!isCasePunctOnly(ch.fromText, ch.toText)) continue;
      // Ignore punctuation hints inside heading lines — headings
      // shouldn't get trailing dots or other punctuation additions.
      // Pure capitalization hints (e.g. "nire" → "Nire") are kept.
      if (
        isInHeading(ch.fromOffset, headingRanges) &&
        ch.fromText.toLowerCase() !== ch.toText.toLowerCase()
      )
        continue;
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
      // Words match case-insensitively. If the actual text differs
      // (e.g. "nire" → "Nire"), emit a replace so case-only changes
      // are not silently dropped.
      if (aWords[i].t.text !== bWords[j].t.text) {
        changes.push({
          type: 'replace',
          fromText: aWords[i].t.text,
          toText: bWords[j].t.text,
          fromOffset: aWords[i].t.from,
          toOffset: aWords[i].t.to,
        });
      }
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

// ── Spelling + cap-punct merge ──────────────────────────────────────
//
// When a spelling error and a cap-punct case change overlap at the same
// position, merge them: apply the capitalization pattern from the
// cap-punct hint to the spelling suggestion, then drop the cap-punct
// hint. This way the user sees a single card with the final word.
//   spelling: laister→laster, cap-punct: laister→Laister  →  laister→Laster

function mergeSpellingCapPunct(spellingErrors, capPunctErrors) {
  const removed = new Set();
  for (const sp of spellingErrors) {
    for (let i = 0; i < capPunctErrors.length; i++) {
      if (removed.has(i)) continue;
      const cp = capPunctErrors[i];
      // Must overlap in position
      if (sp.from >= cp.to || cp.from >= sp.to) continue;
      // Only merge pure case changes (no punctuation difference)
      if (cp.original.toLowerCase() !== cp.suggestion.toLowerCase()) continue;
      const merged = applyCasePattern(cp.original, cp.suggestion, sp.suggestion);
      if (merged && merged !== sp.suggestion) {
        sp.suggestion = merged;
        removed.add(i);
      }
    }
  }
  return capPunctErrors.filter((_, i) => !removed.has(i));
}

/**
 * Apply the case pattern from (original→corrected) to target.
 * Currently handles first-letter capitalization (sentence-initial,
 * proper nouns) — the only case change Basque cap-punct produces.
 * @returns {string|null} target with case applied, or null if not applicable
 */
function applyCasePattern(original, corrected, target) {
  if (original.toLowerCase() !== corrected.toLowerCase()) return null;
  if (
    corrected.length > 0 &&
    original.length > 0 &&
    corrected[0] === corrected[0].toUpperCase() &&
    original[0] === original[0].toLowerCase() &&
    corrected[0].toLowerCase() === original[0].toLowerCase()
  ) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return null;
}

/**
 * Check whether a plain-text offset falls within a heading line.
 * @param {number} offset - plain-text offset
 * @param {Array<[number, number]>} headingRanges - [start, end] ranges
 * @returns {boolean}
 */
function isInHeading(offset, headingRanges) {
  for (const [start, end] of headingRanges) {
    if (offset >= start && offset < end) return true;
  }
  return false;
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

export async function detectHeatmap(mdText) {
  try {
    if (!isGectorReady()) {
      await initGector();
      if (!isGectorReady()) return [];
    }
    const { text: plainText, map } = stripMarkdown(mdText);
    if (!plainText.trim()) return [];
    const { detections } = await detectGrammar(plainText);
    return (detections || []).map((d) => ({
      ...d,
      start: mapOffset(d.start, map, false),
      end: mapOffset(d.end, map, true),
    }));
  } catch (err) {
    console.warn('[analyze] heatmap detection failed:', err);
    return [];
  }
}
