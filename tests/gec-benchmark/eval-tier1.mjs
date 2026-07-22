/**
 * Tier 1 evaluation harness — measures spelling correction accuracy
 * and false-positive rate using the Elhuyar GEC benchmark.
 *
 * Runs in Node.js (no browser needed). Tests the pure-JS candidate
 * ranking: edits1 ∩ wordlist ∪ hunspellSuggestions, scored by
 * β·log(freq+1) + δ·(1/(1+ed)).
 *
 * The scoring functions below are copies of src/spell.js exports.
 * If spell.js scoring changes, update these to match and re-run.
 *
 * Usage:
 *   node tests/gec-benchmark/eval-tier1.mjs
 *
 * Metrics:
 *   - Spelling: detection rate, candidate coverage, top-1, top-5 accuracy
 *   - False positives: false detection rate, false correction rate
 *   - Grammar: baseline correction rate (expected ~0% — real-word errors)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateTypoSentences } from './lib/typo-gen.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ════════════════════════════════════════════════════
//  Scoring functions (copied from src/spell.js — keep in sync)
// ════════════════════════════════════════════════════

const SCORE_BETA = 0.3;
const SCORE_DELTA = 0.5;
const EU_ALPHABET = 'abcdefghijklmnopqrstuvwxyzáéíóúüñçàèìòùâêîôû';

function edits1(word) {
  const w = (word || '').toLowerCase();
  const splits = [];
  for (let i = 0; i <= w.length; i++) splits.push([w.slice(0, i), w.slice(i)]);
  const results = new Set();
  for (const [a, b] of splits) {
    if (b.length > 0) results.add(a + b.slice(1));
    if (b.length > 1) results.add(a + b[1] + b[0] + b.slice(2));
    for (const c of EU_ALPHABET) {
      if (b.length > 0) results.add(a + c + b.slice(1));
      results.add(a + c + b);
    }
  }
  results.delete(w);
  return results;
}

function levenshtein(a, b) {
  a = (a || '').toLowerCase();
  b = (b || '').toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

function matchCase(source, target) {
  if (!source || !target) return target;
  const letters = [...source].filter(ch => /\p{L}/u.test(ch));
  if (letters.length === 0) return target;
  const isUpper = ch => ch.toLowerCase() !== ch && ch.toUpperCase() === ch;
  const upperCount = letters.filter(isUpper).length;
  if (upperCount === letters.length && letters.length > 1) return target.toUpperCase();
  if (isUpper(letters[0]) && letters.slice(1).every(ch => !isUpper(ch))) {
    const t = target.toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return target.toLowerCase();
}

function getRankedCandidates(typed, hunspellSuggestions, fmap) {
  if (!typed) return [];
  const typedLower = typed.toLowerCase();
  const ed1Variants = edits1(typedLower);
  const pool = new Set();
  for (const v of ed1Variants) {
    if (fmap.has(v)) pool.add(v);
  }
  if (Array.isArray(hunspellSuggestions)) {
    for (const s of hunspellSuggestions) {
      if (!s) continue;
      const sLow = s.toLowerCase();
      if (sLow !== typedLower) pool.add(sLow);
    }
  }
  const ranked = [];
  for (const cand of pool) {
    const freq = fmap.get(cand) ?? 0;
    const ed = ed1Variants.has(cand) ? 1 : levenshtein(typedLower, cand);
    if (freq <= 0 && ed !== 1) continue;
    const score = SCORE_BETA * Math.log(freq + 1) + SCORE_DELTA * (1 / (1 + ed));
    ranked.push({ word: cand, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map(c => ({ word: matchCase(typed, c.word), score: c.score }));
}

// ════════════════════════════════════════════════════
//  Data loading
// ════════════════════════════════════════════════════

function loadFreqMap() {
  const path = join(REPO_ROOT, 'public', 'dicts', 'eu-words-freq.txt');
  const content = readFileSync(path, 'utf-8');
  const map = new Map();
  for (const line of content.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const word = line.slice(0, tab).trim().toLowerCase();
    const count = parseInt(line.slice(tab + 1), 10);
    if (word) map.set(word, Number.isFinite(count) ? count : 0);
  }
  return map;
}

/**
 * Parse an Elhuyar TSV file.
 * Format: ORIGINAL_SENTENCE\tSENTENCE_WITH_ERRORS\tERROR_TYPES
 * Header row is skipped.
 */
function loadElhuyarTSV(filename) {
  const path = join(__dirname, 'elhuyar', filename);
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').slice(1).filter(l => l.trim()); // skip header
  return lines.map(line => {
    const parts = line.split('\t');
    return {
      correct: parts[0]?.trim() || '',
      erroneous: parts[1]?.trim() || '',
      errorTypes: parts[2]?.trim() || '',
    };
  }).filter(p => p.correct && p.erroneous);
}

/**
 * Find which words differ between correct and erroneous sentences.
 * Returns array of { correctWord, erroneousWord, position }.
 */
function findDifferences(correct, erroneous) {
  const cWords = correct.split(/\s+/);
  const eWords = erroneous.split(/\s+/);
  const diffs = [];
  const maxLen = Math.max(cWords.length, eWords.length);
  for (let i = 0; i < maxLen; i++) {
    if (cWords[i] !== eWords[i]) {
      // Strip punctuation for comparison
      const cw = (cWords[i] || '').replace(/[^A-Za-zÀ-ÿ''\-]/g, '');
      const ew = (eWords[i] || '').replace(/[^A-Za-zÀ-ÿ''\-]/g, '');
      if (cw && ew && cw.toLowerCase() !== ew.toLowerCase()) {
        diffs.push({ correctWord: cw, erroneousWord: ew, position: i });
      }
    }
  }
  return diffs;
}

/**
 * Tokenize text (Basque-aware, matches spell.js tokenize()).
 * Returns array of { word, start, end }.
 */
const WORD_RE = /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛçÇ''\-]+|\d+(?:[.,]\d+)*|https?:\/\/\S+|[\w.-]+@[\w.-]+/g;

function tokenize(text) {
  const tokens = [];
  let match;
  while ((match = WORD_RE.exec(text)) !== null) {
    tokens.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/**
 * Check if a word should be spell-checked (matches spell.js filter logic).
 */
function shouldCheckWord(word, prevWord) {
  if (/^\d+([.,]\d+)*$/.test(word)) return false;
  if (/^https?:\/\//.test(word)) return false;
  if (/@/.test(word)) return false;
  if (word.length < 2) return false;
  if (word === word.toUpperCase() && word.length > 1) return false;
  if (word.length <= 5 && prevWord && /^\d+([.,]\d+)*$/.test(prevWord)) return false;
  return true;
}

// ════════════════════════════════════════════════════
//  Evaluation
// ════════════════════════════════════════════════════

function evalSpellingCorrection(fmap, typoCases) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SPELLING CORRECTION (synthetic typos)');
  console.log('═══════════════════════════════════════════════════════\n');

  let total = 0;
  let detected = 0;        // typo word NOT in wordlist (correctly flagged)
  let hasCandidates = 0;   // getRankedCandidates returned ≥1 candidate
  let correctInPool = 0;   // correct word is in the candidate pool
  let top1 = 0;            // correct word ranked #1
  let top5 = 0;            // correct word in top 5

  const failures = [];

  for (const tc of typoCases) {
    for (const edit of tc.edits) {
      total++;
      const typoWord = edit.typo.toLowerCase();
      const correctWord = edit.word.toLowerCase();

      // Step 1: Detection — is the typo word in the wordlist?
      const inDict = fmap.has(typoWord);
      if (!inDict) detected++;

      // Step 2: Candidate generation
      const ranked = getRankedCandidates(edit.typo, [], fmap);
      if (ranked.length > 0) hasCandidates++;

      // Step 3: Is the correct word in the pool?
      const correctIdx = ranked.findIndex(c => c.word.toLowerCase() === correctWord);
      if (correctIdx >= 0) correctInPool++;

      // Step 4: Top-1
      if (correctIdx === 0) top1++;

      // Step 5: Top-5
      if (correctIdx >= 0 && correctIdx < 5) top5++;

      // Track failures for analysis
      if (correctIdx !== 0) {
        failures.push({
          typo: edit.typo,
          correct: edit.word,
          type: edit.type,
          detected: !inDict,
          correctInPool: correctIdx >= 0,
          correctRank: correctIdx,
          top3: ranked.slice(0, 3).map(c => `${c.word}(${c.score.toFixed(2)})`),
        });
      }
    }
  }

  console.log(`  Total typos:          ${total}`);
  console.log(`  Detected (∉ dict):    ${detected}  (${pct(detected, total)})`);
  console.log(`  Has candidates:       ${hasCandidates}  (${pct(hasCandidates, total)})`);
  console.log(`  Correct in pool:      ${correctInPool}  (${pct(correctInPool, total)})`);
  console.log(`  Top-1 accuracy:       ${top1}  (${pct(top1, total)})`);
  console.log(`  Top-5 accuracy:       ${top5}  (${pct(top5, total)})`);

  // Show sample failures
  console.log('\n  --- Sample failures (top-1 misses) ---');
  const sample = failures.slice(0, 15);
  for (const f of sample) {
    const rank = f.correctRank >= 0 ? `#${f.correctRank + 1}` : 'NOT IN POOL';
    const det = f.detected ? '✓' : '✗';
    console.log(`    [${det}] ${f.typo} → ${f.correct} (${rank}) [${f.type}]  top3: ${f.top3.join(', ')}`);
  }
  if (failures.length > 15) {
    console.log(`    ... and ${failures.length - 15} more failures`);
  }
}

function evalFalsePositives(fmap, correctSentences, label) {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  FALSE POSITIVES (${label})`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  let totalWords = 0;
  let checkedWords = 0;
  let falseDetections = 0;    // correct word NOT in wordlist
  let falseCorrections = 0;   // correct word would be "corrected" to something else

  const falsePositives = [];

  for (const sentence of correctSentences) {
    const tokens = tokenize(sentence);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const prevWord = i > 0 ? tokens[i - 1].word : null;
      if (!shouldCheckWord(tok.word, prevWord)) continue;

      totalWords++;
      checkedWords++;
      const wordLower = tok.word.toLowerCase();

      if (!fmap.has(wordLower)) {
        falseDetections++;
        // Would getRankedCandidates produce a "correction"?
        const ranked = getRankedCandidates(tok.word, [], fmap);
        if (ranked.length > 0) {
          falseCorrections++;
          if (falsePositives.length < 15) {
            falsePositives.push({
              word: tok.word,
              suggestion: ranked[0].word,
              score: ranked[0].score.toFixed(2),
              sentence: sentence.slice(0, 60) + '...',
            });
          }
        }
      }
    }
  }

  console.log(`  Sentences:            ${correctSentences.length}`);
  console.log(`  Words checked:        ${checkedWords}`);
  console.log(`  False detections:     ${falseDetections}  (${pct(falseDetections, checkedWords)})`);
  console.log(`  False corrections:    ${falseCorrections}  (${pct(falseCorrections, checkedWords)})`);

  if (falsePositives.length > 0) {
    console.log('\n  --- Sample false corrections ---');
    for (const fp of falsePositives) {
      console.log(`    ${fp.word} → ${fp.suggestion} (${fp.score})  | ${fp.sentence}`);
    }
  }
}

function evalGrammarBaseline(fmap, grammarCases, label) {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  GRAMMAR CORRECTION BASELINE (${label})`);
  console.log(`═══════════════════════════════════════════════════════\n`);

  let totalErrors = 0;
  let detected = 0;        // error word NOT in wordlist (unlikely for grammar)
  let correctInPool = 0;   // correct word in candidate pool
  let top1 = 0;

  for (const gc of grammarCases) {
    const diffs = findDifferences(gc.correct, gc.erroneous);
    for (const diff of diffs) {
      totalErrors++;
      const errWord = diff.erroneousWord.toLowerCase();
      const correctWord = diff.correctWord.toLowerCase();

      // Detection: is the erroneous word in the wordlist?
      if (!fmap.has(errWord)) detected++;

      // Would the correct word appear in candidates?
      const ranked = getRankedCandidates(diff.erroneousWord, [], fmap);
      const correctIdx = ranked.findIndex(c => c.word.toLowerCase() === correctWord);
      if (correctIdx >= 0) correctInPool++;
      if (correctIdx === 0) top1++;
    }
  }

  console.log(`  Cases:                ${grammarCases.length}`);
  console.log(`  Total error words:    ${totalErrors}`);
  console.log(`  Detected (∉ dict):    ${detected}  (${pct(detected, totalErrors)})`);
  console.log(`  Correct in pool:      ${correctInPool}  (${pct(correctInPool, totalErrors)})`);
  console.log(`  Top-1 (would fix):    ${top1}  (${pct(top1, totalErrors)})`);
  console.log(`  (Expected ~0% — grammar errors are real-word errors,`);
  console.log(`   not spelling. This is the baseline for Tier 2.5/3.)`);
}

function pct(n, total) {
  if (total === 0) return 'N/A';
  return `${(n / total * 100).toFixed(1)}%`;
}

// ════════════════════════════════════════════════════
//  Main
// ════════════════════════════════════════════════════

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  TXUKUN TIER 1 EVALUATION — Basque GEC Benchmark          ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Load frequency map
console.log('Loading frequency map (eu-words-freq.txt)...');
const fmap = loadFreqMap();
console.log(`  ${fmap.size} words loaded\n`);

// Load Elhuyar datasets
console.log('Loading Elhuyar datasets...');
const demNone = loadElhuyarTSV('Dem_none.tsv').map(p => p.correct);  // correct sentences
const demSingle = loadElhuyarTSV('Dem_single.tsv');
const demMulti = loadElhuyarTSV('Dem_multi.tsv');
const deaNone = loadElhuyarTSV('Dea_none.tsv').map(p => p.correct);
console.log(`  Dem_none: ${demNone.length} correct sentences`);
console.log(`  Dem_single: ${demSingle.length} grammar-error sentences`);
console.log(`  Dem_multi: ${demMulti.length} grammar-error sentences`);
console.log(`  Dea_none: ${deaNone.length} correct sentences`);

// Generate synthetic typos from Dem_none + Dea_none (correct sentences)
console.log('\nGenerating synthetic typos from correct sentences...');
const correctSentences = [...demNone, ...deaNone];
const typoCases = generateTypoSentences(correctSentences, 42, 1);
console.log(`  Generated ${typoCases.length} typo sentences`);

// ── Run evaluations ──

// 1. Spelling correction (synthetic typos)
evalSpellingCorrection(fmap, typoCases);

// 2. False positives (correct sentences — Dem_none, manually reviewed)
evalFalsePositives(fmap, demNone, 'Dem_none — manually reviewed');

// 3. Grammar baseline (Elhuyar Dem_single + Dem_multi)
evalGrammarBaseline(fmap, demSingle, 'Dem_single');
evalGrammarBaseline(fmap, demMulti, 'Dem_multi');

console.log('\n═══════════════════════════════════════════════════════');
console.log('  Done. Re-run with Tier 2 (LM re-ranking) to compare.');
console.log('═══════════════════════════════════════════════════════\n');
