/**
 * Txukun rule — Amaierako puntuazioa (terminal punctuation)
 *
 * EBE Puntuazio-markak §1 (puntua '.') and §6 (galdera-marka '?').
 *
 * For each sentence, if it doesn't end with sentence-ending punctuation (. ? !),
 * add one:
 *   - If the first word is an interrogative pronoun (zer, non, nora, noiz,
 *     nola, zergatik, zein, zenbat, nor…) → add '?'
 *   - Otherwise (declarative) → add '.'
 *
 * Targets F1 failure: c043 (model outputs "Non bizi zara" — no '?').
 * Also helps c001, c024 (model returns input unchanged — no '.').
 *
 * @module txukun/core/rules/terminal-punct
 */

import { LintKind, lint, insertAfter } from '../types.js';
import { firstWord, lastNonWhitespace } from '../document.js';

// Basque interrogative pronouns (sentence-initial → question).
// Source: standard Basque grammar + EBE Puntuazio-markak §6.
const INTERROGATIVES = new Set([
  'nor', 'nori', 'norekin', 'norena',      // who
  'zer', 'zertarako',                        // what
  'non', 'nongo', 'nondik', 'nora',          // where
  'noiz', 'noiztik',                          // when
  'nola',                                     // how
  'zergatik',                                 // why
  'zein', 'zeinetan',                         // which
  'zenbat', 'zenbatean',                      // how much/many
]);

export default {
  description: 'Amaierako puntuazioa: deklariboa→., galdera→? (EBE §1, §6)',

  lint(doc) {
    const lints = [];
    for (const sentence of doc.iterSentences()) {
      const last = lastNonWhitespace(sentence);
      if (!last) continue;

      // Already has terminal sentence-ending punctuation?
      if (last.kind === 'punctuation' && /[.?!]/.test(last.text)) continue;

      // Determine sentence type from first word
      const word = firstWord(sentence);
      const isQuestion = word && INTERROGATIVES.has(word.text.toLowerCase());
      const punct = isQuestion ? '?' : '.';

      lints.push(lint({
        span: { start: last.start, end: last.end },
        kind: LintKind.Punctuation,
        suggestions: [insertAfter(punct)],
        message: `Esaldiak amaierako puntuazioa behar du: ${punct}`,
        priority: 40,
      }));
    }
    return lints;
  },
};
