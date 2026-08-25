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
import zalantzaWords from './zalantza-words.js';
import zalantzaPhrases from './zalantza-phrases.js';

export { sentenceBoundary, sentenceInitialCap, terminalPunct, vocativeComma, zalantzaWords, zalantzaPhrases };

/** All registered rules, in priority order (split→cap→comma→punct→zalantza-word→zalantza-phrase). */
export const allRules = [sentenceBoundary, sentenceInitialCap, vocativeComma, terminalPunct, zalantzaWords, zalantzaPhrases];
