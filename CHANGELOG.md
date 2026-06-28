# Changelog

All notable changes to Txukun will be documented in this file.

---

## [0.1.0] — MVP — 2026-06-28

### Added

- **Capitalization and punctuation restoration** using `HiTZ/cap-punct-eu` MarianMT model
- **Client-side inference** via Transformers.js + ONNX Runtime Web (WASM backend)
- **Custom ONNX export pipeline**: encoder + decoder with KV-cache, IR version 8 for browser compatibility
- **Custom `tokenizer.json`** built from SentencePiece source tokenizer (Unigram + Metaspace pre-tokenizer)
- **Basque-first i18n** with English fallback (manual language switcher)
- **Two-column layout**: side-by-side input/output on desktop, stacked on mobile
- **Example chips**: 8 Basque sentences, one-click fill
- **Copy to clipboard** button for corrected output
- **Download as `.txt`** button for corrected output
- **Clear input** button
- **Character count** indicators for input and output
- **Status indicator** with animated dot (idle / loading / ready / processing / error)
- **Progress bar** showing model download progress
- **Toast notification system** with success / error / warning / info types
- **Keyboard shortcut**: `Ctrl+Enter` to trigger correction
- **Ctrl+Enter to correct** hint shown when input has text
- **Auto-height textareas** that grow with content
- **About section** explaining the model, privacy, and the speech-to-text pipeline (Audio → Parakeet-eu ASR → Txukun → Clean text)
- **Language detection** from saved preference or browser, defaulting to Basque
- **GitHub Actions deploy workflow**: auto-deploy to GitHub Pages (`itzune.eus/txukun/`)
- **Itzune design system**: cosmic-void gradient background, steel-navy cards, sky-blue accents, JetBrains Mono typography, pill-shaped UI elements
- **Dark theme only** (matching Itzune aesthetic)
- **Release notes**: spell-check Lucide icon throughout the UI

### Known Limitations

- Model files are large (encoder 136MB, decoder 168MB) and loaded directly from the site — no CDN mirroring yet
- No spell checking or grammar correction (planned for Phase 2)
- Only supports single-line and multi-line text; no paragraph-level context window awareness yet
- Output may include `<unk>` tokens in edge cases (basic cleaning applied)

---

*This MVP focuses on the core value proposition: restore capitalization and punctuation in lowercase, punctuationless Basque text — e.g., ASR output. Spell checking and grammar correction are planned for future releases.*
