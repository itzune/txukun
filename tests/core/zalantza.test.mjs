/**
 * Zalantza-words rule unit tests — runs WITHOUT the model (instant).
 *
 * Tests the EBE-grounded zalantza-hittak rule (src/core/rules/zalantza-words.js)
 * against the 739-pair dictionary (src/core/data/zalantza.js). Verifies:
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
test('dictionary has 720 single-token pairs', () => {
  eq(Object.keys(ZALANTZA).length, 720, 'pair count');
});
test('dictionary is frozen', () => {
  eq(Object.isFrozen(ZALANTZA), true);
});
test('no idempotency overlap (no RED is also a BOLD target)', () => {
  const vals = new Set(Object.values(ZALANTZA));
  const overlap = Object.keys(ZALANTZA).filter((k) => vals.has(k));
  eq(overlap.length, 0, 'overlap');
});
test('known pairs present (batch 1)', () => {
  eq(ZALANTZA['aborto'], 'abortu');
  eq(ZALANTZA['abots'], 'ahots');
  eq(ZALANTZA['amapola'], 'mitxoleta');
  eq(ZALANTZA['onda'], 'uhin');
  eq(ZALANTZA['azufre'], 'sufre');
});
test('batch 2a new singles present', () => {
  eq(ZALANTZA['aitzaki'], 'aitzakia');
  eq(ZALANTZA['amorrain'], 'amuarrain');
  eq(ZALANTZA['batxilerato'], 'batxilergo');
  eq(ZALANTZA['diabetis'], 'diabetes');
  eq(ZALANTZA['eskui'], 'eskuin');
  eq(ZALANTZA['ikurriñ'], 'ikurrin');
  eq(ZALANTZA['marioneta'], 'txotxongilo');
});
test('batch 2a Type C pairs present (single RED → multi-word BOLD)', () => {
  eq(ZALANTZA['abioneta'], 'hegazkin txiki');
  eq(ZALANTZA['arratsaldeon'], 'arratsalde on');
  eq(ZALANTZA['egunon'], 'egun on');
  eq(ZALANTZA['eskerrikasko'], 'eskerrik asko');
  eq(ZALANTZA['laburmetraia'], 'film labur');
  eq(ZALANTZA['luzemetraia'], 'film luze');
});
test('compound fragments excluded from dictionary', () => {
  eq(ZALANTZA['izar'], undefined, 'izar (star) must be absent');
  eq(ZALANTZA['hezur'], undefined, 'hezur (bone) must be absent');
  eq(ZALANTZA['paper'], undefined, 'paper must be absent');
  eq(ZALANTZA['bizkar'], undefined, 'bizkar (back) must be absent');
  eq(ZALANTZA['leiho'], undefined, 'leiho (window) must be absent');
});
test('hyphenated compounds moved to phrases file (not single-word)', () => {
  // These 19 were reclassified: tokenizer splits 'gora-behera' into 3 tokens,
  // so they can't match as single 'word' tokens. Now in zalantza-phrases.js.
  eq(ZALANTZA['gora-behera'], undefined, 'gora-behera moved to phrases');
  eq(ZALANTZA['ipar-izar'], undefined, 'ipar-izar moved to phrases');
  eq(ZALANTZA['bizkar-hezur'], undefined, 'bizkar-hezur moved to phrases');
  eq(ZALANTZA['bertso-paper'], undefined, 'bertso-paper moved to phrases');
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

// ── Batch 2a: new singles ───────────────────────────

console.log('\nBatch 2a — new singles:');
test('aitzaki → aitzakia', () => eq(rule('aitzaki'), 'aitzakia'));
test('amorrain → amuarrain', () => eq(rule('amorrain'), 'amuarrain'));
test('batxilerato → batxilergo', () => eq(rule('batxilerato'), 'batxilergo'));
test('diabetis → diabetes', () => eq(rule('diabetis'), 'diabetes'));
test('eskui → eskuin', () => eq(rule('eskui'), 'eskuin'));
test('ikurriñ → ikurrin (ñ preserved)', () => eq(rule('ikurriñ'), 'ikurrin'));
test('marioneta → txotxongilo', () => eq(rule('marioneta'), 'txotxongilo'));
test('txontxongilo → txotxongilo', () => eq(rule('txontxongilo'), 'txotxongilo'));

// ── Batch 2a: Type C (single-word RED → multi-word BOLD) ──

console.log('\nBatch 2a — Type C (multi-word targets):');
test('abioneta → hegazkin txiki', () => eq(rule('abioneta'), 'hegazkin txiki'));
test('arratsaldeon → arratsalde on', () => eq(rule('arratsaldeon'), 'arratsalde on'));
test('egunon → egun on', () => eq(rule('egunon'), 'egun on'));
test('eskerrikasko → eskerrik asko', () => eq(rule('eskerrikasko'), 'eskerrik asko'));
test('laburmetraia → film labur', () => eq(rule('laburmetraia'), 'film labur'));
test('Type C Title-case preserved (Abioneta → Hegazkin txiki)', () =>
  eq(rule('Abioneta'), 'Hegazkin txiki'));
test('Type C UPPER preserved (ABIONETA → HEGAZKIN TXIKI)', () =>
  eq(rule('ABIONETA'), 'HEGAZKIN TXIKI'));
test('Type C idempotency: multi-word target not re-touched', () => {
  eq(rule('hegazkin txiki'), 'hegazkin txiki', 'standard form unchanged');
  eq(rule('egun on'), 'egun on');
});
test('Type C in context (abioneta bat → hegazkin txiki bat)', () =>
  eq(rule('abioneta bat ikusi dut'), 'hegazkin txiki bat ikusi dut'));

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
