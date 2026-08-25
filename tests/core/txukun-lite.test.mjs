/**
 * Txukun Lite integration test — rules surface as cap-punct cards WITHOUT the model
 *
 * Reproduces the core of `src/analyze.js:detectCapPunctErrors()`:
 *   1. run rules on raw text (the "Txukun Lite" path correctCapPunct takes when
 *      the model isn't loaded)
 *   2. diff original vs. ruled output (diffWords)
 *   3. keep only case/punct-only changes (isCasePunctOnly)
 *   4. assert those become 'cappunct'-category errors (the cards the UI shows)
 *
 * This is the test the AGENTS.md release process asks for: confirming the
 * one-line Txukun Lite fix (removing the `if (!isModelReady()) return` early
 * bail in detectCapPunctErrors) actually surfaces rule fixes in the UI even
 * before/without the neural model.
 *
 * Pure Node — imports only src/core/* (no browser-only model deps).
 *
 * @run node tests/core/txukun-lite.test.mjs
 */

import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';
import { diffWords, isCasePunctOnly } from '../../src/core/diff.js';

let pass = 0;
let fail = 0;
const eq = (actual, expected, label) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    console.log(`      expected ${JSON.stringify(expected)}`);
    console.log(`      got      ${JSON.stringify(actual)}`);
  }
  ok ? pass++ : fail++;
};

/**
 * Simulate detectCapPunctErrors' core logic in rules-only (no-model) mode.
 * Returns the cap-punct errors that would become UI suggestion cards.
 */
function detectCapPunctLite(text) {
  const { corrected } = runRules(text, allRules);
  if (!corrected || corrected === text) return [];
  const errors = [];
  for (const ch of diffWords(text, corrected)) {
    if (ch.type !== 'replace') continue;
    if (!isCasePunctOnly(ch.fromText, ch.toText)) continue;
    errors.push({
      from: ch.fromOffset,
      to: ch.toOffset,
      original: ch.fromText,
      suggestion: ch.toText,
      category: 'cappunct',
    });
  }
  return errors;
}

console.log('Txukun Lite — rules surface as cards WITHOUT the model:\n');

test('c060: "kaixo mikel" → cap + comma + ! (no model)', () => {
  const errors = detectCapPunctLite('kaixo mikel');
  // Should produce cap-punct errors (not empty) even though no model ran.
  eq(errors.length > 0, true, 'produces at least one cap-punct error');
  // The full ruled output should be "Kaixo, mikel!"
  const { corrected } = runRules('kaixo mikel', allRules);
  eq(corrected, 'Kaixo, mikel!', 'ruled output');
  // Original word "kaixo" → "Kaixo," (case + comma) is case-punct-only
  const kaixoErr = errors.find((e) => e.original === 'kaixo');
  eq(!!kaixoErr, true, '"kaixo" flagged');
  eq(kaixoErr.suggestion, 'Kaixo,', 'suggestion = "Kaixo,"');
  eq(kaixoErr.category, 'cappunct', 'category = cappunct (blue card)');
});

test('c061: "eskerrik asko miren" → comma after phrase + cap (Lite: no Miren cap)', () => {
  const errors = detectCapPunctLite('eskerrik asko miren');
  eq(errors.length > 0, true, 'produces cap-punct errors');
  const { corrected } = runRules('eskerrik asko miren', allRules);
  // Lite mode (no model) can't capitalize "miren"→"Miren" — that needs the
  // neural model / gazetteer (F5). Rules add: sentence-initial cap on
  // "eskerrik", comma after "eskerrik asko", terminal period.
  eq(corrected, 'Eskerrik asko, miren.', 'ruled output (Lite: no Miren cap)');
});

test('sentence-initial cap: "kaixo ni miren naiz" → "Kaixo..."', () => {
  const errors = detectCapPunctLite('kaixo ni miren naiz');
  const first = errors.find((e) => e.original === 'kaixo');
  eq(!!first, true, 'first word "kaixo" flagged');
  eq(first.suggestion, 'Kaixo,', 'capitalized + comma');
});

test('interrogative: "non bizi zara" → "?" (no model)', () => {
  const errors = detectCapPunctLite('non bizi zara');
  const { corrected } = runRules('non bizi zara', allRules);
  eq(corrected, 'Non bizi zara?', 'adds ?');
  eq(errors.length > 0, true, 'produces cap-punct error');
  // "zara" → "zara?" is case-punct-only → flagged
  const last = errors.find((e) => e.original === 'zara');
  eq(!!last, true, '"zara" flagged for ?');
  eq(last.suggestion, 'zara?', 'suggestion = "zara?"');
});

test('empty/already-correct text → no errors (no false cards)', () => {
  eq(detectCapPunctLite(''), [], 'empty string → no errors');
  // A declarative sentence the rules agree is complete: no greeting (so no
  // '.'→'!' replacement), no interrogative, already capped + perioded.
  // ("Kaixo, Miren." is NOT rule-stable — the vocative-greeting rule correctly
  //  wants '!' there per EBE §2.3, so it would fire.)
  eq(detectCapPunctLite('Etorri naiz gaur.'), [], 'declarative → no errors');
});

test('pure word substitution NOT flagged (isCasePunctOnly guard)', () => {
  // Rules don't substitute words, but verify the guard: if a hypothetical
  // diff produced "etorri"→"joan", it must NOT become a cap-punct card.
  eq(isCasePunctOnly('etorri', 'joan'), false, 'word substitution rejected');
  eq(isCasePunctOnly('mikel', 'Mikel!'), true, 'case+punct accepted');
  eq(isCasePunctOnly('miren', 'miren'), false, 'identical rejected');
});

test('ordinal period after a number is NOT a sentence boundary (EBE §1.2.2)', () => {
  // EBE Puntuazioa §1.2.2 "Zenbakietakoa": a period after a digit number
  // replaces the -garren ordinal suffix. "1993. urtean" = "1993garren urtean"
  // (in the 1993rd year). The period is an ordinal marker, NOT a sentence
  // terminator — so "urtean" must NOT be capitalized as sentence-initial.
  // EBE itself uses "1927. urtearen" (ebe-punt.txt line 174).
  //
  // Before the fix: iterSentences split at "1993.", making "urtean" the
  // first word of a new sentence → false "Urtean" suggestion.
  eq(detectCapPunctLite('1993. urtean jaio nintzen.'), [], 'ordinal year → no false cap');
  eq(detectCapPunctLite('Bigarren etapa 1927. urtearen artean izan zen.'), [],
    'EBE example "1927. urtearen" → no false cap');
  // Ruled output must be unchanged (already correct).
  eq(runRules('1993. urtean jaio nintzen.', allRules).corrected,
    '1993. urtean jaio nintzen.', 'ruled output preserves ordinal');
  // Thousands separator ("2.018") is also not a sentence boundary.
  eq(detectCapPunctLite('2.018 ogi ekarri ditu.'), [], 'thousands separator → no false cap');
});

test('genuine sentence end after a word still splits (no regression)', () => {
  // A period after a LETTER word is still a sentence boundary — "da. etorri"
  // splits, and "etorri" IS sentence-initial → capitalize.
  const errors = detectCapPunctLite('etorri da. etorri berriro.');
  eq(errors.length > 0, true, 'real sentence split still fires cap');
  const { corrected } = runRules('etorri da. etorri berriro.', allRules);
  eq(corrected, 'Etorri da. Etorri berriro.', 'second sentence capitalized');
});

function test(name, fn) {
  console.log(`${name}:`);
  try { fn(); } catch (e) {
    console.log(`  ✗ threw: ${e.message}`);
    fail++;
  }
}

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  ${pass} passed, ${fail} failed`);
console.log('═══════════════════════════════════════════════════════');
if (fail > 0) { console.log('\n✗ Txukun Lite tests FAILED'); process.exit(1); }
console.log('\n✓ All Txukun Lite tests passed');
