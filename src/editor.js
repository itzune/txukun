/**
 * Txukun — Idaztian markdown editor + error decorations
 *
 * Wraps IdaztianEditor (CodeMirror 6 markdown, live preview) and adds a
 * custom StateField that renders error decorations (red/amber/blue wavy
 * underlines) in the document. Errors are managed via StateEffects so
 * positions are automatically remapped when the user edits the text.
 *
 * CM6 primitives are imported from `idaztian` (which re-exports them) to
 * guarantee a single module instance — the editor and our extensions
 * share the same StateField/StateEffect identity. The error field is
 * passed via `extraExtensions` so it is part of the initial editor state
 * (no fragile post-construction appendConfig).
 */

import { IdaztianEditor, StateField, StateEffect, EditorView, Decoration } from 'idaztian';
import 'idaztian/style.css';

// ── State effects (commands to the error field) ─────────────────────

const setErrorsEffect = StateEffect.define();          // { errors: Error[] }
const setErrorStatusEffect = StateEffect.define();     // { id, status }
const setActiveErrorEffect = StateEffect.define();     // { id | null }
const setVanishingEffect = StateEffect.define();       // { id | null }

// ── Error field ──────────────────────────────────────────────────────
//
// State value: { errors: Error[], activeId: string|null, vanishingId: string|null }
// Each Error: { id, from, to, original, suggestion, category, title, status }
// status: 'pending' | 'accepted' | 'dismissed'
// category: 'grammar' | 'spelling' | 'cappunct'

const errorField = StateField.define({
  create: () => ({ errors: [], activeId: null, vanishingId: null }),

  update(value, tr) {
    // Map error positions through document changes (typing, accepting fixes)
    let errors = value.errors;
    if (tr.docChanged) {
      errors = errors.map((e) => {
        const from = tr.changes.mapPos(e.from, 1);
        const to = tr.changes.mapPos(e.to, -1);
        if (from === e.from && to === e.to) return e;
        if (to < from) return { ...e, from, to: from };
        return { ...e, from, to };
      });
    }

    let activeId = value.activeId;
    let vanishingId = value.vanishingId;

    for (const eff of tr.effects) {
      if (eff.is(setErrorsEffect)) {
        errors = eff.value.errors;
        activeId = null;
        vanishingId = null;
      } else if (eff.is(setErrorStatusEffect)) {
        const { id, status } = eff.value;
        errors = errors.map((e) => (e.id === id ? { ...e, status } : e));
      } else if (eff.is(setActiveErrorEffect)) {
        activeId = eff.value.id;
      } else if (eff.is(setVanishingEffect)) {
        vanishingId = eff.value.id;
      }
    }

    return { errors, activeId, vanishingId };
  },

  provide: (f) =>
    EditorView.decorations.from(f, (val) => {
      const decos = [];
      for (const e of val.errors) {
        if (e.status !== 'pending') continue;
        if (e.to <= e.from) continue;
        let cls = `tx-error tx-error--${e.category}`;
        if (e.id === val.activeId) cls += ' tx-error--active';
        if (e.id === val.vanishingId) cls += ' tx-error--vanishing';
        decos.push(
          Decoration.mark({ class: cls, attributes: { 'data-error-id': e.id } }).range(e.from, e.to)
        );
      }
      return Decoration.set(decos, true);
    }),
});

// ── Click handler (separate extension) ───────────────────────────────

function clickHandler(onClick) {
  return EditorView.domEventHandlers({
    click: (event) => {
      const el = event.target?.closest?.('.tx-error');
      if (el?.dataset?.errorId) {
        onClick?.(el.dataset.errorId);
        return true;
      }
      return false;
    },
  });
}

// ── Public API ───────────────────────────────────────────────────────

let editor = null;
let errorClickCb = null;
let suppressClear = false;  // true while applying an accept/dismiss fix

/**
 * Initialize the Idaztian editor with the error-decoration field injected
 * via `extraExtensions` (part of the initial editor state).
 */
export async function initEditor({ parent, initialContent = '', onChange, onErrorClick, onStats }) {
  errorClickCb = onErrorClick || null;

  editor = new IdaztianEditor({
    parent,
    initialContent,
    theme: 'dark',
    toolbar: false,
    placeholder: 'Idatzi edo itsatsi euskarazko testua hemen…',
    extraExtensions: [errorField, clickHandler((id) => errorClickCb?.(id))],
    onChange: (content) => {
      onChange?.(content, suppressClear);
      onStats?.(countStats(content));
    },
  });

  return editor;
}

function countStats(content) {
  const text = content.trim();
  const words = text ? text.split(/\s+/).length : 0;
  return { words, chars: content.length };
}

export function getContent() {
  return editor ? editor.getContent() : '';
}

export function setContent(text) {
  if (!editor) return;
  editor.setContent(text);
}

export function focusEditor() {
  editor?.focus();
}

export function getStats() {
  return countStats(getContent());
}

// ── Error management ─────────────────────────────────────────────────

function view() {
  return editor?.view ?? null;
}

/** Replace the full error list (re-renders all decorations). */
export function setErrors(errors) {
  const v = view();
  if (!v) return;
  v.dispatch({ effects: setErrorsEffect.of({ errors }) });
}

/** Clear all errors. */
export function clearErrors() {
  const v = view();
  if (!v) return;
  v.dispatch({ effects: setErrorsEffect.of({ errors: [] }) });
}

/** Get current pending errors (for the suggestions panel). */
export function getErrors() {
  const v = view();
  if (!v) return [];
  return v.state.field(errorField).errors;
}

/**
 * Accept a suggestion: replace the text range with the suggestion and
 * mark the error accepted. The text change auto-remaps other errors.
 */
export function acceptError(id) {
  const v = view();
  if (!v) return;
  const { errors } = v.state.field(errorField);
  const e = errors.find((x) => x.id === id);
  if (!e || e.status !== 'pending') return;

  suppressClear = true;
  v.dispatch({
    changes: { from: e.from, to: e.to, insert: e.suggestion },
    effects: [
      setErrorStatusEffect.of({ id, status: 'accepted' }),
      setActiveErrorEffect.of({ id: null }),
    ],
  });
  setTimeout(() => { suppressClear = false; }, 50);
}

/**
 * Dismiss a suggestion: fade the underline then remove. No text change.
 */
export function dismissError(id) {
  const v = view();
  if (!v) return;
  suppressClear = true;
  v.dispatch({ effects: setVanishingEffect.of({ id }) });
  setTimeout(() => {
    const v2 = view();
    if (!v2) return;
    v2.dispatch({
      effects: [
        setVanishingEffect.of({ id: null }),
        setErrorStatusEffect.of({ id, status: 'dismissed' }),
        setActiveErrorEffect.of({ id: null }),
      ],
    });
    suppressClear = false;
  }, 380);
}

/** Highlight an error as active (clicked from the card or elsewhere). */
export function setActiveError(id) {
  const v = view();
  if (!v) return;
  v.dispatch({ effects: setActiveErrorEffect.of({ id }) });
}

/** Scroll the editor to show a given error's position. */
export function scrollToError(id) {
  const v = view();
  if (!v) return;
  const { errors } = v.state.field(errorField);
  const e = errors.find((x) => x.id === id);
  if (!e) return;
  v.dispatch({
    effects: EditorView.scrollIntoView(e.from, { y: 'center', yMargin: 80 }),
    selection: { anchor: e.from },
  });
  v.focus();
}
