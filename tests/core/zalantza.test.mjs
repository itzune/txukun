/**
 * Zalantza-words rule unit tests — runs WITHOUT the model (instant).
 *
 * Tests the EBE-grounded zalantza-hittak rule (src/core/rules/zalantza-words.js)
 * against the 628-pair dictionary (src/core/data/zalantza.js). Verifies:
 *   - word-level substitution correctness
 *   - case preservation (lower / Title / UPPER)
 *   - mixed-case skip (proper-noun guard)
 *   - idempotency (standard forms not re-touched)
 *   - compound-fragment safety (izar, hezur, etc. NOT replaced)
 *   - verb-collision guard (gara = 'we are' not replaced)
 *   - integration with runRules + allRules
 *
 * Run:  npm run test:core
 *       node tests/core/zalantza.test.mjs
 */

import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';
import zalantzaWords from '../../src/core/rules/zalantza-words.js';
import { ZALANTZA } from '../../src/core/data/zalantza.js';

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
  return runRules(text, [zalantzaWords]).corrected;
}
// Run the full rule stack
function all(text) {
  return runRules(text, allRules).corrected;
}

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  TXUKUN ZALANTZA-HITZAK — unit tests                      ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// ── Data integrity ──────────────────────────────────

console.log('Data integrity:');
test('dictionary has 628 pairs', () => {
  eq(Object.keys(ZALANTZA).length, 628, 'pair count');
});
test('dictionary is frozen', () => {
  eq(Object.isFrozen(ZALANTZA), true);
});
test('no idempotency overlap (no RED is also a BOLD target)', () => {
  const vals = new Set(Object.values(ZALANTZA));
  const overlap = Object.keys(ZALANTZA).filter((k) => vals.has(k));
  eq(overlap.length, 0, 'overlap');
});
test('known pairs present', () => {
  eq(ZALANTZA['aborto'], 'abortu');
  eq(ZALANTZA['abots'], 'ahots');
  eq(ZALANTZA['amapola'], 'mitxoleta');
  eq(ZALANTZA['onda'], 'uhin');
  eq(ZALANTZA['azufre'], 'sufre');
});
test('compound fragments excluded from dictionary', () => {
  eq(ZALANTZA['izar'], undefined, 'izar (star) must be absent');
  eq(ZALANTZA['hezur'], undefined, 'hezur (bone) must be absent');
  eq(ZALANTZA['paper'], undefined, 'paper must be absent');
  eq(ZALANTZA['bizkar'], undefined, 'bizkar (back) must be absent');
  eq(ZALANTZA['leiho'], undefined, 'leiho (window) must be absent');
});
test('verb-collision word gara excluded', () => {
  eq(ZALANTZA['gara'], undefined, 'gara (we are) must be absent');
});

// ── Single-word substitution ────────────────────────

console.log('\nSingle-word substitution:');
test('aborto → abortu', () => eq(rule('aborto'), 'abortu'));
test('abots → ahots', () => eq(rule('abots'), 'ahots'));
test('amapola → mitxoleta', () => eq(rule('amapola'), 'mitxoleta'));
test('onda → uhin', () => eq(rule('onda'), 'uhin'));
test('azufre → sufre', () => eq(rule('azufre'), 'sufre'));
test('aguakate → ahuakate', () => eq(rule('aguakate'), 'ahuakate'));
test('esklabu → esklabo', () => eq(rule('esklabu'), 'esklabo'));
test('xori → txori (dialectal x→tx)', () => eq(rule('xori'), 'txori'));
test('ixil → isil', () => eq(rule('ixil'), 'isil'));

// ── Case preservation ───────────────────────────────

console.log('\nCase preservation:');
test('lowercase preserved', () => eq(rule('aborto'), 'abortu'));
test('Title-case preserved (sentence-initial)', () => eq(rule('Amapola'), 'Mitxoleta'));
test('UPPER-case preserved', () => eq(rule('ONDA'), 'UHIN'));
test('Title-case for multi-char (Abots → Ahots)', () => eq(rule('Abots'), 'Ahots'));

// ── Guards ──────────────────────────────────────────

console.log('\nGuards:');
test('mixed-case skipped (proper noun)', () => {
  // "Aguakate" as a surname/brand → should NOT be touched if mixed weirdly
  // Title-case IS replaced (it's a normal sentence-start noun); test a truly mixed form
  eq(rule('aBoRtO'), 'aBoRtO', 'mixed case unchanged');
});
test('standard form not re-touched (idempotency)', () => {
  eq(rule('abortu'), 'abortu', 'abortu is the standard, unchanged');
  eq(rule('ahots'), 'ahots', 'ahots is the standard, unchanged');
  eq(rule('mitxoleta'), 'mitxoleta');
});
test('compound-fragment words NOT replaced in text', () => {
  // izar (star) is a valid word; must not become iparrizar
  eq(rule('izar'), 'izar', 'izar unchanged');
  eq(rule('hezur'), 'hezur', 'hezur unchanged');
  eq(rule('paper'), 'paper', 'paper unchanged');
});
test('verb gara NOT replaced', () => {
  eq(rule('gara'), 'gara', 'gara (we are) unchanged');
});
test('word-boundary: substring not touched', () => {
  // "abortoak" is a declined form (aborto + ak), NOT the bare loanword.
  // The tokenizer treats it as one word token → no match. Correct behavior.
  eq(rule('abortoak'), 'abortoak', 'declined form untouched');
});

// ── In context ──────────────────────────────────────

console.log('\nIn context:');
test('loanword in a sentence', () => {
  eq(rule('amapola batean'), 'mitxoleta batean');
});
test('multiple zalantza words in one sentence', () => {
  eq(rule('onda eta azufre'), 'uhin eta sufre');
});
test('sentence-initial zalantza word (Title-case)', () => {
  eq(rule('Aguakate bat jan dut.'), 'Ahuakate bat jan dut.');
});
test('does not touch surrounding punctuation', () => {
  eq(rule('amapola, azufre.'), 'mitxoleta, sufre.');
});

// ── Full rule-stack integration ─────────────────────

console.log('\nFull rule-stack integration:');
test('zalantza + terminal punct coexist', () => {
  // No terminal punct → terminal-punct adds '.'; cap capitalizes first word;
  // zalantza swaps amapola→mitxoleta (preserving the title case cap applied).
  const out = all('amapola ederra da');
  eq(out, 'Mitxoleta ederra da.', 'cap + zalantza + punct');
});
test('registered in allRules', () => {
  eq(allRules.includes(zalantzaWords), true);
});

// ── Summary ─────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('───────────────────────────────────────────────────────────');
if (failed > 0) process.exit(1);
