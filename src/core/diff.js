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

/**
 * Word-level LCS diff. Returns an edit script mapping original offsets to
 * corrected text spans.
 * @param {string} originalText
 * @param {string} correctedText
 * @returns {Array<{type:string, fromText:string, toText:string, fromOffset:number, toOffset:number}>}
 */
export function diffWords(originalText, correctedText) {
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

/**
 * True if `a` and `b` differ only in case and/or punctuation (same letters).
 * Used to gate cap-punct diffs: a change like "mikel" → "Mikel!" passes,
 * but a word substitution like "etorri" → "joan" is rejected (not cap-punct).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isCasePunctOnly(a, b) {
  if (a === b) return false;
  const strip = (s) => s.replace(/[^\p{L}]/gu, '').toLowerCase();
  return strip(a) === strip(b) && strip(a).length > 0;
}
