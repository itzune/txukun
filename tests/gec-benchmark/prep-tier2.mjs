/**
 * Prepares Tier 2 evaluation inputs — generates typo cases, runs Tier 1,
 * and saves candidates + context as JSON for the browser-based Tier 2 eval.
 *
 * The browser page (eval-tier2.html) loads this JSON, runs wllama surprisal
 * scoring on each candidate, and compares Tier 1 vs Tier 2 ranking.
 *
 * Usage:
 *   node tests/gec-benchmark/prep-tier2.mjs
 *
 * Output: tests/gec-benchmark/tier2-inputs.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateTypoSentences } from './lib/typo-gen.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ── Scoring functions (copied from src/spell.js — keep in sync) ──

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
  a = (a || '').toLowerCase(); b = (b || '').toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  let prev = new Array(n + 1), curr = new Array(n + 1);
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
  for (const v of ed1Variants) if (fmap.has(v)) pool.add(v);
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

// ── Data loading ──

function loadFreqMap() {
  const content = readFileSync(join(REPO_ROOT, 'public', 'dicts', 'eu-words-freq.txt'), 'utf-8');
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

function loadCorrectSentences(filename) {
  const path = join(__dirname, 'elhuyar', filename);
  const content = readFileSync(path, 'utf-8');
  return content.split('\n').slice(1).filter(l => l.trim())
    .map(line => line.split('\t')[0]?.trim() || '')
    .filter(s => s);
}

// ── Main ──

console.log('Preparing Tier 2 evaluation inputs...\n');

const fmap = loadFreqMap();
console.log(`Frequency map: ${fmap.size} words`);

const correctSentences = [
  ...loadCorrectSentences('Dem_none.tsv'),
  ...loadCorrectSentences('Dea_none.tsv'),
];
console.log(`Correct sentences: ${correctSentences.length}`);

const typoCases = generateTypoSentences(correctSentences, 42, 1);
console.log(`Typo cases generated: ${typoCases.length}`);

// Build Tier 2 evaluation inputs
const inputs = [];
let skipped = 0;

for (const tc of typoCases) {
  for (const edit of tc.edits) {
    const ranked = getRankedCandidates(edit.typo, [], fmap);

    // Only include cases with ≥2 candidates (Tier 2 can only help when there's a choice)
    if (ranked.length < 2) {
      skipped++;
      continue;
    }

    // Extract context: text before the typo word in the erroneous sentence
    const errWords = tc.erroneous.split(/\s+/);
    const contextWords = errWords.slice(0, edit.position);
    const context = contextWords.join(' ');

    const correctLower = edit.word.toLowerCase();
    const tier1Rank = ranked.findIndex(c => c.word.toLowerCase() === correctLower);

    inputs.push({
      typo: edit.typo,
      correct: edit.word,
      typoType: edit.type,
      context,
      sentence: tc.erroneous,
      candidates: ranked.slice(0, 5).map(c => ({
        word: c.word,
        score: parseFloat(c.score.toFixed(4)),
      })),
      tier1Correct: tier1Rank === 0,
      tier1Rank: tier1Rank, // -1 = not in pool
    });
  }
}

console.log(`Cases with ≥2 candidates: ${inputs.length} (skipped ${skipped})`);

const tier1Success = inputs.filter(i => i.tier1Correct).length;
const tier1FailButFixable = inputs.filter(i => !i.tier1Correct && i.tier1Rank >= 0).length;
const tier1NotInPool = inputs.filter(i => i.tier1Rank < 0).length;

console.log(`  Tier 1 top-1 correct:    ${tier1Success}`);
console.log(`  Tier 1 wrong but fixable: ${tier1FailButFixable} (correct word in pool, not #1)`);
console.log(`  Correct NOT in pool:     ${tier1NotInPool} (Tier 2 can't help)`);

// Save JSON
const outputPath = join(__dirname, 'tier2-inputs.json');
writeFileSync(outputPath, JSON.stringify(inputs, null, 0)); // no indent = smaller file
console.log(`\nSaved ${inputs.length} cases to ${outputPath}`);
console.log(`File size: ${(inputs.length * 200 / 1024).toFixed(0)} KB (approx)`);
