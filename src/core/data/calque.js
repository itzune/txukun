/**
 * Txukun — Kalko lexiko-semantikoak data (EBE *Kalko desegoki nabarmen batzuk* §1)
 *
 * Lexical-semantic calques from Euskaltzaindia's EBE appendix (ebe-kal.txt §1,
 * PDF pp. 49–51): loan-translations where a Spanish/French word or phrase is
 * calqued into Basque instead of using the native term.
 *
 * Linguistically distinct from zalantzak (ebe-zal.txt):
 *   - Zalantzak = doubtful word CHOICE (two valid words, one preferred)
 *   - Kalkoak = loan-TRANSLATION (foreign pattern copied, native term exists)
 *
 * EBE §1 contains 34 entries; only 8 are clean word/phrase substitutions.
 * Of those 8, 4 (belgiar, europear, egipziar, erabakior) are already in
 * zalantza.js (listed in both EBE sections) — not duplicated here.
 * This file: 2 single-word + 2 phrase calques (4 net new pairs).
 * The remaining 26 are deferred:
 *   - 9 sentence-level rewrites (need grammar/POS)
 *   - 6 context-dependent (proba/froga, gizona/gizakia, udal/udaletxe)
 *   - 5 multi-target (2+ correct forms)
 *   - 3 morphological (berdina→bera declension, jolastu→jokatu conjugation)
 *   - 1 proper noun (Errege Katolikoak → Errege-erregina Katolikoak → F5)
 *   - 1 questionable (?eskaini) + 1 usage note (ospatu)
 *
 * Verification (Euskaltzaindiaren Hiztegia, 2026-01):
 *   - europear: 0 EH results (not in dictionary) — clearly non-standard
 *   - belgiar: marked '* e.' (not-recommended foreignism) in older dict
 *   - egipziar: same demonym pattern as belgiar/europear
 *   - balore: 3 EH results, all cross-reference to balio (softer, no *)
 *   - erabakior: EH cross-references to erabakigarri (not a headword)
 *   - erasokor: only in OEH (historical dict), not EH proper
 *   - pena merezi: * in EBE; 'pena' alone is valid (pain/pity) — phrase only
 *   - zentzu bakarreko: * in EBE; 'zentzu' alone is valid (sense) — phrase only
 *
 * Source: https://www.euskaltzaindia.eus/components/com_ebe/pdf/EBE-eranskinak.pdf
 *
 * @module txukun/core/data/calque
 */

// ── Single-word calques (6) ─────────────────────────
// Matchable by per-token lookup (single 'word' token, no spaces/hyphens).
// Keys are lowercase. Case preserved via matchCase() (lower/Title/UPPER).

export const CALQUE_WORDS = Object.freeze({
  // NOTE: belgiar→belgikar, europear→europar, egipziar→egiptoar, erabakior→
  // erabakigarri also appear in EBE §1, but are ALREADY in zalantza.js (they're
  // listed in both EBE sections). Not duplicated here — zalantza rule (priority
  // 45) catches them first. Verified: identical targets in both sources.

  // balore: calque of Sp 'valor'/Fr 'valeur' → balio (EH cross-refs to balio)
  'balore': 'balio',

  // erasokor: -kor suffix where -tzaile is standard → erasotzaile (OEH only)
  'erasokor': 'erasotzaile',
});

// ── Phrase calques (2) ──────────────────────────────
// Multi-token REDs matched by sliding-window token-sequence matcher.
// These are phrases where individual words are valid alone — only the
// combination is a calque (so single-word rule must NOT flag the parts).

export const CALQUE_PHRASES = Object.freeze([
  // Calque of Sp 'merecer la pena'. 'pena' alone = valid (pain/pity).
  // EBE: *Ez du pena merezi hori egitea → Ez du merezi hori egitea.
  { red: 'pena merezi', bold: 'merezi' },

  // Calque of Sp 'sentido único'. 'zentzu' alone = valid (sense).
  // EBE: *zentzu bakarreko errepidea → noranzko bakarreko errepidea.
  { red: 'zentzu bakarreko', bold: 'noranzko bakarreko' },
]);
