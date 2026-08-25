/**
 * Txukun rule — Zalantza proper nouns (izendunak)
 *
 * EBE Zalantza appendix: proper-noun spelling corrections. These are exonyms
 * and proper nouns whose non-standard spelling causes doubt. The standard form
 * is ALWAYS capitalized (proper noun convention).
 *
 * This rule handles both single-word and phrase proper nouns in one module:
 *   Phase 1 (priority 49): per-token word lookup — same algorithm as
 *     zalantza-words, but against PROPER_WORDS and with `matchCaseProper()`.
 *   Phase 2 (priority 50): sliding-window token-sequence match — same
 *     algorithm as zalantza-phrases, but against PROPER_PHRASES.
 *
 * KEY DIFFERENCE from zalantza-words: `matchCaseProper()` always returns a
 * capitalized target (proper nouns are always capitalized), even when the
 * input is lowercase. In contrast, `matchCase()` returns lowercase targets
 * for lowercase input (common nouns).
 *
 * Priority 49/50 (after zalantza 45/46 and calque 47/48): structural rules
 * first, then common-noun zalantza, then calque, then proper-noun zalantza.
 * No overlap with zalantza.js, zalantza-phrases.js, or calque.js (verified
 * — see /tmp/validate_proper.mjs, all 24 checks passed).
 *
 * @module txukun/core/rules/zalantza-proper
 */

import { LintKind, lint, replaceWith } from '../types.js';
import { tokenize } from '../document.js';
import { PROPER_WORDS, PROPER_PHRASES } from '../data/zalantza-proper.js';

/**
 * Case-matching for PROPER NOUNS.
 *
 * Unlike `matchCase()` (from zalantza-words.js), this ALWAYS returns a
 * capitalized target — proper nouns are always capitalized regardless of
 * the input's case:
 *   - ALL-CAPS input (len > 1) → ALL-CAPS target
 *   - lowercase input          → target as-is (already pre-capitalized in data)
 *   - Title-case input         → target as-is (already pre-capitalized in data)
 *   - mixed-case input         → null (skip — probably intentional)
 *
 * The target string stored in the data file already has the correct internal
 * capitalization (e.g., "Erdialdeko Amerika", "Donibane Lohizune"). We return
 * it unchanged for lowercase/Title inputs, and toUpperCase() for ALL-CAPS.
 *
 * @param {string} source  — the matched token's text (input case)
 * @param {string} target  — the pre-capitalized target string (from data)
 * @returns {string|null}  — the correctly-cased target, or null to skip
 */
export function matchCaseProper(source, target) {
  // ALL-CAPS input (length > 1) → ALL-CAPS target
  if (source === source.toUpperCase() && source.length > 1) {
    return target.toUpperCase();
  }
  // All-lowercase input → target as-is (proper nouns always capitalized)
  if (source === source.toLowerCase() && source.length > 0) {
    return target;
  }
  // Title case (first upper, rest lower) → target as-is
  if (
    source.length > 0 &&
    source[0] === source[0].toUpperCase() &&
    source.slice(1) === source.slice(1).toLowerCase()
  ) {
    return target;
  }
  return null; // mixed case → skip
}

// Pre-compute phrase patterns once at module load (same as zalantza-phrases).
const phrasePatterns = PROPER_PHRASES.map(({ red, bold }) => ({
  red,
  bold,
  seq: tokenize(red)
    .filter((t) => t.kind !== 'whitespace')
    .map((t) => ({ text: t.text.toLowerCase(), kind: t.kind })),
}));

export default {
  description: 'Zalantza izendunak: exonoimoak eta izen bereziak (EBE Zalantza)',

  lint(doc) {
    const lints = [];

    // ── Phase 1: single-word proper nouns ─────────────
    for (const tok of doc.tokens) {
      if (tok.kind !== 'word') continue;
      const lower = tok.text.toLowerCase();
      const target = PROPER_WORDS[lower];
      if (!target) continue;

      const replacement = matchCaseProper(tok.text, target);
      if (replacement === null) continue; // mixed-case, skip
      if (replacement === tok.text) continue; // no-op (already correct)

      lints.push(lint({
        span: { start: tok.start, end: tok.end },
        kind: LintKind.Confusable,
        suggestions: [replaceWith(replacement)],
        message: `«${tok.text}» izen berezia — erabili «${target}» (EBE)`,
        priority: 49,
      }));
    }

    // ── Phase 2: phrase proper nouns ──────────────────
    const docNonWs = doc.tokens.filter((t) => t.kind !== 'whitespace');
    const n = docNonWs.length;

    for (const pat of phrasePatterns) {
      const plen = pat.seq.length;
      if (plen === 0 || plen > n) continue;

      for (let i = 0; i + plen <= n; i++) {
        let ok = true;
        for (let j = 0; j < plen; j++) {
          const dt = docNonWs[i + j];
          const pt = pat.seq[j];
          if (dt.kind !== pt.kind) { ok = false; break; }
          if (pt.kind === 'word') {
            if (dt.text.toLowerCase() !== pt.text) { ok = false; break; }
          } else {
            if (dt.text !== pt.text) { ok = false; break; }
          }
        }
        if (!ok) continue;

        const firstTok = docNonWs[i];
        const lastTok = docNonWs[i + plen - 1];
        const span = { start: firstTok.start, end: lastTok.end };

        // Case preservation from the first WORD token in the window.
        let firstWord = null;
        for (let j = 0; j < plen; j++) {
          if (docNonWs[i + j].kind === 'word') { firstWord = docNonWs[i + j]; break; }
        }
        const replacement = firstWord ? matchCaseProper(firstWord.text, pat.bold) : pat.bold;
        if (replacement === null) continue; // mixed-case first token → skip

        const current = doc.text.slice(span.start, span.end);
        if (current === replacement) continue; // idempotency guard

        lints.push(lint({
          span,
          kind: LintKind.Confusable,
          suggestions: [replaceWith(replacement)],
          message: `«${current}» izen berezia — erabili «${pat.bold}» (EBE)`,
          priority: 50,
        }));
      }
    }

    return lints;
  },
};
