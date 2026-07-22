/**
 * Txukun — LM-based candidate re-ranking (Tier 2)
 *
 * Uses the futo-transformer-basque GGUF model (25M-param Llama, ~50MB)
 * via wllama (llama.cpp compiled to WASM) to score spell-correction
 * candidates by contextual surprisal.
 *
 * Surprisal = log P(candidate | context) − log P(candidate)
 *
 * This isolates the contextual signal by cancelling the candidate's
 * inherent token-probability bias. Validated against Ikasbil fill-the-gap
 * exercises (8 grammar test cases, 4/8 = matches Python reference).
 * The 4/8 ceiling reflects the 25M model's limits on fine-grained grammar
 * (ergative case, verb suffixes); lexical disambiguation (the actual
 * spell-checker use case) is expected to score higher.
 *
 * The model is lazy-loaded: wllama + GGUF are only fetched when
 * autoCorrect() first encounters a spell error with multiple candidates.
 * If loading fails, all surprisal scores return 0 (graceful degradation
 * to Tier 1 frequency re-ranking).
 *
 * See CORRECTOR_STRATEGY.md §3, §7, Appendix A.2, Appendix B.
 */

import { Wllama } from '@wllama/wllama/esm/index.js';
import wllamaWasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';

// ── State ───────────────────────────────────────────

let wllama = null;
let loadingPromise = null;
let loadFailed = false;

// Weight for LM surprisal in the combined score.
// Tier 1 score range: ~0.5–3.0 (β·log(freq+1) + δ·(1/(1+ed))).
// Surprisal range: ~-5 to +7. A weight of 1.0 lets surprisal overcome
// moderate frequency gaps (e.g. musika freq=9449 vs mutila freq=710)
// when the context strongly favours the lower-frequency word.
export const LM_WEIGHT = 1.0;

// Maximum candidates to score with the LM (latency cap).
const MAX_LM_CANDIDATES = 5;

// ── Lazy loading ────────────────────────────────────

/**
 * Lazy-load the wllama WASM + GGUF model.
 * Called on first use; subsequent calls return the cached promise.
 * Returns null if loading failed (graceful degradation).
 */
export async function initLM(modelUrl) {
  if (wllama) return wllama;
  if (loadFailed) return null;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const inst = new Wllama({ default: wllamaWasmUrl });
    await inst.loadModelFromUrl(modelUrl, {
      n_ctx: 2048,
      n_threads: 4,
      progressCallback: ({ loaded, total }) => {
        if (loaded >= total) {
          console.log('[txukun LM] model loaded');
        }
      },
    });
    wllama = inst;
    return wllama;
  })().catch((err) => {
    console.warn('[txukun LM] load failed, falling back to Tier 1:', err);
    loadFailed = true;
    return null;
  });

  return loadingPromise;
}

/**
 * Check if the LM is loaded and ready for scoring.
 */
export function isLMReady() {
  return wllama !== null && typeof wllama.isModelLoaded === 'function' && wllama.isModelLoaded();
}

/**
 * Was LM loading attempted and failed?
 * Used to avoid retrying on every word.
 */
export function isLMFailed() {
  return loadFailed;
}

// ── Surprisal scoring ───────────────────────────────

/**
 * Generate target text token-by-token from prompt, matching each token
 * from the model's top_logprobs. Returns matched tokens with their logprobs.
 *
 * Since wllama v3.5.1 has no tokenize() method and silently ignores echo=true
 * (prompt logprobs are never returned), we use this token-by-token approach:
 * at each step, call createCompletion with max_tokens=1 and n_probs=200 to get
 * the top-200 next-token candidates, then find the one whose text is the
 * longest prefix of the remaining target text.
 *
 * @param {string} prompt    starting context for generation
 * @param {string} target    text to match token-by-token
 * @returns {Promise<Array<{text: string, logprob: number}> | null>}
 *          null if any token can't be matched (not in top-N)
 */
async function scoreSequence(prompt, target) {
  let currentPrompt = prompt;
  let remaining = target;
  const matched = [];
  const MAX_TOKENS = 20; // safety limit against infinite loops

  for (let i = 0; i < MAX_TOKENS && remaining.length > 0; i++) {
    const resp = await wllama.createCompletion({
      prompt: currentPrompt,
      max_tokens: 1,
      n_probs: 200,       // top-200 tokens (vocab is 4096, so top ~5%)
                          // 500+ causes UTF-8 crashes in the C++ server
                          // (some tokens have invalid UTF-8 byte sequences)
      temperature: 0,
      cache_prompt: true,  // reuse KV cache for common prefix
      stream: false,
    });

    // wllama v3.5.1 returns new OAI format: logprobs.content[]
    // (TypeScript types are outdated — cast to any)
    const content = resp?.choices?.[0]?.logprobs?.content;
    if (!content || content.length === 0) return null;

    const topLogprobs = content[0].top_logprobs;
    if (!topLogprobs || topLogprobs.length === 0) return null;

    // Find the longest token whose text is a prefix of remaining
    let bestMatch = null;
    for (const entry of topLogprobs) {
      if (entry.token && entry.token.length > 0 && remaining.startsWith(entry.token)) {
        if (!bestMatch || entry.token.length > bestMatch.token.length) {
          bestMatch = entry;
        }
      }
    }

    if (!bestMatch) return null; // token not in top-N, can't score

    matched.push({ text: bestMatch.token, logprob: bestMatch.logprob });
    currentPrompt += bestMatch.token;
    remaining = remaining.substring(bestMatch.token.length);
  }

  return remaining.length === 0 ? matched : null;
}

/**
 * Compute surprisal for a single candidate given context.
 *
 * Surprisal = log P(candidate | context) − log P(candidate)
 *
 * This isolates the contextual signal by cancelling the candidate's
 * inherent token-probability bias. Validated against Ikasbil grammar
 * exercises (4/8, matches Python surprisal_sum method, no BOS).
 *
 * KEY IMPLEMENTATION DETAIL: The leading space goes in the PROMPT,
 * not the target. The Llama SentencePiece tokenizer adds a prefix-space
 * artifact (tokenizing ' word' → [' ', ' ', 'word...']), which breaks
 * text-prefix matching. By putting the space in the prompt, both passes
 * score the exact same word tokens — no boundary detection needed.
 *
 * The space token's logprob is excluded from both passes. Since it's
 * P(' '|prompt) — identical for all candidates given the same context —
 * it doesn't affect ranking.
 *
 * @param {string} context   text before the candidate
 * @param {string} candidate candidate word/phrase (no leading space)
 * @returns {Promise<number>} surprisal score (higher = more contextually likely)
 */
async function scoreSurprisal(context, candidate) {
  // Space in the prompt, not the target — avoids SentencePiece double-space
  const inContextPrompt = context + ' ';
  const baselinePrompt = ' ';
  const target = candidate;

  // In-context pass: score candidate tokens given context + space
  const ctxMatched = await scoreSequence(inContextPrompt, target);
  if (!ctxMatched || ctxMatched.length === 0) return -100;
  const ctxSum = ctxMatched.reduce((s, e) => s + e.logprob, 0);

  // Baseline pass: score same tokens given just a space (no context)
  const baseMatched = await scoreSequence(baselinePrompt, target);
  if (!baseMatched) return ctxSum; // can't compute baseline, use naive logprob

  const baseSum = baseMatched.reduce((s, e) => s + e.logprob, 0);
  return ctxSum - baseSum;
}

/**
 * Re-rank candidates by LM surprisal.
 *
 * @param {string} context     text before the misspelled word
 * @param {string[]} candidates lowercase candidate words
 * @returns {Promise<number[]>} surprisal scores, aligned with candidates
 */
export async function lmRerank(context, candidates) {
  if (!isLMReady()) return candidates.map(() => 0);

  const limited = candidates.slice(0, MAX_LM_CANDIDATES);
  const scores = [];
  for (const cand of limited) {
    try {
      scores.push(await scoreSurprisal(context, cand));
    } catch (err) {
      console.warn('[txukun LM] scoring failed for', cand, err);
      scores.push(0);
    }
  }

  // If ALL candidates got the -100 penalty (none were scoreable),
  // return 0 for all — fallback to Tier 1 frequency re-ranking.
  if (scores.every((s) => s <= -99)) {
    return candidates.map(() => 0);
  }

  // Pad with 0 for any truncated candidates
  while (scores.length < candidates.length) scores.push(0);
  return scores;
}
