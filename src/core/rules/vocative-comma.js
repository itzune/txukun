/**
 * Txukun rule — Bokatiboaren koma (vocative/greeting comma)
 *
 * EBE koma §3: bokatiboa → koma. After a greeting interjection (kaixo, agur,
 * gabon) followed by more content, insert a comma to separate the greeting
 * from the addressed phrase.
 *
 *   "kaixo mikel"     → "Kaixo, Mikel"     (comma after greeting)
 *   "kaixo egun on…"  → "Kaixo, egun on…"  (comma after greeting)
 *
 * Only handles single-word greetings in batch 1. Multi-word greetings
 * ("eskerrik asko", "egun on", "arratsalde on") are deferred — they need
 * phrase matching and none are strict:true cases.
 *
 * Targets F2 (c060, c061 — strict:false) and F3/c080 (strict:true).
 *
 * @module txukun/core/rules/vocative-comma
 */

import { LintKind, lint, insertAfter } from '../types.js';

// Single-word greeting interjections (EBE koma §3: bokatiboa)
const GREETINGS = new Set([
  'kaixo',   // hi/hello
  'agur',    // goodbye
  'gabon',   // good night
]);

export default {
  description: 'Bokatiboa: agurraren ondoren koma (EBE koma §3)',

  lint(doc) {
    const lints = [];
    for (const sentence of doc.iterSentences()) {
      // Find first word; check if it's a greeting
      let greetingIdx = -1;
      for (let i = 0; i < sentence.length; i++) {
        if (sentence[i].kind === 'word') {
          if (GREETINGS.has(sentence[i].text.toLowerCase())) {
            greetingIdx = i;
          }
          break; // only check the first word
        }
      }
      if (greetingIdx < 0) continue;

      const greeting = sentence[greetingIdx];

      // Find the next non-whitespace token after the greeting
      let next = null;
      for (let i = greetingIdx + 1; i < sentence.length; i++) {
        if (sentence[i].kind !== 'whitespace') {
          next = sentence[i];
          break;
        }
      }
      if (!next) continue; // greeting is the only content — no comma needed

      // Only insert comma when a word follows (the greeting + vocative pattern).
      // If only punctuation follows, the greeting is standalone (e.g. "Kaixo.").
      if (next.kind !== 'word') continue;

      lints.push(lint({
        span: { start: greeting.start, end: greeting.end },
        kind: LintKind.Punctuation,
        suggestions: [insertAfter(',')],
        message: 'Agurraren ondoren koma behar da (bokatiboa)',
        priority: 35,
      }));
    }
    return lints;
  },
};
