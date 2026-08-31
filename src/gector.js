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
const MAX_ITERATIONS = 5;

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
    );
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
    } else {
      edited.push(word);
    }
  }

  let result = edited.join(' ');
  result = result.replace(/ \$DELETE\b/g, '').replace(/\$DELETE /g, '').replace(/\$DELETE/g, '');
  result = result.replace(/\$START /g, '').replace(/\$START/g, '');
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

/**
 * Correct grammar and return per-word error info.
 *
 * @param {string} text — input text
 * @returns {Promise<{corrected: string, wordTypes: Array<{start, end, type, pIncorrect}>}>}
 *   `corrected` — fully corrected text (after up to MAX_ITERATIONS passes).
 *   `wordTypes` — per-original-word error type + detection, aligned to
 *     `text` char offsets. Types come from iteration 0 (original words).
 *   If model loading failed, returns { corrected: text, wordTypes: [] }.
 */
export async function correctGrammar(text) {
  if (!isGectorReady()) {
    await initGector();
    if (!isGectorReady()) return { corrected: text, wordTypes: [] };
  }

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

  // Types + detection aligned to original-text offsets (captured once).
  const wordTypes = alignWordInfo(predTypeIds, wordDetections, wordIds, wordTokens);

  // ── Iterative refinement of the corrected text ──
  const { wordLabels, hasCorrections } = alignToWords(predLabelIds, wordIds);
  if (!hasCorrections) {
    // Model $KEEP'd every word — return the original text unchanged.
    // Skipping detokenization avoids introducing spacing artifacts
    // (e.g. «mugatua» → « mugatua») that would cause spurious diffs.
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

  const maxLen = vocab.max_length || 128;

  const wordTokens = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    wordTokens.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  if (wordTokens.length === 0) return { detections: [] };

  const words = ['$START', ...wordTokens.map((w) => w.word)];
  const { inputIds, wordIds } = tokenizeWithWordIds(words, maxLen);
  const attentionMask = new Array(inputIds.length).fill(1);

  const { predTypeIds, wordDetections } = await predictAll(inputIds, attentionMask, wordIds);

  const detMap = new Map();
  for (const d of wordDetections) detMap.set(d.wordIdx, d.pIncorrect);

  // Map type IDs to word indices (first subword per word)
  const typeByWordIdx = new Map();
  let prevWordId = null;
  for (let t = 0; t < wordIds.length; t++) {
    const wid = wordIds[t];
    if (wid === null || wid === prevWordId) continue;
    prevWordId = wid;
    if (wid === 0) continue;
    const typeId = predTypeIds[t];
    const type = vocab.t_id2label ? (vocab.t_id2label[String(typeId)] || 'none') : 'none';
    typeByWordIdx.set(wid - 1, type);
  }

  const detections = wordDetections
    .filter((d) => d.wordIdx < wordTokens.length)
    .map((d) => ({
      word: wordTokens[d.wordIdx].word,
      pIncorrect: d.pIncorrect,
      start: wordTokens[d.wordIdx].start,
      end: wordTokens[d.wordIdx].end,
      type: typeByWordIdx.get(d.wordIdx) || 'none',
    }));

  return { detections };
}
