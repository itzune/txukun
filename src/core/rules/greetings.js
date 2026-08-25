/**
 * Txukun — Agur-/esker-esapideen datuak (greeting phrase data)
 *
 * Shared linguistic data for the vocative-comma and terminal-punct rules.
 * Keeping greeting sets in one place makes them easy to verify and extend.
 *
 * Sources (verified 2026-08-25, see RESEARCH.md §7.10):
 *   - EBE puntuazioa §1 (line 29): "Arratsalde on!" "Zorionak, Amaia!" — verbless
 *     greeting sentences take harridura-marka ('!')
 *   - EBE puntuazioa §2.3 (line 54): "Kaixo, Mikel!" — bokatiboa: comma + '!'
 *   - EBE puntuazioa §6: '!' for exclamatory/interjection sentences
 *   - Euskaltzaindia Buletina 2024: "Eskerrik asko, Joxean, …" "Eskerrik asko." —
 *     gratitude expression takes period ('.'), NOT exclamation
 *
 * Distinction:
 *   - Interjection greetings (kaixo, agur, gabon, egun on…) → exclamatory → '!'
 *   - Gratitude expressions (eskerrik asko) → declarative → '.'
 *
 * @module txukun/core/rules/greetings
 */

// Single-word interjection greetings → exclamatory ('!').
// EBE §2.3: "Kaixo, Mikel!"; agur/gabon by analogy (same word class: interjection).
export const EXCLAMATORY_GREETINGS = new Set([
  'kaixo',    // hi / hello
  'agur',     // goodbye / farewell
  'gabon',    // good night
]);

// Multi-word interjection greeting phrases → exclamatory ('!').
// EBE §1: "Arratsalde on!"; "egun on!" (textbook); "eguerdi on" by analogy
// (time-of-day greeting formula: [moment] + on).
// Note: "gabon" alone already means "good night"; "gabon gau" is redundant
// and would conflict with the single-word "gabon" check, so it's excluded.
export const EXCLAMATORY_PHRASES = [
  'egun on',          // good morning
  'arratsalde on',    // good afternoon
  'eguerdi on',       // good midday
];

// Multi-word greeting phrases that are declarative → period ('.').
// Euskaltzaindia Buletina 2024: "Eskerrik asko." — gratitude, not exclamation.
export const DECLARATIVE_PHRASES = [
  'eskerrik asko',    // thank you very much
];

// All multi-word greeting phrases (for comma insertion in vocative-comma).
// Both exclamatory and declarative phrases need a comma before the vocative.
export const ALL_GREETING_PHRASES = [...EXCLAMATORY_PHRASES, ...DECLARATIVE_PHRASES];
