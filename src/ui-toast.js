/**
 * Txukun — Toast notification
 *
 * Lightweight toast system for user feedback.
 */

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration - ms before auto-dismiss
 */
export function toast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'toast';

  // Add type-specific styling
  const colors = {
    success: { border: 'rgba(52, 211, 153, 0.3)', bg: 'rgba(52, 211, 153, 0.06)', dot: '#34d399' },
    error:   { border: 'rgba(232, 72, 50, 0.3)', bg: 'rgba(232, 72, 50, 0.06)', dot: '#e84832' },
    warning: { border: 'rgba(245, 160, 32, 0.3)', bg: 'rgba(245, 160, 32, 0.06)', dot: '#f5a020' },
    info:    { border: 'rgba(75, 184, 232, 0.3)', bg: 'rgba(75, 184, 232, 0.06)', dot: '#4bb8e8' },
  };

  const c = colors[type] || colors.info;
  el.style.borderColor = c.border;
  el.style.background = c.bg;

  // Add colored dot + message
  el.innerHTML = `
    <span style="display:flex;align-items:center;gap:10px;">
      <span style="width:6px;height:6px;border-radius:50%;background:${c.dot};flex-shrink:0;"></span>
      <span>${escapeHtml(message)}</span>
    </span>
  `;

  container.appendChild(el);

  // Auto dismiss
  const dismiss = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  };

  setTimeout(dismiss, duration);

  // Allow click to dismiss early
  el.addEventListener('click', () => {
    dismiss();
  });

  return el;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
