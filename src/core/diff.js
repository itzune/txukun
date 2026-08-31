/**
 * Txukun — Word-level LCS diff (pure, no dependencies)
 *
 * Tokenizes two texts into words (whitespace preserved as separate tokens),
 * runs a case-insensitive LCS alignment, and emits per-span changes:
 *   { type: 'replace'|'insert'|'delete', fromText, toText, fromOffset, toOffset }
 *
 * Matches carry the ORIGINAL character offsets so suggestions map back to the
 * source text. Case-only differences on matching words (e.g. "nire" → "Nire")
 * are emitted as 'replace' so capitalization fixes are not silently dropped.
 *
 * Extracted from `src/analyze.js` (P1) so the diff pipeline is unit-testable in
 * Node without importing browser-only model deps.
 *
 * @module txukun/core/diff
 */

/**
 * Tokenize text into whitespace/non-whitespace runs, preserving offsets.
 * @param {string} text
 * @returns {Array<{text:string, from:number, to:number}>}
 */
export function tokenizeWithOffsets(text) {
  const tokens = [];
  const re = /(\s+|\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ text: m[0], from: m.index, to: m.index + m[0].length });
  }
  return tokens;
}

// Punctuation chars that the GECToR model tokenizer splits from words.
// MUST match PUNCT_RE in gector.js so the diff tokenizes the same way.
const PUNCT_RE = /([.,;:!?()«»"'\u2013\u2014])/g;

/**
 * Further split each non-whitespace token by punctuation, preserving
 * char offsets. This mirrors the model's tokenizeWords() so that
 * "«mugatua»" is split into [«, mugatua, »] in BOTH the original and
 * corrected texts — preventing spurious diffs when detokenization
 * introduces spacing differences around punctuation.
 */
function splitPunct(tokens) {
  const out = [];
  for (const tok of tokens) {
    if (!/\S/.test(tok.text)) {
      out.push(tok); // whitespace token — keep as-is
      continue;
    }
    const chunk = tok.text;
    const base = tok.from;
    let last = 0;
    let m;
    PUNCT_RE.lastIndex = 0;
    while ((m = PUNCT_RE.exec(chunk)) !== null) {
      if (m.index > last) {
        out.push({ text: chunk.slice(last, m.index), from: base + last, to: base + m.index });
      }
      out.push({ text: m[0], from: base + m.index, to: base + m.index + 1 });
      last = m.index + 1;
    }
    if (last < chunk.length) {
      out.push({ text: chunk.slice(last), from: base + last, to: base + chunk.length });
    }
  }
  return out;
}

/**
 * Word-level LCS diff. Returns an edit script mapping original offsets to
 * corrected text spans.
 * @param {string} originalText
 * @param {string} correctedText
 * @returns {Array<{type:string, fromText:string, toText:string, fromOffset:number, toOffset:number}>}
 */
export function diffWords(originalText, correctedText) {
  // Split punctuation from words (matching the model's tokenization) so
  // that «mugatua» becomes [«, mugatua, »] in both texts. Without this,
  // detokenization spacing differences around punctuation cause spurious
  // diffs (e.g. «mugatua vs « + mugatua).
  const a = splitPunct(tokenizeWithOffsets(originalText));
  const b = splitPunct(tokenizeWithOffsets(correctedText));
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
