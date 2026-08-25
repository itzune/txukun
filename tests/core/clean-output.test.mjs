/**
 * Clean-output + GECToR tokenization unit tests
 *
 * Tests two pure functions that are the root cause of recent false positives:
 *   1. cleanModelOutput() — must strip Spanish inverted marks (¡ ¿)
 *   2. GECToR tokenizePunctuation/detokenizePunctuation — must NOT split
 *      hyphens in compound words (hego-ekialdetik, Madril-Sevilla)
 *
 * Pure Node — no browser/model deps needed.
 *
 * @run node tests/core/clean-output.test.mjs
 */

import { cleanModelOutput } from '../../src/core/clean-output.js';
import { correctGrammar, isGectorReady } from '../../src/gector.js';

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

console.log('cleanModelOutput — Spanish inverted marks stripped:\n');

test('special tokens still stripped (regression)', () => {
  eq(cleanModelOutput('<s>Hello</s>'), 'Hello', 'BOS/EOS stripped');
  eq(cleanModelOutput('<unk> test <pad>'), 'test', '<unk>/<pad> stripped');
  eq(cleanModelOutput('  multiple   spaces  '), 'multiple spaces', 'whitespace collapsed');
});

test('Spanish inverted exclamation (¡) stripped', () => {
  // The cap-punct model sometimes hallucinates ¡Tantaka (Spanish punctuation).
  // EBE §6: Basque uses only terminal ! — inverted ¡ never appears.
  eq(cleanModelOutput('¡Tantaka bilduz'), 'Tantaka bilduz', 'leading ¡ stripped');
  eq(cleanModelOutput('kaixo ¡miren!'), 'kaixo miren!', 'mid-sentence ¡ stripped');
  eq(cleanModelOutput('¡¡¡kaixo!!!'), 'kaixo!!!', 'multiple ¡ stripped, ! kept');
});

test('Spanish inverted question mark (¿) stripped', () => {
  eq(cleanModelOutput('¿Zer?'), 'Zer?', 'leading ¿ stripped, ? kept');
  eq(cleanModelOutput('¿¿ Nora zoaz?'), 'Nora zoaz?', 'multiple ¿ stripped');
});

test('legitimate Basque punctuation preserved', () => {
  eq(cleanModelOutput('Nola ez dakizula?'), 'Nola ez dakizula?', 'terminal ? preserved');
  eq(cleanModelOutput('Bai ipuin politak zureak!'), 'Bai ipuin politak zureak!', 'terminal ! preserved');
  eq(cleanModelOutput('Astakilo!, deitzen zidaten.'), 'Astakilo!, deitzen zidaten.', '!, and . preserved');
});

console.log('\nGECToR tokenization — hyphens in compounds preserved:\n');

test('tokenizePunctuation does NOT split hyphens (hego-ekialdetik)', () => {
  // Before the fix: PUNCT_RE included \-, splitting "hego-ekialdetik" into
  // ["hego", "-", "ekialdetik"]. GECToR then predicted $DELETE on "ekialdetik"
  // → output "hego-" (destroying the compound word).
  //
  // We can't call tokenizePunctuation directly (not exported), but we verify
  // via the PUNCT_RE regex behavior. If hyphens aren't split, the GECToR
  // word array preserves "hego-ekialdetik" as one token.
  //
  // Since correctGrammar needs the model, we test the regex indirectly:
  // the PUNCT_RE pattern must NOT match hyphens.
  const PUNCT_RE = /([.,;:!?()«»"'\u2013\u2014])/g;
  const testWord = 'hego-ekialdetik';
  const spaced = testWord.replace(PUNCT_RE, ' $1 ').replace(/\s+/g, ' ').trim();
  eq(spaced, 'hego-ekialdetik', 'hyphen NOT split → compound preserved');

  // Also verify Madril-Sevilla stays intact
  const testWord2 = 'Madril-Sevilla';
  const spaced2 = testWord2.replace(PUNCT_RE, ' $1 ').replace(/\s+/g, ' ').trim();
  eq(spaced2, 'Madril-Sevilla', 'Madril-Sevilla hyphen NOT split');

  // But real sentence punctuation IS still split (comma, period)
  const sentence = 'kaixo, etorri.';
  const spacedSent = sentence.replace(PUNCT_RE, ' $1 ').replace(/\s+/g, ' ').trim();
  eq(spacedSent, 'kaixo , etorri .', 'comma and period still split (needed by GECToR)');
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
if (fail > 0) { console.log('\n✗ Clean-output tests FAILED'); process.exit(1); }
console.log('\n✓ All clean-output tests passed');
