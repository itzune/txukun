/**
 * Txukun — Documents panel (left side)
 *
 * Renders the document list from the documents.js store and handles
 * new/switch/delete/import. Keeps the active doc in sync with the editor.
 */

import { listDocs, getActiveId, setActiveId, createDoc, updateDoc, deleteDoc, getDoc, ensureDoc } from './documents.js';

let listEl = null;
let onSwitch = () => {};
let onRename = () => {};

export function initDocPanel({ listRoot, onSwitchCb, onRenameCb }) {
  listEl = listRoot;
  onSwitch = onSwitchCb || (() => {});
  onRename = onRenameCb || (() => {});
  render();
}

export function render() {
  if (!listEl) return;
  const docs = listDocs();
  const activeId = getActiveId();
  listEl.innerHTML = '';

  if (docs.length === 0) {
    listEl.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--text-muted);">Ez dago dokumenturik</div>';
    return;
  }

  for (const doc of docs) {
    const item = document.createElement('div');
    item.className = 'doc-item' + (doc.id === activeId ? ' active' : '');
    item.dataset.docId = doc.id;
    item.innerHTML = `
      <span class="doc-item__icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </span>
      <span class="doc-item__name">${escapeHtml(doc.title || 'Dokumentu berria')}</span>
      <button class="doc-item__del" title="Ezabatu">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.doc-item__del')) return;
      if (doc.id === getActiveId()) return;
      setActiveId(doc.id);
      onSwitch(doc);
      render();
    });
    item.querySelector('.doc-item__del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`«${doc.title || 'Dokumentu berria'}» ezabatu?`)) return;
      const nextId = deleteDoc(doc.id);
      onSwitch(nextId ? getDoc(nextId) : ensureDoc());
      render();
    });
    listEl.appendChild(item);
  }
}

/** Create a new blank document without switching to it. */
export function newDoc() {
  const doc = createDoc('', '', { setActive: false });
  render();
  return doc;
}

/**
 * Import a .md/.txt file as a new document.
 * @param {File} file
 */
export async function importDoc(file) {
  const text = await file.text();
  const name = file.name.replace(/\.(md|txt)$/i, '');
  const doc = createDoc(name, text);
  onSwitch(doc);
  render();
  return doc;
}

export function renameActive(title) {
  const id = getActiveId();
  if (!id) return;
  updateDoc(id, { title });
  onRename(title);
  render();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
