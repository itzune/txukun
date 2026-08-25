/**
 * Txukun — Core type system (Lint + Suggestion + LintKind)
 *
 * Modeled on Harper's `linting/{lint,suggestion,lint_kind}.rs` (see RESEARCH.md
 * §7.8). The entire edit vocabulary is 3 primitives — the same 3 Harper uses:
 *
 *   replaceWith(text)  — replace the lint's span content with `text`
 *   insertAfter(text)  — keep span content, insert `text` after it
 *   remove()           — delete the span content
 *
 * A Lint carries: a span (where in source), a kind (category), one or more
 * suggestions (how to fix), a message (user-facing), and a priority (lower =
 * more important; the engine applies highest-priority lints first).
 *
 * Spans are end-exclusive {start, end} — covers start..end, not start..=end.
 * This matches Harper's `Span<T>` and JS string.slice() conventions.
 *
 * @module txukun/core/types
 */

/**
 * Lint categories — for UI grouping + eval per-category fix rates.
 * Mapped to EBE rule sections where applicable.
 */
export const LintKind = Object.freeze({
  Capitalization: 'Capitalization', // Maiuskulak (EBE id=1023)
  Punctuation: 'Punctuation',       // Puntuazio-markak
  Calque: 'Calque',                 // Kalkoak (ebe-kal.txt)
  Confusable: 'Confusable',         // Zalantza-hitzak (ebe-zal.txt)
  Spelling: 'Spelling',             // Orthography
  Style: 'Style',                   // Word order, register (low confidence)
});

// ── Suggestion constructors (3 edit primitives) ─────

/** Replace the lint's span with `text`. */
export function replaceWith(text) {
  return { op: 'replaceWith', text };
}

/** Keep the lint's span content, insert `text` immediately after it. */
export function insertAfter(text) {
  return { op: 'insertAfter', text };
}

/** Delete the lint's span content. */
export function remove() {
  return { op: 'remove' };
}

// ── Lint constructor ────────────────────────────────

/**
 * @param {Object} opts
 * @param {{start:number,end:number}} opts.span - end-exclusive offset range
 * @param {string} opts.kind - a LintKind value
 * @param {Array} opts.suggestions - suggestion objects from replaceWith/insertAfter/remove
 * @param {string} opts.message - user-facing description
 * @param {number} [opts.priority=50] - lower = more important (applied first)
 * @returns {Lint}
 */
export function lint({ span, kind, suggestions, message, priority = 50 }) {
  return { span, kind, suggestions: suggestions || [], message, priority };
}
