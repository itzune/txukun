/**
 * Txukun — Document management (left panel)
 *
 * Multiple markdown documents persisted in localStorage. Each document:
 * { id, title, content, createdAt, updatedAt }
 *
 * The active document id is also stored so reloading the page restores it.
 */

const STORE_KEY = 'txukun.docs.v1';
const ACTIVE_KEY = 'txukun.activeDoc.v1';

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAll(docs) {
  localStorage.setItem(STORE_KEY, JSON.stringify(docs));
}

function uid() {
  return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function listDocs() {
  return loadAll().sort((a, b) => a.createdAt - b.createdAt);
}

export function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function getDoc(id) {
  return loadAll().find((d) => d.id === id) || null;
}

export function createDoc(title = '', content = '', { setActive = true } = {}) {
  const docs = loadAll();
  const now = Date.now();
  const doc = {
    id: uid(),
    title: title || titleFromH1(content) || 'Dokumentu berria',
    content,
    createdAt: now,
    updatedAt: now,
  };
  docs.push(doc);
  saveAll(docs);
  if (setActive) setActiveId(doc.id);
  return doc;
}

export function updateDoc(id, { title, content }) {
  const docs = loadAll();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return;
  if (title !== undefined) doc.title = title;
  if (content !== undefined) doc.content = content;
  doc.updatedAt = Date.now();
  saveAll(docs);
}

export function deleteDoc(id) {
  const docs = loadAll().filter((d) => d.id !== id);
  saveAll(docs);
  if (getActiveId() === id) {
    setActiveId(docs[0]?.id || null);
  }
  return docs[0]?.id || null;
}

/** Ensure there's at least one doc; create if none. Returns active doc. */
export function ensureDoc() {
  let docs = listDocs();
  if (docs.length === 0) {
    return createDoc('', '');
  }
  let activeId = getActiveId();
  let doc = docs.find((d) => d.id === activeId);
  if (!doc) {
    doc = docs[0];
    setActiveId(doc.id);
  }
  return doc;
}

/** Extract a title from the first H1 heading (# Title) in the content. */
export function titleFromH1(content) {
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) return '';
  const clean = match[1].replace(/[*_`#]/g, '').trim();
  return clean.slice(0, 50);
}
