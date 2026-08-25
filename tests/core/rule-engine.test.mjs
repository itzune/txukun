/**
 * Rule engine unit tests — runs WITHOUT the model (instant).
 *
 * Tests the src/core/ rule engine in isolation against simulated model outputs
 * (the F1 failure cases where the model returns input unchanged or nearly so).
 * The full model+rules integration is tested by tests/cap-punct/eval.mjs.
 *
 * Run:  npm run test:core
 *       node tests/core/rule-engine.test.mjs
 */

import { tokenize, Document, firstWord, lastNonWhitespace } from '../../src/core/document.js';
import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';

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

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  TXUKUN RULE ENGINE — unit tests                          ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// ── Tokenizer ───────────────────────────────────────

console.log('Tokenizer:');
test('tokenize produces correct spans', () => {
  const tokens = tokenize('Etorri da gaur.');
  eq(tokens.length, 6, 'token count');
  eq(tokens[0].text, 'Etorri', 'first word');
  eq(tokens[0].start, 0, 'first start');
  eq(tokens[0].end, 6, 'first end');
  eq(tokens[0].kind, 'word', 'first kind');
  eq(tokens[5].text, '.', 'last punct');
  eq(tokens[5].kind, 'punctuation', 'last kind');
});

test('tokenize handles Basque accented chars', () => {
  const tokens = tokenize('Bañu üñé.');
  eq(tokens[0].text, 'Bañu', 'word with ñ');
  eq(tokens[0].kind, 'word');
});

test('tokenize handles multiple punctuation', () => {
  const tokens = tokenize('zer?!');
  eq(tokens[1].text, '?!', 'combined punct');
  eq(tokens[1].kind, 'punctuation');
});

// ── Document / iterSentences ────────────────────────

console.log('\nDocument:');
test('iterSentences: one sentence (no punct)', () => {
  const doc = new Document('etorri da gaur');
  const sents = doc.iterSentences();
  eq(sents.length, 1, 'sentence count');
});

test('iterSentences: splits on sentence-ending punct', () => {
  const doc = new Document('A etorri da. B joan da.');
  const sents = doc.iterSentences();
  eq(sents.length, 2, 'sentence count');
});

test('iterSentences: splits on ?', () => {
  const doc = new Document('Nora zoaz? Non bizi zara?');
  const sents = doc.iterSentences();
  eq(sents.length, 2, 'sentence count');
});

test('firstWord / lastNonWhitespace navigation', () => {
  const doc = new Document('  etorri da gaur  ');
  const sents = doc.iterSentences();
  const first = firstWord(sents[0]);
  const last = lastNonWhitespace(sents[0]);
  eq(first.text, 'etorri');
  eq(last.text, 'gaur');
});

// ── Rule: sentence-initial-cap ──────────────────────

console.log('\nsentence-initial-cap:');
test('capitalizes lowercase first word', () => {
  const { corrected, lints } = runRules('etorri da gaur', allRules);
  eq(corrected, 'Etorri da gaur.', 'cap + punct applied');
  eq(lints.length, 2, '2 lints applied (cap + punct)');
});

test('skips already-capitalized first word', () => {
  const { corrected, lints } = runRules('Etorri da gaur.', allRules);
  eq(corrected, 'Etorri da gaur.', 'unchanged');
  eq(lints.length, 0, 'no lints');
});

// ── Rule: terminal-punct ────────────────────────────

console.log('\nterminal-punct:');
test('adds period to declarative', () => {
  const { corrected } = runRules('etorri da gaur', allRules);
  eq(corrected, 'Etorri da gaur.', 'period added');
});

test('adds ? to interrogative (non)', () => {
  const { corrected } = runRules('non bizi zara', allRules);
  eq(corrected, 'Non bizi zara?', 'question mark added');
});

test('adds ? to interrogative (nora)', () => {
  const { corrected } = runRules('nora zoaz', allRules);
  eq(corrected, 'Nora zoaz?', 'question mark added');
});

test('adds ? to interrogative (zer)', () => {
  const { corrected } = runRules('zer moduz zaude', allRules);
  eq(corrected, 'Zer moduz zaude?', 'question mark added');
});

test('skips sentence with existing terminal punct', () => {
  const { corrected, lints } = runRules('Bihar etorriko naiz.', allRules);
  eq(corrected, 'Bihar etorriko naiz.', 'unchanged');
  eq(lints.length, 0, 'no lints');
});

test('skips question with existing ?', () => {
  const { corrected, lints } = runRules('Nora zoaz?', allRules);
  eq(corrected, 'Nora zoaz?', 'unchanged');
  eq(lints.length, 0, 'no lints');
});

// ── Combined F1 failure simulations ─────────────────

console.log('\nF1 failure simulations (simulated model output → rules):');
test('c001: "etorri da gaur" → "Etorri da gaur."', () => {
  const { corrected } = runRules('etorri da gaur', allRules);
  eq(corrected, 'Etorri da gaur.');
});

test('c024: "bizi naiz irailean" → "Bizi naiz irailean."', () => {
  const { corrected } = runRules('bizi naiz irailean', allRules);
  eq(corrected, 'Bizi naiz irailean.');
});

test('c043: "Non bizi zara" → "Non bizi zara?"', () => {
  // Model outputs capped but no ?
  const { corrected } = runRules('Non bizi zara', allRules);
  eq(corrected, 'Non bizi zara?');
});

// ── Don't-break-passing-cases ───────────────────────

console.log('\nRegression guard (don\'t break passing cases):');
test('c002: "Bihar etorriko naiz." unchanged', () => {
  const { corrected } = runRules('Bihar etorriko naiz.', allRules);
  eq(corrected, 'Bihar etorriko naiz.');
});

test('c020: "Etorriko naiz astelehena." unchanged (days lowercase)', () => {
  const { corrected } = runRules('Etorriko naiz astelehena.', allRules);
  eq(corrected, 'Etorriko naiz astelehena.');
});

test('c050: "Gaur eguzkia atera da." unchanged', () => {
  const { corrected } = runRules('Gaur eguzkia atera da.', allRules);
  eq(corrected, 'Gaur eguzkia atera da.');
});

test('c065: "Sagarra, laranja eta banana erosi ditut." unchanged', () => {
  const { corrected } = runRules('Sagarra, laranja eta banana erosi ditut.', allRules);
  eq(corrected, 'Sagarra, laranja eta banana erosi ditut.');
});

// ── Rule: vocative-comma ────────────────────────────

console.log('\nvocative-comma:');
test('inserts comma after kaixo', () => {
  const { corrected } = runRules('kaixo egun on guztioi', allRules);
  eq(corrected, 'Kaixo, egun on guztioi.');
});

test('inserts comma after kaixo + name', () => {
  const { corrected } = runRules('kaixo mikel', allRules);
  // Note: 'mikel' stays lowercase — proper-noun cap is a future rule (batch 2)
  eq(corrected, 'Kaixo, mikel.');
});

test('skips when comma already present', () => {
  const { corrected, lints } = runRules('Kaixo, Mikel!', allRules);
  eq(corrected, 'Kaixo, Mikel!');
  eq(lints.length, 0, 'no lints — comma already there');
});

test('skips greeting-only sentence (no comma needed)', () => {
  const { corrected, lints } = runRules('kaixo', allRules);
  eq(corrected, 'Kaixo.');
  // No vocative comma (no content after greeting), but cap+punct still fire
});

test('c080: "kaixo egun on guztioi" → "Kaixo, egun on guztioi."', () => {
  const { corrected } = runRules('kaixo egun on guztioi', allRules);
  eq(corrected, 'Kaixo, egun on guztioi.');
});

// ── Idempotency ─────────────────────────────────────

console.log('\nIdempotency:');
test('running rules twice = once', () => {
  const { corrected: once } = runRules('etorri da gaur', allRules);
  const { corrected: twice, lints } = runRules(once, allRules);
  eq(twice, once, 'no further changes');
  eq(lints.length, 0, 'no lints on second pass');
});

test('empty string', () => {
  const { corrected, lints } = runRules('', allRules);
  eq(corrected, '');
  eq(lints.length, 0);
});

test('whitespace only', () => {
  const { corrected, lints } = runRules('   ', allRules);
  eq(corrected, '   ');
  eq(lints.length, 0);
});

// ── Summary ─────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.error('✗ Rule engine tests FAILED');
  process.exit(1);
} else {
  console.log('✓ All rule engine tests passed');
}
