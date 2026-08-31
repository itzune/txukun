/**
 * Txukun — Analysis bridge (single-model architecture)
 *
 * Runs the GECToR v2-mt model (one forward pass per iteration, up to 5)
 * and produces a typed list of suggestion errors for the editor / panel:
 *
 *   { id, from, to, original, suggestion, category, title, status, confidence }
 *
 * `category` holds the model's error-type label (one of: morphology,
 * word_level, zalantza, calque, spelling, punctuation, capitalization,
 * proper_noun). This replaces the old 3-bucket grammar/spelling/cappunct
 * scheme and the separate MarianMT / Hunspell / BERTeus / rule-engine
 * pipeline — all of those categories are now classified by the single
 * model's type head.
 *
 * Flow:
 *   1. stripMarkdown(md) → plain text + offset map
 *   2. correctGrammar(plain) → { corrected, wordTypes }
 *      wordTypes: per-original-word { start, end, type, pIncorrect }
 *      (types from iteration 0, aligned to original char offsets)
 *   3. diffWords(plain, corrected) → per-span changes
 *   4. for each change, look up the source word's type by offset overlap
 *   5. map offsets back to markdown, build context, dedupe overlaps
 *
 * The model runs on PLAIN TEXT (markdown stripped) because it was trained
 * on plain text. Error offsets are mapped back to raw-markdown positions
 * for the editor decorations.
 */

import { correctGrammar, detectGrammar, isGectorReady, isGectorFailed, initGector } from './gector.js';
import { diffWords } from './core/diff.js';

// ── Error-type → Basque card title ─────────────────────────────────
//
// The model's 8 non-`none` types, plus a fallback for corrections whose
// type the head classified as `none` (a type-head miss — the label head
// made a correction but the type head wasn't confident; default to the
// most common correction category).
const TYPE_TITLES = {
  morphology: 'Gramatika',
  word_level: 'Hitz okerra',
  zalantza: 'Zalantza-hitza',
  calque: 'Kalkoa',
  spelling: 'Ortografia',
  punctuation: 'Puntuazioa',
  capitalization: 'Maiuskula',
  proper_noun: 'Izen berezia',
  none: 'Gramatika',
};

// ── Markdown stripping with offset mapping ──────────────────────────
//
// Idaztian's getContent() returns raw markdown source. The model was
// trained on plain text, so we strip markdown syntax before passing text
// to it, then map the resulting error offsets back to markdown positions
// for the editor decorations.

/**
 * Strip markdown syntax markers from text, returning plain text + a
 * position map so error offsets can be translated back to markdown.
 *
 * Strips: headings, bold, italic, strikethrough, inline code, links,
 * images, blockquotes, list markers, horizontal rules, code fences.
 *
 * @param {string} md - Raw markdown source
 * @returns {{ text: string, map: number[] }}
 */
function stripMarkdown(md) {
  let plain = '';
  const map = [];
  let i = 0;
  let inCodeBlock = false;
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
      if (h) j += h[0].length;

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

    // ── ASCII double quotes — strip (the BPE tokenizer splits them into
    //    standalone tokens, which breaks the word-level LCS diff).
    if (md[i] === '"') {
      i++;
      continue;
    }

    // ── Regular character ──
    plain += md[i];
    map.push(i);
    i++;
  }

  return { text: plain, map };
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
 */
function buildContext(plainText, from) {
  const paraStart = plainText.lastIndexOf('\n', from - 1) + 1;
  const ctxStart = Math.max(paraStart, from - 28);
  let ctx = plainText.slice(ctxStart, from);
  if (ctxStart > paraStart) ctx = '\u2026' + ctx;
  return ctx.trimEnd();
}

let errCounter = 0;
const nextId = () => `e${++errCounter}`;

/**
 * Analyze the full text and return an array of typed error objects.
 *
 * Markdown syntax is stripped before passing to the model (it was
 * trained on plain text). Error offsets are mapped back to raw-markdown
 * positions so editor decorations land on the right characters.
 *
 * @param {string} mdText - raw markdown from the editor
 * @param {(p:{stage:string})=>void} [onProgress] - status callback
 * @param {(batch:Array)=>void} [onBatch] - incremental card stream
 * @returns {Promise<Array>}
 */
export async function analyzeText(mdText, onProgress, onBatch) {
  if (!mdText || !mdText.trim()) return [];

  const { text: plainText, map } = stripMarkdown(mdText);
  if (!plainText.trim()) return [];

  // ── Run the single GECToR v2-mt model ──
  // If the model isn't loaded yet (it loads in the background after
  // startup), skip this run instead of freezing the UI for 50–120s.
  // The background load continues; the next Aztertu click will have it.
  if (!isGectorReady()) {
    onProgress?.({ stage: 'loading' });
    if (!isGectorFailed()) initGector(); // idempotent — kicks off background load
    return [];
  }

  onProgress?.({ stage: 'analyzing' });

  let corrected, wordTypes;
  try {
    ({ corrected, wordTypes } = await correctGrammar(plainText));
  } catch (err) {
    console.warn('[analyze] GECToR correction failed:', err);
    return [];
  }

  // DEBUG: log what the model produced
  if (typeof window !== 'undefined' && window.__TXUKUN_DEBUG) {
    console.log('[analyze] corrected === plainText?', corrected === plainText);
    console.log('[analyze] plainText:', plainText.slice(0, 80));
    console.log('[analyze] corrected:', (corrected || '').slice(0, 80));
    console.log('[analyze] wordTypes:', wordTypes?.length, 'items');
  }

  if (!corrected || corrected === plainText) return [];

  // ── Diff original → corrected to extract per-span changes ──
  const changes = diffWords(plainText, corrected);

  // Yield so the progress indicator repaints before we build the batch.
  await new Promise((r) => setTimeout(r, 0));

  const errors = [];
  for (const ch of changes) {
    // replace: word(s) changed (the dominant case)
    // delete:  word removed (GECToR $DELETE)
    // insert:  word added (GECToR $APPEND) — zero-width span
    if (ch.type !== 'replace' && ch.type !== 'delete') continue;

    // Look up the source word's error type + detection confidence by
    // char-offset overlap with the per-word wordTypes array.
    const wt = findWordType(ch.fromOffset, ch.toOffset, wordTypes);

    // If the type head said 'none' but the label head made a correction,
    // default to 'morphology' (the most common correction category) so
    // the card gets a valid CSS class and a meaningful title.
    const category = wt.type === 'none' ? 'morphology' : wt.type;

    errors.push({
      id: nextId(),
      from: ch.fromOffset,
      to: ch.toOffset,
      original: ch.fromText,
      suggestion: ch.toText,
      category,
      title: TYPE_TITLES[category] || 'Gramatika',
      status: 'pending',
      confidence: wt.pIncorrect,
    });
  }

  if (errors.length === 0) return [];

  // Build context snippets (plain text, paragraph-bounded) BEFORE
  // mapping offsets to markdown — keeps context clean (no markers).
  for (const e of errors) e.context = buildContext(plainText, e.from);

  // Stream the batch to the UI immediately.
  const mapped = errors.map((e) => ({
    ...e,
    from: mapOffset(e.from, map, false),
    to: mapOffset(e.to, map, true),
  }));
  onBatch?.(mapped);

  // Sort by position; longer spans first when tied
  mapped.sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  // Remove overlaps (keep earliest, then longest)
  const final = dedupeOverlaps(mapped);
  return final;
}

/**
 * Find the wordType whose [start, end) span overlaps [from, to).
 * Falls back to the nearest preceding word, then a generic default.
 *
 * @param {number} from - change start offset (plain text)
 * @param {number} to - change end offset (plain text, exclusive)
 * @param {Array<{start,end,type,pIncorrect}>} wordTypes
 * @returns {{type:string, pIncorrect:number}}
 */
function findWordType(from, to, wordTypes) {
  if (!wordTypes || wordTypes.length === 0) {
    return { type: 'morphology', pIncorrect: 0 };
  }
  // Direct overlap
  for (const wt of wordTypes) {
    if (wt.start < to && from < wt.end) return wt;
  }
  // Nearest preceding word (the change likely attaches to it)
  for (let i = wordTypes.length - 1; i >= 0; i--) {
    if (wordTypes[i].end <= from) return wordTypes[i];
  }
  // Nearest following word
  return wordTypes[0];
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

// ── Detection-only heatmap ──────────────────────────────────────────
//
// Returns per-word P(INCORRECT) + error type, aligned to character
// positions in the original markdown. Used by the editor to highlight
// suspect words even before the user runs a full analysis.

export async function detectHeatmap(mdText) {
  try {
    if (!isGectorReady()) {
      if (!isGectorFailed()) initGector();
      return [];
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
