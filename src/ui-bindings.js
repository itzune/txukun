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
    case 'loading-spell':
      dot.classList.add('status-dot--loading');
      text.textContent = 'Hiztegia kargatzen...';
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

// ── Spell Status Indicator ──────────────────────────

export function setSpellStatus(loaded, extra) {
  const status = document.getElementById('spellStatus');
  if (!status) return;
  status.style.display = 'inline';
  if (loaded) {
    const count = typeof extra === 'number' ? extra : 0;
    status.textContent = count > 0 ? `🔍 ${count} hitz` : '✅ zuzen';
    status.style.color = count > 0 ? 'var(--color-itzune-orange)' : 'var(--color-itzune-green)';
  } else {
    const msg = typeof extra === 'string' ? ': ' + extra : '';
    status.textContent = '❌ hiztegirik gabe' + msg;
    status.style.color = 'var(--color-itzune-red)';
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

  // Hide spell-annotated overlay if visible
  const overlay = el('outputSpellOverlay');
  if (overlay) overlay.style.display = 'none';
}

/**
 * Show the output with spell-check annotations.
 * Renders an HTML overlay on top of the textarea.
 *
 * @param {string} annotatedHtml - HTML with <span class="spell-error"> tags
 * @param {string} plainText - the plain text version for the textarea (still used for copy/download)
 */
export function setOutputTextAnnotated(annotatedHtml, plainText) {
  // Set the textarea value to plain text (for copy/download/size)
  const output = el('outputText');
  if (output) {
    output.value = plainText;
    const countEl = el('outputCharCount');
    if (countEl) countEl.textContent = plainText.length;
  }

  // Show the spell-annotated overlay
  const overlay = el('outputSpellOverlay');
  if (overlay) {
    const content = el('outputSpellContent');
    if (content) {
      content.innerHTML = annotatedHtml;
      // Bind click handlers for spell suggestions
      bindSpellSuggestionClicks(content);
    }
    overlay.style.display = 'block';
  }
}

export function getOutputText() {
  const output = el('outputText');
  return output ? output.value : '';
}

/**
 * Show the input textarea with spell-check annotations.
 * Renders an HTML overlay on top of the input textarea.
 */
export function setInputTextAnnotated(annotatedHtml, plainText) {
  const overlay = el('inputSpellOverlay');
  if (overlay) {
    const content = el('inputSpellContent');
    if (content) {
      content.innerHTML = annotatedHtml;
      bindSpellSuggestionClicks(content);
    }
    overlay.style.display = 'block';
  }
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

// ── Spell Check Popover ─────────────────────────────

let activePopover = null;

function hidePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

/**
 * Bind click handlers on spell-error spans to show suggestion popovers.
 */
export function bindSpellSuggestionClicks(container) {
  container.querySelectorAll('.spell-error').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();

      // Hide any existing popover
      hidePopover();

      const suggestions = (span.dataset.suggestions || '').split(',').filter(Boolean);
      if (suggestions.length === 0) return;

      const word = span.dataset.word || '';

      // Build popover
      const popover = document.createElement('div');
      popover.className = 'spell-popover';
      popover.innerHTML = `
        <div class="spell-popover__header">
          <span class="spell-popover__word">${escapeHtml(word)}</span>
        </div>
        <div class="spell-popover__suggestions">
          ${suggestions.map(s => `<button class="spell-popover__suggestion" data-replace="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join('')}
        </div>
      `;

      // Position relative to viewport (popover is a child of document.body)
      const rect = span.getBoundingClientRect();

      popover.style.position = 'fixed';
      popover.style.left = rect.left + 'px';
      popover.style.top = (rect.bottom + 4) + 'px';

      // Apply replacement on click
      popover.querySelectorAll('.spell-popover__suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
          const replacement = btn.dataset.replace;
          span.textContent = replacement;
          span.classList.remove('spell-error');
          span.classList.add('spell-fixed');
          span.title = `"${word}" → "${replacement}"`;
          hidePopover();

          // Determine which panel: output or input
          const isInputOverlay = span.closest('#inputSpellOverlay');
          const overlayContent = isInputOverlay
            ? el('inputSpellContent')
            : el('outputSpellContent');
          const textarea = isInputOverlay
            ? el('inputText')
            : el('outputText');

          // Update the plain textarea
          if (overlayContent && textarea) {
            textarea.value = overlayContent.textContent || '';
          }

          // If it was the input panel, re-run correction
          if (isInputOverlay) {
            hideInputSpellOverlay();
            // Trigger re-correction via a custom event
            const event = new CustomEvent('txukun:recorrect');
            document.dispatchEvent(event);
          }
        });
      });

      document.body.appendChild(popover);
      activePopover = popover;

      // Check if popover overflows viewport — reposition above
      const popRect = popover.getBoundingClientRect();
      if (popRect.bottom > window.innerHeight - 10) {
        popover.style.top = (rect.top - popRect.height - 4) + 'px';
      }
      if (popRect.right > window.innerWidth - 10) {
        popover.style.left = (window.innerWidth - popRect.width - 10) + 'px';
      }
    });
  });
}

// Global click handler to hide popover
document.addEventListener('click', hidePopover);

// ── Helpers ─────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function hideInputSpellOverlay() {
  const overlay = el('inputSpellOverlay');
  if (overlay) overlay.style.display = 'none';
}
