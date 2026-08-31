/**
 * Txukun — GECToR v2-mt grammar correction (single-model architecture)
 *
 * Uses the multi-task GECToR v2 model (itzune/gector-eus-v2-onnx), trained
 * on the horkonpon-corpus (199K pairs). Three heads, one encoder:
 *
 *   - Edit labels   ($KEEP / $DELETE / $REPLACE_x / $APPEND_x / $TRANSFORM_*)
 *   - Detection     ($CORRECT / $INCORRECT)  → per-word P(error)
 *   - Error type    (none / spelling / punctuation / capitalization /
 *                    word_level / zalantza / morphology / proper_noun / calque)
 *
 * The type head is the key addition over v1: every corrected word is
 * tagged with its error category, so the suggestions panel can group and
 * label fixes correctly instead of lumping everything into "grammar".
 *
 * Types are captured on iteration 0 (the first forward pass on the
 * ORIGINAL source words) — they describe the original word's error
 * category, not a post-correction artifact. This matches the Python
 * reference (gector/predict.py: first_iter_types).
 *
 * Model: int4 ONNX (~87MB), runs on WASM via onnxruntime-web.
 * Tokenizer: XLM-RoBERTa BPE (RoBERTa-eus-base), via Transformers.js.
 * Lazy-loaded on first correctGrammar()/detectGrammar() call.
 */

import { InferenceSession, Tensor } from 'onnxruntime-web';
import { AutoTokenizer } from '@huggingface/transformers';
import { cachedFetch } from './cache.js';

// ── State ───────────────────────────────────────────

let session = null;
let tokenizer = null;
let vocab = null;
let loadingPromise = null;
let loadFailed = false;

// ── Constants ───────────────────────────────────────

// Inference parameters (precision-oriented — false positives are costly
// in an editor/autocorrect context). Mirrors the Python eval defaults.
const KEEP_CONFIDENCE = 0.0;
const MIN_ERROR_PROB = 0.5;   // detection gate: only correct if confident
const MAX_ITERATIONS = 3;

// Model source: HuggingFace Hub.
// itzune/gector-eus-v2-onnx contains:
//   onnx/model_q4.onnx        (~87MB int4, 3 outputs incl. logits_t)
//   gector_vocab.json         (label/detect/type vocabularies)
//   tokenizer files at root   (XLM-RoBERTa BPE)
const HF_REPO = 'itzune/gector-eus-v2-onnx';
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;
const CACHE_KEY = 'gector-v2-mt';

// ── Lazy loading ────────────────────────────────────

/**
 * Lazy-load the GECToR v2 ONNX model + tokenizer + vocab.
 * Subsequent calls return the cached promise. Returns null on failure
 * (graceful degradation — callers fall back to original text).
 */
export async function initGector() {
  if (session) return session;
  if (loadFailed) return null;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [tok, voc, modelBuf] = await Promise.all([
      AutoTokenizer.from_pretrained(HF_REPO),
      cachedFetch(`${HF_BASE}/gector_vocab.json`, CACHE_KEY).then((r) => r.json()),
      cachedFetch(`${HF_BASE}/onnx/model_q4.onnx`, CACHE_KEY).then((r) => r.arrayBuffer()),
    ]);

    tokenizer = tok;
    vocab = voc;

    session = await InferenceSession.create(modelBuf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    const hasTypes = vocab.t_num_labels !== undefined;
    console.log(
      '[txukun GECToR v2] model loaded — labels:', vocab.num_labels,
      '| detect:', vocab.d_num_labels,
      '| types:', hasTypes ? vocab.t_num_labels : 'none',
      '| session outputs:', session.outputNames?.map((n) => n) ?? 'unknown',
    );
    console.log('[txukun] Debug mode: set window.__TXUKUN_DEBUG = true for inference logs');
    return session;
  })().catch((err) => {
    console.warn('[txukun GECToR v2] load failed, grammar correction disabled:', err);
    loadFailed = true;
    return null;
  });

  return loadingPromise;
}

export function isGectorReady() {
  return session !== null && tokenizer !== null && vocab !== null;
}

export function isGectorFailed() {
  return loadFailed;
}

// ── Subword tokenization with word_ids ──────────────
//
// Replicates HuggingFace's is_split_into_words=True + word_ids() by
// tokenizing each word individually with a space prefix. Verified to
// produce identical token IDs and word_ids to the Python path.

function tokenizeWithWordIds(words, maxLen) {
  const bosId = tokenizer.bos_token_id ?? 0;
  const eosId = tokenizer.eos_token_id ?? 2;

  const inputIds = [bosId];
  const wordIds = [null];

  for (let w = 0; w < words.length; w++) {
    const enc = tokenizer(' ' + words[w], { add_special_tokens: false });
    const ids = Array.from(enc.input_ids.data).map(Number);

    for (const id of ids) {
      if (inputIds.length >= maxLen - 1) break;
      inputIds.push(id);
      wordIds.push(w);
    }
    if (inputIds.length >= maxLen - 1) break;
  }

  inputIds.push(eosId);
  wordIds.push(null);

  return { inputIds, wordIds };
}

/** First-subword mask: 1 at the first subword of each word, else 0. */
function buildWordMasks(wordIds) {
  const masks = [];
  let prevWordId = null;
  for (const wid of wordIds) {
    if (wid === null) {
      masks.push(0);
    } else if (wid !== prevWordId) {
      masks.push(1);
    } else {
      masks.push(0);
    }
    prevWordId = wid;
  }
  return masks;
}

// ── Softmax ─────────────────────────────────────────

function softmax(logits, start, len) {
  let maxLogit = -Infinity;
  for (let i = 0; i < len; i++) {
    const v = logits[start + i];
    if (v > maxLogit) maxLogit = v;
  }
  let sumExp = 0;
  const exps = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    exps[i] = Math.exp(logits[start + i] - maxLogit);
    sumExp += exps[i];
  }
  return { exps, sumExp };
}

// ── Core 3-head prediction ──────────────────────────
//
// Single forward pass returning edit-label IDs, type IDs, and per-word
// detection probabilities. All three heads are read from one session.run.

async function predictAll(inputIds, attentionMask, wordIds) {
  const seqLen = inputIds.length;

  const inputIdsTensor = new Tensor(
    'int64',
    BigInt64Array.from(inputIds.map(BigInt)),
    [1, seqLen],
  );
  const attentionMaskTensor = new Tensor(
    'int64',
    BigInt64Array.from(attentionMask.map(BigInt)),
    [1, seqLen],
  );

  const outputs = await session.run({
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor,
  });

  const logitsLabels = outputs.logits_labels.data;
  const logitsD = outputs.logits_d.data;
  const hasTypes = outputs.logits_t !== undefined;
  const logitsT = hasTypes ? outputs.logits_t.data : null;

  const numLabels = vocab.num_labels - 1;   // projection excludes <PAD>
  const dNumLabels = vocab.d_num_labels - 1;
  const tNumLabels = hasTypes ? vocab.t_num_labels - 1 : 0;

  const keepIdx = vocab.label2id[vocab.keep_label];
  const incorIdx = vocab.d_label2id[vocab.incorrect_label];

  const wordMasks = buildWordMasks(wordIds);

  // ── Detection: max P(INCORRECT) across first-subwords (sentence gate) ──
  let maxErrorProb = 0;
  const wordDetections = []; // { wordIdx, pIncorrect }

  for (let t = 0; t < seqLen; t++) {
    if (wordMasks[t] !== 1) continue;
    const { exps, sumExp } = softmax(logitsD, t * dNumLabels, dNumLabels);
    const pIncor = exps[incorIdx] / sumExp;
    if (pIncor > maxErrorProb) maxErrorProb = pIncor;

    const wid = wordIds[t];
    if (wid !== null && wid > 0) {
      // wid=0 is $START; real words start at wid=1 → index wid-1
      wordDetections.push({ wordIdx: wid - 1, pIncorrect: pIncor });
    }
  }

  const sentenceKeepAll = maxErrorProb < MIN_ERROR_PROB;

  // ── Edit labels: softmax + keep_confidence + detection gate ──
  const predLabelIds = new Int32Array(seqLen);

  for (let t = 0; t < seqLen; t++) {
    if (sentenceKeepAll) {
      predLabelIds[t] = keepIdx;
      continue;
    }
    const { exps, sumExp } = softmax(logitsLabels, t * numLabels, numLabels);
    const probs = new Float32Array(numLabels);
    for (let l = 0; l < numLabels; l++) probs[l] = exps[l] / sumExp;

    probs[keepIdx] += KEEP_CONFIDENCE;

    let maxProb = 0;
    for (let l = 0; l < numLabels; l++) {
      if (probs[l] > maxProb) maxProb = probs[l];
    }
    if (maxProb < MIN_ERROR_PROB) {
      predLabelIds[t] = keepIdx;
      continue;
    }

    let bestLabel = 0;
    let bestProb = -Infinity;
    for (let l = 0; l < numLabels; l++) {
      if (probs[l] > bestProb) {
        bestProb = probs[l];
        bestLabel = l;
      }
    }
    predLabelIds[t] = bestLabel;
  }

  // ── Error types: argmax over type logits (per token) ──
  // argmax(logits) == argmax(softmax(logits)), so no need to normalize.
  // Only the first-subword value per word is used (see alignWordInfo).
  const predTypeIds = new Int32Array(seqLen);
  if (hasTypes) {
    for (let t = 0; t < seqLen; t++) {
      let bestId = 0;
      let bestLogit = -Infinity;
      for (let l = 0; l < tNumLabels; l++) {
        const v = logitsT[t * tNumLabels + l];
        if (v > bestLogit) {
          bestLogit = v;
          bestId = l;
        }
      }
      predTypeIds[t] = bestId;
    }
  }

  return { predLabelIds, predTypeIds, wordDetections };
}

// ── Align labels to words ───────────────────────────

function alignToWords(predLabelIds, wordIds) {
  const wordLabels = [];
  const noCorrectionIds = new Set([
    vocab.label2id['$KEEP'],
    vocab.label2id['<OOV>'],
    vocab.label2id['<PAD>'],
  ]);

  let prevWordId = null;
  let hasCorrections = false;

  for (let t = 0; t < wordIds.length; t++) {
    const wid = wordIds[t];
    if (wid === null) continue;
    if (wid === prevWordId) continue;

    const labelId = predLabelIds[t];
    const label = vocab.id2label[String(labelId)];
    wordLabels.push(label);

    if (!noCorrectionIds.has(labelId)) {
      hasCorrections = true;
    }
    prevWordId = wid;
  }

  return { wordLabels, hasCorrections };
}

// ── Align types + detection to original word tokens ─
//
// Returns one entry per real input word (skipping $START), each carrying
// the error type and P(INCORRECT) from the first subword of that word.
// Offsets point into the ORIGINAL input text (not the punct-tokenized
// string), so they line up with diffWord() output and the editor.

function alignWordInfo(predTypeIds, wordDetections, wordIds, wordTokens) {
  const detMap = new Map();
  for (const d of wordDetections) detMap.set(d.wordIdx, d.pIncorrect);

  const result = [];
  let prevWordId = null;

  for (let t = 0; t < wordIds.length; t++) {
    const wid = wordIds[t];
    if (wid === null) continue;
    if (wid === prevWordId) continue;
    prevWordId = wid;
    if (wid === 0) continue; // $START

    const idx = wid - 1; // real-word index into wordTokens
    if (idx >= wordTokens.length) continue;

    const typeId = predTypeIds[t];
    const type = vocab.t_id2label ? (vocab.t_id2label[String(typeId)] || 'none') : 'none';
    const wt = wordTokens[idx];

    result.push({
      start: wt.start,
      end: wt.end,
      wordIdx: idx,
      type,
      pIncorrect: detMap.get(idx) ?? 0,
    });
  }

  return result;
}

// ── Apply edits ─────────────────────────────────────

function applyEdits(words, labels) {
  const edited = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const label = labels[i] || '$KEEP';

    if (word === '$START') {
      edited.push('$START');
    } else if (label === '<PAD>' || label === '<OOV>' || label === '$KEEP') {
      edited.push(word);
    } else if (label.startsWith('$REPLACE_')) {
      edited.push(label.substring(9));
    } else if (label.startsWith('$APPEND_')) {
      edited.push(word);
      edited.push(label.substring(8));
    } else if (label === '$DELETE') {
      edited.push('$DELETE');
    } else if (label === '$TRANSFORM_CASE_CAPITAL') {
      edited.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
    } else if (label === '$TRANSFORM_CASE_UPPER') {
      edited.push(word.toUpperCase());
    } else if (label === '$TRANSFORM_CASE_UPPER_-1') {
      edited.push(word.slice(0, -1).toUpperCase());
    } else if (label === '$TRANSFORM_AGREEMENT_PLURAL') {
      edited.push(word + 's');
    } else if (label === '$TRANSFORM_SPLIT_HYPHEN') {
      edited.push(word.replace(/-/g, ' '));
    } else if (label === '$MERGE_HYPHEN' || label === '$MERGE_SPACE') {
      // Merge markers are handled at the string level after join,
      // matching Python's edit_src_by_tags.
      edited.push(word);
      edited.push(label);
    } else {
      edited.push(word);
    }
  }

  let result = edited.join(' ');
  result = result.replace(/ \$MERGE_HYPHEN /g, '-');
  result = result.replace(/ \$MERGE_SPACE /g, '');
  result = result.replace(/ \$DELETE\b/g, '').replace(/\$DELETE /g, '').replace(/\$DELETE/g, '');
  result = result.replace(/\$START /g, '').replace(/\$START/g, '');
  // Clean up any leftover merge markers (at sequence boundaries)
  result = result.replace(/\$MERGE_HYPHEN\b/g, '').replace(/\$MERGE_SPACE\b/g, '');
  return result.split(/\s+/).filter((w) => w.length > 0);
}

// ── Punctuation tokenization (offset-preserving) ────
//
// Splits punctuation from words exactly as the training data did, but
// records each token's char span in the ORIGINAL text. This keeps type
// offsets aligned to the source the editor/diff operate on.
// Hyphens are intentionally NOT split — in Basque they join compounds
// (hego-ekialdea, euskal-espainiar); splitting them destroys compounds.
// MUST match PUNCT_RE in core/diff.js (splitPunct).

function tokenizeWords(text) {
  const tokens = [];
  const wsRe = /\S+/g;
  let m;
  while ((m = wsRe.exec(text)) !== null) {
    const chunk = m[0];
    const base = m.index;
    const punctRe = /([.,;:!?()«»"'\u2013\u2014])/g;
    let last = 0;
    let pm;
    while ((pm = punctRe.exec(chunk)) !== null) {
      if (pm.index > last) {
        tokens.push({ word: chunk.slice(last, pm.index), start: base + last, end: base + pm.index });
      }
      tokens.push({ word: pm[0], start: base + pm.index, end: base + pm.index + 1 });
      last = pm.index + 1;
    }
    if (last < chunk.length) {
      tokens.push({ word: chunk.slice(last), start: base + last, end: base + chunk.length });
    }
  }
  return tokens;
}

function detokenizePunctuation(text) {
  // Remove space BEFORE closing/mid punctuation: "word ," → "word,"
  let result = text.replace(/\s+([.,;:!?»)"'])/g, '$1');
  // Remove space AFTER opening punctuation: "« word" → "«word"
  // («, (, –, — are opening — the old regex wrongly removed space
  //  before them, turning «mugatua» into « mugatua» and causing
  //  spurious diffs at every quote/paren/em-dash.)
  result = result.replace(/([«(\u2013\u2014"'])\s+/g, '$1');
  return result;
}

// ── Public API ──────────────────────────────────────

// Max words per chunk. The model's max_length is 128 subwords; Basque
// words average ~1.5–2 BPE subwords, so 60 words ≈ 90–120 subwords —
// safely under the limit. The model was trained/evaluated on individual
// sentences (short records), so chunking also gives it focused context
// matching the training distribution, instead of one long truncated block.
const MAX_CHUNK_WORDS = 60;

/**
 * Split text into sentence-level chunks for the model.
 *
 * Each sentence becomes its own chunk (split at . ! ? » and newlines).
 * This matches the model's training distribution (individual sentences)
 * and ensures sentence-initial words are at position 0 — which is where
 * the model can detect capitalization errors ($TRANSFORM_CASE_CAPITAL).
 * If a single sentence exceeds MAX_CHUNK_WORDS, it gets hard-split.
 *
 * Returns chunks with their [start, end) offsets in the original text.
 */
function chunkText(text) {
  const wordTokens = tokenizeWords(text);
  if (wordTokens.length === 0) return [];

  const chunks = [];
  let chunkStartIdx = 0;

  for (let i = 0; i < wordTokens.length; i++) {
    const word = wordTokens[i].word;
    const isSentenceEnd = /^[.!?»]+$/.test(word);
    const isHardBreak = i - chunkStartIdx + 1 >= MAX_CHUNK_WORDS;

    // Check for paragraph boundary (newline before this word)
    let isParaBreak = false;
    if (i > chunkStartIdx) {
      const gap = text.slice(wordTokens[i - 1].end, wordTokens[i].start);
      if (/\n/.test(gap)) isParaBreak = true;
    }

    if (isParaBreak) {
      // End current chunk BEFORE this word (word goes to new chunk)
      if (i > chunkStartIdx) {
        const start = wordTokens[chunkStartIdx].start;
        const end = wordTokens[i - 1].end;
        chunks.push({ text: text.slice(start, end), start, end });
      }
      chunkStartIdx = i;
    }

    if (isSentenceEnd || isHardBreak) {
      // Include current word in current chunk, then start new chunk
      const start = wordTokens[chunkStartIdx].start;
      const end = wordTokens[i].end;
      chunks.push({ text: text.slice(start, end), start, end });
      chunkStartIdx = i + 1;
    }
  }

  // Last chunk (trailing words without sentence-ending punctuation)
  if (chunkStartIdx < wordTokens.length) {
    const start = wordTokens[chunkStartIdx].start;
    chunks.push({ text: text.slice(start), start, end: text.length });
  }

  return chunks;
}

// ── Per-chunk logits processing ─────────────────────
//
// Processes one chunk's slice of the batched ONNX output: computes the
// sentence-level detection gate, per-word edit labels, and per-word type
// IDs. `batchOffset` is the starting index of this chunk's logits in the
// flat output arrays (i.e. batchIdx * maxSeqLen * numLabelsPerHead).

function _processChunkLogits(
  logitsLabels, logitsD, logitsT,
  batchOffsetLabels, batchOffsetD, batchOffsetT,
  seqLen, wordIds,
  numLabels, dNumLabels, tNumLabels,
  keepIdx, incorIdx, hasTypes,
) {
  const wordMasks = buildWordMasks(wordIds);

  // ── Detection: max P(INCORRECT) across first-subwords (sentence gate) ──
  let maxErrorProb = 0;
  const wordDetections = [];

  for (let t = 0; t < seqLen; t++) {
    if (wordMasks[t] !== 1) continue;
    const { exps, sumExp } = softmax(logitsD, batchOffsetD + t * dNumLabels, dNumLabels);
    const pIncor = exps[incorIdx] / sumExp;
    if (pIncor > maxErrorProb) maxErrorProb = pIncor;

    const wid = wordIds[t];
    if (wid !== null && wid > 0) {
      wordDetections.push({ wordIdx: wid - 1, pIncorrect: pIncor });
    }
  }

  const sentenceKeepAll = maxErrorProb < MIN_ERROR_PROB;

  // DEBUG: log detection gate for batched chunks
  if (typeof window !== 'undefined' && window.__TXUKUN_DEBUG) {
    console.log(`[GECToR] batched chunk: maxErrorProb=${maxErrorProb.toFixed(4)} gate=${sentenceKeepAll ? 'KEEP-ALL' : 'OPEN'} detections=${wordDetections.length}`);
  }

  // ── Edit labels: softmax + keep_confidence + detection gate ──
  const predLabelIds = new Int32Array(seqLen);

  for (let t = 0; t < seqLen; t++) {
    if (sentenceKeepAll) {
      predLabelIds[t] = keepIdx;
      continue;
    }
    const { exps, sumExp } = softmax(logitsLabels, batchOffsetLabels + t * numLabels, numLabels);
    const probs = new Float32Array(numLabels);
    for (let l = 0; l < numLabels; l++) probs[l] = exps[l] / sumExp;

    probs[keepIdx] += KEEP_CONFIDENCE;

    let maxProb = 0;
    for (let l = 0; l < numLabels; l++) {
      if (probs[l] > maxProb) maxProb = probs[l];
    }
    if (maxProb < MIN_ERROR_PROB) {
      predLabelIds[t] = keepIdx;
      continue;
    }

    let bestLabel = 0;
    let bestProb = -Infinity;
    for (let l = 0; l < numLabels; l++) {
      if (probs[l] > bestProb) {
        bestProb = probs[l];
        bestLabel = l;
      }
    }
    predLabelIds[t] = bestLabel;
  }

  // ── Error types: argmax over type logits (per token) ──
  const predTypeIds = new Int32Array(seqLen);
  if (hasTypes) {
    for (let t = 0; t < seqLen; t++) {
      let bestId = 0;
      let bestLogit = -Infinity;
      for (let l = 0; l < tNumLabels; l++) {
        const v = logitsT[batchOffsetT + t * tNumLabels + l];
        if (v > bestLogit) {
          bestLogit = v;
          bestId = l;
        }
      }
      predTypeIds[t] = bestId;
    }
  }

  return { predLabelIds, predTypeIds, wordDetections };
}

/**
 * Batched prediction: process multiple chunks in ONE ONNX forward pass.
 *
 * Each chunk has its own inputIds, wordIds, and seqLen. They are padded
 * to the max seqLen in the batch, run through the model together, and
 * each chunk's logits are processed independently with _processChunkLogits.
 *
 * This is dramatically faster than N sequential forward passes — the
 * WASM inference overhead is paid once per iteration, not once per chunk.
 */
async function predictAllBatched(chunkInputs) {
  const batchSize = chunkInputs.length;
  const maxSeqLen = Math.max(...chunkInputs.map((c) => c.inputIds.length));

  // Build padded batch tensors
  const batchInputIds = new BigInt64Array(batchSize * maxSeqLen);
  const batchAttentionMask = new BigInt64Array(batchSize * maxSeqLen);

  for (let b = 0; b < batchSize; b++) {
    const { inputIds, seqLen } = chunkInputs[b];
    for (let t = 0; t < seqLen; t++) {
      batchInputIds[b * maxSeqLen + t] = BigInt(inputIds[t]);
      batchAttentionMask[b * maxSeqLen + t] = 1n;
    }
    // Padding remains 0 (zero-init by BigInt64Array)
  }

  const outputs = await session.run({
    input_ids: new Tensor('int64', batchInputIds, [batchSize, maxSeqLen]),
    attention_mask: new Tensor('int64', batchAttentionMask, [batchSize, maxSeqLen]),
  });

  const logitsLabels = outputs.logits_labels.data;
  const logitsD = outputs.logits_d.data;
  const hasTypes = outputs.logits_t !== undefined;
  const logitsT = hasTypes ? outputs.logits_t.data : null;

  const numLabels = vocab.num_labels - 1;
  const dNumLabels = vocab.d_num_labels - 1;
  const tNumLabels = hasTypes ? vocab.t_num_labels - 1 : 0;
  const keepIdx = vocab.label2id[vocab.keep_label];
  const incorIdx = vocab.d_label2id[vocab.incorrect_label];

  // Process each chunk's logits slice
  const results = [];
  for (let b = 0; b < batchSize; b++) {
    const { wordIds, seqLen } = chunkInputs[b];
    const batchOffsetLabels = b * maxSeqLen * numLabels;
    const batchOffsetD = b * maxSeqLen * dNumLabels;
    const batchOffsetT = hasTypes ? b * maxSeqLen * tNumLabels : 0;

    results.push(
      _processChunkLogits(
        logitsLabels, logitsD, logitsT,
        batchOffsetLabels, batchOffsetD, batchOffsetT,
        seqLen, wordIds,
        numLabels, dNumLabels, tNumLabels,
        keepIdx, incorIdx, hasTypes,
      ),
    );
  }
  return results;
}

/**
 * Process a single chunk of text (up to ~60 words). Returns corrected
 * text + per-word types with offsets relative to the chunk's own start.
 * Used for the single-chunk fast path (no batching overhead).
 */
async function _correctChunk(text) {
  const maxLen = vocab.max_length || 128;
  const wordTokens = tokenizeWords(text);
  if (wordTokens.length === 0) return { corrected: text, wordTypes: [] };

  const words = ['$START', ...wordTokens.map((w) => w.word)];
  const { inputIds, wordIds } = tokenizeWithWordIds(words, maxLen);
  const attentionMask = new Array(inputIds.length).fill(1);

  // ── Iteration 0: labels + types + detection on original words ──
  const { predLabelIds, predTypeIds, wordDetections } = await predictAll(
    inputIds, attentionMask, wordIds,
  );

  // Types + detection aligned to chunk offsets (captured once).
  const wordTypes = alignWordInfo(predTypeIds, wordDetections, wordIds, wordTokens);

  // ── Iterative refinement of the corrected text ──
  const { wordLabels, hasCorrections } = alignToWords(predLabelIds, wordIds);
  if (!hasCorrections) {
    return { corrected: text, wordTypes };
  }

  let currentWords = applyEdits(words, wordLabels);
  for (let iter = 1; iter < MAX_ITERATIONS; iter++) {
    const w = ['$START', ...currentWords];
    const { inputIds: ii, wordIds: wi } = tokenizeWithWordIds(w, maxLen);
    const mask = new Array(ii.length).fill(1);
    const { predLabelIds: pl } = await predictAll(ii, mask, wi);
    const { wordLabels: wl, hasCorrections: hc } = alignToWords(pl, wi);
    if (!hc) break;
    currentWords = applyEdits(w, wl);
  }

  const corrected = detokenizePunctuation(currentWords.join(' '));
  return { corrected, wordTypes };
}

/**
 * Correct grammar and return per-word error info.
 *
 * Splits the input into sentence-level chunks (the model's max_length is
 * 128 subwords and it was trained on individual sentences), then processes
 * ALL chunks in a single batched ONNX forward pass per iteration. This
 * ensures:
 *   - All text is seen by the model (not just the first ~100 words)
 *   - The detection gate is applied per-sentence, not per-document
 *   - Context matches the training distribution (short sentences)
 *   - Sentence-initial words are at position 0 for capitalization detection
 *   - Performance is O(iterations) forward passes, not O(chunks × iterations)
 *
 * @param {string} text — input text
 * @returns {Promise<{corrected: string, wordTypes: Array<{start, end, type, pIncorrect}>}>}
 *   `corrected` — fully corrected text (after up to MAX_ITERATIONS per chunk).
 *   `wordTypes` — per-original-word error type + detection, aligned to
 *     `text` char offsets. Types come from iteration 0 (original words).
 *   If model loading failed, returns { corrected: text, wordTypes: [] }.
 */
export async function correctGrammar(text) {
  if (!isGectorReady()) {
    await initGector();
    if (!isGectorReady()) return { corrected: text, wordTypes: [] };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) return { corrected: text, wordTypes: [] };
  if (chunks.length === 1) {
    return _correctChunk(chunks[0].text);
  }

  // ── Multi-chunk: batched inference ──
  const maxLen = vocab.max_length || 128;

  // Initialize per-chunk state
  const states = chunks
    .map((c) => {
      const wordTokens = tokenizeWords(c.text);
      if (wordTokens.length === 0) return null;
      const words = ['$START', ...wordTokens.map((w) => w.word)];
      const { inputIds, wordIds } = tokenizeWithWordIds(words, maxLen);
      return {
        chunkStart: c.start,
        chunkEnd: c.end,
        chunkText: c.text,
        wordTokens,
        words,
        inputIds,
        wordIds,
        seqLen: inputIds.length,
        wordTypes: null,      // set in iteration 0
        currentWords: null,   // set when corrections applied
        everCorrected: false, // true if any iteration made changes
        done: false,          // true when no more corrections needed
      };
    })
    .filter((s) => s !== null);

  if (states.length === 0) return { corrected: text, wordTypes: [] };

  // DEBUG: log chunks for diagnosis
  if (typeof window !== 'undefined' && window.__TXUKUN_DEBUG) {
    console.log(`[GECToR] correctGrammar: ${states.length} chunks`, states.map((s) => s.chunkText.slice(0, 40)));
  }

  // Iterative batched refinement
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const active = states.filter((s) => !s.done);
    if (active.length === 0) break;

    // Run ALL active chunks in ONE forward pass
    const predictions = await predictAllBatched(
      active.map((s) => ({ inputIds: s.inputIds, wordIds: s.wordIds, seqLen: s.seqLen })),
    );

    for (let i = 0; i < active.length; i++) {
      const s = active[i];
      const { predLabelIds, predTypeIds, wordDetections } = predictions[i];

      // Store types from iteration 0 (aligned to original words)
      if (iter === 0) {
        s.wordTypes = alignWordInfo(
          predTypeIds, wordDetections, s.wordIds, s.wordTokens,
        );
      }

      const { wordLabels, hasCorrections } = alignToWords(predLabelIds, s.wordIds);
      if (!hasCorrections) {
        s.done = true;
        s.currentWords = s.words.slice(1); // strip $START
        if (typeof window !== 'undefined' && window.__TXUKUN_DEBUG) {
          console.log(`[GECToR] iter ${iter} chunk ${i}: no corrections (done)`);
        }
        continue;
      }

      s.currentWords = applyEdits(s.words, wordLabels);
      s.everCorrected = true;

      if (typeof window !== 'undefined' && window.__TXUKUN_DEBUG) {
        console.log(`[GECToR] iter ${iter} chunk ${i}: corrected`, s.currentWords.slice(0, 5));
      }

      // Re-tokenize for next iteration
      if (iter < MAX_ITERATIONS - 1) {
        const w = ['$START', ...s.currentWords];
        const { inputIds, wordIds } = tokenizeWithWordIds(w, maxLen);
        s.words = w;
        s.inputIds = inputIds;
        s.wordIds = wordIds;
        s.seqLen = inputIds.length;
      }
    }
  }

  // Handle chunks that never finished (hit MAX_ITERATIONS with corrections)
  for (const s of states) {
    if (!s.done && s.currentWords) {
      s.currentWords = s.currentWords; // already set from last iteration
    } else if (!s.done) {
      s.currentWords = s.words.slice(1);
    }
  }

  // Merge results: preserve whitespace between chunks, adjust offsets
  const correctedParts = [];
  const allWordTypes = [];
  let prevEnd = 0;

  for (const s of states) {
    // Preserve whitespace between chunks
    if (s.chunkStart > prevEnd) {
      correctedParts.push(text.slice(prevEnd, s.chunkStart));
    }

    const corrected = s.everCorrected
      ? detokenizePunctuation(s.currentWords.join(' '))
      : s.chunkText;
    correctedParts.push(corrected);

    // Adjust word-type offsets from chunk-local to full-text
    if (s.wordTypes) {
      for (const wt of s.wordTypes) {
        allWordTypes.push({
          ...wt,
          start: wt.start + s.chunkStart,
          end: wt.end + s.chunkStart,
        });
      }
    }

    prevEnd = s.chunkEnd;
  }

  // Preserve trailing whitespace
  if (prevEnd < text.length) {
    correctedParts.push(text.slice(prevEnd));
  }

  const finalCorrected = correctedParts.join('');

  // DEBUG: log final result
  if (typeof window !== 'undefined' && window.__TXUKUN_DEBUG) {
    console.log(`[GECToR] final: changed=${finalCorrected !== text}`, { corrected: finalCorrected.slice(0, 80), original: text.slice(0, 80) });
    const correctedChunks = states.filter((s) => s.everCorrected).length;
    console.log(`[GECToR] ${correctedChunks}/${states.length} chunks had corrections`);
  }

  return { corrected: finalCorrected, wordTypes: allWordTypes };
}

/**
 * Detect grammar errors without applying corrections (heatmap).
 *
 * Single forward pass — returns per-word P(INCORRECT) + error type,
 * aligned to character positions in the original text.
 *
 * @param {string} text
 * @returns {Promise<{detections: Array<{word, start, end, pIncorrect, type}>}>}
 */
export async function detectGrammar(text) {
  if (!isGectorReady()) {
    await initGector();
    if (!isGectorReady()) return { detections: [] };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) return { detections: [] };

  const maxLen = vocab.max_length || 128;

  // Initialize chunk states (same as correctGrammar but single pass)
  const states = chunks
    .map((c) => {
      const wordTokens = tokenizeWords(c.text);
      if (wordTokens.length === 0) return null;
      const words = ['$START', ...wordTokens.map((w) => w.word)];
      const { inputIds, wordIds } = tokenizeWithWordIds(words, maxLen);
      return {
        chunkStart: c.start,
        wordTokens,
        wordIds,
        inputIds,
        seqLen: inputIds.length,
      };
    })
    .filter((s) => s !== null);

  if (states.length === 0) return { detections: [] };

  // Single batched forward pass for all chunks
  const predictions = await predictAllBatched(
    states.map((s) => ({ inputIds: s.inputIds, wordIds: s.wordIds, seqLen: s.seqLen })),
  );

  const allDetections = [];
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const { predTypeIds, wordDetections } = predictions[i];

    const detMap = new Map();
    for (const d of wordDetections) detMap.set(d.wordIdx, d.pIncorrect);

    // Map type IDs to word indices (first subword per word)
    const typeByWordIdx = new Map();
    let prevWordId = null;
    for (let t = 0; t < s.wordIds.length; t++) {
      const wid = s.wordIds[t];
      if (wid === null || wid === prevWordId) continue;
      prevWordId = wid;
      if (wid === 0) continue;
      const typeId = predTypeIds[t];
      const type = vocab.t_id2label ? (vocab.t_id2label[String(typeId)] || 'none') : 'none';
      typeByWordIdx.set(wid - 1, type);
    }

    for (const d of wordDetections) {
      if (d.wordIdx >= s.wordTokens.length) continue;
      const wt = s.wordTokens[d.wordIdx];
      allDetections.push({
        word: wt.word,
        pIncorrect: d.pIncorrect,
        start: wt.start + s.chunkStart,
        end: wt.end + s.chunkStart,
        type: typeByWordIdx.get(d.wordIdx) || 'none',
      });
    }
  }

  return { detections: allDetections };
}
