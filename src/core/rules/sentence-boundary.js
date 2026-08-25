/**
 * Txukun rule — Esaldi-muga: AUX + TEMPORAL adberbioa (sentence splitting)
 *
 * F4 fix. In unpunctuated ASR text, the model often fails to split distinct
 * sentences (c070: "kaixo ni miren naiz atzo etorri nintzen" → one flat
 * sentence). This rule detects a strong sentence-boundary signal and inserts
 * a period, letting the iterative engine cascade (split → cap → comma → punct).
 *
 * Signal (verified against EBE + UD, see RESEARCH.md §7.9):
 *   A bare finite AUXILIARY (izan/edun/egon) immediately followed by a
 *   TEMPORAL adverb, where a SECOND finite auxiliary appears later in the
 *   same sentence.
 *
 *     "kaixo ni miren [naiz]AUX1 [atzo]TEMP [etorri [nintzen]AUX2"
 *                                      ^ insert "." here (after AUX1)
 *
 * Why the "second auxiliary" guard is essential:
 *   Basque allows post-positioned temporals: "etorri naiz gaur" (I came today)
 *   is ONE sentence. Here naiz(AUX1) + gaur(TEMP) but NO second auxiliary →
 *   the guard prevents a false split.
 *
 * Why only BARE auxiliaries:
 *   Subordinate clauses suffix the auxiliary (-la, -ela, -lako, -arren):
 *   "...dela", "...delako", "...naizela". These are NOT in the bare-form set,
 *   so exact-token match excludes them. Only main-clause auxiliaries trigger.
 *
 * Why not split asyndetic coordination (c071):
 *   "etorri da joan da berriro etorriko da" has da(AUX1) + joan(NOT temporal).
 *   Condition 2 fails → no split. EBE puntuazioa §1 explicitly classifies
 *   "Etorri da, jan du, joan da." as ONE sentence (alborakuntza / asyndetic
 *   coordination) — so NOT splitting is correct.
 *
 * Limitations (batch 1, strict:false cases):
 *   - Doesn't handle synthetic lexical verbs (joan/etorri/ibili finite forms)
 *   - Rare word orders (multiple temporals) may mis-split
 *   - These are acceptable for strict:false ASR-style input
 *
 * @module txukun/core/rules/sentence-boundary
 */

import { LintKind, lint, insertAfter } from '../types.js';

// Bare finite auxiliary forms (izan + edun + egon, present + past, all persons).
// Source: Euskaltzaindia grammar + Buber's Basque Page paradigm (verified
// 2026-08-25, see RESEARCH.md §7.9). Exact-token match excludes suffixed
// subordinate forms (dela, delako, naizela, …).
const FINITE_AUX = new Set([
  // izan (to be) — present
  'naiz', 'haiz', 'da', 'gara', 'zara', 'zarete', 'dira',
  // izan — past
  'nintzen', 'hintzen', 'zen', 'ginen', 'zinen', 'zineten', 'ziren',
  // edun (to have, transitive) — present, singular object
  'dut', 'duk', 'dun', 'du', 'dugu', 'duzu', 'duzue', 'dute',
  // edun — present, plural object
  'ditut', 'dituk', 'ditun', 'ditu', 'ditugu', 'dituzu', 'dituzue', 'dituzte',
  // edun — past, singular object
  'nuen', 'huen', 'zuen', 'genuen', 'zenuen', 'zenuten', 'zuten',
  // edun — past, plural object
  'nituen', 'hituen', 'zituen', 'genituen', 'zenituen', 'zenituzten', 'zituzten',
  // egon (to stay/be located) — present
  'nago', 'zaude', 'haude', 'dago', 'gaude', 'zaudezte', 'daude',
  // egon — past
  'nengoen', 'zegoen', 'gegoen', 'zegoeten', 'zegozten',
]);

// Temporal adverbs that commonly begin a new clause/sentence (often with a
// tense shift). Conservative set — excludes ambiguous forms (berandu=late adj,
// lehen=first adj handled by the second-AUX guard regardless).
const TEMPORAL = new Set([
  'atzo',     // yesterday (past)
  'gaur',     // today (present)
  'bihar',    // tomorrow (future)
  'orain',    // now
  'orduan',   // then (past)
  'gero',     // later / then
  'lehen',    // before / formerly (past)
  'azkenik',  // finally
  'laster',   // soon (future)
  'inoiz',    // ever / at any time
  'beti',     // always
]);

/** Next non-whitespace token at or after index i in a token slice. */
function nextContent(tokens, i) {
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].kind !== 'whitespace') return tokens[j];
  }
  return null;
}

export default {
  description: 'Esaldi-muga: AUX + temporal-adberbioa → puntua (F4)',

  lint(doc) {
    const lints = [];
    for (const sentence of doc.iterSentences()) {
      const words = sentence.filter((t) => t.kind === 'word');
      // Need ≥ 2 finite auxiliaries for the second-AUX guard.
      let split = null;
      for (let i = 0; i < words.length; i++) {
        const tok = words[i];
        if (!FINITE_AUX.has(tok.text.toLowerCase())) continue;

        const next = nextContent(sentence, sentence.indexOf(tok));
        if (!next || next.kind !== 'word') continue;
        if (!TEMPORAL.has(next.text.toLowerCase())) continue;

        // Second-AUX guard: is there another finite auxiliary AFTER the temporal?
        const hasLaterAux = words
          .slice(i + 2)
          .some((w) => FINITE_AUX.has(w.text.toLowerCase()));
        if (!hasLaterAux) continue;

        // Boundary found: insert "." after the auxiliary.
        split = lint({
          span: { start: tok.start, end: tok.end },
          kind: LintKind.Punctuation,
          suggestions: [insertAfter('.')],
          message: 'Esaldi-muga: aditz laguntzailea + temporal adberbioa → puntua',
          priority: 20,
        });
        break; // one split per sentence per pass; engine re-lints after
      }
      if (split) lints.push(split);
    }
    return lints;
  },
};
