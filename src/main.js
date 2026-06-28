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
import { loadSpellChecker, checkSpelling, annotateSpelling, stripAnnotations } from './spell.js';

// ── State ──────────────────────────────────────────

let correctorPipeline = null;
let modelLoading = false;
let modelLoaded = false;
let spellReady = false;
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

    // Load spell checker in background (after model is ready)
    try {
      await loadSpellChecker();
      spellReady = true;
      setModelStatus('ready');
      console.log('Spell checker loaded');
    } catch (err) {
      console.warn('Spell checker failed to load, continuing without spelling:', err);
      spellReady = false;
      setModelStatus('ready');
    }
  } catch (err) {
    console.error('Failed to load model:', err);
    modelLoading = false;
    setModelStatus('error');
    setProgress(0);

    toast(t('toast.modelError', currentLang) + ': ' + err.message, 'error');
  }
}

// ── Correction Logic ────────────────────────────────

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

  try {
    // Process text — the model works on individual sentences
    // Split by newlines, process each line, join back
    const lines = input.split('\n').filter(line => line.trim());
    const results = [];

    for (const line of lines) {
      const result = await correctorPipeline(line);
      let text = result[0]?.translation_text || line;
      // Clean MarianMT output special tokens: <unk>, </s>, <pad>, <s>
      text = text
        .replace(/<\/s>/g, '')
        .replace(/<s>/g, '')
        .replace(/<pad>/g, '')
        .replace(/<unk>/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      results.push(text || line);
    }

    // If there were no lines (empty after trim), handle single case
    if (results.length === 0) {
      const result = await correctorPipeline(input);
      let text = result[0]?.translation_text || input;
      text = text
        .replace(/<\/s>/g, '')
        .replace(/<s>/g, '')
        .replace(/<pad>/g, '')
        .replace(/<unk>/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      results.push(text || input);
    }

    const output = results.join('\n');

    // Run spell check if available
    let annotatedOutput = output;
    if (spellReady) {
      const errors = checkSpelling(output);
      if (errors.length > 0) {
        annotatedOutput = annotateSpelling(output, errors);
      }
    }

    setOutputText(output);
    if (annotatedOutput !== output) {
      setOutputTextAnnotated(annotatedOutput, output);
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

  // Auto-load model after a short delay (let the page render first)
  setTimeout(() => {
    loadModel();
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

      // Update output char count
      const outputEl = document.getElementById('outputText');
      if (outputEl) {
        document.getElementById('outputCharCount').textContent = outputEl.value.length;
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
}

// Start
init();
