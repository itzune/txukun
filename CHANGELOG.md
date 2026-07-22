# Changelog

All notable changes to Txukun will be documented in this file.

---

## [Unreleased] — Tier 1 frequency re-ranking for autocorrect

Implements Tier 1 of [`CORRECTOR_STRATEGY.md`](./CORRECTOR_STRATEGY.md): replace the
blind `suggestions[0]` autocorrect with corpus-frequency re-ranking. No new
dependencies; all inference stays client-side.

### Fixed
- **`batzutan`-class autocorrect bugs** (`XUXEN_ISSUES.md` §1): `autoCorrect()`
  no longer blindly takes Hunspell's first suggestion. For `batzutan`, Hunspell
  proposes `batsutan` (wrong, an affix-generated form absent from the corpus)
  and never proposes the correct `batzuetan`. The new re-ranker generates
  edit-distance-1 candidates against the wordlist and picks `batzuetan`
  (corpus count 14,790) over `batsutan` (count 0) by frequency. Verified for the
  full §9 test set in `scripts/verify-autocorrect.mjs`.

### Changed
- **`autoCorrect()` re-ranks candidates** (`src/spell.js`): the candidate pool
  is now `(edit-distance-1 variants ∩ wordlist) ∪ (Hunspell suggestions)`, scored
  as `score = β·log(freq+1) + δ·(1/(1+edit_distance))` with `β=0.3, δ=0.5`
  (named `SCORE_BETA`/`SCORE_DELTA` constants, ready for grid-search). Hunspell
  is demoted to a *secondary* candidate source — it is no longer the sole
  generator nor the ranker. A confidence gate (`freq > 0` OR `ed === 1`) prevents
  forcing rare zero-frequency edit-distance-2 words onto the user; words with no
  confident candidate are left unchanged (graceful degradation).
- **Single dictionary fetch**: `loadSpellChecker()` now fetches
  `eu-words-freq.txt` once and builds both the main-thread frequency `Map` (for
  re-ranking) and the worker's detection `Set` (the worker parses the `word\tcount`
  word column). The redundant `eu-words.txt` fetch is dropped (~1.6 MB saved at
  runtime; the file is retained in the repo as legacy). The two files are
  byte-identical word sets (160,459 words).
- New exported pure helpers in `src/spell.js`: `edits1`, `levenshtein`,
  `matchCase`, `rankCandidates` (unit-testable in Node without the Worker).

### Known limitations (deferred to Tier 2 — neural re-ranking via wllama)
- **Proper-noun diacritic restoration** (e.g. `inaki → iñaki`): on the shipped
  160k wordlist `Iñaki` has corpus count 0, so frequency re-ranking picks
  `izaki` (count 1,831) instead. This is context-dependent (name vs. word) and
  needs the LM. Since `Iñaki` is in Xuxen's `eu.dic`, the previous
  `suggestions[0]` path may have restored it via Hunspell's REP/TRY tables — a
  possible regression for this specific class. Mitigation options: Tier 2 LM, or
  an optional diacritic-aware edit-distance refinement (not in the Tier 1 spec).
- **Genuine multi-candidate ambiguity** (e.g. `mutika → musika` instead of
  `mutila`): frequency alone picks the more common word; only context (LM)
  resolves it. Documented in `CORRECTOR_STRATEGY.md` §9.

### Added
- `scripts/verify-autocorrect.mjs` — Node verification of the §9 test cases
  against the shipped wordlist, importing the real `spell.js` helpers
  (Hunspell stubbed to `[]` to isolate the new logic).

---

## [1.5.1] — Hunspell WASM worker ready fix + green annotation — 2026-06-29

### Fixed
- **Spell worker race condition**: `loadSpellChecker()` now waits for the Hunspell WASM worker to fully initialize (~3s for Xuxen dict) before returning. Previously, clicking "Correct" too quickly after page load would silently skip all spell corrections because the worker wasn't ready yet.
- **Green annotation for pre-model corrections**: auto-corrected words (e.g., `gabiltxa` → `gabiltza`) now correctly display green underlines in the output. The pre-model corrections are merged with post-model corrections before annotation.

### Changed
- Spell checker pipeline now properly sequenced: `loadSpellChecker()` awaits worker `ready` message before resolving, ensuring subsequent `autoCorrect()` calls actually check words instead of no-oping.

---

## [1.5.0] — Spell checker improvements + disclaimers — 2026-06-28

### Added
- **Hyphen-split spell checking**: compound words like `EiTB-ko`, `hitz-armak`, `etxe-aurrean` now validated by checking each part independently
- **Number-suffix skip**: short words (≤5 chars) following a numeric token are treated as Basque suffixes (`42koa`, `15ekoa`, `42ko`) and not flagged
- **Case-insensitive acronym lookup**: `eitb` finds `EITB`, `EiTB` finds `EITB` via uppercase fallback
- **Disclaimer section** in "Nola dabil?": warns about model hallucinations (inherent to all generative AI) and clarifies auto-correct uses static dictionary + Levenshtein, not AI/LLM
- **Green + red combined annotations**: auto-corrected words in green, remaining errors in red
- **Clickable corrected words**: clicking a green-underlined word shows popover to undo the correction

### Fixed
- Removed `SER` from word list (Spanish false positive)
- `spell()` case-insensitive lookup now correctly handles mixed-case acronyms without matching false positives

### Removed
- Pipeline flow diagram (🎤 Audio → Parakeet → Txukun) — not yet implemented

---

## [1.4.0] — Auto-correct on by default — 2026-06-28

### Changed
- **Auto-zuzenketa toggle now actually auto-corrects**: when enabled, misspelled words are automatically replaced with the first suggestion (output AND input)
- When disabled, errors are only annotated (red underline) — no auto-replacement
- Input auto-correction runs silently: textarea updates with corrected text, remaining errors annotated
- Added `spell.autoCorrect()` function: replaces fixable errors in-place, returns `{ text, changes }`
- Updated spell toggle tooltip to clarify: "Aktibatuta, akats ortografikoak automatikoki zuzentzen dira..."

---

## [1.3.0] — Auto-correct toggle + info tooltip — 2026-06-28

### Changed
- Renamed spell toggle from "Ortografia" to "Auto-zuzenketa" ("Auto-correct" in English)
- Added ℹ info icon next to toggle label with hover tooltip explaining auto-correction behavior
- Tooltip text updates when language switches (Basque/English)

---

## [1.2.0] — Input spell check + toggle + re-correction — 2026-06-28

### Added
- **Input panel spell checking**: after correction, the input textarea also shows spell errors with red wavy underlines. Clicking a suggestion replaces the word and automatically re-runs correction with the fixed input
- **Spell check toggle** in the status bar ("Ortografia") — enables/disables all spell checking. Unchecking hides input and output spell overlays
- **`?spell=0`/`?spell=1` GET parameter** to control spell check on page load (default: enabled)
- **`txukun:recorrect` custom event** to trigger re-correction from spell suggestion clicks

### Changed
- `ui-bindings.js`: added `setInputTextAnnotated()` for input panel spell overlay, updated `bindSpellSuggestionClicks()` to detect input vs output panel and trigger re-correction accordingly
- `main.js`: spell check gated behind `spellEnabled` flag; toggle handler shows/hides overlays; event listener for `txukun:recorrect`
- `i18n.js`: added `spell.toggle` key ("Ortografia" / "Spell check")
- `index.html`: added `#inputSpellOverlay` overlay div, spell toggle checkbox, toggle CSS

---

## [1.1.0] — Spell checking with frequency-ranked word list — 2026-06-28

### Changed

- **Replaced Hunspell WASM with nspell + pre-built word list** due to Emscripten conflict with ONNX Runtime Web (two WASM modules cannot coexist in the same browser context). See `SPELL_DEBUG_LOG.md` for full history of 6 failed attempts.
- **160k-word dictionary** (130k base forms from Xuxen .dic + 30k frequent conjugated/declined forms extracted from `ccmatrix_filtered.en-eu.eu` corpus and verified with Hunspell at build time)
- **Corpus-frequency-ranked suggestions**: Levenshtein distance ≤2 scanning, sorted by edit distance then corpus frequency. Common words ("zer" 83k occurrences) now appear as top suggestions.
- **Case-insensitive spell checking**: dictionary is lowercase, input is lowercased before lookup

### Added

- `public/dicts/eu-words.txt` — 160k unique Basque words (1.6 MB)
- `public/dicts/eu-words-freq.txt` — frequency data from Basque parallel corpus (2.0 MB)
- `SPELL_DEBUG_LOG.md` — full documentation of all spell checker integration attempts
- Build-time word list generation using `hunspell-asm` in Node.js to verify corpus-extracted forms

### Removed

- `hunspell-asm` and `dictionary-eu` npm dependencies (no longer needed at runtime)
- Web Worker files (`public/spell-worker.js`, `src/spell-worker.js`)

---

## [1.0.0] — MVP — 2026-06-28

### Added

- **Capitalization and punctuation restoration** using `HiTZ/cap-punct-eu` MarianMT model
- **Spell checking** with Hunspell WASM + Xuxen Basque dictionary (dictionary-eu, 85k words)
- **Client-side inference** via Transformers.js + ONNX Runtime Web (WASM backend)
- **Int8 dynamically quantized ONNX model** served from HuggingFace Hub (`itzune/txukun-cap-punct-eu`) — 77 MB total (74% smaller than fp32)
- **Custom ONNX export pipeline**: encoder + decoder with KV-cache, IR version 8 for browser compatibility
- **Custom `tokenizer.json`** built from SentencePiece source tokenizer (Unigram + Metaspace pre-tokenizer)
- **Basque-first i18n** with English fallback (manual language switcher)
- **Two-column layout**: side-by-side input/output on desktop, stacked on mobile
- **Example chips**: 8 Basque sentences, one-click fill
- **Copy to clipboard** button for corrected output
- **Download as `.txt`** button for corrected output
- **Clear input** button
- **Character count** indicators for input and output
- **Status indicator** with animated dot (idle / loading / loading-spell / ready / processing / error)
- **Progress bar** showing model download progress
- **Toast notification system** with success / error / warning / info types
- **Keyboard shortcut**: `Ctrl+Enter` to trigger correction
- **Ctrl+Enter to correct** hint shown when input has text
- **Auto-height textareas** that grow with content
- **Spell check annotations**: misspelled words underlined in red with wavy line, click to see suggestions in a popover, click suggestion to apply
- **About section** explaining the model, privacy, and the speech-to-text pipeline (Audio → Parakeet-eu ASR → Txukun → Clean text)
- **Language detection** from saved preference or browser, defaulting to Basque
- **GitHub Actions deploy workflow**: auto-deploy to GitHub Pages (`itzune.eus/txukun/`)
- **Itzune design system**: cosmic-void gradient background, steel-navy cards, sky-blue accents, JetBrains Mono typography, pill-shaped UI elements
- **Dark theme only** (matching Itzune aesthetic)
- **spell-check Lucide icon** throughout the UI (replaced 🧹 broom emoji)
- **MarianMT output cleaning**: strips `<unk>`, `</s>`, `<s>`, `<pad>` tokens and normalizes whitespace
- **Properly linked references**: HiTZ Zentroa (`hitz.eus`) and `cap-punct-eu` HF repo in about section
- **`AGENTS.md`** with project conventions, tech stack, and release checklist

### Fixed

- **I18n rendering**: `<p>` elements with `data-i18n` now use `innerHTML` to render formatting tags (`<strong>`, `<a>`, `<code>`)
- **Progress bar**: normalized per-file progress values (0–100 instead of 0–1), filters to only show ONNX/tokenizer downloads
- **Model loading**: `subfolder: ''` and `dtype: 'q8'` options to correctly locate quantized files on HF Hub

### Known Limitations

- Int8 dynamic quantization may have minor accuracy impact vs fp32 (no evaluation done yet)
- No grammar correction (planned for future Phase 2)
- Spell checker may flag proper nouns, technical terms, and compound words as errors
- Only supports single-line and multi-line text; no paragraph-level context window awareness yet

---

*This MVP focuses on the core value proposition: restore capitalization and punctuation in lowercase, punctuationless Basque text — e.g., ASR output. Spell checking and grammar correction are planned for future releases.*
