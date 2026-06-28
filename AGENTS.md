# AGENTS.md

Instructions for AI agents working on the Txukun project.

---

## Project Overview

Txukun is a browser-based Basque text cleaning tool that restores capitalization and punctuation to raw text (e.g., ASR output). It's part of the [Itzune](https://itzune.eus) ecosystem of Basque language AI tools.

- **Repo**: https://github.com/itzune/txukun
- **Site**: https://itzune.eus/txukun/
- **Model**: https://huggingface.co/itzune/txukun-cap-punct-eu
- **Original model**: https://huggingface.co/HiTZ/cap-punct-eu

## Tech Stack

- **Build**: Vite 5
- **Runtime**: Vanilla JavaScript (no framework)
- **Inference**: Transformers.js (@huggingface/transformers) + ONNX Runtime Web WASM
- **Model**: MarianMT (6 encoder + 6 decoder, d_model=512, SentencePiece tokenizer)
- **Deploy**: GitHub Pages at `/txukun/` sub-path (base URL matters)
- **Design**: Itzune design system (dark theme, cosmic-void gradient, JetBrains Mono, sky `#4bb8e8` accents)

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Single-page app (all HTML + inline CSS) |
| `src/main.js` | Entry point: model loading, correction logic, i18n, keyboard shortcuts |
| `src/i18n.js` | Basque/English translations with dot-path resolver |
| `src/ui-bindings.js` | DOM references, status indicator, progress bar, buttons, toast system |
| `src/ui-examples.js` | Basque example sentences as clickable chips |
| `src/ui-toast.js` | Toast notification with type-specific styling |
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

The model is loaded from HuggingFace Hub using Transformers.js:

```javascript
const { pipeline } = await import('@huggingface/transformers');
const correctorPipeline = await pipeline(
  'translation',
  'itzune/txukun-cap-punct-eu',
  {
    device: 'wasm',
    dtype: 'fp16',       // float16 quantized model
    subfolder: '',        // files are in repo root, not onnx/ subfolder
  }
);
```

- Model files: `encoder_model_fp16.onnx` (68 MB) + `decoder_model_merged_fp16.onnx` (81 MB)
- Files must be named with `_fp16` suffix for Transformers.js auto-detection
- `subfolder: ''` is critical — TF.js defaults to `onnx/` subfolder

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
- Model output contains MarianMT special tokens (`<unk>`, `</s>`, `<s>`, `<pad>`) — must be cleaned in `correctText()`
- Float16 quantization may have minor accuracy impact vs fp32
- No spell checking or grammar correction yet (Phase 2)
