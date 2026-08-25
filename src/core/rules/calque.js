/**
 * Txukun rule — Kalko lexiko-semantikoak (lexical-semantic calques)
 *
 * EBE *Kalko desegoki nabarmen batzuk* §1 (ebe-kal.txt): loan-translations
 * where a Spanish/French word or phrase is calqued into Basque instead of
 * using the native term. Linguistically distinct from zalantzak (which are
 * doubtful word CHOICES between two valid words).
 *
 * This rule handles both single-word and phrase calques in one module:
 *   Phase 1 (priority 47): per-token word lookup — same algorithm as
 *     zalantza-words, but against CALQUE_WORDS and with LintKind.Calque.
 *   Phase 2 (priority 48): sliding-window token-sequence match — same
 *     algorithm as zalantza-phrases, but against CALQUE_PHRASES.
 *
 * Only 2 single-word + 2 phrase entries are calque-specific. The other 4
 * clean §1 pairs (belgiar, europear, egipziar, erabakior) are already in
 * zalantza.js (they appear in both EBE sections) and are caught by the
 * zalantza rule (priority 45) before this rule runs.
 *
 * Priority 47/48 (after zalantza at 45/46): structural rules first, then
 * zalantza substitution, then calque substitution. Calque words don't
 * overlap with zalantza words (verified — see /tmp/validate_calques.mjs).
 *
 * @module txukun/core/rules/calque
 */

import { LintKind, lint, replaceWith } from '../types.js';
import { tokenize } from '../document.js';
import { matchCase } from './zalantza-words.js';
import { CALQUE_WORDS, CALQUE_PHRASES } from '../data/calque.js';

// Pre-compute phrase patterns once at module load (same as zalantza-phrases).
const phrasePatterns = CALQUE_PHRASES.map(({ red, bold }) => ({
  red,
  bold,
  seq: tokenize(red)
    .filter((t) => t.kind !== 'whitespace')
    .map((t) => ({ text: t.text.toLowerCase(), kind: t.kind })),
}));

export default {
  description: 'Kalko lexiko-semantikoak: erderaren itzulpen-okerrak (EBE §1)',

  lint(doc) {
    const lints = [];

    // ── Phase 1: single-word calques ──────────────────
    for (const tok of doc.tokens) {
      if (tok.kind !== 'word') continue;
      const lower = tok.text.toLowerCase();
      const target = CALQUE_WORDS[lower];
      if (!target) continue;

      const replacement = matchCase(tok.text, target);
      if (replacement === null) continue; // mixed-case, skip
      if (replacement === tok.text) continue; // no-op

      lints.push(lint({
        span: { start: tok.start, end: tok.end },
        kind: LintKind.Calque,
        suggestions: [replaceWith(replacement)],
        message: `«${tok.text}» kalkoa — erabili «${replacement}» (EBE)`,
        priority: 47,
      }));
    }

    // ── Phase 2: phrase calques ───────────────────────
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
        const replacement = firstWord ? matchCase(firstWord.text, pat.bold) : pat.bold;
        if (replacement === null) continue; // mixed-case first token → skip

        const current = doc.text.slice(span.start, span.end);
        if (current === replacement) continue; // idempotency guard

        lints.push(lint({
          span,
          kind: LintKind.Calque,
          suggestions: [replaceWith(replacement)],
          message: `«${current}» kalkoa — erabili «${replacement}» (EBE)`,
          priority: 48,
        }));
      }
    }

    return lints;
  },
};
