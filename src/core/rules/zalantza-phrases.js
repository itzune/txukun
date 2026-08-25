/**
 * Txukun rule — Zalantza esapideak (doubtful phrases)
 *
 * EBE *Zalantza eragiten duten zenbait hitz* (PDF pp. 479–490): multi-token
 * dispreferred forms (phrases with spaces and/or hyphens) mapped to their
 * standard (bold) forms.
 *
 * These cannot be matched by zalantza-words.js (the single-word rule) because
 * the tokenizer splits on \p{P}+ and \s+ — so 'aire-garraio' is three tokens
 * [aire, '-', garraio], never a single 'word' token. This rule tokenizes each
 * RED phrase, keeps the non-whitespace token sequence (words + punctuation),
 * and slides a window over the document's non-whitespace tokens.
 *
 *   'aire-garraio'    → 'aireko garraio'      (wpw: word-punct-word)
 *   'kontutan hartu'  → 'kontuan hartu'       (ww: word-word)
 *   'gora-behera'     → 'gorabehera'          (wpw, reclassified from single-word)
 *
 * Matching rules:
 *   - word tokens:     case-insensitive equality
 *   - punctuation:     exact text match (hyphen vs space matters — 'aire-garraio'
 *                      and 'aire garraio' are different REDs)
 *   - Case preservation: from the first word token via matchCase() (lower /
 *     Title / UPPER). Mixed-case first token → skip (proper-noun guard).
 *
 * Priority 46 (after single-word zalantza at 45): structural rules first, then
 * single-word substitution, then phrase substitution. Overlap safety verified:
 * the only sub-pattern overlap (gora-behera ⊂ gutxi gora-behera) converges to
 * the same output regardless of application order.
 *
 * See RESEARCH.md §7.12–§7.13. Data: src/core/data/zalantza-phrases.js.
 *
 * @module txukun/core/rules/zalantza-phrases
 */

import { LintKind, lint, replaceWith } from '../types.js';
import { tokenize } from '../document.js';
import { matchCase } from './zalantza-words.js';
import { ZALANTZA_PHRASES } from '../data/zalantza-phrases.js';

// Pre-compute each pattern's token sequence once (module load).
// seq = [{text: lowercase, kind}] for non-whitespace tokens.
const patterns = ZALANTZA_PHRASES.map(({ red, bold }) => ({
  red,
  bold,
  seq: tokenize(red)
    .filter((t) => t.kind !== 'whitespace')
    .map((t) => ({ text: t.text.toLowerCase(), kind: t.kind })),
}));

export default {
  description: 'Zalantza esapideak: hitz-anitzeko ordezkapenak (EBE Zalantza)',

  lint(doc) {
    const lints = [];

    // Document tokens, whitespace filtered out (keep words + punctuation),
    // preserving original spans for lint spans.
    const docNonWs = doc.tokens.filter((t) => t.kind !== 'whitespace');
    const n = docNonWs.length;

    for (const pat of patterns) {
      const plen = pat.seq.length;
      if (plen === 0 || plen > n) continue;

      // Slide a window of length plen over docNonWs.
      for (let i = 0; i + plen <= n; i++) {
        let ok = true;
        for (let j = 0; j < plen; j++) {
          const dt = docNonWs[i + j];
          const pt = pat.seq[j];
          if (dt.kind !== pt.kind) { ok = false; break; }
          if (pt.kind === 'word') {
            if (dt.text.toLowerCase() !== pt.text) { ok = false; break; }
          } else {
            // punctuation: exact match (hyphen vs em-dash etc. differ)
            if (dt.text !== pt.text) { ok = false; break; }
          }
        }
        if (!ok) continue;

        // Match found. Span = first token start → last token end (includes any
        // internal whitespace/punctuation between them).
        const firstTok = docNonWs[i];
        const lastTok = docNonWs[i + plen - 1];
        const span = { start: firstTok.start, end: lastTok.end };

        // Case preservation from the first WORD token in the window.
        let firstWord = null;
        for (let j = 0; j < plen; j++) {
          if (docNonWs[i + j].kind === 'word') { firstWord = docNonWs[i + j]; break; }
        }
        const replacement = firstWord ? matchCase(firstWord.text, pat.bold) : pat.bold;
        if (replacement === null) continue; // mixed-case first token → skip (proper noun)

        // Idempotency: the match guarantees the RED form is present, so the span
        // content is the (cased) RED, not the target. But guard against the edge
        // case where replacement equals the current content (no-op).
        const current = doc.text.slice(span.start, span.end);
        if (current === replacement) continue;

        lints.push(lint({
          span,
          kind: LintKind.Confusable,
          suggestions: [replaceWith(replacement)],
          message: `«${current}» zalantza-esapidea — erabili «${replacement}» (EBE)`,
          priority: 46,
        }));
      }
    }
    return lints;
  },
};
