/**
 * Txukun — EBE zalantza proper-noun data
 *
 * EBE Zalantza appendix (ebe-zal.txt): proper-noun spelling corrections where
 * the dispreferred form (RED) should be replaced by the standard Basque form.
 * These are EXONIMOAK (exonyms) and proper nouns whose non-standard spelling
 * causes doubt. Euskaltzaindia's EBE and EODA (Onomastika Datubasea) confirm
 * directionality.
 *
 * KEY DIFFERENCE from zalantza.js: these are PROPER NOUNS, so the target is
 * ALWAYS capitalized regardless of the input's case. The `matchCaseProper()`
 * function in zalantza-proper.js handles this: lowercase/Title input → Title
 * target (target stored pre-capitalized); UPPER input → UPPER target.
 *
 * SOURCES:
 *   - EBE Zalantza appendix (PDF color analysis: RED=dispreferred, BOLD=standard)
 *   - EBE Aurkibide analitikoa (analytic index, `*` marks dispreferred forms)
 *   - EODA (Euskaltzaindiaren Onomastika Datubasea) — official place-name forms
 *
 * SKIPPED from zalantza-proper.tsv (3 entries):
 *   - ozkabarte: truncated extraction ("santo domingo de la" — missing "Calzada"),
 *     likely misrouted entry. Skip until re-extracted from PDF.
 *   - donejakue: false-positive risk. "Donejakue" alone is a valid word
 *     (adjective "of Saint James"). Target "Donejakue bidea" (the Camino)
 *     only applies when referring to the route. Would wrongly correct
 *     "donejakue eliza" → "Donejakue bidea eliza".
 *   - donibane: false-positive risk. "Donibane" is a place-name component used
 *     in MULTIPLE places (Donibane Garazi ≠ Donibane Lohizune). Target
 *     "Donibane Lohizune" only applies to Saint-Jean-de-Luz. Would wrongly
 *     correct "Donibane Garazi" → "Donibane Lohizune Garazi".
 *
 * @module txukun/core/data/zalantza-proper
 */

// ── Single-word RED → target (21 entries) ──────────
// 18 single-word → single-word + 3 single-word → multi-word

export const PROPER_WORDS = Object.freeze({
  // Places & geography
  auñamendiak: 'Pirinioak',     // Navarrese form → Batua (Pyrenees)
  gorbea: 'Gorbeia',            // Mountain (Gorbeia)
  haizkorri: 'Aizkorri',        // Mountain (Aizkorri)
  himalaya: 'Himalaia',         // Himalaya
  jerusalen: 'Jerusalem',       // Jerusalem
  kalagorria: 'Calahorra',      // La Rioja — exonimo, keep Spanish form (EODA confirmed)
  kanboia: 'Kanbodia',          // Cambodia
  pabe: 'Paue',                 // Pau (French city, Basque form)
  pertsia: 'Persia',            // Persia (don't over-Basquize)
  pirineoak: 'Pirinioak',       // Pyrenees
  tantzania: 'Tanzania',        // Tanzania
  troya: 'Troia',               // Troy
  ukrania: 'Ukraina',           // Ukraine
  etxegarate: 'Etzegarate',     // Mountain pass (Etzegarate)

  // Regions (single-word RED → multi-word target)
  ertamerika: 'Erdialdeko Amerika',  // Central America
  ertaroa: 'Erdi Aroa',              // Middle Ages

  // People & religion
  adan: 'Adam',                 // Adam
  belen: 'Betleem',             // Bethlehem
  eba: 'Eva',                   // Eve
  ernio: 'Hernio',              // Hernio (mountain/name)
  jesukristo: 'Jesu Kristo',    // Jesus Christ (one word → two words)
});

// ── Multi-word / hyphenated RED → target (3 entries) ─

export const PROPER_PHRASES = Object.freeze([
  { red: 'big-bang', bold: 'Big Bang' },          // hyphenated → space-separated
  { red: 'deba behea', bold: 'Debabarrena' },     // Lower Deba region
  { red: 'deba garaia', bold: 'Debagoiena' },     // Upper Deba region
]);
