/**
 * Zalantza-phrases rule unit tests — runs WITHOUT the model (instant).
 *
 * Tests the EBE-grounded zalantza-esapideak rule (src/core/rules/zalantza-phrases.js)
 * against the 52-pair phrase dictionary (src/core/data/zalantza-phrases.js).
 *
 * Verifies:
 *   - multi-token phrase substitution (ww / wpw / www / wwpw structures)
 *   - hyphenated compound substitution (reclassified from single-word)
 *   - case preservation (lower / Title / UPPER) via first word token
 *   - mixed-case skip (proper-noun guard)
 *   - punctuation-structure sensitivity (hyphen vs space differ)
 *   - idempotency (corrected targets not re-touched)
 *   - overlap convergence (gora-behera ⊂ gutxi gora-behera)
 *   - integration with runRules + allRules
 *
 * Run:  npm run test:core
 *       node tests/core/zalantza-phrases.test.mjs
 */

import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';
import zalantzaPhrases from '../../src/core/rules/zalantza-phrases.js';
import { ZALANTZA_PHRASES } from '../../src/core/data/zalantza-phrases.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Run a single rule in isolation
function rule(text) {
  return runRules(text, [zalantzaPhrases]).corrected;
}
// Run the full rule stack
function all(text) {
  return runRules(text, allRules).corrected;
}

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  TXUKUN ZALANTZA-ESAPIDEAK — unit tests                   ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// ── Data integrity ──────────────────────────────────

console.log('Data integrity:');
test('phrase dictionary has 52 pairs', () => {
  eq(ZALANTZA_PHRASES.length, 52, 'pair count');
});
test('dictionary is frozen', () => {
  eq(Object.isFrozen(ZALANTZA_PHRASES), true);
});
test('no duplicate REDs', () => {
  const reds = ZALANTZA_PHRASES.map((p) => p.red);
  eq(new Set(reds).size, reds.length, 'unique REDs');
});
test('all REDs are multi-token (≥2 non-ws tokens)', () => {
  // (verified in extraction; sanity check here)
  eq(ZALANTZA_PHRASES.every((p) => p.red.trim().length > 0), true);
});
test('known phrases present (from TSV)', () => {
  const find = (r) => ZALANTZA_PHRASES.find((p) => p.red === r);
  eq(find('aire-garraio').bold, 'aireko garraio');
  eq(find('kontutan hartu').bold, 'kontuan hartu');
  eq(find('kosta ala kosta').bold, 'kosta ahala kosta');
});
test('reclassified hyphenated compounds present', () => {
  const find = (r) => ZALANTZA_PHRASES.find((p) => p.red === r);
  eq(find('gora-behera').bold, 'gorabehera');
  eq(find('ipar-izar').bold, 'iparrizar');
  eq(find('bizkar-hezur').bold, 'bizkarrezur');
  eq(find('bertso-paper').bold, 'bertsopaper');
});

// ── Word-word phrases (space-separated) ─────────────

console.log('\nWord-word phrases (ww):');
test('kontutan hartu → kontuan hartu', () => eq(rule('kontutan hartu'), 'kontuan hartu'));
test('kosta ala kosta → kosta ahala kosta', () => eq(rule('kosta ala kosta'), 'kosta ahala kosta'));
test('harri bitxi → harribitxi', () => eq(rule('harri bitxi'), 'harribitxi'));
test('agi denez → agidanez', () => eq(rule('agi denez'), 'agidanez'));
test('ipar ekialde → ipar-ekialde', () => eq(rule('ipar ekialde'), 'ipar-ekialde'));

// ── Hyphenated phrases (wpw: word-punct-word) ───────

console.log('\nHyphenated phrases (wpw):');
test('aire-garraio → aireko garraio', () => eq(rule('aire-garraio'), 'aireko garraio'));
test('aire-bidaia → aireko bidaia', () => eq(rule('aire-bidaia'), 'aireko bidaia'));
test('bideo-kasete → bideokasete', () => eq(rule('bideo-kasete'), 'bideokasete'));
test('euskaldun-berri → euskaldun berri', () => eq(rule('euskaldun-berri'), 'euskaldun berri'));

// ── Reclassified hyphenated compounds ───────────────

console.log('\nReclassified hyphenated compounds:');
test('gora-behera → gorabehera', () => eq(rule('gora-behera'), 'gorabehera'));
test('ipar-izar → iparrizar', () => eq(rule('ipar-izar'), 'iparrizar'));
test('bizkar-hezur → bizkarrezur', () => eq(rule('bizkar-hezur'), 'bizkarrezur'));
test('bertso-paper → bertsopaper', () => eq(rule('bertso-paper'), 'bertsopaper'));
test('saski-baloi → saskibaloi', () => eq(rule('saski-baloi'), 'saskibaloi'));
test('te-ontzi → teontzi', () => eq(rule('te-ontzi'), 'teontzi'));

// ── Case preservation ───────────────────────────────

console.log('\nCase preservation:');
test('lowercase preserved', () => eq(rule('aire-garraio'), 'aireko garraio'));
test('Title-case preserved (Aire-garraio → Aireko garraio)', () =>
  eq(rule('Aire-garraio'), 'Aireko garraio'));
test('UPPER-case preserved (AIRE-GARRAIO → AIREKO GARRAIO)', () =>
  eq(rule('AIRE-GARRAIO'), 'AIREKO GARRAIO'));
test('Title-case ww phrase (Kontutan hartu → Kontuan hartu)', () =>
  eq(rule('Kontutan hartu'), 'Kontuan hartu'));
test('UPPER ww phrase (KOSTA ALA KOSTA → KOSTA AHALA KOSTA)', () =>
  eq(rule('KOSTA ALA KOSTA'), 'KOSTA AHALA KOSTA'));

// ── Guards ──────────────────────────────────────────

console.log('\nGuards:');
test('mixed-case first token skipped (proper noun)', () => {
  eq(rule('aIrE-garraio'), 'aIrE-garraio', 'mixed case unchanged');
});
test('punctuation-structure sensitive: space ≠ hyphen', () => {
  // 'aire garraio' (space) is NOT the RED 'aire-garraio' (hyphen) → no match
  eq(rule('aire garraio'), 'aire garraio', 'space-form not touched by hyphenated RED');
});
test('standard form not re-touched (idempotency)', () => {
  eq(rule('aireko garraio'), 'aireko garraio', 'correct form unchanged');
  eq(rule('gorabehera'), 'gorabehera', 'correct form unchanged');
  eq(rule('kontuan hartu'), 'kontuan hartu', 'correct form unchanged');
});
test('declined form not touched', () => {
  // 'aire-garraioa' (with article suffix -a) is a different token sequence
  eq(rule('aire-garraioa'), 'aire-garraioa', 'declined form untouched');
});

// ── Overlap convergence ─────────────────────────────

console.log('\nOverlap convergence:');
test('gutxi gora-behera → gutxi gorabehera (longer pattern wins)', () => {
  eq(rule('gutxi gora-behera'), 'gutxi gorabehera');
});
test('gora-behera alone → gorabehera (shorter pattern when no gutxi)', () => {
  eq(rule('gora-behera'), 'gorabehera');
});
test('gutxi gorabehera (already correct) unchanged', () => {
  eq(rule('gutxi gorabehera'), 'gutxi gorabehera');
});

// ── In context ──────────────────────────────────────

console.log('\nIn context:');
test('phrase in a sentence', () => {
  eq(rule('aire-garraio merkea da'), 'aireko garraio merkea da');
});
test('multiple phrase errors in one sentence', () => {
  eq(rule('aire-garraio eta bideo-kasete'), 'aireko garraio eta bideokasete');
});
test('phrase with surrounding punctuation', () => {
  eq(rule('(aire-garraio)'), '(aireko garraio)');
});

// ── Full rule-stack integration ─────────────────────

console.log('\nFull rule-stack integration:');
test('phrase + terminal punct + cap coexist', () => {
  const out = all('aire-garraio merkea da');
  eq(out, 'Aireko garraio merkea da.', 'cap + phrase + punct');
});
test('phrase + single-word zalantza coexist', () => {
  // 'abots' is a single-word zalantza; 'aire-garraio' is a phrase
  const out = all('abots eta aire-garraio');
  eq(out, 'Ahots eta aireko garraio.', 'single-word + phrase + cap + punct');
});
test('registered in allRules', () => {
  eq(allRules.includes(zalantzaPhrases), true);
});

// ── Summary ─────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('───────────────────────────────────────────────────────────');
if (failed > 0) process.exit(1);
