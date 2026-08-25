/**
 * Calque rule unit tests — runs WITHOUT the model (instant).
 *
 * Tests the EBE-grounded kalko lexiko-semantikoak rule (src/core/rules/calque.js)
 * against the calque data (src/core/data/calque.js): 2 single-word + 2 phrase pairs.
 *
 * Verifies:
 *   - single-word calque substitution (balore→balio, erasokor→erasotzaile)
 *   - phrase calque substitution (pena merezi→merezi, zentzu bakarreko→noranzko bakarreko)
 *   - case preservation (lower / Title / UPPER) for both words and phrases
 *   - mixed-case skip (proper-noun guard)
 *   - false-positive guards (pena alone, zentzu alone, zentzu komuna NOT flagged)
 *   - idempotency (corrected targets not re-touched)
 *   - in-context full sentences
 *   - integration with runRules + allRules (no conflict with zalantza)
 *
 * Run:  npm run test:core
 *       node tests/core/calque.test.mjs
 */

import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';
import calque from '../../src/core/rules/calque.js';
import { CALQUE_WORDS, CALQUE_PHRASES } from '../../src/core/data/calque.js';

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

// Run calque rule in isolation
function rule(text) {
  return runRules(text, [calque]).corrected;
}
// Run the full rule stack
function all(text) {
  return runRules(text, allRules).corrected;
}

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  TXUKUN KALKO LEXIKO-SEMANTIKOAK — unit tests             ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// ── Data integrity ──────────────────────────────────

console.log('─ Data integrity ─');

test('CALQUE_WORDS has 3 entries (2 §1 + 1 §2 syntactic)', () => {
  eq(Object.keys(CALQUE_WORDS).length, 3);
});

test('CALQUE_PHRASES has 4 entries (2 §1 + 2 §2 syntactic)', () => {
  eq(CALQUE_PHRASES.length, 4);
});

test('No no-ops in CALQUE_WORDS', () => {
  for (const [k, v] of Object.entries(CALQUE_WORDS)) {
    if (k === v) throw new Error(`No-op: ${k}→${v}`);
  }
});

test('No no-ops in CALQUE_PHRASES', () => {
  for (const { red, bold } of CALQUE_PHRASES) {
    if (red === bold) throw new Error(`No-op: ${red}→${bold}`);
  }
});

test('No idempotency chains in CALQUE_WORDS', () => {
  for (const v of Object.values(CALQUE_WORDS)) {
    if (v.toLowerCase() in CALQUE_WORDS) {
      throw new Error(`Chain: target "${v}" is also a key`);
    }
  }
});

test('All CALQUE_WORDS keys are lowercase', () => {
  for (const k of Object.keys(CALQUE_WORDS)) {
    if (k !== k.toLowerCase()) throw new Error(`Not lowercase: "${k}"`);
  }
});

test('All CALQUE_WORDS keys are single-token (no space/hyphen)', () => {
  for (const k of Object.keys(CALQUE_WORDS)) {
    if (k.includes(' ') || k.includes('-')) throw new Error(`Multi-token: "${k}"`);
  }
});

// ── Single-word calques ─────────────────────────────

console.log('\n─ Single-word calques ─');

test('balore → balio (lowercase)', () => {
  eq(rule('balore'), 'balio');
});

test('erasokor → erasotzaile (lowercase)', () => {
  eq(rule('erasokor'), 'erasotzaile');
});

test('balore in sentence (undeclined form)', () => {
  // NOTE: declined forms (baloreak, balorearen...) are not matched —
  // stem+suffix matching is deferred to batch 3+ (morphological analysis)
  eq(rule('Gure balore moral bat'), 'Gure balio moral bat');
});

test('erasokor in sentence', () => {
  eq(rule('giro erasokor izan da'), 'giro erasotzaile izan da');
});

test('multiple calques in one sentence', () => {
  eq(rule('balore erasokor bat'), 'balio erasotzaile bat');
});

// ── Case preservation (single words) ────────────────

console.log('\n─ Case preservation (words) ─');

test('Balore → Balio (Title case)', () => {
  eq(rule('Balore moral bat da'), 'Balio moral bat da');
});

test('BALORE → BALIO (UPPER case)', () => {
  eq(rule('BALORE moral bat'), 'BALIO moral bat');
});

test('Erasokor → Erasotzaile (Title case)', () => {
  eq(rule('Erasokor giroa'), 'Erasotzaile giroa');
});

test('ERASOKOR → ERASOTZAILE (UPPER case)', () => {
  eq(rule('ERASOKOR da'), 'ERASOTZAILE da');
});

// ── Mixed-case skip (proper-noun guard) ─────────────

console.log('\n─ Mixed-case skip ─');

test('BaLoRe skipped (mixed case)', () => {
  eq(rule('BaLoRe moral'), 'BaLoRe moral');
});

test('ErAsOkOr skipped (mixed case)', () => {
  eq(rule('ErAsOkOr giroa'), 'ErAsOkOr giroa');
});

// ── Idempotency (single words) ──────────────────────

console.log('\n─ Idempotency (words) ─');

test('balio not re-flagged', () => {
  eq(rule('balio moral bat'), 'balio moral bat');
});

test('erasotzaile not re-flagged', () => {
  eq(rule('erasotzaile giroa'), 'erasotzaile giroa');
});

// ── Phrase calques ─────────────────────────────────

console.log('\n─ Phrase calques ─');

test('pena merezi → merezi', () => {
  eq(rule('pena merezi'), 'merezi');
});

test('pena merezi in sentence', () => {
  eq(rule('Ez du pena merezi hori egitea'), 'Ez du merezi hori egitea');
});

test('zentzu bakarreko → noranzko bakarreko', () => {
  eq(rule('zentzu bakarreko'), 'noranzko bakarreko');
});

test('zentzu bakarreko in sentence', () => {
  eq(rule('zentzu bakarreko errepidea da'), 'noranzko bakarreko errepidea da');
});

// ── Case preservation (phrases) ─────────────────────

console.log('\n─ Case preservation (phrases) ─');

test('Pena merezi → Merezi (Title case, sentence start)', () => {
  eq(rule('Pena merezi du horrek'), 'Merezi du horrek');
});

test('PENA MEREZI → MEREZI (UPPER case)', () => {
  eq(rule('PENA MEREZI du'), 'MEREZI du');
});

test('Zentzu bakarreko → Noranzko bakarreko (Title case)', () => {
  eq(rule('Zentzu bakarreko errepidea'), 'Noranzko bakarreko errepidea');
});

test('ZENTZU BAKARREKO → NORANZKO BAKARREKO (UPPER case)', () => {
  eq(rule('ZENTZU BAKARREKO errepidea'), 'NORANZKO BAKARREKO errepidea');
});

// ── False-positive guards ───────────────────────────

console.log('\n─ False-positive guards ─');

test('pena alone NOT flagged (valid word = pain/pity)', () => {
  eq(rule('pena hartzen dut'), 'pena hartzen dut');
});

test('zentzu alone NOT flagged (valid word = sense)', () => {
  eq(rule('zentzu komuna'), 'zentzu komuna');
});

test('zentzu bakar bat NOT flagged (not the calque phrase)', () => {
  eq(rule('zentzu bakar bat'), 'zentzu bakar bat');
});

test('merezi alone NOT flagged (already the correct form)', () => {
  eq(rule('merezi du horrek'), 'merezi du horrek');
});

// ── Idempotency (phrases) ───────────────────────────

console.log('\n─ Idempotency (phrases) ─');

test('merezi not re-flagged after correction', () => {
  const corrected = rule('Ez du pena merezi hori egitea');
  eq(corrected, 'Ez du merezi hori egitea');
  // Run again on corrected text — should be stable
  eq(rule(corrected), corrected);
});

test('noranzko bakarreko not re-flagged after correction', () => {
  const corrected = rule('zentzu bakarreko errepidea');
  eq(corrected, 'noranzko bakarreko errepidea');
  eq(rule(corrected), corrected);
});

// ── §2 Syntactic calques (Kalko morfosintaktikoak) ──

console.log('\n─ §2 syntactic calques ─');

test('gogoekin → gogoarekin (§2 word calque)', () => {
  eq(rule('Hori egiteko gogoekin nago'), 'Hori egiteko gogoarekin nago');
});

test('gogoekin in sentence', () => {
  eq(rule('Lan egiteko gogoekin dator.'), 'Lan egiteko gogoarekin dator.');
});

test('GOGOEKIN → GOGOAREKIN (UPPER case)', () => {
  eq(rule('GOGOEKIN nago'), 'GOGOAREKIN nago');
});

test('Gogoekin → Gogoarekin (Title case, sentence start)', () => {
  eq(rule('Gogoekin nago lanean'), 'Gogoarekin nago lanean');
});

test('gogoarekin not re-flagged (already correct)', () => {
  eq(rule('gogoarekin nago lanean'), 'gogoarekin nago lanean');
});

test('hobe esanda → hobeto esanda (§2 phrase calque)', () => {
  eq(rule('hobe esanda, ez da horrela'), 'hobeto esanda, ez da horrela');
});

test('hobe esan → hobeto esan (§2 phrase calque, no suffix)', () => {
  eq(rule('hobe esan behar dut'), 'hobeto esan behar dut');
});

test('Hobe esanda → Hobeto esanda (Title case, sentence start)', () => {
  eq(rule('Hobe esanda, ez da horrela'), 'Hobeto esanda, ez da horrela');
});

test('HOBE ESANDA → HOBETO ESANDA (UPPER case)', () => {
  eq(rule('HOBE ESANDA, ez da horrela'), 'HOBETO ESANDA, ez da horrela');
});

test('hobe alone NOT flagged (valid adjective = better)', () => {
  eq(rule('hobe da horrela'), 'hobe da horrela');
});

test('hobeto alone NOT flagged (already correct adverb)', () => {
  eq(rule('hobeto esanda, ez da horrela'), 'hobeto esanda, ez da horrela');
});

test('hobeto not re-flagged after correction', () => {
  const corrected = rule('hobe esanda, ez da horrela');
  eq(corrected, 'hobeto esanda, ez da horrela');
  eq(rule(corrected), corrected);
});

// ── Integration with full rule stack ────────────────

console.log('\n─ Full-stack integration ─');

test('calque + zalantza in same sentence (no conflict)', () => {
  // belgiar is in zalantza, balore is in calque — both should correct.
  // Full stack also capitalizes first letter + adds terminal period.
  eq(all('belgiar balore bat'), 'Belgikar balio bat.');
});

test('calque phrase + zalantza word in same sentence', () => {
  // aborto (zalantza) + pena merezi (calque phrase).
  // Declined 'abortoak' wouldn't match — using undeclined form.
  eq(all('aborto pena merezi du'), 'Abortu merezi du.');
});

test('all calque types together', () => {
  // belgiar (zalantza) + balore, erasokor (calque) + pena merezi (calque phrase)
  eq(all('belgiar balore erasokor bat pena merezi du'), 'Belgikar balio erasotzaile bat merezi du.');
});

test('calque rule does not break normal text', () => {
  eq(all('Kaixo, egun on guztiei.'), 'Kaixo, egun on guztiei.');
});

test('EBE example: balore moral → balio moral', () => {
  // Full stack adds terminal period (input already Title-cased)
  eq(all('Balore moral bat da elkartasuna'), 'Balio moral bat da elkartasuna.');
});

test('EBE example: pena merezi → merezi', () => {
  // Full stack adds terminal period (Ez already capitalized)
  eq(all('Ez du pena merezi hori egitea'), 'Ez du merezi hori egitea.');
});

test('EBE example: zentzu bakarreko → noranzko bakarreko', () => {
  // Full stack: sentence-initial-cap fires first (zentzu→Zentzu),
  // then calque phrase (Zentzu→Noranzko via matchCase), then terminal period
  eq(all('zentzu bakarreko errepidea'), 'Noranzko bakarreko errepidea.');
});

// ── Summary ─────────────────────────────────────────

console.log(`\n${'═'.repeat(59)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(59)}`);
process.exit(failed > 0 ? 1 : 0);
