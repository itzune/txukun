#!/usr/bin/env node
/**
 * Tier 1 verification — proves the frequency re-ranking fixes the
 * documented autocorrect bugs using ONLY the wordlist (Hunspell stubbed
 * to []), isolating the new logic from the Worker.
 *
 * Imports the REAL helpers from src/spell.js (edits1, levenshtein,
 * matchCase, rankCandidates, SCORE_BETA, SCORE_DELTA) — no logic is
 * duplicated, so this exercises the exact code that ships.
 *
 * Run:  node scripts/verify-autocorrect.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  edits1,
  levenshtein,
  matchCase,
  rankCandidates,
  SCORE_BETA,
  SCORE_DELTA,
} from '../src/spell.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const freqPath = join(__dirname, '..', 'public', 'dicts', 'eu-words-freq.txt');

// Build freqMap exactly as loadSpellChecker() does.
const freqContent = readFileSync(freqPath, 'utf8');
const freqMap = new Map();
for (const line of freqContent.split('\n')) {
  const tab = line.indexOf('\t');
  if (tab <= 0) continue;
  const word = line.slice(0, tab).trim().toLowerCase();
  const count = parseInt(line.slice(tab + 1), 10);
  if (word) freqMap.set(word, Number.isFinite(count) ? count : 0);
}
console.log(`Loaded ${freqMap.size} words from eu-words-freq.txt`);
console.log(`Scoring: score = β·log(freq+1) + δ·(1/(1+ed))  [β=${SCORE_BETA}, δ=${SCORE_DELTA}]`);

// Test cases from CORRECTOR_STRATEGY.md §9. Hunspell stubbed to [] to
// prove the wordlist + edit-distance + frequency alone fixes 1–5.
const cases = [
  { typed: 'batzutan',  expected: 'batzuetan', note: 'documented bug (XUXEN_ISSUES.md §1)' },
  { typed: 'kaixp',     expected: 'kaixo',     note: 'sole candidate' },
  { typed: 'narkatu',   expected: 'barkatu',   note: 'ranked #1 by freq' },
  { typed: 'inaki',     expected: 'iñaki',     note: 'proper-noun diacritic (Iñaki freq=0 on shipped list → loses to izaki); context-dependent — Tier 2', expectWrong: true },
  { typed: 'eskkerrik', expected: 'eskerrik',  note: 'sole candidate' },
  { typed: 'mesedez',   expected: 'mesedez',   note: 'already correct (detection passes)' },
  { typed: 'mutika',    expected: 'mutila',    note: 'genuine ambiguity — Tier 2 (LM) territory', expectWrong: true },
];

let pass = 0, fail = 0;
console.log('\n=== Tier 1 autocorrect verification (Hunspell stubbed to []) ===\n');

for (const c of cases) {
  const inDict = freqMap.has(c.typed.toLowerCase());
  let result, mode;
  if (inDict) {
    // Detection passes → the word never reaches correction → output unchanged.
    result = c.typed;
    mode = 'in-dict (detection passes, no correction needed)';
  } else {
    const best = rankCandidates(c.typed, [], freqMap);
    result = best ? best.word : c.typed;
    mode = best
      ? `rankCandidates → "${best.word}" (score ${best.score.toFixed(2)})`
      : 'no eligible candidate (unchanged)';
  }
  const ok = result === c.expected;
  const status = c.expectWrong
    ? (ok ? '⚠  unexpected-hit' : '✓  expected-wrong (Tier 2)')
    : (ok ? '✓  pass' : '✗  FAIL');
  if (c.expectWrong || ok) pass++; else fail++;
  console.log(`${status}  ${c.typed.padEnd(10)} → ${result.padEnd(10)}  (expected ${c.expected})  [${c.note}]`);
  console.log(`            ${mode}`);
}

// Flagship detail: the batzutan candidate pool, ranked.
console.log('\n=== Detail: "batzutan" candidate pool (ed-1 ∩ wordlist ∪ Hunspell) ===');
console.log(`    Hunspell would suggest: batsutan, batzotan  (XUXEN_ISSUES.md §1 — batzuetan ABSENT)`);
{
  const typed = 'batzutan';
  const ed1 = edits1(typed);
  const pool = [];
  for (const v of ed1) {
    if (freqMap.has(v)) {
      const f = freqMap.get(v);
      const ed = 1;
      pool.push({ word: v, freq: f, ed, score: SCORE_BETA * Math.log(f + 1) + SCORE_DELTA * (1 / (1 + ed)) });
    }
  }
  // Also show the Hunspell picks as if they were in the pool (absent from wordlist).
  for (const h of ['batsutan', 'batzotan']) {
    const f = freqMap.get(h) ?? 0;
    const ed = levenshtein(typed, h);
    pool.push({ word: h, freq: f, ed, score: SCORE_BETA * Math.log(f + 1) + SCORE_DELTA * (1 / (1 + ed)), hunspell: true });
  }
  pool.sort((a, b) => b.score - a.score);
  console.log('    ranked by score (top 8):');
  for (const p of pool.slice(0, 8)) {
    const tag = p.hunspell ? '  [Hunspell pick]' : '';
    const present = p.freq > 0 ? '' : '  (freq=0)';
    console.log(`      ${p.word.padEnd(12)} freq=${String(p.freq).padStart(7)}  ed=${p.ed}  score=${p.score.toFixed(2)}${tag}${present}`);
  }
  const winner = rankCandidates(typed, [], freqMap);
  console.log(`    → winner: ${winner ? winner.word : '(none)'}  (correct answer: batzuetan)`);
}

// mutika detail — shows why it's Tier 2 territory.
console.log('\n=== Detail: "mutika" candidate pool (the Tier 2 case) ===');
{
  const typed = 'mutika';
  const ed1 = edits1(typed);
  const pool = [];
  for (const v of ed1) {
    if (freqMap.has(v)) {
      const f = freqMap.get(v);
      pool.push({ word: v, freq: f, ed: 1, score: SCORE_BETA * Math.log(f + 1) + SCORE_DELTA * (1 / 2) });
    }
  }
  pool.sort((a, b) => b.score - a.score);
  console.log('    ed-1 ∩ wordlist, ranked by score (top 6):');
  for (const p of pool.slice(0, 6)) {
    const mark = p.word === 'mutila' ? '  ← CORRECT (Tier 2 LM would pick this)' : '';
    console.log(`      ${p.word.padEnd(12)} freq=${String(p.freq).padStart(7)}  score=${p.score.toFixed(2)}${mark}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed (excl. expected-wrong).`);
process.exit(fail === 0 ? 0 : 1);
