/**
 * Txukun rule — Esaldi-hasierako maiuskulak (sentence-initial capitalization)
 *
 * EBE Maiuskulak §1.1 (id=1023): idatzi-hasiera maiuskulaz jarri.
 *
 * For each sentence, if the first word starts with a lowercase letter,
 * uppercase it. Unlike English (Harper's SentenceCapitalization), Basque has
 * NO lowercase-proper-noun exceptions (no `npm`/`mRNA`-style words) —
 * sentence-initial is ALWAYS capitalized. So this rule needs no dictionary.
 *
 * Targets F1 failures: c001, c024 (model returns input unchanged).
 *
 * @module txukun/core/rules/sentence-initial-cap
 */

import { LintKind, lint, replaceWith } from '../types.js';
import { firstWord } from '../document.js';

export default {
  description: 'Esaldi-hasierako maiuskulak (EBE Maiuskulak §1.1)',

  lint(doc) {
    const lints = [];
    for (const sentence of doc.iterSentences()) {
      const word = firstWord(sentence);
      if (!word) continue;

      const ch = word.text[0];
      // Only uppercase lowercase letters (skip digits, symbols, already-capped)
      if (!/\p{Ll}/u.test(ch)) continue;

      const replacement = ch.toUpperCase() + word.text.slice(1);
      lints.push(lint({
        span: { start: word.start, end: word.end },
        kind: LintKind.Capitalization,
        suggestions: [replaceWith(replacement)],
        message: 'Esaldiak maiuskulaz hasi behar du',
        priority: 30,
      }));
    }
    return lints;
  },
};
