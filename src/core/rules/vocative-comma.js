/**
 * Txukun rule — Bokatiboaren koma (vocative/greeting comma)
 *
 * EBE koma §3: bokatiboa → koma. After a greeting interjection (kaixo, agur,
 * gabon) or greeting phrase (eskerrik asko, egun on, arratsalde on) followed
 * by more content, insert a comma to separate the greeting from the
 * addressed phrase.
 *
 *   "kaixo mikel"          → "Kaixo, Mikel"          (single-word greeting)
 *   "eskerrik asko miren"  → "Eskerrik asko, Miren"  (multi-word phrase)
 *   "egun on mikel"        → "Egun on, Mikel"        (multi-word phrase)
 *
 * Handles both single-word greetings and multi-word greeting phrases.
 * Phrase data is shared with terminal-punct via greetings.js.
 *
 * Targets F2 (c060, c061 — strict:false) and F3/c080 (strict:true).
 *
 * @module txukun/core/rules/vocative-comma
 */

import { LintKind, lint, insertAfter } from '../types.js';
import { EXCLAMATORY_GREETINGS, ALL_GREETING_PHRASES } from './greetings.js';

export default {
  description: 'Bokatiboa: agurraren ondoren koma (EBE koma §3)',

  lint(doc) {
    const lints = [];
    for (const sentence of doc.iterSentences()) {
      const words = sentence.filter((t) => t.kind === 'word');
      if (words.length === 0) continue;

      const first = words[0];
      let commaAfter = null; // token after which to insert the comma

      // 1) Single-word greeting (kaixo, agur, gabon)
      if (EXCLAMATORY_GREETINGS.has(first.text.toLowerCase())) {
        // Need at least one more word after the greeting for the vocative pattern
        if (words.length >= 2) {
          commaAfter = first;
        }
      }

      // 2) Multi-word greeting phrase (eskerrik asko, egun on, …)
      if (!commaAfter) {
        for (const phrase of ALL_GREETING_PHRASES) {
          const pw = phrase.split(' ');
          if (words.length < pw.length + 1) continue; // phrase + ≥1 more word
          const matches = pw.every((w, i) => words[i].text.toLowerCase() === w);
          if (matches) {
            commaAfter = words[pw.length - 1]; // last word of the phrase
            break;
          }
        }
      }

      if (!commaAfter) continue;

      // Idempotency: skip if a comma already follows the greeting/phrase
      const afterIdx = sentence.indexOf(commaAfter);
      let nextRaw = null;
      for (let i = afterIdx + 1; i < sentence.length; i++) {
        if (sentence[i].kind !== 'whitespace') {
          nextRaw = sentence[i];
          break;
        }
      }
      if (nextRaw && nextRaw.kind === 'punctuation' && nextRaw.text === ',') continue;

      lints.push(lint({
        span: { start: commaAfter.start, end: commaAfter.end },
        kind: LintKind.Punctuation,
        suggestions: [insertAfter(',')],
        message: 'Agurraren ondoren koma behar da (bokatiboa)',
        priority: 35,
      }));
    }
    return lints;
  },
};
