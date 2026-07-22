/**
 * Txukun — BERTeus neural re-ranking (Tier 2)
 *
 * Uses BERTeus (ixa-ehu/berteus-base-cased, 110M BERT, int4 ONNX, 85MB)
 * via Transformers.js to score spell-correction candidates by masked
 * embedding similarity.
 *
 *   score = cosine_sim(mask_hidden_state, mean(candidate_word_embeddings))
 *
 * The misspelled word is replaced with [MASK] in its sentence context
 * (bidirectional — BERT sees both left and right context). The [MASK]
 * hidden state is compared against each candidate's static word embedding
 * (mean of subword piece embeddings from the embedding matrix).
 *
 * Validated in-browser: 29/30 cases match Python ranking (96.7%).
 * Full 933-case benchmark: +110 net (85.5% accuracy) at BERT_WEIGHT=18.
 * See CORRECTOR_STRATEGY.md Appendix C.
 *
 * The model is lazy-loaded: ONNX model + embedding matrix are only fetched
 * when autoCorrect() first encounters a spell error with ≥2 candidates.
 * If loading fails, all scores return 0 (graceful degradation to Tier 1).
 *
 * Transformers.js is already loaded for MarianMT (cap-punct model), so
 * no new library dependency is needed.
 */

import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';

// ── State ───────────────────────────────────────────

let model = null;
let tokenizer = null;
let embeddings = null; // Float32Array (vocabSize × EMB_DIM)
let vocabSize = 0;
let loadingPromise = null;
let loadFailed = false;

// ── Constants ───────────────────────────────────────

const EMB_DIM = 768;
const MASK_TOKEN_ID = 4; // BERTeus [MASK] token ID (from tokenizer_config.json)
const MASK_TOKEN_STR = '[MASK]'; // standard BERT mask token (tokenizer maps to ID 4)

// Weight for BERT score in the combined score.
// Grid search peak (int4 ONNX): w=18 → +110 net (85.5%).
// combined = tier1_score + BERT_WEIGHT × cosine_sim
export const BERT_WEIGHT = 18.0;

// Maximum candidates to score with BERT (latency cap).
const MAX_BERT_CANDIDATES = 5;

// Character window of context (each side) to feed BERT.
// ~200 chars ≈ 30-40 words per side. BERT max_length=512 tokens
// (~170 Basque subword tokens for 80 words), so this is safe.
const CONTEXT_CHARS = 200;

// Model source: HuggingFace Hub (models are too large for git/GitHub Pages).
// The repo itzune/berteus-onnx contains: onnx/model_q4.onnx (85MB int4),
// word_embeddings_f16.bin (74MB), tokenizer.json, config.json, etc.
// For local testing, initBERT(modelDir) can override to a local path.
const HF_REPO = 'itzune/berteus-onnx';
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;

// Local fallback path (used only when modelDir is passed, e.g. test page)
const BASE = import.meta.env.BASE_URL || '/';
const MODEL_DIR = `${BASE}models/berteus`;

// ── float16 → float32 conversion ────────────────────
//
// The embedding matrix is stored as float16 (74MB) to halve download size.
// Converted to float32 in-memory for vector math. Uses bit manipulation
// (no DataStream dependency, works in all browsers).

function float16BufferToFloat32(buffer) {
  const uint16 = new Uint16Array(buffer);
  const float32 = new Float32Array(uint16.length);
  const uint32 = new Uint32Array(float32.buffer);
  for (let i = 0; i < uint16.length; i++) {
    const h = uint16[i];
    const sign = (h >>> 15) & 0x1;
    const exp = (h >>> 10) & 0x1f;
    const mant = h & 0x3ff;
    let bits;
    if (exp === 0) {
      if (mant === 0) {
        bits = sign << 31; // signed zero
      } else {
        // Subnormal: normalize
        let m = mant, e = -1;
        while ((m & 0x400) === 0) { m <<= 1; e--; }
        m &= 0x3ff;
        bits = (sign << 31) | ((127 - 15 + e) << 23) | (m << 13);
      }
    } else if (exp === 31) {
      bits = (sign << 31) | 0x7f800000 | (mant << 13); // inf/nan
    } else {
      // Normalized
      bits = (sign << 31) | ((exp + 127 - 15) << 23) | (mant << 13);
    }
    uint32[i] = bits;
  }
  return float32;
}

// ── Vector operations ───────────────────────────────

function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) + 1e-8;
  const result = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) result[i] = vec[i] / norm;
  return result;
}

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ── Lazy loading ────────────────────────────────────

/**
 * Lazy-load the BERTeus ONNX model + embedding matrix.
 * Called on first use; subsequent calls return the cached promise.
 * Returns null if loading failed (graceful degradation to Tier 1).
 *
 * @param {string} [modelDir]  override model directory (for testing)
 * @returns {Promise<object|null>}
 */
export async function initBERT(modelDir) {
  if (model) return model;
  if (loadFailed) return null;
  if (loadingPromise) return loadingPromise;

  const useLocal = !!modelDir;
  const dir = modelDir || MODEL_DIR;

  loadingPromise = (async () => {
    // Local mode (test page): configure Transformers.js for local files.
    // Production: load from HuggingFace Hub (no env changes needed —
    // Transformers.js defaults to allowRemoteModels=true in browser).
    if (useLocal) {
      env.allowLocalModels = true;
      env.localModelPath = `${BASE}models/`;
    }

    // Load model, tokenizer, and embeddings in parallel
    const [mdl, tok, emb] = await Promise.all([
      useLocal
        ? AutoModel.from_pretrained('berteus', { dtype: 'q4', device: 'wasm' })
        : AutoModel.from_pretrained(HF_REPO, { dtype: 'q4', device: 'wasm' }),
      useLocal
        ? AutoTokenizer.from_pretrained('berteus')
        : AutoTokenizer.from_pretrained(HF_REPO),
      loadEmbeddings(dir, useLocal),
    ]);

    model = mdl;
    tokenizer = tok;
    embeddings = emb.embeddings;
    vocabSize = emb.vocabSize;
    console.log('[txukun BERT] model loaded, vocab:', vocabSize);
    return model;
  })().catch((err) => {
    console.warn('[txukun BERT] load failed, falling back to Tier 1:', err);
    loadFailed = true;
    return null;
  });

  return loadingPromise;
}

/**
 * Load the float16 embedding matrix and convert to float32.
 * In production, fetched from HuggingFace Hub. In local/test mode,
 * fetched from the model directory.
 */
async function loadEmbeddings(dir, useLocal) {
  const embPath = useLocal
    ? `${dir}/word_embeddings_f16.bin`
    : `${HF_BASE}/word_embeddings_f16.bin`;
  const response = await fetch(embPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch embeddings: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const emb = float16BufferToFloat32(buffer);
  const vs = emb.length / EMB_DIM;
  return { embeddings: emb, vocabSize: vs };
}

/**
 * Check if BERT is loaded and ready for scoring.
 */
export function isBERTReady() {
  return model !== null && tokenizer !== null && embeddings !== null;
}

/**
 * Was BERT loading attempted and failed?
 * Used to avoid retrying on every word.
 */
export function isBERTFailed() {
  return loadFailed;
}

// ── Scoring ─────────────────────────────────────────

/**
 * Re-rank candidates by BERTeus masked embedding similarity.
 *
 * Replaces the misspelled word at [errorStart, errorEnd) with [MASK],
 * runs BERT on the surrounding context, and scores each candidate by
 * cosine similarity between the [MASK] hidden state and the candidate's
 * mean subword embedding.
 *
 * @param {string} text        full text containing the error
 * @param {number} errorStart  char offset of the misspelled word start
 * @param {number} errorEnd    char offset of the misspelled word end
 * @param {string[]} candidates lowercase candidate words
 * @returns {Promise<number[]>} cosine sim scores [-1, 1], aligned with candidates
 */
export async function bertRerank(text, errorStart, errorEnd, candidates) {
  if (!isBERTReady()) return candidates.map(() => 0);

  const limited = candidates.slice(0, MAX_BERT_CANDIDATES);

  // Build masked text with a context window on both sides.
  // BERT is bidirectional — right context matters (unlike the futo LM
  // which only used left context).
  const windowStart = Math.max(0, errorStart - CONTEXT_CHARS);
  const windowEnd = Math.min(text.length, errorEnd + CONTEXT_CHARS);
  const leftContext = text.slice(windowStart, errorStart);
  const rightContext = text.slice(errorEnd, windowEnd);
  const maskedText = leftContext + MASK_TOKEN_STR + rightContext;

  // Tokenize the masked sentence
  const inputs = tokenizer(maskedText, {
    truncation: true,
    max_length: 512,
    padding: false,
  });

  // Transformers.js returns BigInt64Array for input_ids — convert to Number
  const inputIds = Array.from(inputs.input_ids.data).map(Number);

  // Find [MASK] token position
  let maskPos = -1;
  for (let i = 0; i < inputIds.length; i++) {
    if (inputIds[i] === MASK_TOKEN_ID) {
      maskPos = i;
      break;
    }
  }
  if (maskPos === -1) {
    // Mask token not found (truncation?) — can't score
    return candidates.map(() => 0);
  }

  // Run BERT encoder (single forward pass for all candidates)
  const outputs = await model(inputs);
  const data = outputs.last_hidden_state.data; // Float32Array

  // Extract [MASK] hidden state (768-dim vector)
  const maskStart = maskPos * EMB_DIM;
  const maskHidden = data.slice(maskStart, maskStart + EMB_DIM);
  const maskNorm = normalize(maskHidden);

  // Score each candidate by cosine similarity to the mask hidden state
  const scores = [];
  for (const cand of limited) {
    // Tokenize candidate without special tokens to get subword piece IDs
    const candInputs = tokenizer(cand, { add_special_tokens: false });
    const candIds = Array.from(candInputs.input_ids.data).map(Number);

    if (candIds.length === 0) {
      scores.push(0);
      continue;
    }

    // Mean of subword embeddings from the static embedding matrix
    const candEmb = new Float32Array(EMB_DIM);
    let validTokens = 0;
    for (let t = 0; t < candIds.length; t++) {
      const id = candIds[t];
      if (id < vocabSize) {
        const embStart = id * EMB_DIM;
        for (let d = 0; d < EMB_DIM; d++) {
          candEmb[d] += embeddings[embStart + d];
        }
        validTokens++;
      }
    }
    if (validTokens > 0) {
      for (let d = 0; d < EMB_DIM; d++) candEmb[d] /= validTokens;
    }

    const candNorm = normalize(candEmb);
    scores.push(dotProduct(maskNorm, candNorm));
  }

  // Pad with 0 for any truncated candidates beyond MAX_BERT_CANDIDATES
  while (scores.length < candidates.length) scores.push(0);
  return scores;
}
