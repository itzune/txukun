# Changelog

All notable changes to Txukun will be documented in this file.

---

## [Unreleased] — post-v2.0.0 (zalantza rule + Txukun Lite UI fix)

### LLM research — synthetic-data GEC feasibility study

#### Added
- **`LLM-RESEARCH.md`** — deep research document on the viability of fine-tuning
  a small LLM for Basque GEC via synthetic error data (the user's proposal).
  Covers: the LLM-for-GEC industry trend (Grammarly mEdIT, BEA/EMNLP 2025),
  synthetic data generation as established SOTA (Stahlberg 2021, Keita 2024
  Zarma), Basque-specific resources (Latxa 7B–70B, Llama-eus-8B), and browser
  deployment constraints (WebLLM ~8B ceiling).
- **Key finding**: the exact approach has already been published for Basque —
  Beloki et al. (SEPLN) built a seq2seq GEC with rule-based error injection from
  a 500K-article Berria corpus, achieving 0.87 F0.5. The authors (Saralegi,
  Corral) are the same Elhuyar/HiTZ group that built Llama-eus-8B.
- **Recommendation**: build the synthetic dataset first (Phase 1, no ML needed —
  pure programming, highest value, reusable asset). Defer LLM fine-tuning
  (Phase 3) until the dataset is built and a collaboration/learning path for
  the ML work is identified. The hard constraint is browser deployment, not
  data or training.

### ASR detection gate — cap-punct hallucination fix

#### Fixed
- **Cap-punct model hallucinated on well-formed text** (100% FP rate): the
  MarianMT cap-punct model was trained on ASR-style lowercase input. When fed
  already-correct text (uppercase + punctuation), it hallucinated degradations
  — capitalizing mid-sentence words, replacing colons/semicolons with
  commas/periods, inserting spurious commas. On a 1483-word Berria article,
  this produced **19 false positives (100% FP rate, 0 true positives)**.
- **Root cause**: the ASR gate (`isWellFormedSegment`) checked for uppercase +
  terminal punctuation. But sentences like `"1993. urtean sortu zen, ildo
  antikapitalista…"` are correctly lowercase ("urtean" follows the ordinal
  "1993.") yet have no uppercase → bypassed the gate → model ran → hallucinated.
  Additionally, `splitIntoSegments()` split on ordinal periods (`"1993. urtean"`
  → `"1993."` + `"urtean…"`), creating lowercase fragments that bypassed the
  gate entirely.
- **Fix 1 — ordinal-safe segmentation**: `splitIntoSegments()` regex changed
  from `/(?<=[.?!])\s+/` to `/(?<=[?!]|[^0-9]\.)\s+/` — does not split on
  periods that follow digits (ordinal markers like `"1993."` or thousands
  separators like `"2.018"`, per EBE Puntuazioa §1.2.2 "Zenbakietakoa").
  Also fixed `sep` to use spaces (not `\n`) between sentences within a line.
- **Fix 2 — conservative ASR gate**: replaced `isWellFormedSegment()` (skip if
  uppercase + terminal punct) with `isASRStyleSegment()` (run model ONLY if
  all-lowercase AND zero punctuation). Any text with caps OR any punctuation is
  human-written → model skipped → rule layer handles it. The model now runs
  exclusively on pure ASR-style text (the input it was trained on).
- **Result**: 19 FPs → **0 FPs** on the AHT Berria article (100% reduction).
  Zero regression on the 33-case golden suite (all 33 are pure ASR-style → none
  skipped). Rule engine (sentence-initial-cap, terminal-punct, zalantza, calque)
  handles all cap-punct needs on human-written text.

### Added
- **Zalantza-hitzak rule** (`src/core/rules/zalantza-words.js`) — the first
  EBE-grounded *general-purpose writer* rule (not ASR-specific). Corrects
  720 doubtful words (628 batch 1 + 92 batch 2a singles) that Euskaltzaindia
  explicitly recommends against (Spanish/French loanwords, dialectal forms,
  apocopes) by replacing them with their standard forms: `abots→ahots`,
  `aborto→abortu`, `amapola→mitxoleta`, `onda→uhin`, `xori→txori`.
  Case-preserving (lower / Title / UPPER; mixed-case tokens skipped as a
  proper-noun guard). Word-boundary safe (declined forms like `abortoak` are
  untouched). Priority 45. Surfaced as `Confusable`-kind lint cards in both the
  model-loaded and Txukun Lite (rules-only) paths.
- `src/core/data/zalantza.js` — the 720-pair frozen dictionary (628 batch 1 +
  92 batch 2a), extracted from Euskaltzaindia's EBE appendix PDF (pp. 479–490)
  via pdfplumber character-color analysis (RED = dispreferred, BOLD = standard).
  Verified: 0 compound-fragment leaks, 0 idempotency overlap, 0 verb/function-word
  collisions (`gara` excluded). See `RESEARCH.md` §7.12–§7.13.
- **Zalantza-esapideak rule** (`src/core/rules/zalantza-phrases.js`) —
  multi-word phrase substitution (batch 2a Phase 2). Corrects 52 phrases the
  single-word rule cannot match (tokenizer splits on hyphens):
  `kontutan hartu→kontuan hartu`, `aire-garraio→aireko garraio`,
  `gora-behera→gorabehera`. Sliding-window token-sequence match.
  Priority 46. See `RESEARCH.md` §7.13.
- `src/core/data/zalantza-phrases.js` — 52-pair frozen array (33 TSV phrases +
  19 reclassified hyphenated compounds that were dead code in the single-word
  file).
- **Kalko lexiko-semantikoak rule** (`src/core/rules/calque.js`) — EBE-grounded
  loan-translation correction (batch 2b). Corrects 4 calque pairs:
  `balore→balio`, `erasokor→erasotzaile` (single words),
  `pena merezi→merezi`, `zentzu bakarreko→noranzko bakarreko` (phrases).
  Combined word-lookup (priority 47) + phrase sliding-window (priority 48) in
  one rule. `LintKind.Calque`. 4 other pairs already covered by zalantza rule.
  See `RESEARCH.md` §7.15.
- **Zalantza izendunak rule** (`src/core/rules/zalantza-proper.js`) — EBE-grounded
  proper-noun spelling correction (batch 2a Phase 3). Corrects 24 exonym /
  proper-noun pairs: `ukrania→Ukraina`, `troya→Troia`, `kalagorria→Calahorra`,
  `big-bang→Big Bang`, etc. Combined word-lookup (priority 49) + phrase
  sliding-window (priority 50) in one rule. New `matchCaseProper()` function —
  unlike `matchCase()`, always returns a capitalized target (proper nouns are
  always capitalized). `LintKind.Confusable`. 3 entries skipped: `ozkabarte`
  (broken extraction), `donejakue`/`donibane` (false-positive risk). F5
  research: semantic capitalization is context-dependent, not gazetteer-able.
  See `RESEARCH.md` §7.16.
- `src/core/data/zalantza-proper.js` — 21 single-word + 3 phrase proper-noun
  data (24 entries total). Directionality verified against EBE analytic index
  + EODA (Onomastika Datubasea).
- `src/core/data/calque.js` — 3-word + 4-phrase calque data (2-word + 2-phrase §1 lexical + 1-word + 2-phrase §2 syntactic).
- **EBE §2 syntactic-calque eval suite** (`tests/ebe-rules/`) — measurement infrastructure for batch 3 (kalko morfosintatikoak). `cases.json` (43 cases, one per EBE §2 category, classified into 5 feasibility tiers A–E) + `eval.mjs` (3 modes: `--rules` default, `--gector`, `--check`). Baseline: rules-only 2/43 (4.7%), rules+GECToR 1/43 (2.3%). **Key finding**: GECToR does NOT cover EBE §2 calques (0/6 tier-C) — transfer errors ≠ the synthetic morphology perturbations GECToR was trained on (R1–R4). See `RESEARCH.md` §7.17.
- **2 §2 syntactic calque rules** added to `calque.js`: `gogoekin→gogoarekin` (Sp 'con ganas' plural → Basque singular) and `hobe esanda→hobeto esanda` (Sp 'mejor dicho', adjective→adverb). These are the only 2 clean word/phrase substitutions in EBE §2's 44 categories; the rest need POS/morphology (tier D, 13) or are context-dependent (tier E, 17).
- `tests/core/zalantza.test.mjs` — 50 unit tests.
- `tests/core/zalantza-phrases.test.mjs` — 39 tests.
- `tests/core/calque.test.mjs` — 53 tests (41 §1 + 12 §2 syntactic).
- `tests/core/zalantza-proper.test.mjs` — 46 tests (matchCaseProper,
  single-word, multi-word target, phrase, guards, full-stack integration).
- `docs/ebe-reference/extract-zalantza.py` — reproducible extraction script (v6).

### Changed
- `src/core/rules/index.js` — registered `zalantzaWords`, `zalantzaPhrases`,
  `calque`, and `zalantzaProper` in `allRules` (now 8 rules: sentence-boundary
  → sentence-initial-cap → vocative-comma → terminal-punct → zalantza-words →
  zalantza-phrases → calque → zalantza-proper).
- `package.json` — `test:core` now runs 6 test files (247 tests total: 41+18+50+39+53+46). Added `test:ebe` and `test:ebe:check` scripts for the EBE §2 eval suite. `test` now includes `test:ebe:check`.
- `TODO.md` — zalantza batches 1, 2a (all 3 phases), and 2b marked done; batch 3 (kalko morfosintaktikoak) research done with feasibility analysis.
- `src/gector.js` — `import.meta.env.BASE_URL` → `import.meta.env?.BASE_URL` (optional chaining for Node.js compatibility — enables `--gector` eval mode).
- `src/cache.js` — `'caches' in window` → `'caches' in globalThis` (works in both browser and Node.js).

### Notes
- The cap-punct golden suite (22/22 strict) is unchanged — zalantza is
  orthogonal to cap-punct and is unit-tested against the EBE pairs themselves
  (per §7.11 eval strategy), not the cap-punct suite.
- This is the first rule advancing txukun's repositioning from ASR post-processor
  to general-purpose Basque writing assistant (Grammarly-for-Basque).

---

### Txukun Lite wired to UI

#### Fixed
- **Txukun Lite was unreachable from the UI**: `detectCapPunctErrors()`
  (`src/analyze.js`) bailed early with `if (!isModelReady()) return errors;`
  before reaching `correctCapPunct()`, which has a rules-only path for when the
  model isn't loaded. Result: users got **zero** cap-punct suggestions (no comma,
  capitalization, or punctuation fixes) while the model was still downloading or
  if it failed to load — even though the rule engine could provide them. Removed
  the early return; `correctCapPunct()` already guards the model-not-loaded case
  internally and takes the cheap rules-only path (no model inference). Rule fixes
  now surface as blue `cappunct` cards before/without the neural model.

### Added
- `src/core/diff.js` — extracted the pure word-level LCS diff pipeline
  (`tokenizeWithOffsets`, `diffWords`, `isCasePunctOnly`) out of `analyze.js` so
  it's unit-testable in Node without browser-only model deps. Same rationale as
  `src/core/clean-output.js` (P0.3). `analyze.js` re-imports from it (no behavior
  change to the model-loaded path).
- `tests/core/txukun-lite.test.mjs` — 18 tests confirming rule fixes surface as
  cap-punct cards without the model (simulates `detectCapPunctErrors`' core:
  `runRules` → `diffWords` → `isCasePunctOnly` → errors). Covers c060, c061,
  interrogative `?`, empty/already-correct guards, and the `isCasePunctOnly`
  word-substitution guard.

---

## [2.0.0] — 3-model architecture + Grammarly-style editor + rule engine — 2026-08-25

Txukun 2.0 is a ground-up rebuild. The app moves from a simple two-column
cap-punct + spell-check tool to a **Grammarly-style editor** with a **3-model
neural pipeline** (GECToR grammar + BERTeus spelling + MarianMT cap-punct),
**per-model confidence thresholds**, and a **deterministic rule engine** grounded
in Euskaltzaindia's EBE reference.

All inference stays client-side (Transformers.js + ONNX Runtime Web WASM).

### Added — 3-model neural pipeline
- **GECToR grammar correction (Tier 3)** — browser pipeline loading a GECToR
  sequence-tagging model from HuggingFace Hub. Detects grammar errors via a
  detection head (P(INCORRECT) confidence) and applies tag-based edits. Full
  model (1M training pairs, F0.5=90.2). License: CC-BY-NC-SA 4.0 (derivative of
  Elhuyar data).
- **BERTeus neural re-ranking (Tier 2)** — replaces the wllama/futo LM with an
  int4-quantized BERTeus ONNX model (85 MB). Re-ranks spelling candidates by
  contextual cosine similarity. Browser validation: 29/30 match Python reference.
- **Per-model confidence thresholds** — each category (grammar, spelling,
  cappunct) has a calibrated minimum confidence; errors below threshold are
  silently suppressed. Calibrated via grid search on a 220-case benchmark
  (22.7% → 38.6% accuracy, +15.9% absolute; over-corrections 139→66, false
  positives 12→1). cappunct lowered from 1.00→0.80 with per-segment confidence.
- **Cache API** for GECToR ONNX + BERTeus embeddings — avoids re-fetch on reload.
- **GECToR detection heatmap** — visualization of detection scores.

### Added — P1 rule engine (deterministic, EBE-grounded)
- **Rule engine** (`src/core/`) — Harper-inspired Lint+Suggestion architecture
  with iterative re-lint (apply one suggestion → re-tokenize → re-lint → repeat).
  Unicode-aware tokenizer, span-based Document model, 3-variant edit enum
  (replaceWith / insertAfter / remove). 4 small files: `types.js`, `document.js`,
  `engine.js`, `rules/*.js`.
- **4 EBE-grounded rules** on cap-punct model output:
  1. `sentence-boundary` — split at bare-finite-AUX + temporal-adverb +
     second-AUX boundary (EBE puntuazioa §1). Second-AUX guard prevents false
     splits on post-positioned temporals ("etorri naiz gaur" = one sentence).
  2. `sentence-initial-cap` — uppercase first word of each sentence
     (EBE Maiuskulak §1.1).
  3. `terminal-punct` — add `.` (declarative), `?` (interrogative pronoun), or
     `!` (exclamatory greeting); also replaces `.`→`!` for vocative greetings
     (EBE puntuazioa §1, §2.3, §6).
  4. `vocative-comma` — insert comma after greeting interjections and multi-word
     phrases (kaixo, agur, gabon, eskerrik asko, egun on…) (EBE koma §3).
- **"Txukun Lite" mode** — rules apply even when the neural model isn't loaded,
  providing basic cap+punct+comma correction without the model download.
- **Cap-punct golden-case suite + eval harness** (`tests/cap-punct/`) — 33 cases
  with strict/all split, RAW/CONSTRAINED/RULED metrics, `--no-rules` flag.

  **Result**: strict accuracy 81.8% → **100%** (22/22), all-case 57.6% → **81.8%**
  (27/33), mean normalized Levenshtein 0.477 → **0.224**, zero regressions.
  The rule-layer thesis (deterministic rules close the gaps the neural model
  leaves) is validated.

### Added — Grammarly-style editor & UX
- **Idaztian markdown editor** (CodeMirror 6) with live preview — replaces the
  plain textarea. Error decorations render as red/amber/blue wavy underlines via
  a custom StateField; positions auto-remap on edit.
- **Suggestions panel** — clickable cards for each detected error, sorted by
  position, de-overlapped (earliest + longest span wins).
- **Document management** — multi-document support (create, import, rename,
  switch between documents).
- **Welcome content** for first-time visitors.
- **Error categories** unified: `grammar` | `spelling` | `cappunct`, each with
  category-specific underline color.

### Added — Spelling improvements
- **Corpus-frequency re-ranking (Tier 1)** — `autoCorrect()` no longer blindly
  takes Hunspell's first suggestion. Candidate pool is
  `(edit-distance-1 variants ∩ wordlist) ∪ (Hunspell suggestions)`, scored as
  `β·log(freq+1) + δ·(1/(1+edit_distance))`. Fixes `batzutan`-class bugs where
  Hunspell proposes `batsutan` (wrong) and never proposes `batzuetan` (correct).
- **Hyphen-split spell checking** — compound words (`EiTB-ko`, `hitz-armak`)
  validated by checking each part independently.
- **Number-suffix skip** — short words (≤5 chars) after numerics treated as
  Basque suffixes (`42koa`, `15ekoa`) and not flagged.
- **Case-insensitive acronym lookup** — `eitb` finds `EITB`, `EiTB` finds `EITB`.
- New pure helpers in `src/spell.js`: `edits1`, `levenshtein`, `matchCase`,
  `rankCandidates`, `checkWord`.

### Changed
- **Cap-punct pipeline**: text split into sentences before the MarianMT model;
  markdown stripped before all models so they never see syntax markers.
- **Suggestion merging**: spelling + cap-punct merged into a single suggestion
  for sentence-initial words; cap-punct capitalization merged into grammar
  corrections too.
- **Single dictionary fetch**: `loadSpellChecker()` fetches `eu-words-freq.txt`
  once, building both the frequency `Map` (re-ranking) and worker detection `Set`.
  Redundant `eu-words.txt` fetch dropped (~1.6 MB saved at runtime).
- **Spell worker**: `loadSpellChecker()` now waits for the Hunspell WASM worker to
  fully initialize before returning (fixes race condition where early "Correct"
  clicks silently skipped spell corrections).
- **idaztian** dependency switched from `file:` to npm `^1.4.0` (then `1.4.1`
  with relaxed `@huggingface/transformers` peer dep).

### Fixed
- **Cap-punct hallucinations**: reject hallucinated repeated punctuation; fix
  all-caps hallucination; don't reject legitimate acronyms in the constraint layer.
- **Cap-punct constraint**: quote stripping + LCS-based alignment fix; ignore
  punctuation hints inside heading lines.
- **UI**: cards no longer squished by `flex-shrink` (added `flex-shrink:0`).
- **Green annotation**: pre-model spell corrections now correctly display green
  underlines in the output.
- **`SER`** removed from word list (Spanish false positive).

### Known limitations
- **Proper-noun diacritic restoration** (`inaki → iñaki`): frequency re-ranking
  picks `izaki` (count 1,831) over `Iñaki` (count 0). Context-dependent — needs
  the LM. (BERTeus re-ranking partially addresses this.)
- **Genuine multi-candidate ambiguity** (`mutika → musika` vs `mutila`):
  frequency/neural picks the more common word; only context resolves it.
- **Remaining cap-punct failures** (all `strict:false`): normalization policy
  (EiTB, %42, URLs) and semantic capitalization (institutions, astral bodies —
  needs gazetteer). These are P2+ work.
- **GECToR license** (CC-BY-NC-SA 4.0) restricts commercial use.

### Documentation
- `RESEARCH.md` — §7.5–§7.10: Harper architecture study, 2026 GEC field survey,
  EBE rule sources, Harper implementation-level design read, F4 sentence-boundary
  detection, F2 greeting punctuation.
- `tests/cap-punct/BASELINE.md` — eval methodology + results across 3 rule batches.
- `docs/ebe-reference/` — EBE puntuazioa/komak/zalantzak reference extracts.
- `CORRECTOR_STRATEGY.md` — Tier 1/2/3 spelling & grammar strategy.

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
