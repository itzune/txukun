# AGENTS.md

Instructions for AI agents working on the Txukun project.

---

## Project Overview

Txukun is a browser-based writing assistant for Basque. It checks grammar, spelling, capitalization, and punctuation — a Grammarly-for-Euskara, with everything running privately in the browser. It combines three neural models (GECToR grammar, BERTeus spelling re-ranking, MarianMT cap-punct) with a deterministic rule engine grounded in Euskaltzaindia's EBE reference.

It works on any Basque text, and is also well-suited to cleaning up ASR (speech-to-text) output — but ASR is one use case among many, not the tool's whole scope.

It's part of the [Itzune](https://itzune.eus) ecosystem of Basque language AI tools.

### Product vs. models — important distinction

**This repo is the *product*** — a generic Basque writing assistant: grammar, spelling, capitalization, punctuation, and AI-powered suggestions. The product is bigger than any single model. It orchestrates three neural models, a deterministic rule engine (EBE-grounded), a 160k-word dictionary, and the UI into one pipeline. Its capabilities are not bounded by any one model's training data or scope.

**The models on HuggingFace are *components*** — each is a standalone trained model with its own origin, scope, and limitations. The product loads them lazily as needed. For example, the cap-punct model was trained on ASR-style lowercase text, but the product accepts normally-capitalized text too (GECToR and the rule engine handle those cases the cap-punct model wasn't trained on).

- **Product (this repo)**: https://github.com/itzune/txukun · https://itzune.eus/txukun/
- **Models (HuggingFace components)**:
  - [`itzune/txukun-cap-punct-eu`](https://huggingface.co/itzune/txukun-cap-punct-eu) — capitalization & punctuation (fine-tune of [`HiTZ/cap-punct-eu`](https://huggingface.co/HiTZ/cap-punct-eu))
  - [`itzune/berteus-onnx`](https://huggingface.co/itzune/berteus-onnx) — spell-check re-ranking (ONNX int4 of [BERTeus](https://huggingface.co/ixa-ehu/berteus-base-cased))
  - [`itzune/gector-eus-onnx`](https://huggingface.co/itzune/gector-eus-onnx) — grammar correction (GECToR on RoBERTa-eus)

## Tech Stack

- **Build**: Vite 5
- **Runtime**: Vanilla JavaScript (no framework)
- **Inference**: Transformers.js (@huggingface/transformers) + ONNX Runtime Web WASM
- **Models (3)**: MarianMT cap-punct (q8, ~77MB), BERTeus re-ranker (int4, 85MB), GECToR grammar (int4, ~85MB) — all loaded from HuggingFace Hub, lazy-loaded
- **Rule engine**: Deterministic, EBE-grounded (Euskaltzaindia's *Euskararen Aholkularia*) — runs with or without the neural models ("Txukun Lite" mode)
- **Deploy**: GitHub Pages at `/txukun/` sub-path (base URL matters)
- **Design**: Itzune design system (dark theme, cosmic-void gradient, JetBrains Mono, sky `#4bb8e8` accents)

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Single-page app (all HTML + inline CSS) |
| `src/main.js` | Entry point: model loading, correction logic, i18n, keyboard shortcuts |
| `src/models.js` | MarianMT pipeline + P1 rule engine integration (cap-punct correction) |
| `src/core/types.js` | Lint + Suggestion + LintKind data model (Harper-inspired) |
| `src/core/document.js` | Tokenizer + Document (span-based token model, iterSentences) |
| `src/core/engine.js` | Rule engine: runRules() with iterative apply |
| `src/core/diff.js` | Pure word-level LCS diff (`diffWords`, `isCasePunctOnly`) — shared by analyze.js + tests |
| `src/core/rules/` | EBE-grounded rules: sentence-boundary, sentence-initial-cap, terminal-punct, vocative-comma, zalantza-words, zalantza-phrases, calque, zalantza-proper (+ shared `greetings.js` data) |
| `src/core/clean-output.js` | Pure model output cleaning (shared by production + eval) |
| `src/i18n.js` | Basque/English translations with dot-path resolver |
| `src/ui-bindings.js` | DOM references, status indicator, progress bar, buttons, toast system |
| `src/ui-examples.js` | Basque example sentences as clickable chips |
| `src/ui-toast.js` | Toast notification with type-specific styling |
| `tests/cap-punct/` | Golden-case eval harness (EBE-grounded, RAW/CONSTRAINED/RULED metrics) |
| `tests/core/` | Rule engine unit tests (instant, no model needed) |
| `docs/ebe-reference/` | EBE rule reference extracts (punctuation, calques, confusables) |
| `vite.config.js` | Vite config with base path `/txukun/` |
| `package.json` | Dependencies and scripts |
| `CHANGELOG.md` | Release changelog |
| `ONNX_EXPORT_LOG.md` | History of ONNX export attempts |
| `RESEARCH.md` | Full implementation research document |
| `.github/workflows/deploy.yml` | GitHub Pages deploy workflow |

## Development

```bash
npm install          # install dependencies
npm run dev          # start dev server (port 3000)
npm run build        # production build to dist/
npm run deploy       # deploy to GitHub Pages (via gh-pages)
```

The dev server runs on `http://localhost:3000/txukun/`. The base path `/txukun/` is configured in `vite.config.js` — always use the sub-path.

## Model Loading

The product uses **three neural models**, each loaded lazily from HuggingFace Hub via Transformers.js. The cap-punct model is detailed below as the canonical example; the other two follow the same pattern.

### Model 1 — cap-punct (MarianMT), `src/models.js`

```javascript
const { pipeline } = await import('@huggingface/transformers');
const correctorPipeline = await pipeline(
  'translation',
  'itzune/txukun-cap-punct-eu',
  {
    device: 'wasm',
    dtype: 'q8',        // int8 quantized model (lossless vs fp32 — see tests/cap-punct/BASELINE.md)
    subfolder: '',        // files are in repo root, not onnx/ subfolder
  }
);
```

- Model files: `encoder_model_quantized.onnx` (int8, shipped) + `encoder_model.onnx` (fp32). Hub has NO `_fp16` files.
- Transformers.js dtype mapping: `'q8'` → `_quantized.onnx` (int8, what `src/models.js` uses), `'fp32'` → `.onnx` (full precision). `'fp16'` 404s (no such files on Hub).
- q8 and fp32 produce identical cap-punct accuracy (verified 2026-08-25, 33-case golden suite)
- `subfolder: ''` is critical — TF.js defaults to `onnx/` subfolder

### Model 2 — BERTeus (spell re-ranking), `src/bert-rerank.js`

```javascript
const { AutoModel } = await import('@huggingface/transformers');
const model = await AutoModel.from_pretrained('itzune/berteus-onnx', {
  dtype: 'q4',   // int4 quantized (85MB encoder + 74MB f16 embeddings)
  device: 'wasm',
});
```

- Used for masked-embedding candidate re-ranking when a spell error has ≥2 candidates.
- Lazy-loaded only on first spell error with multiple candidates.

### Model 3 — GECToR (grammar correction), `src/gector.js`

- HF repo: `itzune/gector-eus-onnx` (`onnx/model_q4.onnx`, 85MB int4 + tokenizer/vocab files).
- Loaded via custom ONNX session (edit-based $KEEP/$DELETE/$REPLACE/$APPEND, up to 5 iterative passes).
- Has a **detect head** (P(INCORRECT) per token) that powers the input heatmap, separate from the correction (label) head.
- Lazy-loaded in the background after the main pipeline initializes.

### Graceful degradation

All three models degrade gracefully — if any model fails to load, the pipeline falls back to the previous tier. The **rule engine runs independently** ("Txukun Lite" mode): capitalization, punctuation, comma fixes, zalantza (doubtful word) substitution, calque (loan-translation) correction, and proper-noun zalantza (exonym spelling) all work even before any neural model loads.

## i18n

Basque-first with English fallback. Translations in `src/i18n.js`. HTML elements use `data-i18n="key.path"` attributes. `<p>` elements with `data-i18n` are rendered via `innerHTML` (allows formatting tags), others via `textContent` (safe).

## Before Creating a Release/Tag

**Always update `CHANGELOG.md` before tagging a release.** The changelog should reflect all changes since the last tag.

Steps:
1. Update `CHANGELOG.md` with changes under the appropriate version header
2. Commit the changelog: `git add CHANGELOG.md && git commit -m "Update changelog for vX.Y.Z"`
3. Tag the release: `git tag -a vX.Y.Z -m "vX.Y.Z — Description"`
4. Push: `git push && git push origin vX.Y.Z`
5. Create GitHub release: `gh release create vX.Y.Z --repo itzune/txukun --title "..." --notes "..."`

## Design Conventions

- Follow Itzune's design system (see `itzune.github.io/css/tokens.css` and `css/main.css` for reference)
- Dark theme only — no light mode
- CSS custom properties for theming
- JetBrains Mono for code/technical text
- Pill-shaped buttons and chips
- Cosmic-void gradient backgrounds
- Sky-blue (`#4bb8e8`) primary accent

## Project Naming

Itzune projects follow Basque-themed naming:
- **Txukun** = "tidy, neat, well-arranged" (this project)
- nongoeuskara = "where is Basque?"
- elhisinda = wordplay on "hel(h)itza" (reachable/accessible)
- herrizherri = "from town to town"
- fimeus = phonetic play on "fime" (fine/precise) + "eus"
- etc.

## Known Constraints

- ONNX Runtime Web WASM supports up to IR version 8
- MarianMT (cap-punct) output contains special tokens (`<unk>`, `</s>`, `<s>`, `<pad>`) — must be cleaned via `cleanModelOutput()` (`src/core/clean-output.js`)
- q8 quantization is **lossless** for cap-punct (q8 = fp32 on the golden suite). The Hub has no fp16 files; `'fp16'` dtype 404s. int4 (BERTeus, GECToR) is a lossy but validated quantization.
- The cap-punct model was trained on ASR-style lowercase input — it has a ~82% ceiling on general text. The rule engine closes the gap (lifts strict accuracy 81.8%→100%). See `tests/cap-punct/BASELINE.md`.
- EBE calque/zalantza rules shipped (P1): zalantza-words (720 pairs), zalantza-phrases (52 pairs), calque (4 pairs), zalantza-proper (24 proper-noun pairs). See `TODO.md` and `RESEARCH.md` §7.12–§7.16
