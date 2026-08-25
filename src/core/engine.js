/**
 * Txukun — Rule engine (Linter trait + iterative apply)
 *
 * Minimal JS port of Harper's `Linter` trait + iterative suggestion application
 * (see RESEARCH.md §7.8, `weir/mod.rs:transform_to_expected`).
 *
 * The engine:
 *   1. Tokenizes the current text → Document
 *   2. Runs all rules' lint(doc) → collect Lints
 *   3. Picks the highest-priority lint (lowest number), applies its first
 *      suggestion to the text
 *   4. Re-tokenizes the new text → back to step 2
 *   5. Repeats until no lints fire (or maxPasses reached)
 *
 * This iterative approach (apply one → re-tokenize → re-lint) sidesteps all
 * offset-shift bookkeeping. It's simple, correct, and fast for <10 rules on
 * short text. Harper uses the same strategy (BFS, depth ≤ 100).
 *
 * A Rule is an object: { description: string, lint(doc) => Lint[] }
 *
 * @module txukun/core/engine
 */

import { Document } from './document.js';

/**
 * Apply a single suggestion to text, given the lint's span.
 * @param {string} text - source text
 * @param {{start:number,end:number}} span - end-exclusive range
 * @param {{op:string,text?:string}} sug - suggestion object
 * @returns {string} modified text
 */
export function applySuggestion(text, span, sug) {
  const before = text.slice(0, span.start);
  const content = text.slice(span.start, span.end);
  const after = text.slice(span.end);
  switch (sug.op) {
    case 'replaceWith':
      return before + (sug.text ?? '') + after;
    case 'insertAfter':
      return before + content + (sug.text ?? '') + after;
    case 'remove':
      return before + after;
    default:
      return text;
  }
}

/**
 * Run rules on text, applying suggestions iteratively.
 *
 * @param {string} text - input text (typically model output)
 * @param {Array} rules - array of Rule objects ({description, lint})
 * @param {{maxPasses?:number}} [opts]
 * @returns {{corrected:string, lints:Array}} corrected text + applied lints
 */
export function runRules(text, rules, opts = {}) {
  const maxPasses = opts.maxPasses ?? 50;
  let current = text;
  const applied = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    const doc = new Document(current);
    const allLints = [];
    for (const rule of rules) {
      const lints = rule.lint(doc);
      if (lints && lints.length) allLints.push(...lints);
    }
    if (allLints.length === 0) break;

    // Sort by priority (lower = more important), then by position (earlier first)
    allLints.sort((a, b) => a.priority - b.priority || a.span.start - b.span.start);

    const best = allLints[0];
    if (!best.suggestions || best.suggestions.length === 0) break;

    const sug = best.suggestions[0];
    const next = applySuggestion(current, best.span, sug);
    if (next === current) break; // no change → prevent infinite loop

    current = next;
    applied.push({ ...best, suggestion: sug, pass });
  }

  return { corrected: current, lints: applied };
}
