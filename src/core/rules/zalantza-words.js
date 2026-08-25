/**
 * Txukun rule — Zalantza-hitzak (doubtful words)
 *
 * EBE *Zalantza eragiten duten zenbait hitz* (PDF pp. 479–490): words the
 * Euskaltzaindiaren Hiztegia explicitly recommends AGAINST (marked red in the
 * source), mapped to their standard (bold) forms.
 *
 * This is a deterministic, word-level substitution: if a token's lowercase
 * form is in the ZALANTZA map, suggest replacing it with the standard form,
 * preserving the source token's case pattern (lower / Title / UPPER). Mixed-case
 * tokens (likely proper nouns) are skipped to avoid false positives.
 *
 * These are general-purpose writer errors (Spanish/French loanwords, dialectal
 * forms, apocopes), NOT ASR artifacts — they apply to any Basque text a
 * bilingual speaker writes. See RESEARCH.md §7.11–§7.12.
 *
 * Priority 45 (last): structural rules (sentence split → caps → commas → punct)
 * get pass-budget priority; word substitution is independent of structure.
 *
 * @module txukun/core/rules/zalantza-words
 */

import { LintKind, lint, replaceWith } from '../types.js';
import { ZALANTZA } from '../data/zalantza.js';

/**
 * Apply the source token's case pattern to the target word.
 *   all-lower  → all-lower target
 *   Title-case → Title-case target (first letter upper, rest lower)
 *   all-UPPER  → UPPER target
 *   mixed      → null (skip; likely a proper noun)
 */
function matchCase(source, target) {
  if (source === source.toLowerCase() && source.length > 0) {
    return target.toLowerCase();
  }
  if (source === source.toUpperCase() && source.length > 1) {
    return target.toUpperCase();
  }
  // Title case: first char upper, rest lower (and source isn't all-caps)
  if (
    source.length > 0 &&
    source[0] === source[0].toUpperCase() &&
    source.slice(1) === source.slice(1).toLowerCase()
  ) {
    return target[0].toUpperCase() + target.slice(1).toLowerCase();
  }
  return null; // mixed case → skip
}

export default {
  description: 'Zalantza-hitzak: erderakako maileguak eta aldaerak (EBE Zalantza)',

  lint(doc) {
    const lints = [];
    for (const tok of doc.tokens) {
      if (tok.kind !== 'word') continue;
      const lower = tok.text.toLowerCase();
      const target = ZALANTZA[lower];
      if (!target) continue;

      const replacement = matchCase(tok.text, target);
      if (replacement === null) continue; // mixed-case, skip
      if (replacement === tok.text) continue; // no change (shouldn't happen)

      lints.push(lint({
        span: { start: tok.start, end: tok.end },
        kind: LintKind.Confusable,
        suggestions: [replaceWith(replacement)],
        message: `«${tok.text}» zalantza-hitza — erabili «${replacement}» (EBE)`,
        priority: 45,
      }));
    }
    return lints;
  },
};
