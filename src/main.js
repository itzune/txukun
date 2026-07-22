/**
 * Txukun — Main entry point
 *
 * Orchestrates model loading, inference, UI events, and i18n.
 */

import { i18n, detectLanguage, t } from './i18n.js';
import { toast } from './ui-toast.js';
import {
  setCorrectButtonEnabled,
  setModelStatus,
  setProgress,
  setSpellStatus,
  getInputText,
  setOutputText,
  setOutputTextAnnotated,
  bindCopyButton,
  bindDownloadButton,
  bindClearButton,
  bindCorrectButton,
  updateCopyDownloadButtons,
} from './ui-bindings.js';
import { renderExamples, bindExampleClicks } from './ui-examples.js';
import { loadSpellChecker, checkSpelling, autoCorrect, annotateWithCorrections, annotateSpelling, stripAnnotations } from './spell.js';
import { correctGrammar, detectGrammar, initGector, isGectorReady, isGectorFailed } from './gector.js';

console.log('[DEBUG] txukun main.js loaded');

// ── State ──────────────────────────────────────────

let correctorPipeline = null;
let modelLoading = false;
let modelLoaded = false;
let spellReady = false;
let spellEnabled = true;  // controlled by toggle and ?spell= param
let grammarEnabled = true; // controlled by ?grammar= param
let currentLang = 'eu';

// ── Model Loading ──────────────────────────────────

async function loadModel() {
  if (modelLoading || modelLoaded) return;

  modelLoading = true;
  setCorrectButtonEnabled(false);
  setModelStatus('loading');
  setProgress(0);

  try {
    // Dynamic import — only load Transformers.js when needed
    const { pipeline, env } = await import('@huggingface/transformers');

    setProgress(10);

    // Load the model from HuggingFace Hub
    correctorPipeline = await pipeline(
      'translation',
      'itzune/txukun-cap-punct-eu',  // HF Hub model
      {
        device: 'wasm',
        dtype: 'q8',        // int8 quantized model (77 MB, 74% smaller than fp32)
        subfolder: '',       // model files are directly in repo root, not in onnx/
        progress_callback: (info) => {
          if (info.status === 'progress' && info.progress !== undefined) {
            // info.progress is 0-100 within the current file.
            // Multiple files are downloaded, so progress resets per file.
            // We simply show current file progress in the 10-90% range.
            // Ignore tiny files (config.json, etc.) — only show ONNX/tokenizer progress.
            if (info.file && (info.file.endsWith('.onnx') || info.file.endsWith('tokenizer.json'))) {
              const pct = 10 + Math.round((info.progress / 100) * 80);
              setProgress(pct);
            }
          }
        },
      }
    );

    setProgress(100);
    modelLoaded = true;
    setModelStatus('loading-spell');

    toast(t('toast.modelReady', currentLang), 'success');

    // Load spell checker (Hunspell WASM worker with Xuxen dictionary)
    // Runs in parallel with model — worker inits independently
    try {
      setModelStatus('loading-spell');
      await loadSpellChecker();
      spellReady = true;
      setSpellStatus(true, 0);
    } catch (err) {
      console.warn('Txukun: spell checker (Hunspell) failed, falling back:', String(err));
      spellReady = false;
      setSpellStatus(false, String(err).slice(0, 40));
    }

    // Pre-load GECToR grammar model in the background (lazy, non-blocking)
    if (grammarEnabled) {
      initGector().then(() => {
        if (isGectorReady()) {
          console.log('[txukun] GECToR grammar model ready');
        }
      });
    }

    setModelStatus('ready');

    // Re-evaluate correct button: if user already typed text while model
    // was loading, the button stayed disabled (it only enables on 'input' event).
    const inputEl2 = document.getElementById('inputText');
    if (inputEl2) {
      const hasText = inputEl2.value.trim().length > 0;
      setCorrectButtonEnabled(hasText && modelLoaded);
    }
  } catch (err) {
    console.error('Failed to load model:', err);
    modelLoading = false;
    setModelStatus('error');
    setProgress(0);

    toast(t('toast.modelError', currentLang) + ': ' + err.message, 'error');
  }
}

// ── Grammar Detection Heatmap ──────────────────

/**
 * Map P(INCORRECT) ∈ [0, 1] to a heatmap background color.
 * Transparent below 0.15; interpolates amber → red with increasing alpha.
 */
function heatmapColor(p) {
  if (p < 0.15) return 'transparent';
  const t = (p - 0.15) / 0.85;  // normalize to [0, 1]
  const r = Math.round(245 + (232 - 245) * t);
  const g = Math.round(160 + (72 - 160) * t);
  const b = Math.round(32 + (50 - 32) * t);
  const a = (0.08 + 0.32 * t).toFixed(2);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render a heatmap on the input overlay — each word's background color
 * reflects GECToR's detection confidence (P(INCORRECT)).
 */
function renderInputHeatmap(text, detections) {
  const overlay = document.getElementById('inputSpellOverlay');
  const content = document.getElementById('inputSpellContent');
  const textarea = document.getElementById('inputText');
  if (!overlay || !content) return;

  const sorted = [...detections].sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  for (const det of sorted) {
    if (det.start < cursor) continue;  // skip overlapping
    html += escapeHtml(text.slice(cursor, det.start));
    const color = heatmapColor(det.pIncorrect);
    const pct = (det.pIncorrect * 100).toFixed(0);
    html += `<span class="heatmap-word" style="background: ${color};" title="Akats konfiantza: ${pct}%">${escapeHtml(det.word)}</span>`;
    cursor = det.end;
  }
  html += escapeHtml(text.slice(cursor));

  content.innerHTML = html;
  overlay.classList.add('spell-overlay--heatmap');
  overlay.style.display = 'block';

  // Sync scroll position with textarea
  if (textarea) {
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  }
}

function hideInputHeatmap() {
  const overlay = document.getElementById('inputSpellOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.classList.remove('spell-overlay--heatmap');
  }
}

// ── Correction Logic ────────────────────────────────

/**
 * Constrain MarianMT output to ONLY capitalization + punctuation changes.
 *
 * MarianMT is a cap-punct model but sometimes hallucinates word
 * substitutions (e.g., "Nire"→"Auzo", "hau"→"hausitza"). This filter
 * compares word-by-word: if the lowercase form differs, the substitution
 * is rejected and the original word is kept. Only cap/punct changes pass.
 *
 * If token counts differ (model added/removed a word), the entire line
 * is rejected — safer than misaligning.
 */
function constrainCapPunct(inputLine, outputLine) {
  const inputTokens = inputLine.match(/\S+/g) || [];
  const outputTokens = outputLine.match(/\S+/g) || [];

  // Token count mismatch → model did something drastic, reject entirely
  if (inputTokens.length !== outputTokens.length) {
    console.log('[DEBUG] constrainCapPunct: token count mismatch, rejecting line',
      { input: inputTokens.length, output: outputTokens.length });
    return inputLine;
  }

  const result = [];
  for (let i = 0; i < inputTokens.length; i++) {
    const inTok = inputTokens[i];
    const outTok = outputTokens[i];

    // Extract alphabetic word part (strip punctuation) for comparison
    const inWord = inTok.replace(/[^A-Za-zÀ-ÿñÑüÜ]/g, '');
    const outWord = outTok.replace(/[^A-Za-zÀ-ÿñÑüÜ]/g, '');

    if (inWord.toLowerCase() === outWord.toLowerCase()) {
      // Same word (possibly different capitalization) — accept output token
      result.push(outTok);
    } else {
      // Word substitution detected — reject, keep input token
      console.log('[DEBUG] constrainCapPunct: rejected substitution',
        { position: i, input: inTok, output: outTok });
      result.push(inTok);
    }
  }

  return result.join(' ');
}

async function correctText() {
  const input = getInputText().trim();
  if (!input) {
    toast(t('toast.noText', currentLang), 'warning');
    return;
  }

  if (!correctorPipeline) {
    toast(t('toast.modelNotReady', currentLang), 'warning');
    return;
  }

  // Show loading state
  setModelStatus('processing');
  setOutputText('...');

  // Auto-correct input spelling before sending to model (when enabled)
  let modelInput = input;
  let preModelCorrections = [];
  if (spellReady && spellEnabled) {
    const corrected = await autoCorrect(input);
    console.log('[DEBUG] pre-model autoCorrect:', JSON.stringify({ input, output: corrected.text, changes: corrected.changes, corrections: corrected.corrections }));
    if (corrected.changes > 0) {
      modelInput = corrected.text;
      // Save pre-model corrections for green annotation in output.
      // We store { original, corrected } so annotateWithCorrections can
      // match by corrected word in the final output text.
      preModelCorrections = corrected.corrections.map(c => ({
        original: c.original,
        corrected: c.corrected,
      }));
    }
  }

  try {
    // Process text — the model works on individual sentences
    // Split by newlines, process each line, join back
    const lines = modelInput.split('\n').filter(line => line.trim());
    const results = [];

    for (const line of lines) {
      const result = await correctorPipeline(line);
      let text = result[0]?.translation_text || line;
      console.log('[DEBUG] MarianMT:', JSON.stringify({ input: line, output: text }));
      // Clean MarianMT output special tokens: <unk>, </s>, <pad>, <s>
      text = text
        .replace(/<\/s>/g, '')
        .replace(/<s>/g, '')
        .replace(/<pad>/g, '')
        .replace(/<unk>/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // Constrain to cap/punct only — reject word substitutions
      const constrained = constrainCapPunct(line, text);
      if (constrained !== text) {
        console.log('[DEBUG] MarianMT constrained:', JSON.stringify({ before: text, after: constrained }));
      }
      text = constrained;

      results.push(text || line);
    }

    // If there were no lines (empty after trim), handle single case
    if (results.length === 0) {
      const result = await correctorPipeline(modelInput);
      let text = result[0]?.translation_text || modelInput;
      text = text
        .replace(/<\/s>/g, '')
        .replace(/<s>/g, '')
        .replace(/<pad>/g, '')
        .replace(/<unk>/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      text = constrainCapPunct(modelInput, text);
      results.push(text || input);
    }

    let output = results.join('\n');
    console.log('[DEBUG] MarianMT joined output:', JSON.stringify({ modelInput, output }));

    // GECToR grammar correction (Tier 3)
    // Fixes real-word grammar errors (verb agreement, case, tense, suffix)
    // that spell check cannot detect. Runs after MarianMT cap-punct.
    if (grammarEnabled && !isGectorFailed()) {
      const grammarResult = await correctGrammar(output);
      if (grammarResult.changed) {
        console.log('[DEBUG] GECToR:', JSON.stringify({ input: output, output: grammarResult.corrected }));
        output = grammarResult.corrected;
      }

      // GECToR detection heatmap (Tier 2.5) — per-word P(INCORRECT) on
      // the input text. Model is loaded now (correctGrammar triggered it).
      if (isGectorReady()) {
        try {
          const { detections } = await detectGrammar(input);
          if (detections.length > 0) {
            renderInputHeatmap(input, detections);
          }
        } catch (e) {
          console.warn('[txukun] detection heatmap failed:', e);
        }
      }
    }

    // Run spell check if enabled and available
    let finalOutput = output;
    let annotatedOutput = output;
    if (spellReady && spellEnabled) {
      // Auto-correct: replace misspelled words with first suggestion
      const result = await autoCorrect(output);
      console.log('[DEBUG] post-model autoCorrect:', JSON.stringify({ input: output, output: result.text, changes: result.changes, corrections: result.corrections }));
      finalOutput = result.text;
      setSpellStatus(true, result.changes + preModelCorrections.length);

      // Also annotate remaining errors (words with no suggestions)
      const remaining = await checkSpelling(finalOutput);

      // Merge pre-model and post-model corrections for green annotation.
      // Pre-model corrections fixed words BEFORE the model, so they
      // appear in the final output too (model preserves them).
      const allCorrections = [
        ...preModelCorrections,
        ...result.corrections.map(c => ({ original: c.original, corrected: c.corrected })),
      ];

      if (allCorrections.length > 0 || remaining.length > 0) {
        annotatedOutput = annotateWithCorrections(finalOutput, allCorrections, remaining);
      }
    } else if (spellReady && !spellEnabled) {
      // Spell checker loaded but disabled: just annotate, don't correct
      const errors = await checkSpelling(output);
      if (errors.length > 0) {
        annotatedOutput = annotateSpelling(output, errors);
      }
    }

    setOutputText(finalOutput);
    if (annotatedOutput && annotatedOutput !== finalOutput) {
      setOutputTextAnnotated(annotatedOutput, finalOutput);
    }
    updateCopyDownloadButtons(true);

    setModelStatus('ready');

    if (input !== output) {
      toast(t('toast.corrected', currentLang), 'success');
    } else {
      toast(t('toast.noChanges', currentLang), 'info');
    }
  } catch (err) {
    console.error('Correction failed:', err);
    setModelStatus('ready');
    toast(t('toast.correctError', currentLang) + ': ' + err.message, 'error');
  }
}

// ── Example Selection ───────────────────────────────

function handleExample(text) {
  const inputEl = document.getElementById('inputText');
  if (inputEl) {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    // Auto-correct when an example is selected
    if (modelLoaded) {
      correctText();
    }
  }
}

// ── Keyboard Shortcuts ──────────────────────────────

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter → correct
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      correctText();
    }
  });
}

// ── Init ────────────────────────────────────────────

async function init() {
  // Detect language
  currentLang = detectLanguage();
  applyLanguage(currentLang);

  // Setup UI bindings
  bindCopyButton();
  bindDownloadButton();
  bindClearButton();
  bindCorrectButton(correctText);

  // Render examples
  renderExamples(currentLang);
  bindExampleClicks(handleExample);

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Listen for spell-corrected input → re-run correction
  document.addEventListener('txukun:recorrect', () => {
    if (modelLoaded) correctText();
  });

  // Listen for suggestion click on output panel → re-spell check without model re-inference
  document.addEventListener('txukun:respell', async (e) => {
    if (spellReady && !spellEnabled) {
      const text = e.detail?.text || '';
      const errors = await checkSpelling(text);
      if (errors.length > 0) {
        setOutputTextAnnotated(annotateSpelling(text, errors), text);
      } else {
        setOutputText(text);
      }
    }
  });

  // Spell toggle checkbox
  const chkSpell = document.getElementById('chkSpell');
  if (chkSpell) {
    // ?spell=0 disables, ?spell=1 enables (default: enabled)
    const params = new URLSearchParams(window.location.search);
    const spellParam = params.get('spell');
    if (spellParam === '0') {
      spellEnabled = false;
      chkSpell.checked = false;
    } else {
      chkSpell.checked = spellEnabled;
    }

    // ?grammar=0 disables GECToR (default: enabled)
    const grammarParam = params.get('grammar');
    if (grammarParam === '0') {
      grammarEnabled = false;
    }
    chkSpell.addEventListener('change', () => {
      spellEnabled = chkSpell.checked;
      // Hide input overlay if disabling
      if (!spellEnabled) {
        const overlay = document.getElementById('inputSpellOverlay');
        if (overlay) overlay.style.display = 'none';
        const outOverlay = document.getElementById('outputSpellOverlay');
        if (outOverlay) outOverlay.style.display = 'none';
      }
    });
  }

  // Auto-load model after a short delay (let the page render first)
  setTimeout(() => {
    loadModel().then(() => {
      // If ?text= param present, fill it in and auto-correct
      const params = new URLSearchParams(window.location.search);
      const presetText = params.get('text');
      if (presetText) {
        const inputEl = document.getElementById('inputText');
        if (inputEl) {
          inputEl.value = presetText;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => correctText(), 500);
        }
      }
    });
  }, 800);

  // Update char count on input
  const inputEl = document.getElementById('inputText');
  if (inputEl) {
    inputEl.addEventListener('input', () => {
      const count = inputEl.value.length;
      document.getElementById('inputCharCount').textContent = count;

      // Enable/disable correct button based on input
      const hasText = inputEl.value.trim().length > 0;
      setCorrectButtonEnabled(hasText && modelLoaded);

      // Hide heatmap overlay when user edits
      hideInputHeatmap();

      // Update output char count
      const outputEl = document.getElementById('outputText');
      if (outputEl) {
        document.getElementById('outputCharCount').textContent = outputEl.value.length;
      }
    });

    // Hide heatmap when user focuses the textarea (to edit)
    inputEl.addEventListener('focus', () => {
      hideInputHeatmap();
    });

    // Sync heatmap overlay scroll with textarea
    inputEl.addEventListener('scroll', () => {
      const overlay = document.getElementById('inputSpellOverlay');
      if (overlay && overlay.style.display !== 'none') {
        overlay.scrollTop = inputEl.scrollTop;
        overlay.scrollLeft = inputEl.scrollLeft;
      }
    });
  }
}

// ── Language ────────────────────────────────────────

function applyLanguage(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;

  // Update all data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const value = t(key, lang);
    if (value && typeof value === 'string') {
      // Use innerHTML for <p> elements that may contain formatting tags (<strong>, <code>)
      if (el.tagName === 'P') {
        el.innerHTML = value;
      } else {
        el.textContent = value;
      }
    }
  });

  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    const value = t(key, lang);
    if (value) el.placeholder = value;
  });

  // Update titles
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    const value = t(key, lang);
    if (value) el.title = value;
  });

  // Update examples
  renderExamples(lang);

  // Update spell info tooltip
  const spellInfoBtn = document.getElementById('spellInfoBtn');
  if (spellInfoBtn) {
    spellInfoBtn.setAttribute('data-tooltip', t('spell.toggleHint', lang));
  }
}

// Start
init();
