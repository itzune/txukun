/**
 * Txukun — Shared model management (single-model architecture)
 *
 * Loads the GECToR v2-mt model (grammar + spelling + cap-punct + types,
 * all in one). This replaces the old 3-model pipeline (MarianMT cap-punct
 * + Hunspell/BERTeus spelling + GECToR grammar) with a single ONNX model.
 *
 * The actual model logic lives in gector.js; this module is a thin status
 * wrapper so the UI (main.js) can show load progress and readiness.
 */

import { initGector, isGectorReady, isGectorFailed } from './gector.js';

// ── State ───────────────────────────────────────────

let loading = false;
let statusCb = () => {};

/** @param {(status: string) => void} cb */
export function onStatus(cb) {
  statusCb = cb;
}

function setStatus(s) {
  statusCb(s);
}

// ── Readiness ───────────────────────────────────────

export function isModelReady() {
  return isGectorReady();
}
export function isGrammarReady() {
  return isGectorReady();
}
export function isGrammarFailed() {
  return isGectorFailed();
}
export function isLoading() {
  return loading;
}

// ── Loading ─────────────────────────────────────────

/**
 * Pre-load the GECToR v2-mt model in the background after startup.
 * The model (~87MB int4 ONNX + tokenizer) takes 5–120s to download and
 * initialize depending on cache and device. analyzeText() also lazy-loads
 * on first call, so this is purely for warming the cache before the user
 * clicks "Aztertu".
 */
export async function loadModels() {
  if (loading || isGectorReady()) return;
  loading = true;
  setStatus('loading');
  try {
    await initGector();
    setStatus(isGectorReady() ? 'ready' : 'error');
  } catch (err) {
    console.error('[txukun] model load failed:', err);
    setStatus('error');
  } finally {
    loading = false;
  }
}
