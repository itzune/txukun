/**
 * EBE syntactic-calque eval harness — measures the rule engine (and
 * optionally GECToR) against EBE §2 (Kalko morfosintaktikoak) examples.
 *
 * This is the measurement infrastructure for batch 3 (syntactic calques).
 * Per §7.11, the Elhuyar GEC benchmark does NOT cover calques/zalantzak, so
 * a separate eval suite is needed. EBE itself is the golden set.
 *
 * The harness runs in THREE modes:
 *   --rules    (default): rule engine only (allRules) — Txukun Lite baseline
 *   --gector   : + GECToR grammar model (downloads model on first run)
 *   --check    : validate cases.json structure only, no execution
 *
 * Metrics:
 *   - Strict exact-match % (normalized: case-insensitive, terminal-punct-stripped)
 *   - Per-tier breakdown (A/B/C/D/E — see cases.json tier_legend)
 *   - Per-subsection breakdown (2.1 noun-phrase / 2.2 verb / 2.3 clause)
 *   - Sample failures with tier + note
 *
 * The baseline (rules-only) is expected to be LOW (~0-10%) because most EBE §2
 * calques need POS/morphology (tier D) or are context-dependent (tier E).
 * This is intentional — it quantifies the gap that batch 3 rules + GECToR
 * integration would close. See RESEARCH.md §7.17 for the feasibility analysis.
 *
 * Usage:
 *   node tests/ebe-rules/eval.mjs                 # rules-only baseline (instant)
 *   node tests/ebe-rules/eval.mjs --check         # validate cases.json
 *   node tests/ebe-rules/eval.mjs --tier B        # filter by tier
 *   node tests/ebe-rules/eval.mjs --subsection 2.2
 *   node tests/ebe-rules/eval.mjs --gector        # + GECToR (slow, downloads model)
 *   node tests/ebe-rules/eval.mjs --verbose       # show all cases, not just failures
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const CHECK_ONLY = flag('--check');
const USE_GECTOR = flag('--gector');
const VERBOSE = flag('--verbose');
const TIER_FILTER = opt('--tier');
const SUBSECTION_FILTER = opt('--subsection');

// ── Load cases ─────────────────────────────────────

const casesPath = join(__dirname, 'cases.json');
const suite = JSON.parse(readFileSync(casesPath, 'utf-8'));

const cases = suite.cases;

// ── --check: validate structure only ───────────────

if (CHECK_ONLY) {
  console.log(`\nLoaded ${cases.length} cases from cases.json (v${suite.version})`);
  console.log(`Source: ${suite.source}\n`);

  // Validate required fields
  let errors = 0;
  const ids = new Set();
  for (const c of cases) {
    for (const f of ['id', 'subsection', 'category', 'tier', 'input', 'expected', 'note']) {
      if (!(f in c)) { console.log(`  ✗ ${c.id || '?'}: missing field '${f}'`); errors++; }
    }
    if (ids.has(c.id)) { console.log(`  ✗ duplicate id: ${c.id}`); errors++; }
    ids.add(c.id);
    if (!['A', 'B', 'C', 'D', 'E'].includes(c.tier)) {
      console.log(`  ✗ ${c.id}: invalid tier '${c.tier}'`); errors++;
    }
    if (!['2.1', '2.2', '2.3'].includes(c.subsection)) {
      console.log(`  ✗ ${c.id}: invalid subsection '${c.subsection}'`); errors++;
    }
  }

  // Summary
  const tiers = {};
  const subs = {};
  for (const c of cases) {
    tiers[c.tier] = (tiers[c.tier] || 0) + 1;
    subs[c.subsection] = (subs[c.subsection] || 0) + 1;
  }
  console.log('Cases by tier:');
  for (const t of ['A', 'B', 'C', 'D', 'E']) {
    console.log(`  ${t}: ${tiers[t] || 0}`);
  }
  console.log('\nCases by subsection:');
  for (const s of Object.keys(subs).sort()) {
    console.log(`  ${s}: ${subs[s]}`);
  }

  if (errors === 0) {
    console.log('\n✓ cases.json structure valid\n');
    process.exit(0);
  } else {
    console.log(`\n✗ ${errors} error(s) found\n`);
    process.exit(1);
  }
}

// ── Normalization ──────────────────────────────────

/**
 * Normalize text for fair comparison. The rule engine adds capitalization
 * (sentence-initial-cap) and terminal punctuation (terminal-punct) which are
 * NOT the calque fix being measured. Strip these so the comparison focuses on
 * whether the calque itself was corrected.
 */
function normalize(s) {
  return s
    .trim()
    .replace(/[.!?]+$/, '')    // strip terminal punctuation the rule engine adds
    .replace(/^["—]/, '')      // strip leading quote/dash (dialogue markers)
    .trim()
    .toLowerCase();
}

// ── Optionally load GECToR ─────────────────────────

let gectorCorrect = null;
if (USE_GECTOR) {
  console.log('Loading GECToR model (this may take a while on first run)...\n');
  try {
    const mod = await import('../../src/gector.js');
    if (mod.correctGrammar) {
      gectorCorrect = mod.correctGrammar;
      console.log('✓ GECToR loaded\n');
    } else {
      console.log('⚠ GECToR module has no correctGrammar export — running rules-only\n');
    }
  } catch (e) {
    console.log(`⚠ GECToR failed to load (${e.message}) — running rules-only\n`);
  }
}

// ── Run eval ───────────────────────────────────────

let filtered = cases;
if (TIER_FILTER) filtered = filtered.filter((c) => c.tier === TIER_FILTER);
if (SUBSECTION_FILTER) filtered = filtered.filter((c) => c.subsection === SUBSECTION_FILTER);

const mode = USE_GECTOR && gectorCorrect ? 'RULES + GECToR' : 'RULES ONLY';
console.log(`═══════════════════════════════════════════════════`);
console.log(`  EBE §2 syntactic-calque eval — ${mode}`);
console.log(`  ${filtered.length} case(s)${TIER_FILTER ? ` (tier ${TIER_FILTER})` : ''}${SUBSECTION_FILTER ? ` (§${SUBSECTION_FILTER})` : ''}`);
console.log(`═══════════════════════════════════════════════════\n`);

const results = [];
let pass = 0;

for (const c of filtered) {
  let output;
  if (USE_GECTOR && gectorCorrect) {
    // GECToR runs on the rule-engine output (rules first, then neural)
    const ruled = runRules(c.input, allRules).corrected;
    try {
      const result = await gectorCorrect(ruled);
      output = typeof result === 'string' ? result : result.corrected;
    } catch {
      output = ruled;
    }
  } else {
    output = runRules(c.input, allRules).corrected;
  }

  const ok = normalize(output) === normalize(c.expected);
  if (ok) pass++;
  results.push({ ...c, output, normalizedOutput: normalize(output), normalizedExpected: normalize(c.expected), pass: ok });
}

// ── Report ─────────────────────────────────────────

const pct = (n, d) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—';

console.log(`Overall: ${pass}/${filtered.length} (${pct(pass, filtered.length)})\n`);

// Per-tier breakdown
console.log('─ By tier ─');
const tierOrder = ['A', 'B', 'C', 'D', 'E'];
for (const t of tierOrder) {
  const tcases = results.filter((r) => r.tier === t);
  if (tcases.length === 0) continue;
  const tpass = tcases.filter((r) => r.pass).length;
  console.log(`  ${t}: ${tpass}/${tcases.length} (${pct(tpass, tcases.length)})  [${suite.tier_legend[t]}]`);
}

// Per-subsection breakdown
console.log('\n─ By subsection ─');
for (const s of ['2.1', '2.2', '2.3']) {
  const scases = results.filter((r) => r.subsection === s);
  if (scases.length === 0) continue;
  const spass = scases.filter((r) => r.pass).length;
  const label = s === '2.1' ? 'Izen-sintagma' : s === '2.2' ? 'Aditza' : 'Perpausa';
  console.log(`  §${s} ${label}: ${spass}/${scases.length} (${pct(spass, scases.length)})`);
}

// Failures (or all if --verbose)
console.log('\n─ ' + (VERBOSE ? 'All cases' : 'Failures') + ' ─');
const shown = VERBOSE ? results : results.filter((r) => !r.pass);
if (shown.length === 0) {
  console.log('  (none — all cases pass!)');
}
for (const r of shown) {
  const mark = r.pass ? '✓' : '✗';
  console.log(`  ${mark} [${r.tier}] ${r.id} ${r.category}`);
  if (!r.pass || VERBOSE) {
    console.log(`      in:  ${r.input}`);
    console.log(`      got:  ${r.output}`);
    console.log(`      exp:  ${r.expected}`);
  }
}

console.log('');
