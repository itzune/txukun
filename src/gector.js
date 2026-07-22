/**
 * Txukun — GECToR grammar correction (Tier 3)
 *
 * Uses GECToR (edit-based grammatical error correction) fine-tuned on
 * RoBERTa-eus-base, trained on 1M Elhuyar GEC pairs.
 *
 * Architecture:
 *   - Encoder: RoBERTa-eus-base (110M, 12L/768H)
 *   - Two heads: label classifier ($KEEP/$DELETE/$REPLACE_x/$APPEND_x)
 *                 + error detector ($CORRECT/$INCORRECT)
 *   - Inference: iterative (up to 5 passes), non-autoregressive
 *
 * Model: int4 ONNX (~85MB), runs on WASM via onnxruntime-web.
 * Tokenizer: XLM-RoBERTa BPE, loaded via Transformers.js.
 *
 * The model corrects real-word grammar errors (verb agreement, case,
 * tense, suffix) that spell check cannot detect (every form is a valid
 * dictionary word, just wrong in context).
 *
 * Lazy-loaded: model is only fetched when correctGrammar() is first called.
 * If loading fails, returns the original text unchanged (graceful degradation).
 */

import { InferenceSession, Tensor } from 'onnxruntime-web';
import { AutoTokenizer, env } from '@huggingface/transformers';

// ── State ───────────────────────────────────────────

let session = null;
let tokenizer = null;
let vocab = null;
let loadingPromise = null;
let loadFailed = false;

// ── Constants ───────────────────────────────────────

const EMB_DIM = 768;

// Inference parameters (tuned for precision over recall — keyboard
// autocorrect context where false positives are costly).
const KEEP_CONFIDENCE = 0.0;
const MIN_ERROR_PROB = 0.5;   // detection threshold: only correct if confident
const MAX_ITERATIONS = 5;

// Punctuation tokenization (must match training data preprocessing).
// The model was trained on data where punctuation is space-separated
// from words (e.g., "kaixo," → "kaixo ,").
const PUNCT_RE = /([.,;:!?()«»"'\-\u2013\u2014])/g;

// Model source: HuggingFace Hub (models are too large for git/GitHub Pages).
// The repo itzune/gector-eus-onnx contains: onnx/model_q4.onnx (85MB int4),
// gector_vocab.json, tokenizer.json, sentencepiece.bpe.model, etc.
const HF_REPO = 'itzune/gector-eus-onnx';
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;

// Local fallback paths (used only for local testing)
const BASE = import.meta.env.BASE_URL || '/';
const MODEL_DIR = `${BASE}models/gector`;

// ── Lazy loading ────────────────────────────────────

/**
 * Lazy-load the GECToR ONNX model + tokenizer + vocab.
 * Called on first use; subsequent calls return the cached promise.
 * Returns null if loading failed (graceful degradation).
 */
export async function initGector() {
  if (session) return session;
  if (loadFailed) return null;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // Load tokenizer, vocab, and ONNX model from HuggingFace Hub.
    // No env.allowLocalModels needed — Transformers.js defaults to
    // allowRemoteModels=true in browser, same as MarianMT (cap-punct).
    const [tok, voc, modelBuf] = await Promise.all([
      AutoTokenizer.from_pretrained(HF_REPO),
      fetch(`${HF_BASE}/gector_vocab.json`).then(r => r.json()),
      fetch(`${HF_BASE}/onnx/model_q4.onnx`).then(r => r.arrayBuffer()),
    ]);

    tokenizer = tok;
    vocab = voc;

    session = await InferenceSession.create(modelBuf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    console.log('[txukun GECToR] model loaded, labels:', vocab.num_labels);
    return session;
  })().catch((err) => {
    console.warn('[txukun GECToR] load failed, grammar correction disabled:', err);
    loadFailed = true;
    return null;
  });

  return loadingPromise;
}

/**
 * Check if GECToR is loaded and ready.
 */
export function isGectorReady() {
  return session !== null && tokenizer !== null && vocab !== null;
}

/**
 * Was GECToR loading attempted and failed?
 */
export function isGectorFailed() {
  return loadFailed;
}

// ── Tokenization with word_ids ──────────────────────
// Replicates HuggingFace's is_split_into_words=True + word_ids()
// by tokenizing each word individually with a space prefix.
// Verified: identical token IDs and word_ids to is_split_into_words=True.

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

// ── Core prediction ─────────────────────────────────

async function predictTokenLabels(inputIds, attentionMask, wordIds) {
  const seqLen = inputIds.length;

  const inputIdsTensor = new Tensor(
    'int64',
    BigInt64Array.from(inputIds.map(BigInt)),
    [1, seqLen]
  );
  const attentionMaskTensor = new Tensor(
    'int64',
    BigInt64Array.from(attentionMask.map(BigInt)),
    [1, seqLen]
  );

  const outputs = await session.run({
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor,
  });

  const logitsLabels = outputs.logits_labels.data;
  const logitsD = outputs.logits_d.data;
  const numLabels = vocab.num_labels - 1;
  const dNumLabels = vocab.d_num_labels - 1;
  const keepIdx = vocab.label2id[vocab.keep_label];
  const incorIdx = vocab.d_label2id[vocab.incorrect_label];

  // Detection: compute max error probability (sentence-level)
  const wordMasks = buildWordMasks(wordIds);
  let maxErrorProb = 0;

  for (let t = 0; t < seqLen; t++) {
    if (wordMasks[t] !== 1) continue;
    const { exps, sumExp } = softmax(logitsD, t * dNumLabels, dNumLabels);
    const pIncor = exps[incorIdx] / sumExp;
    if (pIncor > maxErrorProb) maxErrorProb = pIncor;
  }

  const sentenceKeepAll = maxErrorProb < MIN_ERROR_PROB;

  // Label prediction: softmax + keep_confidence + argmax
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

  return predLabelIds;
}

// ── Detection-only prediction ──────────────────────

/**
 * Run a detection-only forward pass — returns per-word P(INCORRECT).
 * Lighter than predictTokenLabels: skips the label softmax over ~4500
 * classes. Used by detectGrammar() for the input heatmap.
 */
async function predictDetection(inputIds, attentionMask, wordIds) {
  const seqLen = inputIds.length;

  const inputIdsTensor = new Tensor(
    'int64',
    BigInt64Array.from(inputIds.map(BigInt)),
    [1, seqLen]
  );
  const attentionMaskTensor = new Tensor(
    'int64',
    BigInt64Array.from(attentionMask.map(BigInt)),
    [1, seqLen]
  );

  const outputs = await session.run({
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor,
  });

  const logitsD = outputs.logits_d.data;
  const dNumLabels = vocab.d_num_labels - 1;
  const incorIdx = vocab.d_label2id[vocab.incorrect_label];

  // Compute P(INCORRECT) for the first subword of each word
  const wordMasks = buildWordMasks(wordIds);
  const wordDetections = [];

  for (let t = 0; t < seqLen; t++) {
    if (wordMasks[t] !== 1) continue;
    const { exps, sumExp } = softmax(logitsD, t * dNumLabels, dNumLabels);
    const pIncor = exps[incorIdx] / sumExp;

    const wid = wordIds[t];
    if (wid !== null && wid > 0) {  // skip $START (wid=0) and special tokens
      wordDetections.push({ wordIdx: wid - 1, pIncorrect: pIncor });
    }
  }

  return wordDetections;
}

// ── Align token labels to words ─────────────────────

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
  return result.split(/\s+/).filter(w => w.length > 0);
}

// ── Punctuation tokenization ────────────────────────

function tokenizePunctuation(text) {
  return text.replace(PUNCT_RE, ' $1 ').replace(/\s+/g, ' ').trim();
}

function detokenizePunctuation(text) {
  return text.replace(/\s+([.,;:!?()«»"'\-\u2013\u2014])/g, '$1');
}

// ── Public API ──────────────────────────────────────

/**
 * Correct grammar errors in text using GECToR.
 *
 * @param {string} text  input text (may contain grammar errors)
 * @returns {Promise<{corrected: string, changed: boolean}>}
 *   corrected text and whether any changes were made.
 *   If model loading failed, returns original text unchanged.
 */
export async function correctGrammar(text) {
  if (!isGectorReady()) {
    await initGector();
    if (!isGectorReady()) return { corrected: text, changed: false };
  }

  const maxLen = vocab.max_length || 128;
  let currentText = tokenizePunctuation(text);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const words = ['$START', ...currentText.split(/\s+/)];

    const { inputIds, wordIds } = tokenizeWithWordIds(words, maxLen);
    const attentionMask = new Array(inputIds.length).fill(1);

    const predLabelIds = await predictTokenLabels(inputIds, attentionMask, wordIds);
    const { wordLabels, hasCorrections } = alignToWords(predLabelIds, wordIds);

    if (!hasCorrections) break;

    const newWords = applyEdits(words, wordLabels);
    currentText = newWords.join(' ');
  }

  const corrected = detokenizePunctuation(currentText);
  return { corrected, changed: corrected !== text };
}

/**
 * Detect grammar errors in text using GECToR's detect head.
 *
 * Single forward pass — returns per-word P(INCORRECT) scores aligned
 * to character positions in the original text. Does NOT apply corrections.
 *
 * Powers the input heatmap: highlights words the model suspects are
 * wrong, even before correction is applied.
 *
 * @param {string} text  input text
 * @returns {Promise<{detections: Array<{word, pIncorrect, start, end}>}>}
 *   detections sorted by position. Empty if model not available.
 */
export async function detectGrammar(text) {
  if (!isGectorReady()) {
    await initGector();
    if (!isGectorReady()) return { detections: [] };
  }

  const maxLen = vocab.max_length || 128;

  // Tokenize input into words with character positions.
  // Whitespace splitting — GECToR handles subword tokenization internally.
  const wordTokens = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    wordTokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (wordTokens.length === 0) return { detections: [] };

  // Prepare GECToR input (prepend $START)
  const words = ['$START', ...wordTokens.map(w => w.word)];
  const { inputIds, wordIds } = tokenizeWithWordIds(words, maxLen);
  const attentionMask = new Array(inputIds.length).fill(1);

  // Run detection-only forward pass
  const wordDetections = await predictDetection(inputIds, attentionMask, wordIds);

  // Map detection scores to original text positions
  const detections = wordDetections
    .filter(d => d.wordIdx < wordTokens.length)
    .map(d => ({
      word: wordTokens[d.wordIdx].word,
      pIncorrect: d.pIncorrect,
      start: wordTokens[d.wordIdx].start,
      end: wordTokens[d.wordIdx].end,
    }));

  return { detections };
}
