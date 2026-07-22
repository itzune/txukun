/**
 * Txukun — Main entry point (Grammarly-style redesign)
 *
 * 3-pane layout: documents (left) · Idaztian editor (center) ·
 * suggestions (right). On-demand analysis ("Aztertu") runs the three
 * detection models and produces suggestion cards the user accepts or
 * dismisses individually — no auto-apply.
 */

import { initEditor, getContent, setContent, setErrors, clearErrors, getErrors, setActiveError, scrollToError, focusEditor } from './editor.js';
import { initDocPanel, render as renderDocs, newDoc, importDoc, renameActive } from './doc-panel.js';
import { initSuggestions, renderCards, clearCards } from './suggestions.js';
import { ensureDoc, getActiveId, updateDoc, getDoc, listDocs, setActiveId, titleFromH1 } from './documents.js';
import { analyzeText } from './analyze.js';
import { loadModels, onStatus, isModelReady, isLoading } from './models.js';
import { toast } from './ui-toast.js';

// ── State ───────────────────────────────────────────

let analyzing = false;
let currentLang = 'eu';
let saveTimer = null;

// ── Init ────────────────────────────────────────────

async function init() {
  // 1. Ensure there's an active document
  const doc = ensureDoc();

  // 2. Initialize the editor
  const editorWrap = document.getElementById('editorWrap');
  await initEditor({
    parent: editorWrap,
    initialContent: doc.content || '',
    onChange: onEditorChange,
    onErrorClick: onErrorClick,
    onStats: updateStats,
  });

  // Set the doc title input
  const titleInput = document.getElementById('docTitle');
  titleInput.value = doc.title || 'Dokumentu berria';

  // 3. Initialize panels
  initDocPanel({
    listRoot: document.getElementById('docList'),
    onSwitchCb: onDocSwitch,
    onRenameCb: () => {},
  });
  initSuggestions({
    panelRoot: document.getElementById('rightPanel'),
    onCountChange: () => {},
  });

  // 4. Wire up all UI events
  wireEvents();

  // 5. Load models in the background (non-blocking)
  onStatus(updateStatus);
  loadModels();

  // 6. Focus the editor
  focusEditor();
}

// ── Editor change handler (auto-save + clear stale errors) ──────────

function onEditorChange(content, isProgrammatic) {
  // Auto-save (debounced)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const id = getActiveId();
    if (!id) return;
    // Derive title from H1 if present
    const h1 = titleFromH1(content);
    if (h1) {
      updateDoc(id, { content, title: h1 });
      const titleInput = document.getElementById('docTitle');
      if (titleInput.value !== h1) {
        titleInput.value = h1;
        renderDocs();
      }
    } else {
      updateDoc(id, { content });
    }
  }, 600);

  // Clear stale errors only on USER edits — not when we're applying a
  // fix (accept/dismiss), which dispatches its own text change.
  if (!isProgrammatic && getErrors().length > 0) {
    clearErrors();
    clearCards();
  }
}

function updateStats({ words, chars }) {
  const wc = document.getElementById('wordCount');
  const cc = document.getElementById('charCount');
  if (wc) wc.textContent = `${words} hitz`;
  if (cc) cc.textContent = `${chars} karaktere`;
}

// ── Error click in editor → expand matching card ────────────────────

function onErrorClick(errorId) {
  const card = document.querySelector(`.card[data-error-id="${errorId}"]`);
  if (card) {
    // Expand + scroll into view in the suggestions panel
    document.querySelectorAll('.card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    setActiveError(errorId);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── Analyze button ──────────────────────────────────────────────────

async function onAnalyze() {
  if (analyzing) return;
  const text = getContent();
  if (!text.trim()) {
    toast('Idatzi testuren bat lehenengo.', 'warning');
    return;
  }
  if (!isModelReady() && isLoading()) {
    toast('Eredua kargatzen ari da… itxaron une bat.', 'warning');
    return;
  }

  analyzing = true;
  const btn = document.getElementById('btnAnalyze');
  const label = document.getElementById('analyzeLabel');
  btn.disabled = true;
  label.textContent = 'Aztertzen…';
  updateStatus('processing');

  try {
    // Clear previous errors
    clearErrors();
    clearCards();

    const errors = await analyzeText(text);

    // Add context snippets (±18 chars) for the cards
    for (const e of errors) {
      const ctxStart = Math.max(0, e.from - 18);
      const ctxEnd = Math.min(text.length, e.to + 18);
      let ctx = text.slice(ctxStart, e.from);
      if (ctxStart > 0) ctx = '…' + ctx;
      e.context = ctx.trim();
    }

    setErrors(errors);
    renderCards(errors);

    if (errors.length === 0) {
      toast('Ez da akatsik aurkitu. 👍', 'success');
    } else {
      toast(`${errors.length} iradokizun aurkitu dira.`, 'info');
    }
  } catch (err) {
    console.error('[txukun] analyze failed:', err);
    toast('Akatsa analesian: ' + (err.message || err), 'error');
  } finally {
    analyzing = false;
    btn.disabled = false;
    label.textContent = 'Aztertu';
    updateStatus(isModelReady() ? 'ready' : 'idle');
  }
}

// ── Document switching ──────────────────────────────────────────────

function onDocSwitch(doc) {
  if (!doc) return;
  setActiveId(doc.id);
  setContent(doc.content || '');
  const titleInput = document.getElementById('docTitle');
  titleInput.value = doc.title || 'Dokumentu berria';
  clearErrors();
  clearCards();
  focusEditor();
}

// ── Status display ──────────────────────────────────────────────────

const STATUS_TEXT = {
  idle: 'Eredua kargatu gabe',
  loading: 'Eredua kargatzen…',
  'loading-spell': 'Zuzentzailea kargatzen…',
  'ready': ' prest',
  'ready-nospell': ' prest (ortografia gabe)',
  processing: 'Aztertzen…',
  error: 'Errorea eredua kargatzean',
};

function updateStatus(status) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const btn = document.getElementById('btnAnalyze');

  // Handle loading:NN% format
  if (typeof status === 'string' && status.startsWith('loading:')) {
    const pct = status.split(':')[1];
    dot.className = 'status-dot status-dot--loading';
    text.textContent = `Kargatzen… ${pct}%`;
    btn.disabled = true;
    return;
  }

  dot.className = 'status-dot';
  if (status === 'loading' || status === 'loading-spell') {
    dot.classList.add('status-dot--loading');
  } else if (status === 'ready' || status === 'ready-nospell') {
    dot.classList.add('status-dot--ready');
  } else if (status === 'processing') {
    dot.classList.add('status-dot--processing');
  }

  text.textContent = STATUS_TEXT[status] || status;

  // Enable analyze button once ready (and not currently analyzing)
  if (!analyzing) {
    btn.disabled = !(status === 'ready' || status === 'ready-nospell');
  }
}

// ── Event wiring ────────────────────────────────────────────────────

function wireEvents() {
  // Panel toggles
  document.getElementById('btnToggleLeft').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('left-collapsed');
  });
  document.getElementById('btnToggleRight').addEventListener('click', () => {
    document.getElementById('app').classList.toggle('right-collapsed');
  });

  // Analyze button
  document.getElementById('btnAnalyze').addEventListener('click', onAnalyze);

  // New document (stays on current doc, new file appears at bottom)
  document.getElementById('btnNewDoc').addEventListener('click', () => {
    newDoc();
    focusEditor();
  });

  // Document title rename
  const titleInput = document.getElementById('docTitle');
  titleInput.addEventListener('input', () => {
    renameActive(titleInput.value);
  });

  // File import (hidden input)
  const fileInput = document.getElementById('fileInput');
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+O → trigger file import
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      fileInput.click();
    }
  });
  // Also allow import via the new-doc button area? Add a separate handler:
  // We'll add an import option accessible through a long-press or context.
  // For now, Ctrl+O opens the file picker.
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await importDoc(file);
    clearErrors();
    clearCards();
    focusEditor();
    fileInput.value = '';
  });

  // Language toggle
  document.querySelectorAll('#langToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#langToggle button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentLang = btn.dataset.lang;
      applyLanguage(currentLang);
    });
  });

  // About modal
  const aboutModal = document.getElementById('aboutModal');
  document.getElementById('btnAbout').addEventListener('click', () => {
    aboutModal.classList.add('open');
  });
  document.getElementById('btnCloseAbout').addEventListener('click', () => {
    aboutModal.classList.remove('open');
  });
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) aboutModal.classList.remove('open');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Enter → analyze
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onAnalyze();
    }
    // Escape → close modal
    if (e.key === 'Escape') {
      aboutModal.classList.remove('open');
    }
  });

  // Populate about modal body
  populateAbout();
}

// ── About modal content ─────────────────────────────────────────────

function populateAbout() {
  const body = document.getElementById('aboutBody');
  body.innerHTML = `
    <p><strong>Txukun</strong> euskarazko testu-zuzentzailea da. Maiuskulak, puntuazioa, ortografia eta gramatika zuzentzen ditu — dena nabigatzailean, pribatutasuna errespetatuz. Ez da testua zerbitzarira bidaltzen.</p>
    <p><strong>Hiru eredu neuronaletan</strong> oinarrituta:</p>
    <p>• <strong>Maiuskulak eta puntuazioa</strong> — MarianMT eredua (77 MB). Testuari maiuskulak eta puntuazioa berrezartzen dizkio.<br/>
    • <strong>Ortografia</strong> — Hunspell hiztegia + BERTeus eredua (85 MB). Akats ortografikoak detektatu eta iradokizun hobeak eskaintzen ditu.<br/>
    • <strong>Gramatika</strong> — GECToR-eus eredua (85 MB, Itzune-k trebatua). Adospena, kasua, denbora eta atzizkiak zuzentzen ditu.</p>
    <p>Analisia eskatu («Aztertu» botoia) eta zuzenketa bakoitza banan-bana onartu edo baztertu dezakezu, Grammarly bezala.</p>
    <p><strong>Lizentzia:</strong> Software librea. Ereduak: <code>itzune/berteus-onnx</code>, <code>itzune/gector-eus-onnx</code>, <code>itzune/txukun-cap-punct-eu</code> (HuggingFace).<br/>
    Iturria: <a href="https://github.com/itzune/txukun" target="_blank">github.com/itzune/txukun</a></p>
  `;
}

// ── Language switching (lightweight) ────────────────────────────────

function applyLanguage(lang) {
  // v1: minimal i18n — most UI text is Basque (the target language).
  // Full EN translation can be added later.
  if (lang === 'en') {
    document.documentElement.lang = 'en';
  } else {
    document.documentElement.lang = 'eu';
  }
}

// ── Boot ────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
