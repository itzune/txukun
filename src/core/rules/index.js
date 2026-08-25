/**
 * Txukun — Rule registry
 *
 * Import all rules here. The eval harness and production pipeline import
 * `allRules` from this module.
 *
 * @module txukun/core/rules
 */

import sentenceBoundary from './sentence-boundary.js';
import sentenceInitialCap from './sentence-initial-cap.js';
import terminalPunct from './terminal-punct.js';
import vocativeComma from './vocative-comma.js';

export { sentenceBoundary, sentenceInitialCap, terminalPunct, vocativeComma };

/** All registered rules, in priority order (split→cap→comma→punct). */
export const allRules = [sentenceBoundary, sentenceInitialCap, vocativeComma, terminalPunct];
