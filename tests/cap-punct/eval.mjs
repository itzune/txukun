/**
 * Cap-punct evaluation harness — measures the MarianMT cap-punct model
 * (itzune/txukun-cap-punct-eu) against EBE-grounded golden cases.
 *
 * Runs in Node.js. Loads the Transformers.js pipeline directly (src/models.js
 * can't be imported here — it pulls in browser-only spell/gector deps).
 * cleanModelOutput() is imported from src/core/clean-output.js (shared with
 * production — P0.3). splitIntoSegments() and constrainCapPunct() are still
 * copied from src/models.js (keep in sync) until P1 extracts them to src/core/.
 *
 * Reports THREE accuracy figures:
 *   - RAW         : model output after special-token cleanup only
 *                   (measures intrinsic model quality)
 *   - CONSTRAINED : + constrainCapPunct anti-hallucination layer
 *   - RULED       : + P1 rule engine (cap-initial, terminal-punct)
 *                   (measures the full user-facing pipeline — HEADLINE)
 * The gap between CONSTRAINED and RULED reveals what the rule layer fixes
 * (notably the F1 failures: c001, c024, c043).
 *
 * Usage:
 *   node tests/cap-punct/eval.mjs                 # full run (downloads model on first run)
 *   node tests/cap-punct/eval.mjs --check         # validate cases.json only, no model
 *   node tests/cap-punct/eval.mjs --category cap-notenglish
 *   node tests/cap-punct/eval.mjs --no-constrain  # skip constraint layer
 *   node tests/cap-punct/eval.mjs --no-rules      # skip rule engine
 *   node tests/cap-punct/eval.mjs --limit 5       # quick smoke test
 *   TXUKUN_DTYPE=fp16 node tests/cap-punct/eval.mjs
 *
 * Metrics:
 *   - Strict exact-match %  (cases with strict:true)
 *   - Full exact-match %    (all cases)
 *   - Mean normalized Levenshtein (0=perfect, 1=completely different)
 *   - Per-category breakdown + sample failures
 * Results saved to tests/cap-punct/results-<timestamp>.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { cleanModelOutput } from '../../src/core/clean-output.js';
import { runRules } from '../../src/core/engine.js';
import { allRules } from '../../src/core/rules/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ── CLI args ────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const CHECK_ONLY = flag('--check');
const NO_CONSTRAIN = flag('--no-constrain');
const NO_RULES = flag('--no-rules');
const LIMIT = opt('--limit') ? parseInt(opt('--limit'), 10) : null;
const CATEGORY = opt('--category');
const DTYPE = process.env.TXUKUN_DTYPE || opt('--dtype') || 'q8';
// Node uses ONNX Runtime Node (device='cpu'); 'wasm' is browser/ORT-Web only.
const DEVICE = process.env.TXUKUN_DEVICE || (typeof window === 'undefined' ? 'cpu' : 'wasm');

// ════════════════════════════════════════════════════
//  Inference helpers
//
//  cleanModelOutput() is imported from src/core/clean-output.js (P0.3).
//  splitIntoSegments() and constrainCapPunct() are still COPIED from
//  src/models.js (keep in sync) — they're pure but not yet extracted;
//  extracting them is P1 groundwork for the src/core/ rule engine.
// ════════════════════════════════════════════════════

/** Split text into sentence-length segments for the model. (src/models.js) */
function splitIntoSegments(text) {
  const segments = [];
  const lines = text.split(/\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) { segments.push({ text: '', sep: '\n' }); continue; }
    const sentenceEnds = line.split(/(?<=[.?!])\s+/);
    for (const sent of sentenceEnds) {
      const trimmed = sent.trim();
      if (!trimmed) continue;
      const wordCount = trimmed.split(/\s+/).length;
      if (wordCount > 25) {
        const words = trimmed.split(/\s+/);
        for (let i = 0; i < words.length; i += 20) {
          segments.push({
            text: words.slice(i, i + 20).join(' '),
            sep: i + 20 >= words.length ? (li < lines.length - 1 ? '\n' : '') : ' ',
          });
        }
      } else {
        segments.push({ text: trimmed, sep: li < lines.length - 1 ? '\n' : '' });
      }
    }
  }
  return segments;
}

/** Anti-hallucination: keep only cap/punct changes, reject word substitutions. */
function constrainCapPunct(inputLine, outputLine) {
  const inputTokens = inputLine.match(/\S+/g) || [];
  const outputTokens = outputLine.match(/\S+/g) || [];
  const norm = (t) => t.toLowerCase().replace(/[^a-zà-ÿñü]/g, '');
  const aNorm = inputTokens.map(norm);
  const bNorm = outputTokens.map(norm);
  const n = aNorm.length;
  const m = bNorm.length;
  if (n === 0) return { text: inputLine, matchRate: 1.0 };
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aNorm[i] === bNorm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result = [];
  let matched = 0;
  const pendingCaps = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aNorm[i] === bNorm[j]) {
      let outTok = outputTokens[j];
      if (outTok.length > 1 && outTok === outTok.toUpperCase() && inputTokens[i] !== inputTokens[i].toUpperCase()) {
        pendingCaps.push({ idx: result.length, outTok });
        outTok = inputTokens[i];
      }
      if (outTok.length > inputTokens[i].length + 3) outTok = inputTokens[i];
      result.push(outTok);
      matched++;
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) { result.push(inputTokens[i]); i++; }
    else { j++; }
  }
  while (i < n) { result.push(inputTokens[i]); i++; }
  const matchRate = n > 0 ? matched / n : 1.0;
  if (matchRate >= 0.7) for (const { idx, outTok } of pendingCaps) result[idx] = outTok;
  return { text: result.join(' '), matchRate };
}

/** Full pipeline (raw + constrained) for one input string. */
async function runCapPunct(text, pipeline) {
  const segments = splitIntoSegments(text);
  const rawParts = [];
  const conParts = [];
  const rates = [];
  for (const seg of segments) {
    if (!seg.text) { rawParts.push({ t: '', sep: seg.sep }); conParts.push({ t: '', sep: seg.sep }); continue; }
    const out = await pipeline(seg.text);
    let corrected = cleanModelOutput(out[0]?.translation_text || seg.text);
    const { text: constrained, matchRate } = constrainCapPunct(seg.text, corrected);
    rawParts.push({ t: corrected || seg.text, sep: seg.sep });
    conParts.push({ t: constrained || seg.text, sep: seg.sep });
    rates.push(matchRate);
  }
  const constrainedText = conParts.map((r) => r.t + r.sep).join('').trimEnd();
  const ruled = NO_RULES ? constrainedText : runRules(constrainedText, allRules).corrected;
  return {
    raw: rawParts.map((r) => r.t + r.sep).join('').trimEnd(),
    constrained: constrainedText,
    ruled,
    matchRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 1.0,
  };
}

// ════════════════════════════════════════════════════
//  Metrics
// ════════════════════════════════════════════════════

/** Levenshtein distance (char-level). */
function levenshtein(a, b) {
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
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

/** Normalize for comparison: collapse whitespace, trim. */
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function pct(n, total) {
  if (total === 0) return 'N/A';
  return `${(n / total * 100).toFixed(1)}%`;
}

// ════════════════════════════════════════════════════
//  Main
// ════════════════════════════════════════════════════

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  TXUKUN CAP-PUNCT EVALUATION — EBE golden cases           ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Load cases
const casesPath = join(__dirname, 'cases.json');
const suite = JSON.parse(readFileSync(casesPath, 'utf-8'));
let cases = suite.cases;
console.log(`Loaded ${cases.length} cases from cases.json (v${suite.version})`);

// Validate structure
const ids = new Set();
const errors = [];
for (const c of cases) {
  if (!c.id) errors.push(`case missing id`);
  else if (ids.has(c.id)) errors.push(`duplicate id: ${c.id}`);
  ids.add(c.id);
  if (typeof c.input !== 'string' || !c.input) errors.push(`${c.id}: input missing`);
  if (typeof c.expected !== 'string' || !c.expected) errors.push(`${c.id}: expected missing`);
  if (!c.category) errors.push(`${c.id}: category missing`);
}
if (errors.length) {
  console.error('\n✗ cases.json validation errors:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('✓ cases.json structure valid\n');

// Apply filters
if (CATEGORY) {
  cases = cases.filter((c) => c.category === CATEGORY);
  console.log(`Filter: category="${CATEGORY}" → ${cases.length} cases\n`);
}
if (LIMIT) {
  cases = cases.slice(0, LIMIT);
  console.log(`Limit: first ${LIMIT} cases\n`);
}

if (CHECK_ONLY) {
  const byCat = {};
  for (const c of cases) byCat[c.category] = (byCat[c.category] || 0) + 1;
  console.log('Cases by category:');
  for (const [cat, n] of Object.entries(byCat).sort()) console.log(`  ${cat.padEnd(24)} ${n}`);
  const strictN = cases.filter((c) => c.strict !== false).length;
  console.log(`\nStrict (headline): ${strictN}/${cases.length}`);
  console.log('\n✓ --check passed. Run without --check to evaluate the model.');
  process.exit(0);
}

// Load model
console.log(`Loading model (dtype=${DTYPE}) from HuggingFace Hub...`);
console.log('  (first run downloads ~150MB to ~/.cache/huggingface; subsequent runs use cache)\n');
const t0 = Date.now();
const { pipeline } = await import('@huggingface/transformers');
let pipelineFn;
try {
  pipelineFn = await pipeline('translation', 'itzune/txukun-cap-punct-eu', {
    device: DEVICE,
    dtype: DTYPE,
    subfolder: '',
  });
} catch (err) {
  console.error(`\n✗ Model load failed (device=${DEVICE}, dtype=${DTYPE}): ${err.message}`);
  console.error(`  Try: TXUKUN_DTYPE=fp16 node tests/cap-punct/eval.mjs`);
  console.error(`       TXUKUN_DTYPE=fp32 node tests/cap-punct/eval.mjs`);
  process.exit(1);
}
console.log(`Model loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// Run evaluation
console.log(`Evaluating ${cases.length} cases${NO_CONSTRAIN ? ' (constrain OFF)' : ''}${NO_RULES ? ' (rules OFF)' : ''}...\n`);
const results = [];
const cats = {}; // category → {total, rawExact, conExact, levSum, levN}

for (let idx = 0; idx < cases.length; idx++) {
  const c = cases[idx];
  const exp = norm(c.expected);
  const { raw, constrained, ruled, matchRate } = await runCapPunct(c.input, pipelineFn);
  const rawN = norm(raw);
  const conN = NO_CONSTRAIN ? rawN : norm(constrained);
  const ruledN = NO_RULES ? conN : norm(ruled);
  const rawExact = rawN === exp;
  const conExact = conN === exp;
  const ruledExact = ruledN === exp;
  const lev = levenshtein(ruledN, exp);
  const levNorm = exp.length > 0 ? lev / exp.length : (lev > 0 ? 1 : 0);

  results.push({
    id: c.id, category: c.category, strict: c.strict !== false,
    input: c.input, expected: c.expected,
    raw, constrained: NO_CONSTRAIN ? null : constrained,
    ruled: NO_RULES ? null : ruled,
    rawExact, conExact, ruledExact, levenshtein: lev, levNorm: +levNorm.toFixed(4), matchRate: +matchRate.toFixed(3),
  });

  // per-category accumulation (constrained is the headline metric)
  const k = c.category;
  cats[k] = cats[k] || { total: 0, rawExact: 0, conExact: 0, ruledExact: 0, levSum: 0, levN: 0 };
  cats[k].total++;
  if (rawExact) cats[k].rawExact++;
  if (conExact) cats[k].conExact++;
  if (ruledExact) cats[k].ruledExact++;
  cats[k].levSum += levNorm;
  cats[k].levN++;

  const mark = conExact ? '✓' : '✗';
  const strictMark = c.strict === false ? '~' : ' ';
  process.stdout.write(`  [${idx + 1}/${cases.length}] ${mark}${strictMark} ${c.id} (${c.category})\r`);
}
process.stdout.write(' '.repeat(80) + '\r');

// ── Report ──────────────────────────────────────────

const total = results.length;
const strictResults = results.filter((r) => r.strict);
const strictN = strictResults.length;
const rawExactN = results.filter((r) => r.rawExact).length;
const conExactN = results.filter((r) => r.conExact).length;
const ruledExactN = results.filter((r) => r.ruledExact).length;
const conExactStrictN = strictResults.filter((r) => r.conExact).length;
const ruledExactStrictN = strictResults.filter((r) => r.ruledExact).length;
const meanLev = results.reduce((a, r) => a + r.levNorm, 0) / total;

console.log('═══════════════════════════════════════════════════════');
console.log('  OVERALL');
console.log('═══════════════════════════════════════════════════════\n');
console.log(`  Cases:                    ${total}`);
console.log(`  Strict (headline):        ${strictN}`);
console.log();
console.log(`  RAW exact-match:          ${rawExactN}/${total}  (${pct(rawExactN, total)})   ← intrinsic model quality`);
console.log(`  CONSTRAINED exact-match:  ${conExactN}/${total}  (${pct(conExactN, total)})   ← + anti-hallucination`);
console.log(`  RULED exact-match:        ${ruledExactN}/${total}  (${pct(ruledExactN, total)})   ← + rule engine`);
console.log();
console.log(`  CONSTRAINED (strict):     ${conExactStrictN}/${strictN}  (${pct(conExactStrictN, strictN)})`);
console.log(`  RULED (strict):           ${ruledExactStrictN}/${strictN}  (${pct(ruledExactStrictN, strictN)})   ← HEADLINE`);
console.log(`  Mean norm. Levenshtein:   ${meanLev.toFixed(4)}   (0=perfect, 1=worst)`);
console.log();

console.log('═══════════════════════════════════════════════════════');
console.log('  PER-CATEGORY  (constrained)');
console.log('═══════════════════════════════════════════════════════\n');
console.log(`  ${'category'.padEnd(24)} ${'n'.padStart(3)}  ${'raw'.padStart(6)}  ${'con'.padStart(6)}  ${'ruled'.padStart(6)}  ${'meanLev'.padStart(7)}`);
for (const [k, v] of Object.entries(cats).sort()) {
  const meanL = v.levN > 0 ? (v.levSum / v.levN).toFixed(4) : 'N/A';
  console.log(`  ${k.padEnd(24)} ${String(v.total).padStart(3)}  ${pct(v.rawExact, v.total).padStart(6)}  ${pct(v.conExact, v.total).padStart(6)}  ${pct(v.ruledExact, v.total).padStart(6)}  ${meanL.padStart(7)}`);
}

// ── Rules-improved (constrained ✗ → ruled ✓) ──────
const improved = results.filter((r) => !r.conExact && r.ruledExact);
if (improved.length && !NO_RULES) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RULES IMPROVED  (constrained ✗ → ruled ✓)');
  console.log('═══════════════════════════════════════════════════════\n');
  for (const r of improved) {
    console.log(`  ${r.id} [${r.category}]`);
    console.log(`    con:  ${r.constrained}`);
    console.log(`    rul:  ${r.ruled}`);
  }
}

// ── Rules-regressed (constrained ✓ → ruled ✗) ──────
const regressed = results.filter((r) => r.conExact && !r.ruledExact);
if (regressed.length && !NO_RULES) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ⚠️  RULES REGRESSED  (constrained ✓ → ruled ✗)');
  console.log('═══════════════════════════════════════════════════════\n');
  for (const r of regressed) {
    console.log(`  ${r.id} [${r.category}]`);
    console.log(`    con:  ${r.constrained}`);
    console.log(`    rul:  ${r.ruled}`);
  }
}

// ── Failures (ruled) ───────────────────────────────
const failures = results.filter((r) => !r.ruledExact);
if (failures.length) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  FAILURES (ruled, first 15)');
  console.log('═══════════════════════════════════════════════════════\n');
  for (const r of failures.slice(0, 15)) {
    const rawMark = r.rawExact ? '✓raw' : '✗raw';
    console.log(`  ${r.id} [${r.category}] ${rawMark} lev=${r.levenshtein} (strict=${r.strict})`);
    console.log(`    in:  ${r.input}`);
    console.log(`    exp: ${r.expected}`);
    console.log(`    got: ${r.ruled ?? r.constrained}`);
  }
  if (failures.length > 15) console.log(`  ... and ${failures.length - 15} more`);
}

// ── Raw-vs-constrained divergence (constraint rejections) ──
const diverged = results.filter((r) => r.raw !== r.constrained && r.rawExact !== r.conExact);
if (diverged.length && !NO_CONSTRAIN) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RAW≠CONSTRAINED DIVERGENCE  (constraint layer changed the verdict)');
  console.log('═══════════════════════════════════════════════════════\n');
  for (const r of diverged) {
    console.log(`  ${r.id} [${r.category}] raw=${r.rawExact ? '✓' : '✗'} con=${r.conExact ? '✓' : '✗'}`);
    console.log(`    raw:  ${r.raw}`);
    console.log(`    con:  ${r.constrained}`);
  }
  console.log('\n  → These are cases constrainCapPunct rejected (word substitutions).');
  console.log('    If they are legit normalizations (c081–c083), consider an opt-in path.');
}

// ── Save results ────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const resultsPath = join(__dirname, `results-${ts}.json`);
const summary = {
  timestamp: new Date().toISOString(),
  dtype: DTYPE,
  noConstrain: NO_CONSTRAIN,
  noRules: NO_RULES,
  caseCount: total,
  strictCount: strictN,
  rawExactMatch: rawExactN,
  rawExactPct: +(rawExactN / total * 100).toFixed(1),
  constrainedExactMatch: conExactN,
  constrainedExactPct: +(conExactN / total * 100).toFixed(1),
  constrainedStrictExactMatch: conExactStrictN,
  constrainedStrictExactPct: +(conExactStrictN / strictN * 100).toFixed(1),
  ruledExactMatch: ruledExactN,
  ruledExactPct: +(ruledExactN / total * 100).toFixed(1),
  ruledStrictExactMatch: ruledExactStrictN,
  ruledStrictExactPct: +(ruledExactStrictN / strictN * 100).toFixed(1),
  meanNormalizedLevenshtein: +meanLev.toFixed(4),
  perCategory: Object.fromEntries(
    Object.entries(cats).map(([k, v]) => [k, {
      total: v.total,
      rawExact: v.rawExact,
      conExact: v.conExact,
      ruledExact: v.ruledExact,
      meanLev: +(v.levSum / v.levN).toFixed(4),
    }])
  ),
  results,
};
mkdirSync(__dirname, { recursive: true });
writeFileSync(resultsPath, JSON.stringify(summary, null, 2));
console.log(`\nResults saved to ${resultsPath}`);
console.log('\n═══════════════════════════════════════════════════════\n');
