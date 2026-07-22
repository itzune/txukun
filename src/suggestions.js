/**
 * Txukun — Suggestions panel (right side)
 *
 * Renders error cards grouped by category tabs. Each card shows the
 * original (strikethrough) → suggestion (green) diff, with Accept and
 * Dismiss buttons. Accepting applies the fix in the editor (via the
 * editor module) and the card slides out with a vanishing animation.
 */

import { acceptError, dismissError, setActiveError, scrollToError } from './editor.js';
import { t } from './i18n.js';

// category → icon (inline SVG)
const ICONS = {
  grammar: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16M4 12h16M4 20h10"/></svg>',
  spelling: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  cappunct: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
};

let activeFilter = 'all';
let panelEl = null;
let listEl = null;
let emptyEl = null;
let countEl = null;

export function initSuggestions({
  panelRoot,
  onCountChange,
}) {
  panelEl = panelRoot;
  listEl = panelEl.querySelector('#suggestions');
  emptyEl = panelEl.querySelector('#suggEmpty');
  countEl = panelEl.querySelector('#suggCount');

  // Tab switching
  const tabs = panelEl.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.cat;
      renderCards(currentErrors);
    });
  });
}

let currentErrors = [];
let activeCardId = null;

/**
 * Render the suggestions list from the current error set.
 * @param {Array} errors — full error list (all statuses)
 */
export function renderCards(errors) {
  currentErrors = errors;

  // Count pending errors per category for tab badges
  const counts = { all: 0, grammar: 0, spelling: 0, cappunct: 0 };
  for (const e of errors) {
    if (e.status !== 'pending') continue;
    counts.all++;
    counts[e.category] = (counts[e.category] || 0) + 1;
  }
  for (const cat of Object.keys(counts)) {
    const badge = panelEl.querySelector(`#badge-${cat}`);
    if (badge) {
      badge.textContent = counts[cat];
      badge.style.display = counts[cat] > 0 ? '' : 'none';
    }
  }

  // Filter
  const visible = errors.filter(
    (e) => e.status === 'pending' && (activeFilter === 'all' || e.category === activeFilter)
  );

  countEl.textContent = counts.all > 0 ? `${counts.all} akats` : '';

  // Clear list (except empty placeholder)
  const cards = listEl.querySelectorAll('.card');
  cards.forEach((c) => c.remove());

  if (visible.length === 0) {
    emptyEl.style.display = '';
    if (counts.all === 0) {
      emptyEl.querySelector('.suggestions-empty__title').textContent = 'Ez iradokizunik';
      emptyEl.querySelector('.suggestions-empty__desc').textContent =
        'Idatzi testua eta sakatu «Aztertu» akatsak bilatzeko.';
    } else {
      emptyEl.querySelector('.suggestions-empty__title').textContent = 'Kategoria hutsik';
      emptyEl.querySelector('.suggestions-empty__desc').textContent =
        ' Beste kategoria batean daude iradokizunak.';
    }
    return;
  }
  emptyEl.style.display = 'none';

  for (const err of visible) {
    listEl.appendChild(buildCard(err));
  }

  // Auto-activate the first card: highlight its error in the editor
  if (visible.length > 0) {
    activeCardId = visible[0].id;
    const firstCard = listEl.querySelector('.card');
    if (firstCard) firstCard.classList.add('active');
    setActiveError(visible[0].id);
  }
}

function buildCard(err) {
  const card = document.createElement('div');
  card.className = `card card--${err.category}`;
  card.dataset.errorId = err.id;
  if (err.id === activeCardId) card.classList.add('active');

  // Build context snippet (truncate to ±20 chars around the error)
  const context = err.context || '';

  card.innerHTML = `
    <div class="card__head">
      <span class="card__icon">${ICONS[err.category] || ICONS.grammar}</span>
      <div class="card__meta">
        <div class="card__title">${escapeHtml(err.title)}</div>
        <div class="card__cat">${escapeHtml(categoryLabel(err.category))}</div>
      </div>
      <span class="card__chevron">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
    <div class="card__body">
      <div class="card__inner">
        <div class="card__diff">
          ${context ? `<span class="diff__context">${escapeHtml(context)}</span>` : ''}
          <span class="diff__old">${escapeHtml(err.original)}</span>
          <span class="diff__arrow">→</span>
          <span class="diff__new">${escapeHtml(err.suggestion)}</span>
        </div>
        <div class="card__actions">
          <button class="card__accept" data-act="accept">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Onartu
          </button>
          <button class="card__dismiss" data-act="dismiss">Baztertu</button>
        </div>
      </div>
    </div>
  `;

  // Head click → expand + scroll editor to the error + highlight
  card.querySelector('.card__head').addEventListener('click', () => {
    activeCardId = err.id;
    // update active states
    listEl.querySelectorAll('.card').forEach((c) => c.classList.toggle('active', c.dataset.errorId === err.id));
    setActiveError(err.id);
    scrollToError(err.id);
  });

  // Accept
  card.querySelector('[data-act="accept"]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    // Phase 1: mark vanishing in editor (underline fades)
    acceptError(err.id);
    // Phase 2: card slides out
    card.classList.add('card--vanishing');
    setTimeout(() => {
      card.remove();
      currentErrors = currentErrors.map((e) =>
        e.id === err.id ? { ...e, status: 'accepted' } : e
      );
      // If the active card was this one, clear active
      if (activeCardId === err.id) activeCardId = null;
      refreshBadges();
      // If list now empty, show empty state
      if (listEl.querySelectorAll('.card').length === 0) renderCards(currentErrors);
    }, 320);
  });

  // Dismiss
  card.querySelector('[data-act="dismiss"]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    dismissError(err.id);
    card.classList.add('card--vanishing');
    setTimeout(() => {
      card.remove();
      currentErrors = currentErrors.map((e) =>
        e.id === err.id ? { ...e, status: 'dismissed' } : e
      );
      if (activeCardId === err.id) activeCardId = null;
      refreshBadges();
      if (listEl.querySelectorAll('.card').length === 0) renderCards(currentErrors);
    }, 320);
  });

  return card;
}

function refreshBadges() {
  const counts = { all: 0, grammar: 0, spelling: 0, cappunct: 0 };
  for (const e of currentErrors) {
    if (e.status !== 'pending') continue;
    counts.all++;
    counts[e.category] = (counts[e.category] || 0) + 1;
  }
  for (const cat of Object.keys(counts)) {
    const badge = panelEl.querySelector(`#badge-${cat}`);
    if (badge) {
      badge.textContent = counts[cat];
      badge.style.display = counts[cat] > 0 ? '' : 'none';
    }
  }
  countEl.textContent = counts.all > 0 ? `${counts.all} akats` : '';
}

function categoryLabel(cat) {
  return { grammar: 'Gramatika', spelling: 'Ortografia', cappunct: 'Maiuskulak · Puntuazioa' }[cat] || cat;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/** Clear all cards (used when text changes / re-analyze). */
export function clearCards() {
  currentErrors = [];
  activeCardId = null;
  const cards = listEl.querySelectorAll('.card');
  cards.forEach((c) => c.remove());
  if (emptyEl) {
    emptyEl.style.display = '';
    emptyEl.querySelector('.suggestions-empty__title').textContent = 'Ez iradokizunik';
    emptyEl.querySelector('.suggestions-empty__desc').textContent =
      'Idatzi testua eta sakatu «Aztertu» akatsak bilatzeko.';
  }
  if (countEl) countEl.textContent = '';
  for (const cat of ['all', 'grammar', 'spelling', 'cappunct']) {
    const badge = panelEl.querySelector(`#badge-${cat}`);
    if (badge) badge.style.display = 'none';
  }
}
