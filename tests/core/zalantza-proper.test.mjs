/**
 * Txukun rule tests — Zalantza proper nouns (izendunak)
 *
 * Tests the zalantza-proper rule: EBE-grounded proper-noun spelling corrections.
 * Key difference from zalantza: proper nouns are ALWAYS capitalized, so
 * lowercase input → Title target (not lowercase target).
 *
 * Run: npm run test:core
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runRules } from '../../src/core/engine.js';
import zalantzaProper, { matchCaseProper } from '../../src/core/rules/zalantza-proper.js';
import { allRules } from '../../src/core/rules/index.js';

// Helper: run only the zalantza-proper rule, return applied lints.
function proper(text) {
  return runRules(text, [zalantzaProper]).lints;
}

// Helper: run the full rule stack, return corrected text.
function all(text) {
  return runRules(text, allRules).corrected;
}

describe('zalantza-proper — matchCaseProper()', () => {
  test('lowercase input → Title target (proper nouns always capitalized)', () => {
    assert.equal(matchCaseProper('ukrania', 'Ukraina'), 'Ukraina');
  });

  test('Title input → Title target', () => {
    assert.equal(matchCaseProper('Ukrania', 'Ukraina'), 'Ukraina');
  });

  test('UPPER input → UPPER target', () => {
    assert.equal(matchCaseProper('UKRANIA', 'Ukraina'), 'UKRAINA');
  });

  test('single-char UPPER input → Title (not UPPER, single char)', () => {
    // 'E' is both upper and lower; length 1 → treated as lowercase/Title, not UPPER
    // Actually 'E' === 'E'.toUpperCase() and length 1, so it falls to the lowercase check
    // (single char uppercase is ambiguous — treated as Title)
    assert.equal(matchCaseProper('E', 'Eva'), 'Eva');
  });

  test('mixed-case input → null (skip)', () => {
    assert.equal(matchCaseProper('uKrania', 'Ukraina'), null);
    assert.equal(matchCaseProper('ukRania', 'Ukraina'), null);
  });

  test('multi-word target: lowercase input → pre-capitalized target', () => {
    assert.equal(matchCaseProper('ertamerika', 'Erdialdeko Amerika'), 'Erdialdeko Amerika');
  });

  test('multi-word target: UPPER input → UPPER target', () => {
    assert.equal(matchCaseProper('ERTAMERIKA', 'Erdialdeko Amerika'), 'ERDIALDEKO AMERIKA');
  });

  test('contrast: matchCase would return lowercase, matchCaseProper returns Title', () => {
    // This is the key difference — for proper nouns, lowercase → Title (not lowercase)
    assert.equal(matchCaseProper('jerusalen', 'Jerusalem'), 'Jerusalem');
    assert.notEqual(matchCaseProper('jerusalen', 'Jerusalem'), 'jerusalem');
  });
});

describe('zalantza-proper — single-word corrections', () => {
  test('ukrania → Ukraina (lowercase input)', () => {
    const lints = proper('ukrania hiri handia da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Ukraina');
    assert.equal(lints[0].priority, 49);
  });

  test('Ukrania → Ukraina (Title input)', () => {
    const lints = proper('Ukrania hiri handia da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Ukraina');
  });

  test('UKRANIA → UKRAINA (UPPER input)', () => {
    const lints = proper('UKRANIA handia da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'UKRAINA');
  });

  test('troya → Troia', () => {
    const lints = proper('troya erori zen');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Troia');
  });

  test('kalagorria → Calahorra (exonimo, keep Spanish form)', () => {
    const lints = proper('kalagorria errioxako hiria da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Calahorra');
  });

  test('himalaya → Himalaia', () => {
    const lints = proper('himalaya mendi handia da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Himalaia');
  });

  test('adan → Adam', () => {
    const lints = proper('adan lehen gizona izan zen');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Adam');
  });

  test('jesukristo → Jesu Kristo (one word → two words)', () => {
    const lints = proper('jesukristo jaio zen');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Jesu Kristo');
  });

  test('pertsia → Persia (don\'t over-Basquize)', () => {
    const lints = proper('pertsia inperioa');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Persia');
  });

  test('gorbea → Gorbeia (mountain)', () => {
    const lints = proper('gorbea mendi tontorra');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Gorbeia');
  });

  test('pirineoak → Pirinioak', () => {
    const lints = proper('pirineoak mendiak dira');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Pirinioak');
  });

  test('auñamendiak → Pirinioak (Navarrese → Batua)', () => {
    const lints = proper('auñamendiak zeharkatu zituen');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Pirinioak');
  });
});

describe('zalantza-proper — single-word → multi-word target', () => {
  test('ertamerika → Erdialdeko Amerika', () => {
    const lints = proper('ertamerika eskualdea');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Erdialdeko Amerika');
  });

  test('Ertamerika → Erdialdeko Amerika (Title)', () => {
    const lints = proper('Ertamerika herrialdea');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Erdialdeko Amerika');
  });

  test('ERTAMERIKA → ERDIALDEKO AMERIKA (UPPER)', () => {
    const lints = proper('ERTAMERIKA handia');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'ERDIALDEKO AMERIKA');
  });

  test('ertaroa → Erdi Aroa', () => {
    const lints = proper('ertaroa historialarik aztertu du');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Erdi Aroa');
  });

  test('Jesukristo → Jesu Kristo (Title input)', () => {
    const lints = proper('Jesukristo jaio zen');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Jesu Kristo');
  });
});

describe('zalantza-proper — phrase corrections', () => {
  test('big-bang → Big Bang (hyphenated → space)', () => {
    const lints = proper('big-bang teoria ezaguna da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Big Bang');
    assert.equal(lints[0].priority, 50);
  });

  test('Big-bang → Big Bang (Title first word)', () => {
    const lints = proper('Big-bang teoria');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Big Bang');
  });

  test('BIG-BANG → BIG BANG (UPPER)', () => {
    const lints = proper('BIG-BANG teoria');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'BIG BANG');
  });

  test('deba behea → Debabarrena (space phrase)', () => {
    const lints = proper('deba behea eskualdea');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Debabarrena');
  });

  test('Deba garaia → Debagoiena (Title phrase)', () => {
    const lints = proper('Deba garaia eskualdea');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Debagoiena');
  });

  test('big bang (space, not hyphen) → NOT matched (different RED)', () => {
    // "big bang" with space is NOT the RED — only "big-bang" (hyphen) is
    const lints = proper('big bang teoria');
    assert.equal(lints.length, 0);
  });
});

describe('zalantza-proper — guards', () => {
  test('idempotency: already-correct form is not re-flagged', () => {
    assert.equal(proper('Ukraina hiri handia da').length, 0);
    assert.equal(proper('Troia erori zen').length, 0);
    assert.equal(proper('Himalaia mendi handia da').length, 0);
  });

  test('idempotency: phrase targets not re-flagged', () => {
    assert.equal(proper('Big Bang teoria da').length, 0);
    assert.equal(proper('Debabarrena eskualdea').length, 0);
  });

  test('mixed-case input is skipped (proper-noun guard)', () => {
    // Mixed-case = probably intentional, don't touch
    assert.equal(proper('uKrania hiria').length, 0);
    assert.equal(proper('tRoYa hiria').length, 0);
  });

  test('non-proper-noun words are not flagged', () => {
    assert.equal(proper('etxea handia da').length, 0);
    assert.equal(proper('kaixo zer moduz').length, 0);
  });

  test('correct word in context: proper noun only flagged when misspelled', () => {
    // "Jerusalem" is correct — should not be flagged
    assert.equal(proper('Jerusalem hiri sakratua da').length, 0);
    // "jerusalen" is misspelled — should be flagged
    const lints = proper('jerusalen hiri sakratua da');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].suggestions[0].text, 'Jerusalem');
  });

  test('UPPER idempotency: UKRAINA (already correct UPPER) not flagged', () => {
    assert.equal(proper('UKRAINA handia').length, 0);
  });
});

describe('zalantza-proper — full-stack integration (all rules)', () => {
  test('all(): ukrania → Ukraina (rule + sentence cap)', () => {
    // Sentence-initial: sentence-initial-cap rule capitalizes first letter
    // zalantza-proper: ukrania → Ukraina
    // terminal-punct: adds period
    const result = all('ukrania hiri handia da');
    assert.equal(result, 'Ukraina hiri handia da.');
  });

  test('all(): troya in mid-sentence', () => {
    const result = all('troiako gerra troya hiriaren ingurukoa zen');
    // "troiako" is NOT "troya" — it's a declined form, not matched
    // "troya" IS matched → Troia
    // sentence-initial-cap: T → troiako
    // terminal-punct: adds period
    assert.equal(result, 'Troiako gerra Troia hiriaren ingurukoa zen.');
  });

  test('all(): big-bang → Big Bang', () => {
    const result = all('big-bang teoria ezaguna da');
    assert.equal(result, 'Big Bang teoria ezaguna da.');
  });

  test('all(): kalagorria → Calahorra', () => {
    const result = all('kalagorria errioxako hiria da');
    assert.equal(result, 'Calahorra errioxako hiria da.');
  });

  test('all(): ertaroa → Erdi Aroa', () => {
    const result = all('ertaroa historialarik aztertu du');
    assert.equal(result, 'Erdi Aroa historialarik aztertu du.');
  });

  test('all(): multiple proper nouns in one sentence', () => {
    const result = all('jerusalen eta troya hiri zaharrak dira');
    assert.equal(result, 'Jerusalem eta Troia hiri zaharrak dira.');
  });

  test('all(): no false positive on correct proper nouns', () => {
    const result = all('Jerusalem hiri sakratua da');
    assert.equal(result, 'Jerusalem hiri sakratua da.');
  });
});

describe('zalantza-proper — LintKind', () => {
  test('uses LintKind.Confusable', () => {
    const lints = proper('ukrania hiria');
    assert.equal(lints.length, 1);
    assert.equal(lints[0].kind, 'Confusable');
  });

  test('message includes EBE attribution', () => {
    const lints = proper('ukrania hiria');
    assert.equal(lints.length, 1);
    assert.ok(lints[0].message.includes('EBE'));
    assert.ok(lints[0].message.includes('Ukraina'));
  });
});
