/**
 * Txukun — Shared model management
 *
 * Owns the MarianMT (cap-punct) pipeline and exposes a clean API for
 * both the UI layer (main.js) and the analysis bridge (analyze.js).
 *
 * Models:
 *   - MarianMT cap-punct  (itzune/txukun-cap-punct-eu)   — this module
 *   - Hunspell + BERTeus  (spell.js)                      — delegated
 *   - GECToR grammar      (gector.js)                     — delegated
 */

import { pipeline } from '@huggingface/transformers';
import { loadSpellChecker } from './spell.js';
import { initGector, isGectorReady, isGectorFailed } from './gector.js';

// ── State ───────────────────────────────────────────

let correctorPipeline = null;
let modelLoading = false;
let modelLoaded = false;
let spellReady = false;
let grammarReady = false;

let statusCb = () => {};

/** @param {(status: string) => void} cb */
export function onStatus(cb) {
  statusCb = cb;
}

function setStatus(s) {
  statusCb(s);
}

export function isModelReady() { return modelLoaded; }
export function isSpellReady() { return spellReady; }
export function isGrammarReady() { return grammarReady; }
export function isGrammarFailed() { return isGectorFailed(); }
export function isLoading() { return modelLoading; }

// ── Model loading ───────────────────────────────────

export async function loadModels() {
  if (modelLoading || modelLoaded) return;
  modelLoading = true;
  setStatus('loading');

  try {
    correctorPipeline = await pipeline('translation', 'itzune/txukun-cap-punct-eu', {
      device: 'wasm',
      dtype: 'q8',
      subfolder: '',
      progress_callback: (info) => {
        if (info.status === 'progress' && info.file &&
            (info.file.endsWith('.onnx') || info.file.endsWith('tokenizer.json'))) {
          setStatus('loading:' + Math.round(10 + (info.progress / 100) * 80) + '%');
        }
      },
    });

    modelLoaded = true;
    setStatus('loading-spell');

    // Hunspell (spell check)
    try {
      await loadSpellChecker();
      spellReady = true;
    } catch (err) {
      console.warn('[txukun] Hunspell failed:', err);
      spellReady = false;
    }

    // GECToR (grammar) — pre-load in background
    initGector().then(() => {
      grammarReady = isGectorReady();
      if (grammarReady) setStatus('ready');
    });

    setStatus(spellReady ? 'ready' : 'ready-nospell');
  } catch (err) {
    console.error('[txukun] model load failed:', err);
    setStatus('error');
  } finally {
    modelLoading = false;
  }
}

// ── Cap-punct correction (MarianMT) ─────────────────

/**
 * Constrain MarianMT output to ONLY capitalization + punctuation changes.
 * Rejects word substitutions (hallucinations) by comparing lowercase forms.
 */
function constrainCapPunct(inputLine, outputLine) {
  const inputTokens = inputLine.match(/\S+/g) || [];
  const outputTokens = outputLine.match(/\S+/g) || [];
  if (inputTokens.length !== outputTokens.length) return inputLine;

  const result = [];
  for (let i = 0; i < inputTokens.length; i++) {
    const inWord = inputTokens[i].replace(/[^A-Za-zÀ-ÿñÑüÜ]/g, '');
    const outWord = outputTokens[i].replace(/[^A-Za-zÀ-ÿñÑüÜ]/g, '');
    if (inWord.toLowerCase() === outWord.toLowerCase()) {
      result.push(outputTokens[i]);
    } else {
      result.push(inputTokens[i]); // reject substitution
    }
  }
  return result.join(' ');
}

/**
 * Run MarianMT cap-punct correction on the full text (line by line).
 * Returns the corrected text with only case/punctuation changes applied.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function correctCapPunct(text) {
  if (!modelLoaded || !correctorPipeline) return text;

  const lines = text.split('\n').filter((l) => l.trim());
  const results = [];
  for (const line of lines) {
    const out = await correctorPipeline(line);
    let corrected = out[0]?.translation_text || line;
    corrected = corrected
      .replace(/<\/?s>/g, '').replace(/<pad>/g, '').replace(/<unk>/g, '')
      .replace(/\s{2,}/g, ' ').trim();
    results.push(constrainCapPunct(line, corrected) || line);
  }
  return results.join('\n');
}
