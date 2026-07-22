/**
 * Tier 2 evaluation driver — uses Playwright to run the browser-based
 * LM re-ranking evaluation against the Elhuyar GEC benchmark.
 *
 * Selects a stratified subset:
 *   - All "fixable" cases (Tier 1 wrong, correct word in candidate pool)
 *   - 100 random Tier 1 successes (to check Tier 2 doesn't break them)
 *
 * Usage:
 *   NODE_PATH=$(npm root -g) node tests/gec-benchmark/run-tier2.mjs
 *
 * Prerequisites:
 *   - Vite dev server is started: npm run dev
 *   - GGUF model at public/models/eu_futo_v2_nobos.gguf
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load and select test cases ──

const allInputs = JSON.parse(
  readFileSync(join(__dirname, 'tier2-inputs.json'), 'utf-8')
);

const fixable = allInputs.filter(i => !i.tier1Correct && i.tier1Rank >= 0);
const successes = allInputs.filter(i => i.tier1Correct);
const notInPool = allInputs.filter(i => i.tier1Rank < 0);

console.log(`Total cases: ${allInputs.length}`);
console.log(`  Tier 1 successes:   ${successes.length}`);
console.log(`  Fixable (T1✗, in pool): ${fixable.length}`);
console.log(`  Not in pool:        ${notInPool.length}`);

// Select subset: all fixable + 100 random successes
const NUM_SUCCESSES = 100;
const shuffledSuccesses = successes.sort(() => Math.random() - 0.5).slice(0, NUM_SUCCESSES);
const subset = [...fixable, ...shuffledSuccesses].sort(() => Math.random() - 0.5);

console.log(`\nSelected subset: ${subset.length} cases`);
console.log(`  Fixable: ${fixable.length}`);
console.log(`  Successes: ${shuffledSuccesses.length}`);
console.log(`  Estimated time: ~${Math.round(subset.length * 0.75)}s (${Math.round(subset.length * 0.75 / 60)}min)\n`);

// ── Run Playwright evaluation ──

const PAGE_URL = process.argv[2] || 'http://localhost:3001/txukun/eval-tier2.html';

console.log(`Connecting to ${PAGE_URL}...`);
console.log('(Make sure the Vite dev server is running)\n');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(900000); // 15 minutes

// Capture console messages for debugging
page.on('console', msg => {
  const text = msg.text();
  if (text.includes('wllama') || text.includes('txukun LM') || text.includes('DEBUG')) {
    console.log(`[browser] ${text}`);
  }
});

// Inject test data before page scripts run
await page.addInitScript((data) => {
  window.__tier2Inputs = data;
}, subset);

console.log('Navigating to eval-tier2.html...');
await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });

console.log('Waiting for model to load and evaluation to run...');
console.log('(This takes several minutes — each case requires multiple wllama calls)\n');

// Wait for completion (15-minute timeout)
try {
  await page.waitForFunction(() => window.__tier2Complete === true, null, { timeout: 900000 });
  
  const results = await page.evaluate(() => window.__tier2Results);
  
  if (results.error) {
    console.error('Evaluation failed:', results.error);
  } else {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  TIER 2 EVALUATION COMPLETE                              ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    const pct = (n, t) => `${(n / t * 100).toFixed(1)}%`;
    console.log(`  Total cases:          ${results.total}`);
    console.log(`  Tier 1 top-1 correct: ${results.tier1Correct}  (${pct(results.tier1Correct, results.total)})`);
    console.log(`  Tier 2 top-1 correct: ${results.tier2Correct}  (${pct(results.tier2Correct, results.total)})`);
    console.log(`  Tier 2 changed rank:  ${results.tier2Changed}  (${pct(results.tier2Changed, results.total)})`);
    console.log(`  LM fallback (all 0):  ${results.lmFallback}  (${pct(results.lmFallback, results.total)})`);
    console.log(`  Improved (T1✗→T2✓):   ${results.tier2Improved}`);
    console.log(`  Worsened (T1✓→T2✗):   ${results.tier2Worsened}`);
    console.log(`  Net improvement:      ${results.netImprovement >= 0 ? '+' : ''}${results.netImprovement} cases`);
    console.log(`  LM_WEIGHT:            ${results.lmWeight}`);
    
    const delta = results.tier2Correct - results.tier1Correct;
    console.log(`\n  Δ accuracy: ${delta >= 0 ? '+' : ''}${delta} cases (${delta >= 0 ? '+' : ''}${(delta / results.total * 100).toFixed(1)}pp)`);
    
    if (delta > 0) {
      console.log('\n  ✓ Tier 2 (LM re-ranking) IMPROVES on Tier 1.');
    } else if (delta < 0) {
      console.log('\n  ✗ Tier 2 (LM re-ranking) HURTS Tier 1. Consider tuning LM_WEIGHT.');
    } else {
      console.log('\n  → Tier 2 (LM re-ranking) has NO NET EFFECT. Consider tuning LM_WEIGHT.');
    }
  }
} catch (err) {
  console.error('Timeout or error waiting for evaluation:', err.message);
  
  // Try to read partial progress
  try {
    const progress = await page.evaluate(() => document.getElementById('progress')?.textContent || '');
    console.log('Last progress:', progress);
    const log = await page.evaluate(() => document.getElementById('log')?.textContent || '');
    console.log('Log (last 500 chars):', log.slice(-500));
  } catch (e) {
    console.error('Could not read partial results:', e.message);
  }
} finally {
  await browser.close();
}
