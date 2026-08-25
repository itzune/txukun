# Txukun — RESEARCH.md

> Basque text correction tool — capitalization, punctuation, spelling, and grammar
>
> **txukun** (Basque): "neat, tidy, well-arranged" — because this tool tidies up raw Basque text.

---

## 1. Vision

### Phase 1 (MVP — now): Capitalization & Punctuation Restoration

A browser-based tool that takes raw Basque text (e.g., ASR output from Parakeet-eu or Whisper) and restores proper capitalization and punctuation. Runs entirely client-side via ONNX + WASM. No server required.

### Phase 2 (Future): Full text correction suite

Extend the tool to include spell checking and grammatical error correction (GEC), making it a complete one-stop Basque text correction tool: paste any rough Basque text → get properly capitalized, punctuated, spell-checked output.

### Pipeline vision

```
Audio → Parakeet-eu (ASR) → lowercase text without punctuation
    → Txukun (cap+punct+spell+grammar) → clean, publishable Basque text
```

---

## 2. Phase 1: Capitalization & Punctuation (MVP)

### 2.1 Model

| Property | Value |
|---|---|
| **Model** | `HiTZ/cap-punct-eu` |
| **HF URL** | https://huggingface.co/HiTZ/cap-punct-eu |
| **Architecture** | MarianMT (encoder-decoder Transformer) |
| **License** | Apache 2.0 |
| **Task** | Translation (lowercase → properly cased+puntuated text) |
| **Language** | Basque only |
| **Model size** | ~154 MB (safetensors) |

#### Architecture Details

From `config.json`:
```
d_model: 512
encoder_layers: 6
decoder_layers: 6
attention_heads: 8
ffn_dim: 2048
vocab_size: 32001
max_position_embeddings: 512
activation: swish
dtype: float16
```

#### Tokenizer

- Type: `MarianTokenizer` with SentencePiece (`source.spm` + `target.spm`, ~842KB each)
- Special tokens: `</s>` (0), `<unk>` (1), `<pad>` (32000)
- `model_max_length`: 512 tokens

#### Generation Settings

```json
{
  "num_beams": 6,
  "max_length": 512,
  "bad_words_ids": [[32000]]
}
```

#### Performance

| Dataset | WER before | WER after | Improvement |
|---|---|---|---|
| FLORES-101 | 19.55% | 5.99% | 13.56pp |
| Common Voice EU | 22.42% | 5.75% | 16.67pp |

#### Examples

| Input (lowercase, no punct) | Output (corrected) |
|---|---|
| `kaixo egun on guztioi` | `Kaixo, egun on guztioi.` |
| `faktoria e i te beko irratian entzuten da` | `Faktoria EiTBko irratian entzuten da.` |
| `gutxi gora behera ehuneko berrogeita bikoa` | `Gutxi gora behera %42koa.` |
| `informazio gehiago hitz puntu e hatxe u puntu eus web horrian` | `Informazio gehiago hitz.ehu.eus web horrian.` |

Note: the model also normalizes some text (spelled-out numbers → digits, URLs, etc.) based on its training normalization.

#### Training Data

- 9,784,905 Basque sentences (subset of `mt-hitz-eu-es`)
- Preprocessing: cleaning, punctuation standardization, filtering, lowercasing + punctuation removal, in-house normalization tool (number normalization, abbreviation expansion)
- Trained on single NVIDIA TITAN RTX GPU with MarianNMT

### 2.2 Client-side Implementation (Transformers.js)

#### MarianMT support confirmed ✅

- Transformers.js supports **MarianMT** architecture since **v1.4.0** (April 2023)
- Pipeline: `pipeline('translation', 'HiTZ/cap-punct-eu')`
- Issue tracking: https://github.com/huggingface/transformers.js/issues/63
- Successfully tested with Helsinki-NLP opus-mt models (same architecture)
- The `@huggingface/transformers` package (formerly `@xenova/transformers`) is the current version

#### ONNX Export & Quantization

**Step 1: Export PyTorch → ONNX**
```bash
pip install optimum[onnxruntime]
optimum-cli export onnx \
  --model HiTZ/cap-punct-eu \
  --task translation \
  --device cpu \
  onnx-export/
```

Note: MarianMT is a seq2seq (encoder-decoder) model. ONNX export creates:
- `encoder_model.onnx` (encoder)
- `decoder_model.onnx` (decoder, auto-regressive)
- `decoder_with_past_model.onnx` (decoder with KV-cache for iterative generation)

**Step 2: Quantize for browser**
```bash
# Using optimum's ONNX quantization
optimum-cli onnxruntime quantize \
  --onnx_model onnx-export/ \
  --avx2 \
  --output quantized/
```

**Model size estimates after quantization:**

| Format | Size | Browser viability |
|---|---|---|
| Safetensors (PyTorch) | 154 MB | ❌ Not usable in browser |
| ONNX fp32 | ~154 MB | ⚠️ Too large |
| ONNX fp16 | ~77 MB | ⚠️ Borderline |
| ONNX q8 (dynamic) | ~77 MB | ⚠️ Borderline |
| ONNX q4 (dynamic) | ~39 MB | ✅ **Ideal** |

At ~39 MB with q4 quantization, the model is smaller than nongoeuskara's combined models (~65 MB), so user experience should be good.

#### Known ONNX Export Pitfalls

From the StackOverflow discussion (https://stackoverflow.com/questions/76089148):
- MarianMT ONNX export requires `--feature=seq2seq-lm` flag in older optimum versions; modern optimum handles this automatically with `--task translation`
- The decoder needs past-key-values (KV-cache) for iterative generation — this is handled by `decoder_with_past_model.onnx`
- SentencePiece tokenizer needs to be available at inference time — Transformers.js handles this

#### Inference Code (Transformers.js)

```javascript
import { pipeline } from '@huggingface/transformers';

// Load the model (downloads ONNX weights from HF Hub)
const corrector = await pipeline('translation', 'HiTZ/cap-punct-eu', {
    // Quantization options (pick one)
    dtype: 'q4',  // smallest, fastest
    // dtype: 'q8',  // balanced
    // dtype: 'fp32', // highest quality, largest
    device: 'wasm',  // CPU via WASM
    // device: 'webgpu',  // GPU via WebGPU (experimental, faster)
});

// Single sentence
const result = await corrector('kaixo egun on guztioi');
// → [{ translation_text: 'Kaixo, egun on guztioi.' }]

// Batch
const results = await corrector([
    'kaixo egun on guztioi',
    'nire jaio urtea mila bederatziehun eta laurogeita hamasei da'
]);
// → [{ translation_text: 'Kaixo, egun on guztioi.' },
//    { translation_text: 'Nire jaio urtea 1996 da.' }]

// Generation options for speed/quality trade-off
const fastResult = await corrector('kaixo egun on guztioi', {
    num_beams: 3,      // fewer beams = faster (default: 6)
    max_length: 256,   // shorter max = faster (default: 512)
});
```

#### Performance Estimates

| Setting | Expected latency (per sentence) |
|---|---|
| WebGPU + q4 | ~150-300ms |
| WASM + q4 | ~300-800ms |
| WASM + q8 | ~500-1200ms |
| WASM + fp32 | ~800-2000ms |

For real-time keystroke mode, use WASM+q4 with num_beams=3 and debounce at 500ms.

### 2.3 Web UI Design (Phase 1)

Following Itzune's existing patterns (nongoeuskara, Piper TTS demo).

#### Layout

```
┌──────────────────────────────────────────────────┐
│  🧹 Txukun                                         │
│  Euskarazko testuaren maiuskulak eta               │
│  puntuazioa zuzentzen ditu                         │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Sarrera (input)                               │  │
│  │  kaixo egun on guztioi                        │  │
│  │  faktoria e i te beko irratian entzuten       │  │
│  │  da                                           │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  [🔄 Zuzendu / Clean]  [⚡ Denbora errealean]     │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Emaitza (output)                              │  │
│  │  Kaixo, egun on guztioi.                      │  │
│  │  Faktoria EiTBko irratian entzuten da.        │  │
│  │                               [📋 Kopiatu]    │  │
│  │                               [⬇ Deskargatu] │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ⚡ Eredua deskargatzen: ████████░░ 80%           │
│  🤖 HiTZ/cap-punct-eu · MarianMT · ~39MB          │
│                                                    │
│  ────────────────────────────────────────────     │
│  📋 Adibideak (examples)                          │
│  📖 Nola erabili                                   │
│  🔗 Parakeet-eu ASR → Txukun                     │
│                                                    │
│  [Euskara ▼]                                      │
└──────────────────────────────────────────────────┘
```

#### Features (Phase 1)

1. Text input — large textarea for pasting raw text
2. "Clean" button — one-click restoration
3. Real-time toggle — process on every keystroke (debounced, like nongoeuskara)
4. Batch mode — process multiple sentences/lines at once
5. Copy button — copy corrected text to clipboard
6. Download — download as .txt
7. Model status indicator — download progress bar, ready state
8. Pre-loaded examples showing before/after
9. Diff view — toggle to show changes highlighted
10. Basque-first i18n (UI in Basque by default)
11. Language switcher (EU/EN/ES/FR)
12. Mobile responsive

#### Desktop-mode enhancement: Input/Output side by side

```
┌──────────────────────────────────────────────────┐
│  🧹 Txukun                                         │
│                                                    │
│  ┌── Sarrera ──────┐  ┌── Emaitza ─────────────┐  │
│  │ kaixo egun on    │  │ Kaixo, egun on guztioi. │  │
│  │ guztioi          │  │                         │  │
│  │                  │  │                         │  │
│  │ faktoria e i te  │  │ Faktoria EiTBko        │  │
│  │ beko irratian    │  │ irratian entzuten da.  │  │
│  │ entzuten da      │  │                         │  │
│  └──────────────────┘  └─────────────────────────┘  │
│                                                    │
│  [🔄 Zuzendu]  [📋 Kopiatu]  [⚡ Real-time: ON]   │
└──────────────────────────────────────────────────┘
```

---

## 3. Phase 2: Full Text Correction Suite

### 3.1 Spell Checking — Basque Hunspell in the Browser

#### The Xuxen Dictionary

Xuxen is the established Basque spell checker developed by Elhuyar and IXA group (UPV/EHU):
- **Type**: Hunspell-based dictionary
- **Website**: https://xuxen.eus
- **Entries**: ~85,000 Basque words
- **License**: GPL-2.0
- **Available as**: Hunspell `.aff` + `.dic` files
- **Packaged in**: [`wooorm/dictionaries/dictionaries/eu`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/eu) (npm: `dictionary-eu`)
- **Debian package**: `hunspell-eu`

#### Browser Implementation

**Option A: hunspell-asm** (WASM Hunspell)
- Package: `hunspell-asm` (npm, 73 stars)
- GitHub: https://github.com/kwonoj/hunspell-asm
- License: MIT
- Provides full Hunspell spell checker compiled to WebAssembly
- Supports: `spell()`, `suggest()`, `addWord()`, `addDictionary()`
- Size: WASM binary is small (~300KB), dictionary files are ~1-2 MB (compressed)

```javascript
import { loadModule } from 'hunspell-asm';

const hunspellFactory = await loadModule();

// Load Basque dictionary (aff + dic)
const affBuffer = await fetch('/dicts/eu.aff').then(r => r.arrayBuffer());
const dicBuffer = await fetch('/dicts/eu.dic').then(r => r.arrayBuffer());

const affPath = hunspellFactory.mountBuffer(new Uint8Array(affBuffer), 'eu.aff');
const dicPath = hunspellFactory.mountBuffer(new Uint8Array(dicBuffer), 'eu.dic');

const spellchecker = hunspellFactory.create(affPath, dicPath);

// Check spelling
spellchecker.spell('kaixo');   // → true
spellchecker.spell('kaixoo');  // → false

// Get suggestions
spellchecker.suggest('kaixoo'); // → ['kaixo', 'kaiku', ...]
```

**Option B: nspell** (Pure JS Hunspell-compatible)
- Package: `nspell` (npm, by wooorm)
- GitHub: https://github.com/wooorm/nspell
- Pure JavaScript, no WASM dependency
- Slower than WASM but simpler to bundle
- Size: ~15KB for the library + ~1-2 MB for dictionary

```javascript
import nspell from 'nspell';
import eu from 'dictionary-eu';

const spell = nspell(eu);
spell.correct('kaixo');  // → true
spell.correct('kaixoo'); // → false
```

**Recommendation**: Use **hunspell-asm** (Option A). It's faster (native Hunspell compiled to WASM), supports suggestions, and the ~300KB overhead is negligible. The dictionary files (`dictionary-eu` npm package) are ~1.2 MB.

#### Integration with UI

After cap+punct restoration, run spell check:
1. Tokenize corrected text into words
2. Run each word through Hunspell
3. Underline misspelled words in red (like a word processor)
4. On hover/click, show suggestions
5. "Apply all" button to accept spell corrections

### 3.2 Grammatical Error Correction (GEC)

#### Existing Work

**Academic research:**
- "Grammatical Error Correction for Basque through a seq2seq neural architecture and synthetic examples" (Beloki et al., SEPLN 2020, 8 citations)
- Orai NLP has listed "grammar checkers" as an application for their Llama-eus/Kimu models
- The approach: seq2seq model trained on synthetic error data (inject grammatical errors into correct text)

**But: No publicly available GEC model for Basque on HuggingFace** ❌

No existing open-source Basque GEC model was found. The 2020 paper describes the approach but the model weights are not published.

#### Options for Phase 2 GEC

**Option A: LLM-based (easiest, requires server)**
Use a small Basque LLM with a well-crafted prompt:

```python
prompt = """Zuzendu testu honetako akats gramatikalak. 
Ez aldatu edukia, soilik gramatika akatsak zuzendu.

Testua: {input_text}
Testu zuzendua:"""
```

Models to try:
- `itzune/kimu` (~2B params, Ollama-ready) — already in Itzune's ecosystem
- `orai-nlp/Gemma-Kimu-2b-it` (3B params)
- `HiTZ/Latxa-Qwen3.5-2B` (2B params, latest)

This requires a server-side component (not browser WASM). Could be a free Hugging Face Space or a lightweight API.

**Option B: Train a GEC-specific seq2seq model (best, most effort)**
Train a small T5/Marian model specifically for Basque GEC:
1. Obtain correct Basque text corpus (EusCrawl, Berria, Wikipedia, etc.)
2. Generate synthetic errors using Basque-specific error patterns:
   - Case/ergative errors (subject vs object confusion)
   - Verb agreement errors (Nor-Nori-Nork)
   - Article/definiteness errors
   - Postposition errors
   - Code-switching errors (Spanish/Basque mixing)
   - Declension errors (Basque has 14+ cases)
3. Train a small Marian or T5 model on the synthetic parallel data
4. Convert to ONNX for browser deployment

The 2020 Beloki paper used this approach with a Transformer base architecture and achieved promising results. The key insight is that for Basque GEC, synthetic data generation needs to be tailored to Basque-specific error types (especially ergative case and complex verb agreement patterns).

**Option C: Rule-based (complementary)**
Basque morphology is highly regular (agglutinative). Many errors can be caught with:
- Morphological analysis (Morfeus+, already available in IXA-pipes)
- Declension pattern checking
- Verb agreement validation (subject/object/number agreement)

This could be a lightweight pure-JS addition that catches systematic errors.

### 3.3 Complete Phase 2 Pipeline

```
Input text (raw/lowercase)
    │
    ▼
[Step 1] Cap+Punct restoration (Marian ONNX, client-side)
    │
    ▼
[Step 2] Spell check (Hunspell WASM, client-side)
    │
    ▼
[Step 3] GEC (LLM server-side, or trained ONNX model)
    │
    ▼
Output: clean, publishable Basque text
```

#### Phase 2 UI additions

```
┌──────────────────────────────────────────────────────┐
│  🧹 Txukun — Testu zuzentzailea                       │
│                                                        │
│  ┌── Sarrera ──────────┐  ┌── Emaitza ─────────────┐  │
│  │ nere jaio urtea      │  │ Nire jaiotze-urtea     │  │
│  │ mila bederatzihun    │  │ 1996 da.               │  │
│  │ eta larogei ta       │  │                        │  │
│  │ amasei da            │  │                        │  │
│  └──────────────────────┘  └────────────────────────┘  │
│                                                        │
│  ┌── Zuzenketak (corrections) ─────────────────────┐  │
│  │ 🔴 okerra: "nere"     → Nire (ortografia)        │  │
│  │ 🔴 okerra: "jaio"     → jaiotze- (gramatika)     │  │
│  │ 🟡 zuzenketa: "mila bederatzihun..." → 1996     │  │
│  │ 🟢 maiuskula: hasierako letra larria             │  │
│  │ 🟢 puntuazioa: puntua amaieran                   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  [🔄 Zuzendu dena] [📋 Kopiatu] [⬇ Deskargatu]       │
│                                                        │
│  ─────────────────────────────────────────────────     │
│  Funtzioak:                                           │
│  ✅ Maiuskulak eta puntuazioa (HiTZ/cap-punct-eu)     │
│  ✅ Ortografia (Xuxen/Hunspell)                       │
│  ⏳ Gramatika (LLM, laster)                           │
│  ⏳ Euskalki detekzioa (Zeineuski)                    │
└──────────────────────────────────────────────────────┘
```

Correction types with visual indicators:
- 🟢 Green = cap+punct (always correct, model-driven)
- 🟡 Yellow = spelling suggestions (user review recommended)
- 🔴 Red = grammar issues (requires user confirmation)

---

## 4. Technology Stack & Architecture

### Phase 1

| Layer | Technology | Size |
|---|---|---|
| Framework | Vite + vanilla JS | ~50KB |
| ML inference | `@huggingface/transformers` | ~200KB |
| ML runtime | ONNX Runtime Web (WASM) | bundled |
| Cap+Punct model | HiTZ/cap-punct-eu (q4 ONNX) | ~39 MB |
| Styling | Custom CSS / Tailwind | ~10KB |
| Deployment | GitHub Pages | free |

**Total page load (first visit):** ~40 MB (model download) + ~300KB (app code)
**Subsequent visits:** ~300KB (model cached by service worker)

### Phase 2 additions

| Layer | Technology | Size |
|---|---|---|
| Spell checker | `hunspell-asm` (WASM) | ~300KB |
| Spell dictionary | `dictionary-eu` (Xuxen) | ~1.2 MB |
| GEC (Option A) | Server API → LLM | N/A (server) |
| GEC (Option B) | ONNX seq2seq model | ~50-100 MB |
| Morph analysis | Pure JS rules or API | TBD |

---

## 5. Project Structure

```
txukun/
├── public/
│   ├── onnx/                  # Cap+Punct ONNX model files
│   │   ├── encoder_model.onnx
│   │   ├── decoder_model.onnx
│   │   └── decoder_with_past_model.onnx
│   ├── dicts/                 # Hunspell dictionary (Phase 2)
│   │   ├── eu.aff
│   │   └── eu.dic
│   └── favicon.svg
├── src/
│   ├── main.js                # Entry point, app initialization
│   ├── model.js               # Transformers.js model loading & inference
│   ├── spell.js               # Hunspell spell checker (Phase 2)
│   ├── grammar.js             # GEC integration (Phase 2)
│   ├── diff.js                # Diff/highlight changes
│   ├── i18n.js                # EU/EN/ES translations
│   ├── ui.js                  # DOM manipulation, event handling
│   └── style.css              # Styles
├── scripts/
│   ├── export-onnx.py         # Convert PyTorch → ONNX
│   ├── quantize-onnx.py       # Quantize ONNX model
│   └── download-dict.sh       # Download Basque Hunspell dict
├── index.html
├── package.json
├── vite.config.js
├── README.md
├── RESEARCH.md                # This file
└── .github/
    └── workflows/
        └── deploy.yml         # GitHub Pages deploy
```

---

## 6. Implementation Plan

### Phase 1: Cap+Punct MVP (target: 4-5 days)

#### Step 1.1 — Validation (Day 1)
- [ ] Clone `HiTZ/cap-punct-eu` and test Python inference
- [ ] Export model to ONNX with `optimum-cli`
- [ ] Test ONNX model in Transformers.js browser environment
- [ ] Test quantized versions (q8, q4) — measure quality vs size
- [ ] Measure inference latency in WASM and WebGPU
- [ ] Understand the in-house normalization requirements
- [ ] Decide: batch or per-sentence processing?

#### Step 1.2 — MVP Build (Days 2-3)
- [ ] Scaffold Vite project
- [ ] Basic HTML/CSS layout (input/output textareas)
- [ ] Model loading with progress indicator
- [ ] Inference integration (Transformers.js pipeline)
- [ ] "Clean" button with loading state
- [ ] Copy-to-clipboard button
- [ ] Example sentences (shown before model loads)
- [ ] Basque UI strings (i18n setup)
- [ ] Error handling (model load fail, inference fail)

#### Step 1.3 — Deploy & Polish (Days 4-5)
- [ ] Deploy to GitHub Pages via Actions
- [ ] Add project to `itzune.github.io/data/projects.json`
- [ ] Mobile responsive
- [ ] Service worker for model caching
- [ ] README + documentation
- [ ] Link from Parakeet-eu README
- [ ] Announce on Itzune social channels

### Phase A/B/C: Rule-based + neural hybrid (see §7.5)

#### Step A — "Txukun Lite" rule engine (pure JS, no model)
- [ ] Tokenizer / Document model (`core/tokenizer.js`)
- [ ] Pattern combinator library (`core/expr.js`: seq, word, anyOf, optional…)
- [ ] Lint/Edit types + applier + diff rendering (`core/edit.js`)
- [ ] First 20–30 Basque orthography rules (`core/rules/`): punct spacing, sentence-initial caps, doubled punctuation, repeated words, special-token artifacts
- [ ] Dictionary layer from hunspell-eu/Xuxen wordlist (`core/dictionary.js`)
- [ ] Edit-distance fuzzy spell suggestions

#### Step B — Neural fallback layer
- [ ] Scope MarianMT restorer to flagged spans only (skip model when rules suffice)
- [ ] Validator: reject model edits introducing out-of-vocabulary words
- [ ] Confidence routing: silent apply (rules) vs suggested cards (neural)

#### Step C — Editor integrations
- [ ] Browser extension prototype (model: Harper's extension architecture)
- [ ] Optional LSP service

### Phase 2: Full Correction Suite (target: 2-3 weeks, future)

#### Step 2.1 — Spell Check (Week 1)
- [ ] Integrate `dictionary-eu` + `hunspell-asm`
- [ ] Build word tokenizer for Basque
- [ ] Implement spell check overlay (red underlines)
- [ ] Implement suggestion popup
- [ ] "Apply all" spell corrections

#### Step 2.2 — GEC (Week 2)
- [ ] Set up LLM-based GEC API (HuggingFace Space with Kimu/Latxa)
- [ ] Wire up GEC step in the pipeline
- [ ] Add visual indicators for grammar corrections
- [ ] Add user confirmation flow for grammar changes

#### Step 2.3 — Integration & Polish (Week 3)
- [ ] Visual diff view with correction categories
- [ ] Download report (list all corrections made)
- [ ] Integration with Zeineuski (dialect info in output)
- [ ] Browser extension prototype
- [ ] Performance optimization

---

## 7. Risks & Unknowns

### Phase 1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Transformers.js MarianMT issues with this specific model | High | Test early. Fallback: HF Inference API (server-side). |
| ONNX export produces broken decoder_with_past | Medium | Test with full pipeline; try different export flags |
| q4 quantization degrades Basque output quality | Medium | Test q8 first (77MB still acceptable). Compare outputs. |
| Normalization mismatch (in-house tool not available) | Medium | Test with raw text vs normalized text. Document what normalization does. |
| WASM inference too slow for real-time mode | Low-Medium | Limit to batch mode first; add real-time later. Test WebGPU. |

### Phase 2 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No existing Basque GEC model | High | Use LLM approach (prompt engineering). Accept server-side dependency. |
| LLM-based GEC is slow/expensive | Medium | Use tiny model (Kimu-2B). Cache results. Show progress. |
| Hunspell Basque dict doesn't cover modern vocabulary | Low | Add custom words. Accept some false negatives. |
| GEC quality not production-ready | Medium | Set expectations. Show GEC as "beta". Require user review. |

### Open Questions

1. **Normalization requirements** — The cap-punct model was trained with an in-house normalization tool. What exactly does it do? Key examples from the model card show number-to-digit conversion (spelled-out numbers → digits) and URL expansion. We need to investigate if this is critical or if the model generalizes to non-normalized input.

2. **Transformers.js MarianMT export with SentencePiece** — The model uses separate `source.spm` and `target.spm` files (not a shared tokenizer). Transformers.js may need the tokenizer files alongside the ONNX model. Test early.

3. **ONNX model hosting** — Options:
   - HuggingFace Hub (transformers.js auto-downloads from HF)
   - GitHub Pages (static file serving, need LFS or separate CDN)
   - CDN (jsDelivr from npm, or direct)
   - **Recommendation**: Let Transformers.js download from HF Hub automatically. Upload ONNX files to HF under `itzune/txukun-cap-punct-onnx`. This gives free CDN-backed hosting and versioning.

4. **Sentence segmentation** — For batch/paragraph input, we need to split into sentences before running the model. Basque uses `.` `!` `?` as sentence boundaries. For ASR output, there's no punctuation at all, so we need either:
   - Process the entire input as a single sequence (model's max_length is 512 tokens)
   - Use a sentence segmentation heuristic (line breaks, pauses)
   - Use the model's own generation to find sentence boundaries

5. **WebGPU support** — Transformers.js supports WebGPU for faster inference. This is still experimental in many browsers. Test on Chrome Canary with WebGPU flag.

---

## 7.5 Harper — Reference Architecture for a Rule-Based + Neural Hybrid

> Study of https://github.com/automattic/harper (Apache-2.0, inspected 2026 from local clone at `/tmp/harper`).
> Motivation: convert Txukun into a generic rule-based spell/grammar checker with smart autocorrection powered by neural models.

### What Harper is

A privacy-first **grammar & spell checker** written in Rust, delivered via WASM to editors (VS Code, Obsidian, Zed, Chrome, WordPress). Suggests in ~10 ms because it is **fully deterministic** — no neural inference at runtime. English-only today.

### Harper's pipeline

```
Text → Parser → Document (typed tokens) → Brill POS tagger → ~333 lint rules → Lint/Edit suggestions
```

| Component | Crate | Idea worth stealing |
|---|---|---|
| Token/document model | `harper-core/src/document.rs` | Parse text once into typed tokens (`Word`, `Punctuation`, `Space`, `Newline`) with spans; all rules operate on tokens, never raw-string regex |
| Pattern combinators | `harper-core/src/expr/` | Rules built declaratively: `SequenceExpr`, `SimilarToPhrase`, `Optional`, `FirstMatchOf`… each lint is one small module |
| Dictionary as data | `harper-core/dictionary.dict` (~54k words) + `spell/rune/` | Hunspell-style affix expansion (prefix/suffix + conditions) compiles a lemma list into inflected forms; FST lookup; rich metadata (POS, dialects) per word |
| Fuzzy spell suggest | `harper-core/src/edit_distance.rs` | Edit-distance ranking over dictionary for "did you mean" |
| POS tagging | `harper-brill` | Brill tagger/chunker, pre-trained models stored as JSON — cheap, offline-trainable |
| Delivery | `harper-wasm` → `packages/harper.js` → editor plugins | Same browser-local philosophy as Txukun's Transformers.js stack |

### Key insight: layered confidence

Harper separates **detection** (lint) from **correction** (structured `Edit` with span). Txukun's hybrid version:

```
Text → Tokenizer/Document → [Rule engine]  → high-confidence fixes (apply silently)
                           → [Neural model] → low-confidence/semantic fixes (suggest)
                           → [Validator]   → reject model edits producing OOV words
```

Benefits vs current Txukun design:
- Most inputs never touch the slow model (~1 s MarianMT); rules are instant
- Neural model becomes just another "linter" backed by inference, invoked only on flagged spans
- Model outputs validated against dictionary/rules before applying (hallucination guard)
- Project no longer blocked on ML improvements — rule layer ships value independently

### Adaptation to Basque — feasibility notes

- The ~333 English rules do NOT transfer; write **20–30 high-value Basque rules first**: punctuation spacing, sentence-initial capitals, doubled punctuation/repeated words, `<unk>` artifacts, common ASR errors
- Hunspell-style affix engine is too rigid for Basque agglutination long-term; start with a flat lemma list seeded from **hunspell-eu / Xuxen** (openly licensed) + edit-distance fuzzy matching
- No in-repo Basque Brill tagger exists; optional later step using `harper-pos-utils` training code or BERTeus-based tagger
- Implement rule engine in **plain JS** (not Rust/WASM): single codebase, instant iteration; a ~200-line tokenizer + small expr combinator library suffices

### Proposed Txukun v2 module layout

```
src/
  core/
    tokenizer.js      # Document model (tokens + spans)
    expr.js           # pattern combinators (seq, word, anyOf…)
    edit.js           # Lint/Edit types, applier, diff rendering
    rules/            # one file per Basque rule
    dictionary.js     # hunspell-eu-derived lookup + fuzzy suggest
  neural/
    restorer.js       # existing cap-punct pipeline, now span-scoped & optional
    validator.js      # checks model output against dictionary/rules
```

### Phasing

1. **Phase A ("Txukun Lite")**: tokenizer + expr system + 20–30 rules + hunspell-eu dictionary with fuzzy suggest — pure JS, no model download
2. **Phase B**: neural restorer re-integrated as fallback layer, scoped to flagged spans only, output validated
3. **Phase C**: editor integrations (browser extension or LSP), following Harper's delivery model

---

## 7.6 Field Survey 2026 — Grammarly, LanguageTool, and the State of GEC

> Research snapshot (2026). Sources: system-design write-ups of Grammarly's architecture, ACL Anthology (LoResLM 2026, BEA 2026), LanguageTool dev docs, Harper COMPARISON.md.

### The three generations of grammar correction

| Generation | Approach | Examples | 2026 status |
|---|---|---|---|
| Gen 1 | Hand-written rules + dictionaries | LanguageTool, Harper, Xuxen | Alive; unbeatable latency (<10 ms), privacy, explainability. Best for orthography/typos |
| Gen 2 | Specialized neural seq2seq / token-tagging (GECToR, MarianMT-style) | Txukun cap-punct model | Displaced for high-resource languages, but **still SOTA-class for low-resource languages** |
| Gen 3 | LLM prompting / fine-tuned small LLMs, multi-stage agents | Grammarly's new stack, XGEC, agent frameworks | Dominant research direction; issues: cost, latency, over-editing/hallucination |

### Key 2026 research signals

- **LLMs win on quality but lose on minimal-edit discipline** — they rewrite too much. Active work: "adapting LLMs for minimal-edit GEC", explainable/joint detect+correct models (XGEC).
- **Multi-stage LLM agent pipelines** (detect → explain → correct → verify) are the trendy architecture — mirrors the rule-first-then-neural layering planned for Txukun (§7.5).
- **Low-resource finding (LoResLM 2026, Zarma/Bambara study)**: rule-based vs MT vs LLM comparison → **MT-based approach (M2M100) won decisively** (95.8% detection rate); rules handled only spelling; small LLMs (Gemma-2B, mT5-small) were mediocre. Lesson: seq2seq/MT fine-tuning is the right paradigm for Basque; the bottleneck is training data, not architecture.
- **BEA 2026 shared task**: winning recipes rely on careful synthetic error generation + fine-tuning smaller models rather than raw LLM prompting.

### Why Grammarly is popular (~20% tech, ~80% product)

1. **Distribution everywhere**: browser extension injecting into every textarea + Word, desktop, mobile keyboards — meets users where they already write.
2. **Freemium funnel**: free tier catches enough to feel magical; underline-in-place UX builds habit within days.
3. **Confidence-tiered suggestions**: correctness (high confidence) vs clarity/tone/style (advisory cards) — never blurs "error" vs "could be better". Same conceptual split as our rule-layer vs neural-layer.
4. **Hybrid pipeline**: fast deterministic checks instantly; heavier neural models server-side within a <200 ms budget; graceful degradation to simpler checks when heavy models fail. Two-stage neural design (error detector + corrector), not blind regeneration.
5. **Trust framing**: privacy marketing, enterprise compliance.
6. **2025–2026 pivot**: acquired Coda and Superhuman; rebranded as **Superhuman** — moving from grammar checker to agentic AI writing platform. Grammar-checking itself became a loss leader.

### Other reference projects

- **LanguageTool** (LGPL): closest analog for a community-driven multilingual checker — XML rules in 30+ languages plus optional **n-gram data rules** ("does this trigram ever occur in real text?") as a cheap statistical layer between rules and neural nets. Its web UI for non-coder rule authors is a proven community-scaling mechanism.
- **Harper**: WASM/local-first delivery + expr-combinator rule system (see §7.5).
- **GECToR lineage**: token-labeling GEC — faster than seq2seq, minimal edits by construction. Already explored via `gector-eus`.
- **XGEC / multi-stage agents**: joint detection + explanation + correction; the "explain why" UX increases trust and doubles as a language-learning tool — strong differentiator for a minority language.

### Implications for Txukun

1. The hybrid rules + neural plan (§7.5) matches both Grammarly's production design and the 2026 research consensus. Phase A validated as first move.
2. If MarianMT plateaus, consider an **M2M100-class multilingual backbone** fine-tuned for Basque correction — best-in-class for low-resource settings.
3. Later, add a small **Basque n-gram naturalness layer** built from public corpora — nearly free at runtime, sits between rules and neural model.
4. **Explain suggestions** (short reason per fix) — trust + learning value for Basque writers.
5. **Distribution niche Grammarly can't touch**: ASR pipeline integration (Parakeet-eu/Whisper → Txukun) — paste-friendly API/bookmarklet for Basque speech-to-text users.

---

## 7.7 EBE — Agintaritza-erregela-iturriak (Euskara Batuaren Eskuliburua)

> Aurreko ataletako arau-kategoriak (§7.5 "common ASR errors", §7.6 inplikazioak) orain Euskaltzaindiaren **Euskara Batuaren Eskuliburua (EBE)** eranskinetan oinarrituta daude. Hiru atal oso jaitsi eta `docs/ebe-reference/`-n gorde dira iturri gisa, P0.2 golden case-ak eta P1 arauak lurreratzeko.

### Iturriak

| Fitxategia | EBE atala | Edukia |
|---|---|---|
| `ebe-punt.txt` | Puntuazio-markak (or. 467–477) | 12 ikurren arauak: puntua, koma, puntu eta koma, bi puntuak, etenpuntuak, galdera/harridura-markak, marra luzeak, parentesiak, elkarrizketa-marra, komatxoak, marratxoa, apostrofoa, zehar-marra. Komarik EZ jartzeko kasuak ere bai (subjektuaren eta aditzaren artean, adib.) |
| `ebe-kal.txt` | Kalko desegoki nabarmen batzuk (or. 501–510) | Erderatik ekarritako akats lexiko-semantikoak + morfosintaktikoak (izen-sintagma, aditza, perpausa). *Forma okerra → forma zuzena* formatuan. Arau-deterministen iturri nagusia |
| `ebe-zal.txt` | Zalantza eragiten duten zenbait hitz (or. 479–490) | Hiztegiaren gomendioak: *ahalbidetu* (ez ahalderatu), *ahots* (ez abots), *abortu* (ez aborto). XUXEN estiloko ordezkapen-zerrenda kanonikoa |

### Egiaztatutako baieztapenak (aurreko bertsioetako zuzenketak)

1. **Maiuskulak ≠ ingeles/gaztelania** (EBE *Maiuskulak*, id=1023). Maiuskulaz soilik: izen bereziak (pertsona, leku, erakunde, jaiegun, astro leku-izen gisa), esaldi-hasiera, siglak, eta `.`/`?`/`!`/`…` ondoren. **Minuskulaz:** egunak (*astelehena*), hilabeteak (*urtarrila*), nazionalitate/hizkuntza-izenlagunak (*euskal*, *ingeles*), urtaroak. Erakundeak partzialki — *Donostiako Udala* baina *Gipuzkoako udaletan*; *Filosofiako Fakultatea* baina *gure fakultatean*. Jaiegunak maiuskulaz (*Aste Santua*, *Aberri Eguna*). Astroak leku-izen gisa: *Lurra, Eguzkia, Artizarra, Marte*.

2. **Hitz-ordena: SOV neutroa, baina ez akatsa** (Euskaltzaindiaren Gramatika, 41. kap.). Marko teorikoa "informazio-egitura/galdegaia" da, ez "pragma". AUX-amaieran heuristikoa mingarria da — galdegaia perpausaren hasieran dagoenean ordena ez-neutroa da baina zuzena. → `style` iradokizun gisa soilik, konfiantza baxuz (ikus `TODO.md` P4).

3. **Kalkoak = arau-iturri nagusia** (ez ingeles-zentrikoko kategoriak). EBEk *forma oker→zuzen* zerrenda kanonikoa ematen du: `*Nekatuta naiz → Nekatuta nago` (partizipioa atribuzioan), `*pena merezi → merezi`, `*ospatu bilera → bilera egin`, `*Ere daude → ...ere badaude` (lokailu-posizioa), pasibo okerrak (`*Poliziagatik atxilotua izan zen → Poliziak atxilotu zuen`), `*dagoeneko → honezkero`. Hauek P1 arauen oinarria dira.

### Ezabatutako baieztapen egiaztatu gabekoak

- ~~`onek→honek`~~ eta ~~`hau→au`~~ "akats arrunt" gisa: **EZ egiaztatua EBEn.** `honek` `hau`-ren ergatiboa da (deklinabide-zuzenketa egokia, ez akatsa); `au` ez da Batua-ko forma independente estandarra. `gector-eus/TODO.md`-eko espekulazioak ziren; orain EBEren kalkoetan oinarritutako arauetan ordezkatuak (`TODO.md` P1, P4).

### Lotutako baliabideak (n-gram geruza, P4)

- EBE eranskina PDF osoa: `https://www.euskaltzaindia.eus/components/com_ebe/pdf/EBE-eranskinak.pdf` (106 or.)
- Maiuskulak sarrera (HTML): `https://www.euskaltzaindia.eus/component/ebe?view=bilaketa&Itemid=1161&task=bilaketa&id=1023`
- Gramatika 41. kap. (hitzen ordena): `https://www.euskaltzaindia.eus/index.php?option=com_liburuak&ItemId=1765&task=gramatika&lang=eu&kodea=41`
- Euskararen Erreferentzia Corpusa / Lexikoaren Behatokia / XX. mendeko Corpus Estatistikoa — n-gram geruza naturalerako (P4); Euskaltzaindiak kudeatuta

---

## 8. References

### Phase 1: Cap+Punct

- **Model**: https://huggingface.co/HiTZ/cap-punct-eu
- **Cap&Punct collection**: https://huggingface.co/collections/HiTZ/cap-and-punct
- **Transformers.js docs**: https://huggingface.co/docs/transformers.js
- **MarianMT support in TF.js**: https://github.com/huggingface/transformers.js/issues/63
- **ONNX export**: https://huggingface.co/docs/optimum/en/exporters/onnx/usage_guides/export_a_model
- **ONNX quantization**: https://huggingface.co/docs/optimum/en/concept_guides/quantization

### Phase 2: Spell Check

- **Xuxen website**: https://xuxen.eus
- **dictionary-eu (npm)**: https://github.com/wooorm/dictionaries/tree/main/dictionaries/eu
- **hunspell-asm**: https://github.com/kwonoj/hunspell-asm
- **nspell**: https://github.com/wooorm/nspell
- **Xuxen paper**: "XUXEN: A Spelling Checker/Corrector for Basque Based on Two-Level Morphology" (Agirre et al., 1992)

### Phase 2: Grammar Correction

- **GEC paper**: "Grammatical Error Correction for Basque through a seq2seq neural architecture and synthetic examples" (Beloki et al., SEPLN 2020)
  - PDF: https://www.orai.eus/sites/default/files/publicaciones/2022-11/GEC-sepln2020-6271-5709-1-PB.pdf
  - 8 citations
- **Error generation thesis**: "Error Generation for a Grammar Checker in Basque" (Méndez Amuchategui, 2023, UPV/EHU)
- **Orai NLP models**: https://huggingface.co/orai-nlp (Llama-eus, Gemma-Kimu)
- **Grammar checker as Orai application**: https://www.orai.eus/en/news/new-neural-model-artificial-intelligence-basque

### Itzune Integration

- **Parakeet-eu**: https://github.com/itzune/parakeet-eu
- **Nongoeuskara** (reference pattern): https://github.com/itzune/nongoeuskara
- **Piper TTS demo** (reference pattern): https://github.com/itzune/basque-piper-tts
- **Website projects**: https://github.com/itzune/itzune.github.io
- **Website data**: https://github.com/itzune/itzune.github.io/blob/main/data/projects.json

---

## 9. Quick Start

```bash
# === Phase 1: Cap+Punct ===

# 1. Clone and test model
git clone https://huggingface.co/HiTZ/cap-punct-eu

pip install torch transformers sentencepiece
python -c "
from transformers import pipeline
pipe = pipeline('translation', model='./cap-punct-eu')
result = pipe(['kaixo egun on guztioi'])
print(result)  # → [{'translation_text': 'Kaixo, egun on guztioi.'}]
"

# 2. Export to ONNX
pip install optimum[onnxruntime]
optimum-cli export onnx \
  --model ./cap-punct-eu \
  --task translation \
  --device cpu \
  onnx-export/

# 3. Test ONNX in Python
python -c "
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoTokenizer

model = ORTModelForSeq2SeqLM.from_pretrained('./onnx-export/')
tokenizer = AutoTokenizer.from_pretrained('./cap-punct-eu')

onnx_pipe = pipeline('translation', model=model, tokenizer=tokenizer)
print(onnx_pipe('kaixo egun on guztioi'))
"

# 4. Create web project
npm create vite@latest txukun -- --template vanilla
cd txukun
npm install @huggingface/transformers

# === Phase 2: Spell Check (future) ===
# npm install hunspell-asm dictionary-eu
```

---

*This research was conducted on 2026-06-28 by analyzing HiTZ's cap-punct-eu model, Xuxen/Basque Hunspell ecosystem, Transformers.js MarianMT support, existing Basque GEC literature, and Itzune's project patterns. §7.5–7.8 added 2026-08-25 during the P0→P1 revival.*

---

## 7.8 Harper — Implementation-level design read (P1 foundation)

*A focused read of `harper-core` source (`/tmp/harper`) to decide what to steal for Txukun's `src/core/` rule engine. Conducted 2026-08-25 before P1 implementation. Reads: `token.rs`, `span.rs`, `document.rs`, `linting/{lint,suggestion,lint_kind,expr_linter,mod}.rs`, `expr/mod.rs`, `expr/sequence_expr.rs`, `linting/sentence_capitalization.rs`, `weir/mod.rs`.*

### The data model (4 types)

Harper's entire core is four small types:

```rust
// span.rs — a window in a char sequence (end-exclusive)
struct Span<T> { start: usize, end: usize }   // covers start..end, not start..=end

// token.rs — a parsed component of a Document
struct Token { span: Span<char>, kind: TokenKind }  // kind = Word|Punctuation|Whitespace(+metadata)

// document.rs — lexed + parsed text
struct Document { source: Lrc<[char]>, tokens: Vec<Token> }  // source is a char buffer, not String

// lint.rs — an error found in text (pure data)
struct Lint {
  span: Span<char>,                    // where in source
  lint_kind: LintKind,                  // category (for UI)
  suggestions: Vec<Suggestion>,         // zero or more fixes
  message: String,                      // user-facing description
  priority: u8,                         // lower = more important
}
```

Key insight: **text is a `Vec<char>`, not a `String`.** Tokens are spans (offsets) into that buffer. This makes edits cheap (mutate the buffer) and offsets stable within a pass.

### The edit model (tiny — 3 variants)

```rust
// suggestion.rs
enum Suggestion {
  ReplaceWith(Vec<char>),   // replace span content with these chars
  InsertAfter(Vec<char>),   // insert these chars after the span
  Remove,                   // delete the span
}
```

`Suggestion::apply(span, &mut Vec<char>)` mutates the char buffer in place. That's the entire edit vocabulary — three cases, one method. Complete and minimal.

`LintKind` is a ~22-variant category enum (Capitalization, Punctuation, Spelling, WordChoice, WordOrder, Style, Repetition, BoundaryError, Eggcorn, Malapropism…). Used for UI grouping/coloring, not logic.

### The rule interface (two layers)

**Low-level — `Linter` trait** (for structural rules):
```rust
trait Linter {
  fn lint(&mut self, document: &Document) -> Vec<Lint>;
  fn description(&self) -> &str;
}
```
Two methods. Full freedom — iterate the document however you want, return lints. `sentence_capitalization.rs` uses this (it's structural: "first word of each sentence", not a pattern).

**High-level — `ExprLinter` trait** (for pattern rules):
```rust
trait ExprLinter {
  type Unit: DocumentIterator;   // Chunk (clause) or Sentence
  fn expr(&self) -> &dyn Expr;   // the pattern to match
  fn match_to_lint(&self, matched: &[Token], source: &[char]) -> Option<Lint>;  // transform → lint
  fn description(&self) -> &str;
}
```
A blanket impl turns `ExprLinter` into `Linter`: iterate chunks/sentences, run the expr matcher at each cursor, call `match_to_lint` for each match.

### The pattern combinators (`Expr`)

```rust
trait Expr {
  fn run(&self, cursor: usize, tokens: &[Token], source: &[char]) -> Option<Span<Token>>;
}
```
At a cursor position, does this pattern match? Returns the matched window. Combinators: `SequenceExpr` (fluent `then_*` builder), `Optional`, `Repeating`, `FirstMatchOf`, `LongestMatchOf`, `UnlessStep`, `FixedPhrase`, `AnchorStart`/`AnchorEnd`, `Filter`, `Not`, `SpaceOrHyphen`. Navigation via `TokenStringExt`: `iter_sentences()`, `iter_chunks()` (clause between commas), `iter_words()`, `first_non_whitespace()`.

This is the `seq`/`word`/`anyOf`/`optional` vocabulary `TODO.md` references.

### The application model (iterative re-lint)

Harper does **not** apply all lints at once with offset bookkeeping. Instead (`weir/mod.rs:transform_to_expected`):

1. Apply the *first* lint's first suggestion → `Suggestion::apply(span, &mut chars)`
2. Re-tokenize the new text → new `Document`
3. Re-lint → new `Vec<Lint>`
4. Repeat (BFS, depth ≤ `MAX_SUGGESTION_TRANSFORMATION_DEPTH` = 100)

Simple and correct (no offset-shift bugs), at the cost of O(passes × lint-cost). For <10ms / ~20 rules this is fine.

### What `sentence_capitalization.rs` reveals (the F1 analogue)

The Basque F1 failure ("etorri da gaur" → unchanged) maps directly to Harper's `SentenceCapitalization` linter. Reading it:

- **The happy path is 5 lines**: for each sentence, find `first_non_whitespace()`, if it's a lowercase word, emit `Lint { span, ReplaceWith(word_with_uppercase_first_char) }`.
- **The other 80 lines are exceptions**: proper nouns (`npm`), camelCase trademarks (`macOS`), lowercase proper nouns (`mRNA`). These all consult `dictionary.get_correct_capitalization_of()` + `metadata.is_proper_noun()` — **FST dictionary metadata we don't have.**
- **For Basque, the exceptions are different**: EBE Maiuskulak §1.1 says sentence-initial is *always* capitalized — `euskal`→`Euskal`, `astelehena`→`Astelehena` at sentence start (the lowercase rule is *mid-sentence*). Basque has no `npm`/`mRNA`-style lowercase-proper-nouns. **So our F1 rule needs no dictionary, no exceptions for batch 1** — just "uppercase the first alphabetic char of each segment." Simpler than Harper's.

### Decision: what to steal vs. skip for P1

**Steal (high value, low complexity):**
1. **`Lint` + `Suggestion` data model** — the 3-variant edit enum is exactly right (minimal, complete, proven). Map `LintKind` → EBE categories (Calque, Confusable, Capitalization, Punctuation).
2. **Span-based tokens** with end-exclusive `{start, end}` offsets (we already track offsets in `analyze.js`).
3. **`Linter` trait shape** → JS `Rule` interface: `lint(doc) => Lint[]` + `description`. Start with *only* this layer.
4. **Iterative apply** (one suggestion → re-tokenize → re-lint) — sidesteps all offset-shift bookkeeping.
5. **`LintKind` category enum** — for UI grouping + the eval harness (track per-category fix rates).

**Skip (YAGNI for batch 1 — 5–10 rules):**
1. **`ExprLinter` + `Expr` combinators** — a DSL needs ≥50 rules to pay off. A rule is just a function for now; add combinators only when a rule is painful to write imperatively.
2. **FST dictionary + per-word metadata** (`is_proper_noun`, `get_correct_capitalization_of`) — use small allowlists for the few exceptions that arise.
3. **Brill POS tagger** — no morphology needed for phrase/token-level EBE calques (batch 1). `is_full_sentence` (nominal+verb) is too English-POS-dependent; for Basque use a simpler heuristic or skip.
4. **`Markdown`/`PlainEnglish` parsers** — `analyze.js:stripMarkdown` already exists.
5. **`FatToken`** — a WASM-bridge serialization detail; not needed in-process.

### Implication for the P1 plan

The minimal `src/core/` engine is **4 small files**, not the 4 *systems* `TODO.md` originally listed:

| File | Harper analogue | What it is |
|---|---|---|
| `src/core/types.js` | `Lint` + `Suggestion` + `LintKind` | 3-type data model (≈30 lines) |
| `src/core/document.js` | `Document` + `Token` + `Span` | tokenize → `[{start,end,kind,text}]` (≈60 lines) |
| `src/core/engine.js` | `Linter` trait + iterative apply | `runRules(text, rules) → {corrected, lints}` (≈50 lines) |
| `src/core/rules/*.js` | `linting/*.rs` | one file per rule, each `export default { lint(doc), description }` |

**No `expr.js` for batch 1.** No `tokenizer.js` with POS tagging. The first rule (`sentenceInitialCap`) is ~15 lines and targets the 3 strict F1 failures (c001, c024, c043) — lifting the headline from 81.8% toward ~95% and proving the rule-layer thesis before any abstraction investment.

---

## 7.9 F4 — Esaldi-mugaren detekzioa (sentence-boundary detection)

Research conducted before implementing the `sentence-boundary` rule (P1 batch 2).
The question: in unpunctuated Basque ASR text, *when* is a boundary a sentence
break vs. a clause comma? This is a detection problem with false-positive risk,
unlike batch 1's mechanical rules.

### The two F4 failures are different problems

**c070** `"kaixo ni miren naiz atzo etorri nintzen"` — genuine multi-sentence.
The model outputs one flat sentence. The boundary after `naiz` (end of "I am
Miren") before `atzo` (yesterday) is invisible to the model.

**c071** `"etorri da joan da berriro etorriko da"` — **not a bug**. The golden
case expected periods, but the model's comma output is EBE-valid.

### Finding 1: EBE explicitly validates the c071 comma version

EBE puntuazioa §1, footnote 1 (line 28-34 of `docs/ebe-reference/ebe-punt.txt`)
defines *esaldia* (sentence) and gives this exact example:

> **alborakuntzaz:** Ezer ez daki; isilik dago. **Etorri da, jan du, joan da.**

EBE classifies "Etorri da, jan du, joan da." as a **single sentence** —
*perpaus elkartua → juntaduraz → alborakuntzaz* (asyndetic coordination: clauses
joined by commas without conjunctions). Our c071 pattern is identical. The
model's `Etorri da, joan da, berriro etorriko da.` is EBE-valid. **The golden
case's period expectation was too strict — corrected to the comma version.**

### Finding 2: UD `parataxis` agrees

Universal Dependencies `parataxis` relation
(https://universaldependencies.org/u/dep/parataxis.html):

> "The parataxis relation is used for a pair of what could have been standalone
> sentences, but which are being treated together as a single sentence. This may
> happen because... these clauses are joined by punctuation such as a colon or
> comma, or not delimited by punctuation at all."

Asyndetic clauses joined by commas = **one sentence** (first clause is head,
rest are `parataxis` dependents). Both EBE and UD agree.

### Finding 3: ixa-pipe-tok cannot segment unpunctuated text

IXA-pipes (the standard Basque NLP toolkit, https://ixa2.si.ehu.eus/ixa-pipes/)
provides `ixa-pipe-tok`, a "multilingual rule-based tokenizer and sentence
segmenter." But its sentence segmentation is **punctuation-based** — it splits
on `.!?` and only has rules to *prevent* false breaks (abbreviations,
non-breaking exceptions). It cannot detect boundaries in unpunctuated ASR text.
No off-the-shelf Basque unpunctuated-text segmenter exists. → We must build the
heuristic ourselves.

### Finding 4: The c070 detection signal — AUX + TEMPORAL + second AUX

Token analysis of c070:

| idx | token | role |
|---|---|---|
| 0 | kaixo | greeting |
| 1 | ni | pronoun (I) |
| 2 | miren | name |
| 3 | **naiz** | **AUX finite** (1sg present *izan*) |
| 4 | **atzo** | **TEMPORAL** (yesterday, past) |
| 5 | etorri | verb participle |
| 6 | **nintzen** | **AUX finite** (1sg past *izan*) |

In Basque SOV order, the finite auxiliary is clause-final. `naiz` ends the
clause "ni Miren naiz" (I am Miren, present). `atzo` (yesterday, past) begins a
new clause with its own past auxiliary `nintzen`. The tense shift
(present → past) is the semantic signal.

**Heuristic:** a bare finite auxiliary (AUX1) immediately followed by a temporal
adverb (TEMPORAL), where a second finite auxiliary (AUX2) appears later in the
same sentence → insert `.` after AUX1.

### Finding 5: The false-positive guard is essential

The naive signal "AUX + TEMPORAL → split" **over-splits**. Basque allows
post-positioned temporals:

> "etorri naiz gaur" = "I came today" — ONE sentence

Here `naiz`(AUX) + `gaur`(TEMPORAL) but no second auxiliary. The **second-AUX
guard** (require AUX2 to exist after the temporal) prevents this false split:
"etorri naiz gaur" has only one finite verb → no split. ✓

### Finding 6: Bare-auxiliary matching excludes subordinate clauses

Subordinate clauses suffix the auxiliary: `-la`/`-ela` (completive: "dela"),
`-lako` (causal: "delako"), `-arren` (concessive). These suffixed forms
("dela", "naizela") are **not** in the bare-form set, so exact-token match
excludes them. Only main-clause auxiliaries trigger. (No morphology analyzer
needed — the set membership test is sufficient.)

### Finding 7: Finite auxiliary paradigm verified

Full finite auxiliary paradigm (present + past, all persons, *izan*/*edun*/*egon*)
verified from Buber's Basque Page (https://www.buber.net/Basque/Euskara/lang.lt.php)
and Euskaltzaindia grammar. ~50 common bare forms. These are unambiguous as
standalone tokens (no overlap with nouns/adjectives). Synthetic lexical verbs
(joan/etorri/ibili finite forms: noa, doa, nindoan…) are **excluded** from
batch 1 — only the auxiliaries izan/edun/egon, which are the reliable
clause-final markers.

### Finding 8: Asyndetic coordination (c071) is correctly NOT split

For c071 `etorri da joan da berriro etorriko da`: `da`(AUX1) is followed by
`joan` (a verb participle, **not** a temporal adverb). Condition 2 (AUX1 +
TEMPORAL) fails → no split. This is correct: EBE says it's one sentence. The
commas come from the model, not the rules.

### Architecture: no pipeline change needed

The `sentence-boundary` rule fits the existing rule engine as a 5th rule
(priority 20, runs before cap=30 / comma=35 / punct=40). The iterative re-lint
model cascades naturally:

1. `sentence-boundary` inserts `.` after AUX1 → "kaixo ni miren naiz. atzo..."
2. `sentence-initial-cap` capitalizes "Atzo" (new sentence start)
3. `vocative-comma` adds comma after "Kaixo"
4. `terminal-punct` adds final `.`

No offset bookkeeping, no pipeline change. The split rule is ~120 lines
including the auxiliary/temporal sets.

### Result

- **c070** ✓ PASS — exact match `"Kaixo, ni Miren naiz. Atzo etorri nintzen."`
- **c071** ✓ PASS — golden corrected to EBE-valid comma version
- RULED all exact-match: 23/33 (69.7%) → **25/33 (75.8%)**
- Mean Levenshtein: 0.351 → **0.287**
- Strict: held at 22/22 (100%) — both fixed cases are `strict:false`
- **Zero regressions**

---

## 7.10 F2 — Agur-puntuazioa eta hitz anitzeko esapideak (greeting punctuation + multi-word phrases)

Research conducted before implementing the F2 batch (c060, c061). Two questions:
(1) do greetings take `!` or `.`? (2) how to detect multi-word greeting phrases
like "eskerrik asko"?

### Finding 1: EBE explicitly shows greetings take '!'

EBE puntuazioa §2.3 (bokatiboa, line 53-54):
> `Kaixo, Mikel! Kaixo, Mikel, zer moduz? Entzun, adiskideok, azken berriak.`

EBE §1 (line 29) — verbless sentences (aditzik gabea):
> `Bai edo Arratsalde on! edo Zorionak, Amaia!`

Both show greeting interjections taking `!`. EBE §6 (harridura-marka): `!` is for
exclamatory/interjection sentences.

### Finding 2: "Eskerrik asko" takes '.' (period), NOT '!'

This was the critical question — is c061's golden expectation (`.`) correct, or is
it another c071 (where the golden was wrong)?

**Verified correct.** Euskaltzaindia Buletina 2024 (the academy's own publication)
uses:
> `Eskerrik asko, Joxean, eman eta irakatsi diguzun guztiagatik. … Eskerrik asko.`

Both instances use period, not exclamation. "Eskerrik asko" is a **gratitude
expression** (declarative), not an interjection (exclamatory). The distinction:

| Category | Examples | Punctuation |
|---|---|---|
| Interjection greetings | kaixo, agur, gabon, egun on, arratsalde on | `!` |
| Gratitude expressions | eskerrik asko | `.` |

### Finding 3: Word-count heuristic distinguishes vocative from longer content

A subtlety: c060 (`kaixo mikel` → `Kaixo, Mikel!`) needs `!`, but c080
(`kaixo egun on guztioi` → `Kaixo, egun on guztioi.`) is **strict:true** and needs
`.`. Both start with "kaixo". How to distinguish?

The EBE distinction is **vocative** (direct address, short) vs. longer content:
- "Kaixo, Mikel!" = greeting + vocative NAME → `!`
- "Kaixo, egun on guztioi." = greeting + longer phrase → `.`

Without a gazetteer, we can't detect names. **Proxy heuristic**: greeting + ≤1 word
→ `!` (vocative name pattern); greeting + 2+ words → `.` (longer content).

Verified against all golden cases:
- c060: "kaixo mikel" — 1 word after greeting → `!` ✓
- c080: "kaixo egun on guztioi" — 3 words after greeting → `.` ✓ (preserved!)
- c070: "kaixo ni miren naiz…" — many words → `.` ✓

### Finding 4: The model adds wrong terminal punctuation (c060)

c060's model output is `Kaixo Mikel.` (capitalized, with period — but wrong mark).
The old terminal-punct rule only *inserted* missing punctuation; it skipped
sentences that already had terminal punct. To fix c060, the rule needed to
**replace** `.` with `!`.

Implemented: when the sentence ends with `.` but should be exclamatory (greeting +
≤1 word), `replaceWith('!')` replaces the period.

**`.` → `?` replacement is deferred** — risk: embedded questions like
"Zer egin duen ez dakit." (I don't know what (s)he did.) start with an interrogative
pronoun but are declarative. Replacing `.` with `?` would false-positive these.
Only `.` → `!` is safe (greetings + ≤1 word is a narrow, reliable signal).

### Finding 5: Shared greeting data module

Greeting sets are needed by two rules:
- `vocative-comma`: all greeting phrases (for comma insertion)
- `terminal-punct`: only exclamatory greetings (for `!` emission)

Created `src/core/rules/greetings.js` as a shared data module:
- `EXCLAMATORY_GREETINGS` (Set): {kaixo, agur, gabon} — single-word, take `!`
- `EXCLAMATORY_PHRASES` (Array): [egun on, arratsalde on, eguerdi on] — multi-word, take `!`
- `DECLARATIVE_PHRASES` (Array): [eskerrik asko] — takes `.`
- `ALL_GREETING_PHRASES`: concatenation (for comma insertion)

Note: "gabon gau" excluded — "gabon" alone already means "good night"; "gabon gau"
is redundant and would conflict with the single-word "gabon" check.

### Finding 6: "eskerrikasko" (one-word variant) exists but is rare

EBE zalantza-hittak (ebe-zal.txt, line 406): `eskerrikasko / eskerrik asko` — both
forms are accepted. The one-word form wouldn't be caught by the multi-word phrase
matcher. Deferred — the two-word form is far more common in practice.

### Result

- **c060** ✓ PASS — `Kaixo Mikel.` → comma inserted + `.` replaced with `!` → `Kaixo, Mikel!`
- **c061** ✓ PASS — `Eskerrik asko Miren.` → comma after "eskerrik asko" → `Eskerrik asko, Miren.`
- RULED all exact-match: 25/33 (75.8%) → **27/33 (81.8%)**
- Mean Levenshtein: 0.287 → **0.224**
- Strict: held at 22/22 (100%) — both fixed cases are `strict:false`
- **Zero regressions** (c080 strict:true preserved by the word-count heuristic)
