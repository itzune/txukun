# Txukun — Euskarazko idazketa-zuzentzailea

> Basque writing assistant — grammar, spelling, punctuation, capitalization,
> calques, and doubtful words, all in one model

[![Deploy](https://github.com/itzune/txukun/actions/workflows/deploy.yml/badge.svg)](https://github.com/itzune/txukun/actions/workflows/deploy.yml)
[![License: CC-BY-SA 4.0](https://img.shields.io/badge/License-CC--BY--SA_4.0-blue.svg)](LICENSE)

**Txukun** is a browser-based writing assistant for Basque. It detects and
corrects grammar, spelling, punctuation, capitalization, word-choice, calque,
and doubtful-word errors — all from a single neural model that runs privately
in your browser. No text ever leaves your device.

The model is **GECToR v2-mt** (multi-task), a RoBERTa-eus encoder with three
output heads trained on the [horkonpon-corpus](https://github.com/itzune/horkonpon-corpus)
(199K error–correction pairs). It tags every corrected word with its error
category, so suggestions are grouped and labelled by type — not lumped into a
generic "grammar" bucket.

- **Single model** — one 87 MB int4 ONNX model replaces the old 3-model +
  rule-engine pipeline (GECToR v1 + MarianMT + Hunspell/BERTeus + 2,400 lines
  of rules)
- **8 error types** — morphology, word-level, spelling, punctuation,
  capitalization, zalantza (doubtful words), calque, proper nouns
- **Private** — all inference runs in-browser via ONNX Runtime (WASM); your
  text never leaves your device
- **Free & open-source** — CC-BY-SA 4.0

## Website

[https://itzune.eus/txukun/](https://itzune.eus/txukun/)

## How it works

1. Type or paste Basque text in the editor
2. Click **Aztertu** (Analyze)
3. The model runs up to 5 iteration passes (GECToR-style iterative refinement)
4. Each correction appears as a card in the right panel, grouped by error type
5. Accept or dismiss each suggestion individually — no auto-apply

### Error types

| Type | Basque label | Colour | What it catches |
|------|-------------|--------|-----------------|
| `morphology` | Gramatika | red | Verb agreement, case, tense, suffix errors |
| `word_level` | Lexikoa | red | Wrong word choice (non-calque) |
| `zalantza` | Zalantzak | amber | Doubtful words (e.g. `abots→ahots`) |
| `calque` | Kalkoak | purple | Syntactic calques (e.g. `balore→balio`) |
| `spelling` | Ortografia | amber | Spelling mistakes |
| `punctuation` | Puntuazioa | blue | Missing/wrong commas, periods, etc. |
| `capitalization` | Maiuskulak | blue | Missing/wrong capital letters |
| `proper_noun` | Izen bereziak | blue | Proper-noun spelling/capitalization |

## Model

| | |
|---|---|
| **Model** | [itzune/gector-eus-v2-onnx](https://huggingface.co/itzune/gector-eus-v2-onnx) |
| **Architecture** | GECToR v2-mt (RoBERTa-eus encoder + 3 heads) |
| **Size** | ~87 MB (int4 ONNX) |
| **Training data** | [horkonpon-corpus](https://github.com/itzune/horkonpon-corpus) — 199K pairs |
| **License** | CC-BY-SA 4.0 |
| **Three heads** | Edit labels ($KEEP / $DELETE / $REPLACE / $APPEND / $TRANSFORM), Detection ($CORRECT / $INCORRECT), Error type (9 labels incl. `none`) |

The model is lazy-loaded on first use and cached in the browser (Cache API)
for instant subsequent loads.

### Performance (1,037-record eval)

| Metric | GECToR v2-mt |
|--------|-------------|
| F0.5 | 77.6 |
| Exact match | 51.3% |
| Precision | 87.6% |
| Recall | 53.3% |
| Clean FP | 1.8% |
| Type accuracy (errors) | 75.8% |

See the [model card](https://huggingface.co/itzune/gector-eus-v2-onnx) for
full per-category results and the [training repo](https://github.com/itzune/gector-eus-v2)
for training code.

## Architecture

```
src/
├── gector.js      — ONNX model loading, 3-head inference, iterative correction
├── analyze.js     — markdown stripping, diff-based error extraction, type mapping
├── models.js      — thin status wrapper (load state for the UI)
├── suggestions.js — right-panel cards, 8 type-based tabs, accept/dismiss
├── editor.js      — Idaztian (CodeMirror 6) + error decorations
├── main.js        — entry point, event wiring, status display
├── cache.js       — Cache API wrapper for model blobs
├── core/diff.js   — word-level LCS diff with char offsets
├── documents.js   — local document storage (IndexedDB)
├── doc-panel.js   — left-panel document list
└── ui-toast.js    — toast notifications
```

**Total: ~2,400 lines** (down from ~6,000+ in the old 3-model + rule-engine
architecture).

## Development

```bash
npm install
npm run dev      # Vite dev server on :3000
npm run build    # Production build → dist/
npm run preview  # Preview the production build
npm run deploy   # Build + deploy to GitHub Pages
```

### Dependencies

- [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) — tokenizer
- [`onnxruntime-web`](https://github.com/microsoft/onnxruntime) — ONNX inference (WASM)
- [`idaztian`](https://github.com/itzune/idaztian) — markdown editor (CodeMirror 6)

## Related projects

- [horkonpon-corpus](https://github.com/itzune/horkonpon-corpus) — training data (199K pairs)
- [gector-eus-v2](https://github.com/itzune/gector-eus-v2) — training code + PyTorch model
- [gemma-4-E4B-horkonpon](https://github.com/itzune/gemma-4-E4B-horkonpon) — server-side LLM model (F0.5=80.8)
- [Euskaltzaindia](https://www.euskaltzaindia.eus/) — normative authority

## License

CC-BY-SA 4.0 — see [LICENSE](LICENSE).
