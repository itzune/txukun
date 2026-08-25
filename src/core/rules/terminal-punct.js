/**
 * Txukun rule — Amaierako puntuazioa (terminal punctuation)
 *
 * EBE Puntuazio-markak §1 (puntua '.'), §6 (galdera-marka '?' / harridura-marka '!').
 *
 * For each sentence, if it doesn't end with sentence-ending punctuation (. ? !),
 * add one:
 *   - Interrogative pronoun first (zer, non, nora…) → '?'
 *   - Exclamatory greeting first (kaixo, agur, egun on…) → '!'  (EBE §2.3, §1)
 *   - Otherwise (declarative) → '.'
 *
 * Targets F1 failure: c043 (model outputs "Non bizi zara" — no '?').
 * Targets F2 failure: c060 ("kaixo mikel" → "Kaixo, Mikel!").
 * Also helps c001, c024 (model returns input unchanged — no '.').
 *
 * @module txukun/core/rules/terminal-punct
 */

import { LintKind, lint, insertAfter, replaceWith } from '../types.js';
import { firstWord, lastNonWhitespace } from '../document.js';
import { EXCLAMATORY_GREETINGS, EXCLAMATORY_PHRASES } from './greetings.js';

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

      // Determine sentence type from first word(s)
      const word = firstWord(sentence);
      const lower = word ? word.text.toLowerCase() : '';
      const words = sentence.filter((t) => t.kind === 'word');

      const isQuestion = INTERROGATIVES.has(lower);

      // Exclamatory greeting check (EBE §2.3: "Kaixo, Mikel!" → '!').
      // Only exclamatory when the greeting is followed by ≤1 word (the vocative
      // name pattern: "Kaixo, Mikel!"). If 2+ words follow, the greeting is just
      // an opener for longer content → '.' (preserves c080: "Kaixo, egun on
      // guztioi."). Standalone greeting (0 words after) is also exclamatory.
      let isExclamatory = false;
      if (!isQuestion) {
        // Check multi-word exclamatory phrases first (more specific)
        let phraseLen = 0;
        for (const phrase of EXCLAMATORY_PHRASES) {
          const pw = phrase.split(' ');
          if (words.length < pw.length) continue;
          if (pw.every((w, i) => words[i].text.toLowerCase() === w)) {
            phraseLen = pw.length;
            break;
          }
        }
        if (phraseLen > 0) {
          if (words.length - phraseLen <= 1) isExclamatory = true;
        } else if (EXCLAMATORY_GREETINGS.has(lower)) {
          if (words.length - 1 <= 1) isExclamatory = true;
        }
      }

      const punct = isQuestion ? '?' : isExclamatory ? '!' : '.';

      // Already has the correct terminal punctuation? → skip
      if (last.kind === 'punctuation' && last.text === punct) continue;

      // Has wrong terminal punctuation? Replace '.' with '!' for exclamatory
      // greetings (c060: model outputs "Kaixo Mikel." → "Kaixo, Mikel!").
      // Note: '.' → '?' replacement is deferred (risk: embedded questions like
      // "Zer egin duen ez dakit." would be falsely question-marked).
      if (last.kind === 'punctuation' && /[.?!]/.test(last.text)) {
        if (last.text === '.' && punct === '!') {
          lints.push(lint({
            span: { start: last.start, end: last.end },
            kind: LintKind.Punctuation,
            suggestions: [replaceWith('!')],
            message: 'Agurrak harridura-marka behar du: !',
            priority: 40,
          }));
        }
        continue;
      }

      // No terminal punctuation → insert
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
