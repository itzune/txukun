/**
 * Txukun — UI Bindings
 *
 * DOM element references and event binding helpers.
 */

// ── Element References ──────────────────────────────

function el(id) {
  return document.getElementById(id);
}

// ── Model Status ────────────────────────────────────

export function setModelStatus(status) {
  const dot = el('statusDot');
  const text = el('statusText');
  if (!dot || !text) return;

  // Remove all status classes
  dot.className = 'status-dot';

  switch (status) {
    case 'idle':
      dot.classList.add('status-dot--inactive');
      text.textContent = 'Eredua kargatu gabe';
      break;
    case 'loading':
      dot.classList.add('status-dot--loading');
      text.textContent = 'Eredua kargatzen...';
      break;
    case 'ready':
      dot.classList.add('status-dot--ready');
      text.textContent = 'Eredua prest';
      break;
    case 'processing':
      dot.classList.add('status-dot--loading');
      text.textContent = 'Prozesatzen...';
      break;
    case 'error':
      dot.classList.add('status-dot--error');
      text.textContent = 'Errorea kargatzean';
      break;
  }
}

// ── Progress ────────────────────────────────────────

export function setProgress(pct) {
  const wrapper = el('progressWrapper');
  const fill = el('progressFill');
  const text = el('progressText');

  if (!wrapper || !fill || !text) return;

  if (pct <= 0) {
    wrapper.style.display = 'none';
    return;
  }

  wrapper.style.display = 'flex';
  fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  text.textContent = Math.round(pct) + '%';

  if (pct >= 100) {
    setTimeout(() => {
      wrapper.style.display = 'none';
    }, 1500);
  }
}

// ── Correct Button ──────────────────────────────────

export function setCorrectButtonEnabled(enabled) {
  const btn = el('btnCorrect');
  if (btn) btn.disabled = !enabled;
}

export function getInputText() {
  const input = el('inputText');
  return input ? input.value : '';
}

export function setOutputText(text) {
  const output = el('outputText');
  if (output) {
    output.value = text;
    // Update char count
    const countEl = el('outputCharCount');
    if (countEl) countEl.textContent = text.length;
  }
}

export function getOutputText() {
  const output = el('outputText');
  return output ? output.value : '';
}

// ── Copy / Download Buttons ─────────────────────────

export function updateCopyDownloadButtons(hasContent) {
  const copyBtn = el('btnCopy');
  const downloadBtn = el('btnDownload');
  if (copyBtn) copyBtn.disabled = !hasContent;
  if (downloadBtn) downloadBtn.disabled = !hasContent;
}

export function bindCopyButton() {
  const btn = el('btnCopy');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const text = getOutputText();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      showToast('Testua arbelean kopiatu da!');
    } catch {
      // Fallback for older browsers
      const output = el('outputText');
      if (output) {
        output.select();
        document.execCommand('copy');
        showToast('Testua arbelean kopiatu da!');
      }
    }
  });
}

export function bindDownloadButton() {
  const btn = el('btnDownload');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const text = getOutputText();
    if (!text) return;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'txukun-testua.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Fitxategia deskargatu da!');
  });
}

export function bindClearButton() {
  const btn = el('btnClear');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const input = el('inputText');
    const output = el('outputText');
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (output) {
      output.value = '';
    }
    updateCopyDownloadButtons(false);
    el('inputCharCount').textContent = '0';
    el('outputCharCount').textContent = '0';
  });
}

export function bindCorrectButton(callback) {
  const btn = el('btnCorrect');
  if (!btn) return;

  btn.addEventListener('click', callback);
}

// ── Toast ───────────────────────────────────────────

export function showToast(message, duration = 2500) {
  const container = el('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
