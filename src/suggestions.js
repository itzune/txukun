/**
 * Txukun — Suggestions panel (right side)
 *
 * Renders error cards grouped by error-type tabs. Each card shows the
 * original (strikethrough) → suggestion (green) diff, with Accept and
 * Dismiss buttons. Accepting applies the fix in the editor (via the
 * editor module) and the card slides out with a vanishing animation.
 *
 * Tabs correspond to the GECToR v2-mt type head's 8 non-`none` labels.
 * The `category` field on each error holds one of these type strings.
 */

import { acceptError, dismissError, setActiveError, scrollToError } from './editor.js';

// ── Error types (GECToR v2-mt type head) ────────────
//
// Order = tab order in the panel (most frequent first).
// label  = tab text + card subtitle.
// icon   = inline SVG (11×11).
// color  = CSS color family (matches .card--<type> and .tx-error--<type>).
export const TYPE_TABS = [
  {
    type: 'morphology',
    label: 'Gramatika',
    color: 'red',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16M4 12h16M4 20h10"/></svg>',
  },
  {
    type: 'word_level',
    label: 'Lexikoa',
    color: 'red',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg>',
  },
  {
    type: 'zalantza',
    label: 'Zalantzak',
    color: 'amber',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  },
  {
    type: 'calque',
    label: 'Kalkoak',
    color: 'purple',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>',
  },
  {
    type: 'spelling',
    label: 'Ortografia',
    color: 'amber',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  },
  {
    type: 'punctuation',
    label: 'Puntuazioa',
    color: 'blue',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
  },
  {
    type: 'capitalization',
    label: 'Maiuskulak',
    color: 'blue',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  },
  {
    type: 'proper_noun',
    label: 'Izen bereziak',
    color: 'blue',
    icon: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  },
];

const TYPE_MAP = Object.fromEntries(TYPE_TABS.map((t) => [t.type, t]));

const DEFAULT_ICON =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16M4 12h16M4 20h10"/></svg>';

let activeFilter = 'all';
let panelEl = null;
let listEl = null;
let emptyEl = null;
let countEl = null;

export function initSuggestions({ panelRoot }) {
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

  // Count pending errors per type (dynamic — supports all 8 types).
  const counts = { all: 0 };
  for (const t of TYPE_TABS) counts[t.type] = 0;
  for (const e of errors) {
    if (e.status !== 'pending') continue;
    counts.all++;
    if (counts[e.category] !== undefined) counts[e.category]++;
    else counts[e.category] = (counts[e.category] || 0) + 1;
  }

  // Update tab badges
  const allCats = ['all', ...TYPE_TABS.map((t) => t.type)];
  for (const cat of allCats) {
    const badge = panelEl.querySelector(`#badge-${cat}`);
    if (badge) {
      badge.textContent = counts[cat] || 0;
      badge.style.display = counts[cat] > 0 ? '' : 'none';
    }
  }

  countEl.textContent = counts.all > 0 ? `${counts.all} akats` : '';

  // Filter
  const visible = errors.filter(
    (e) => e.status === 'pending' && (activeFilter === 'all' || e.category === activeFilter),
  );

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

  const context = err.context || '';
  const typeInfo = TYPE_MAP[err.category];
  const icon = typeInfo ? typeInfo.icon : DEFAULT_ICON;
  const label = typeInfo ? typeInfo.label : err.category;

  card.innerHTML = `
    <div class="card__head">
      <span class="card__icon">${icon}</span>
      <div class="card__meta">
        <div class="card__title">${escapeHtml(err.title)}</div>
        <div class="card__cat">${escapeHtml(label)}</div>
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
    listEl
      .querySelectorAll('.card')
      .forEach((c) => c.classList.toggle('active', c.dataset.errorId === err.id));
    setActiveError(err.id);
    scrollToError(err.id);
  });

  // Accept
  card.querySelector('[data-act="accept"]').addEventListener('click', (ev) => {
    ev.stopPropagation();
    acceptError(err.id);
    card.classList.add('card--vanishing');
    setTimeout(() => {
      card.remove();
      currentErrors = currentErrors.map((e) => (e.id === err.id ? { ...e, status: 'accepted' } : e));
      if (activeCardId === err.id) activeCardId = null;
      refreshBadges();
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
      currentErrors = currentErrors.map((e) => (e.id === err.id ? { ...e, status: 'dismissed' } : e));
      if (activeCardId === err.id) activeCardId = null;
      refreshBadges();
      if (listEl.querySelectorAll('.card').length === 0) renderCards(currentErrors);
    }, 320);
  });

  return card;
}

function refreshBadges() {
  const counts = { all: 0 };
  for (const t of TYPE_TABS) counts[t.type] = 0;
  for (const e of currentErrors) {
    if (e.status !== 'pending') continue;
    counts.all++;
    counts[e.category] = (counts[e.category] || 0) + 1;
  }
  const allCats = ['all', ...TYPE_TABS.map((t) => t.type)];
  for (const cat of allCats) {
    const badge = panelEl.querySelector(`#badge-${cat}`);
    if (badge) {
      badge.textContent = counts[cat] || 0;
      badge.style.display = counts[cat] > 0 ? '' : 'none';
    }
  }
  countEl.textContent = counts.all > 0 ? `${counts.all} akats` : '';
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
  const allCats = ['all', ...TYPE_TABS.map((t) => t.type)];
  for (const cat of allCats) {
    const badge = panelEl.querySelector(`#badge-${cat}`);
    if (badge) badge.style.display = 'none';
  }
}
