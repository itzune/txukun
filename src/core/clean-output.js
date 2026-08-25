/**
 * Txukun — Model output cleaning (pure, dependency-free)
 *
 * Strips MarianMT special tokens and normalizes whitespace from raw
 * translation output. Extracted from src/models.js (P0.3) so it can be
 * shared by the production pipeline, the eval harness, and (later) the
 * Phase A rule engine's ASR-artifact cleanup.
 *
 * Pure function — no imports, safe to use in Node.js and the browser.
 *
 * Special tokens handled (MarianMT / SentencePiece):
 *   <s>     BOS  (beginning of sequence)
 *   </s>    EOS  (end of sequence)
 *   <pad>   padding
 *   <unk>   unknown token
 *
 * The regex `<\/?s>` matches both `<s>` and `</s>` in one pass.
 *
 * @param {string} text - Raw model output (may contain special tokens)
 * @returns {string} Cleaned text with single-space whitespace, trimmed
 */
export function cleanModelOutput(text) {
  if (!text) return '';
  return text
    .replace(/<\/?s>/g, '')   // <s> and </s> (BOS/EOS)
    .replace(/<pad>/g, '')    // padding
    .replace(/<unk>/g, '')    // unknown tokens
    .replace(/[¡¿]/g, '')     // Spanish inverted marks — never valid in Basque
                               // (EBE Puntuazioa §6 uses only terminal ? and !).
                               // The cap-punct model sometimes hallucinates
                               // these; strip them so they never reach the UI.
    .replace(/\s{2,}/g, ' ')  // collapse runs of whitespace
    .trim();
}
