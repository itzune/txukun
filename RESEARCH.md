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

---

## 7.11 EBE arauak — eval-estrategia eta ASR-niche arriskua

Research conducted before reframing the P1 roadmap away from F3 (ASR normalization)
toward EBE calque/zalantza rules. Two questions: (1) do the existing eval harnesses
cover calque/zalantza errors? (2) is F3 (ASR normalization) the right next step?

### Finding 1: F3 cases are ASR-niche — a general-purpose writer never produces them

The three F3 failures, examined concretely:

| Case | Input | Expected | Who writes this? |
|---|---|---|---|
| c081 | `faktoria e i te beko irratian...` | `Faktoria EiTBko irratian...` | Only ASR spells out acronyms letter-by-letter |
| c082 | `...ehuneko berrogeita bikoa` | `...%42koa` | Only ASR verbalizes symbols |
| c083 | `...hitz puntu e hatxe u puntu eus...` | `...hitz.ehu.eus...` | Only ASR spells out URLs/punctuation |

A person typing normally writes `EiTB`, `%42`, `hitz.ehu.eus` directly. F3 rules
would **never fire** on general text — they're only useful as an ASR post-processor.
Building them into the core pipeline pulls txukun back toward "ASR cleaner" just as
v2.0.0 positioned it as a general-purpose writing tool (3-model Grammarly-style
architecture).

**Decision: demote F3 to an optional "ASR mode" (toggle, like the existing spell
toggle). Not core roadmap.** Could live behind `?asr=1` URL param. ASR remains a
valid use case — just not the headline pitch.

### Finding 2: EBE calques/zalantzak are general-purpose writer errors

The EBE **kalkoak** and **zalantza-hittak** are exactly the errors Basque *speakers*
make when writing — Spanish/French-influenced calques and doubtful word choices.
Verified from `docs/ebe-reference/ebe-kal.txt` and `ebe-zal.txt`:

- *Lexical calques*: `balore→balio` (Spanish "valores"), `*ideologia anitza→
  askotariko ideologia` ("ideología variada"), `*Egun berdinean→Egun berean`
  ("el mismo día")
- *Syntactic calques*: `*Euria dago→Euria ari du` ("está lloviendo"), `*Nekatuta
  naiz→Nekatuta nago` ("estoy cansado"), `*Poliziagatik atxilotua izan zen→
  Poliziak atxilotu zuen` (passive calque)
- *Zalantza-hittak*: `abots→ahots`, `aborto→abortu`, `ahalderatu→ahalbidetu`
  — Euskaltzaindiaren Hiztegiak explicitly says "don't use X, use Y"

These have **nothing to do with ASR** — they apply to any text a bilingual Basque
speaker writes. And they're authoritative (Euskaltzaindia's EBE), deterministic, and
high-confidence — perfect for the rule engine.

**Decision: promote EBE calque/zalantza rules to the main P1 next-step.** This
realigns txukun as Grammarly-for-Basque (catches real speaker errors) rather than
ASR post-processor (fixes machine artifacts).

### Finding 3: Elhuyar GEC benchmark does NOT cover calques/zalantzak

This was the key eval-strategy question. The existing `tests/gec-benchmark/`
contains the Elhuyar GEC corpus (Dea/Dem TSV files, ~6000 sentence pairs). I
examined the error-type distribution:

```
Dea_single (2000 pairs):  R2=1077, R4=615, R3=154, R1=154
Dem_single (manually revised, 250 pairs):  R2=118, R4=71, R3=25, R1=7
```

Inspecting examples of each R-code:

| Code | What it is | Example |
|---|---|---|
| R1 | Verb tense (synthetic morphology) | `etorriko zen→etortzen zen`, `egingo dute→egiten dute` |
| R2 | Case/agreement (auxiliary) | `gehitu behar zaio→gehitu behar dio`, `Titin da→Titin du` |
| R3 | Determiner/case (ergative) | `gehienek→gehienak`, `Roentgenek→Roentgenak` |
| R4 | Subordinator suffix | `zaidalako→zaidalaren`, `litekeena da→litekeela da` |

**All four R-codes are synthetic morphology errors** — verb tense, case agreement,
determiners, suffixes. These are exactly what GECToR (Tier 3) is trained to fix.
They are **NOT** lexical-choice errors (calques) or word-substitution errors
(zalantzak).

**Implication**: The Elhuyar benchmark cannot measure EBE calque/zalantza rules.
Those rules operate on a different error class (lexical selection, not inflection).
The benchmark would show zero improvement from adding calque rules, even if the
rules work perfectly — because its sentences don't contain calque errors.

### Finding 4: EBE itself is the golden set for calque/zalantza rules

The EBE reference files ARE the labeled dataset:
- `ebe-zal.txt`: each entry is a `(dispreferred form → recommended form)` pair,
  explicitly marked "ez erabili X, erabili Y" by Euskaltzaindiaren Hiztegiak
- `ebe-kal.txt`: each entry is a `(calque → correct form)` pair with the calque
  marked with `*`

**Eval strategy decided**:
1. **Zalantza + lexical calque rules** (batches 1–2): unit-test against the
   EBE pairs themselves. The rule's job is "given X, output Y" — testable as
   exact-match assertions extracted from ebe-zal.txt / ebe-kal.txt. ~30-50
   zalantza pairs + ~20-30 lexical calque pairs.
2. **Syntactic calque rules** (batch 3): these need sentence context
   (`*Nekatuta naiz` → `Nekatuta nago` — the rule must detect "naiz" after an
   adjective where "nago" is required). Create a small `tests/ebe-rules/cases.json`
   suite (10-15 sentences) extracted from EBE's own examples.

### Finding 5: Zalantza rules are the natural batch 1 — simplest, most deterministic

Among the EBE rule batches, zalantza-hittak are the lowest-risk starting point:
- **Word-level replacement** (no context needed): `abots` → `ahots` is a pure
  token substitution, no morphology, no syntax.
- **EBE provides exact pairs**: no interpretation needed — the rule data is
  extracted directly from the reference file.
- **High confidence**: Euskaltzaindiaren Hiztegiak explicitly recommends these.
- **Low false-positive risk**: the dispreferred forms are unambiguously wrong
  (not register-dependent like the "secondary" forms EBE marks in normal type).

Contrast with syntactic calques (batch 3): `*Nekatuta naiz` requires detecting
that "naiz" follows a participle-adjective where Basque uses "nago" (state-of-being
verb, not izan). That needs at minimum a part-of-speech heuristic — which triggers
the deferred `src/core/tokenizer.js` POS work (§7.8 decision: don't build POS until
a rule actually requires it).

### Summary of roadmap reframe

| | Before | After |
|---|---|---|
| Next P1 step | F3 ASR normalization (c081-c083) | EBE zalantza rules (batch 1) |
| Positioning | ASR post-processor | General-purpose Basque writing tool |
| Eval harness | cap-punct suite (ASR-flavored) | EBE pair unit-tests + small calque suite |
| F3 status | Core roadmap | Deferred to optional "ASR mode" toggle |

The cap-punct suite (33 cases, 100% strict) remains as a regression guard for the
existing rule layer. It is NOT the right harness for measuring new EBE rules, which
is why a separate eval strategy (Finding 4) is needed.

## 7.12 Zalantza-hitzak — erauzketa eta egiaztapena (EBE PDF color analysis)

**Date:** 2026-08-26
**Goal:** Extract the authoritative `(dispreferred → recommended)` word pairs
from Euskaltzaindia's *Zalantza eragiten duten zenbait hitz* (EBE appendix,
PDF pp. 479–490) and turn them into a deterministic, dictionary-driven
correction rule (`src/core/rules/zalantza-words.js`).

### Why this needed bespoke extraction (not the plain-text file)

`docs/ebe-reference/ebe-zal.txt` is a plain-text dump of the same section, but
the README already warns that **color information is lost** in extraction. Color
is the *only* signal for directionality in the EBE zalantza list:

- **RED** text (CMYK `(0,1,1,0)`) = "ez erabili" — the dispreferred form
- **BOLD** text = the standard / recommended form
- **regular** (non-bold, non-red) = secondary/acceptable form — *not* a correction

Without color, "abots / ahots" is ambiguous: which is wrong? With color:
`<R>abots <B>ahots` → abots is wrong, ahots is right. The plain-text file cannot
express this. So the extraction had to go back to the source PDF and read
character-level color + font weight.

### Extraction method (pdfplumber, 4 iterations)

The extractor (`docs/ebe-reference/extract-zalantza.py`) reads PDF pages 28–48
(0-indexed 27–47), splits each page into left/right columns, groups characters
by line (rounded `top`), and classifies each character:

```python
def char_class(c):
    col = c.get("non_stroking_color")   # CMYK tuple
    font = c.get("fontname", "")
    if col == (0, 1, 1, 0): return "R"  # RED → dispreferred
    if "Bold" in font:       return "B"  # BOLD → standard
    return "k"                            # regular → secondary (ignored)
```

Characters are then re-tokenized into word-units, tagged with their class, and
grouped into phrases (same-class, space-joined). A `(RED → BOLD)` pair is
extracted when a line has exactly one BOLD single-word target and one or more
RED single-word sources.

**Four iterations** were needed to reach a clean dataset:

1. **v1** — naive per-word extraction. Produced ~708 pairs but leaked compound
   fragments (see v3).
2. **v2** — added phrase grouping (multi-word RED forms separated to batch 2).
3. **v3** — handled the `(-)` parenthesized-hyphen pattern. EBE writes compound
   dispreferred forms like `bertso(-)paper` to mean "the hyphenated compound
   bertso-paper". A naive tokenizer splits this into `bertso` + `paper` as
   standalone RED words, leaking common valid words (`izar`, `hezur`, `bizkar`,
   `leiho`, `mahai`, `orratz`, `kanpaina`, `denda`, `saski`, `baloi`, `paper`)
   as false "don't use" entries. **Fix:** detect `(-)` / `(<color>-)` sequences
   in the character stream and treat them as a hyphen *joiner* — `bertso(-)paper`
   becomes one token `bertso-paper`, correctly routed to the multi-word (batch 2)
   list instead of leaking standalone fragments.
4. **v4** — idempotency + collision audit (see below).

### Verification (5 checks)

Before shipping, the 628-pair dataset passed all five checks:

1. **Direction validated against EBE's own intro.** The EBE zalantza section
   opens with worked examples whose direction is stated in prose
   (`ahalbait` is explicitly "ez erabili"). The color classifier was confirmed
   against these: `ahalbait`=RED ✓, `abots`=RED ✓, `abortu`=BOLD ✓, `ahots`=BOLD ✓.

2. **Zero compound-fragment leaks.** All `(-)` compounds are joined into single
   multi-word tokens. Verified absent from the single-word set: `izar`, `hezur`,
   `bizkar`, `leiho`, `mahai`, `orratz`, `kanpaina`, `denda`, `saski`, `baloi`,
   `paper`, `bertso`, `ipar`, `buru`. (These are all valid common words that are
   only dispreferred *inside* specific compounds like `ipar-izar` → `iparrizar`.)

3. **Zero idempotency overlap.** Iterative re-lint (the engine applies one lint
   per pass, then re-tokenizes) would over-correct if a chain `X→Y→Z` existed
   (X replaced by Y, then Y replaced by Z). Audit confirmed: **no RED word is
   also a BOLD target** — 0 overlap. The one near-miss (`papel→paper` and
   `paper→bertsopaper`) was caught and resolved: `paper→bertsopaper` was a
   `(-)` fragment of `bertso(-)paper`, removed by the v3 joiner fix. (`paper` is
   in fact a BOLD recommended form for `papel`.)

4. **Zero verb/function-word collisions.** A RED word that is also a common verb
   or function word would cause dangerous over-correction. The one collision
   found — `gara` (RED, mapped to `geltoki` "train station", a French loanword)
   — is also the 1st-person-plural present auxiliary "we are". Replacing "gara"
   in "etorri gara" ("we have come") with "geltoki" would be catastrophic. This
   is a genuine polysemy: `gara` = both "train station" (regional French loan)
   and "we are" (auxiliary). **Decision:** exclude `gara` entirely — too
   ambiguous for a context-free word rule; needs POS or gazetteer to disambiguate.
   A full scan of the 628 RED words against Basque verb/function-word lists found
   **no other collisions.**

5. **Spot-checks against known Basque linguistics.** Sample pairs confirmed
   correct direction: `amapola→mitxoleta` (poppy, Spanish→Basque), `onda→uhin`
   (wave), `bena→zain` (vein), `xori→txori` (bird, dialectal x→tx), `abots→ahots`
   (voice), `azufre→sufre` (sulfur). All match established Basque lexicography.

### Final dataset

| Category | Count | Disposition |
|---|---|---|
| Single-word unambiguous pairs | **628** | Shipped (`src/core/data/zalantza.js`) |
| Multi-word phrase pairs | 108 | Batch 2 (needs phrase-level detection; some are proper-noun/gazetteer territory) |
| Ambiguous multi-target pairs | 5 | Skipped (context-dependent: `boltsa→burrsa\|poltsa`, `kartera→diru-zorro\|paper-zorro`, `magisteritza→...`, `ingresatu→kartzelatu\|ospitaleratu`, `kaja→kaxa\|kutxa`) |
| Compound-fragment leaks | 0 | Eliminated by v3 `(-)` joiner |
| Verb collisions | 1 (`gara`) | Excluded |

The 628 shipped pairs cover: Spanish/French loanwords (`aborto→abortu`,
`amapola→mitxoleta`, `azufre→sufre`), dialectal consonant variants
(`xori→txori`, `ixil→isil`), apocopes, and spelling regularizations.

### Rule design (`src/core/rules/zalantza-words.js`)

- **Kind:** `LintKind.Confusable` (zalantza-hittak category, per types.js).
- **Edit:** `replaceWith(target)` — pure word substitution.
- **Case preservation:** the source token's case pattern is applied to the
  target: all-lower → lower target; Title-case → Title-case target; all-UPPER →
  UPPER target; **mixed-case → skip** (proper-noun guard, avoids touching
  brand/surname tokens).
- **Word-boundary safe:** the tokenizer emits whole-word tokens, so declined
  forms (`abortoak` = `aborto` + `-ak` plural) are one token → no match → no
  false positive. (Declined-form handling is a future enhancement, batch 3.)
- **Priority 45** (last): structural rules (sentence-split 20 → caps 30 →
  commas 35 → punct 40) get pass-budget priority in the iterative engine;
  word substitution is independent of structure so order is correctness-neutral.
- **Idempotent:** standard forms (BOLD targets) are never RED words (check 3),
  so re-linting corrected text produces zero new lints.

### Eval strategy (per §7.11)

Per the §7.11 decision, zalantza rules are **unit-tested against the EBE pairs
themselves**, not the cap-punct suite or the Elhuyar GEC benchmark (which covers
synthetic morphology, not lexical choice). `tests/core/zalantza.test.mjs`
(30 tests) covers: data integrity (628 pairs, frozen, 0 overlap, fragments
absent, `gara` absent), single-word substitution across categories, case
preservation (lower/Title/UPPER), guards (mixed-case skip, idempotency,
compound-fragment safety, verb-collision safety, word-boundary), in-context
sentences, and full rule-stack integration.

The cap-punct suite (22/22 strict) is run as a **regression guard** only — it
confirms the new rule doesn't break existing cap-punct behavior. It does not
measure zalantza coverage.

### What's deferred

- **Batch 2 — multi-word zalantza (108 phrases):** e.g. `asanblada asanblea→biltzar`,
  `asper egin→asper-asper egin`. Needs phrase-level detection (multi-token span
  matching). Some entries are proper nouns (`Bizkaiko Golkoa→Bizkaiko golkoa`)
  → gazetteer territory (F5), not pure lexical zalantza.
- **Batch 2 — ambiguous multi-target (5 pairs):** context-dependent; need
  disambiguation (POS or surrounding-word heuristics).
- **Batch 3 — declined forms:** `abortoak`, `amapolak` etc. The tokenizer treats
  these as single tokens, so the bare-loanword rule doesn't fire. Handling
  requires either morphological segmentation or a suffix-aware matcher.
- **`gara` disambiguation:** needs POS (is it the auxiliary "we are" or the noun
  "train station"?) — deferred to the tokenizer/POS work (§7.8).

### Files

- `src/core/data/zalantza.js` — 628-pair frozen dictionary (the data)
- `src/core/rules/zalantza-words.js` — the rule (case-preserving substitution)
- `tests/core/zalantza.test.mjs` — 30 unit tests
- `docs/ebe-reference/extract-zalantza.py` — reproducible extraction script
- `docs/ebe-reference/zalantza-multi.tsv` — 108 batch-2 multi-word phrases (SUPERSEDED — see §7.13)
- `docs/ebe-reference/zalantza-ambiguous.tsv` — 5 skipped ambiguous pairs (SUPERSEDED — see §7.13)

---

## 7.13 Zalantza multi-hitza — erauzketa zuzena, egiaztapena, eta inplementazio-plana

*Research conducted 2026-08-27 for P1 batch 2a (multi-word zalantza phrases).*

### Atzeoharra — zergatik aztertu berriro

Batch 1-ek (§7.12) 628 hitz bakuneko ordezkapen bidali zuen, baina 108
esaldi-mailako "multi-word" sarrera `zalantza-multi.tsv`-n utzi zituen batch
2-rako. TSV hori, ordea, **apolitsua zen**: batch 1-eko `final_extract.py`
extraktorearen azpiproduktu bat zen, komak eta puntuazioa jaurtitzen zituena.
Adibidez, `jatsi, jeitsi, jetxi → jaitsi` (hiru aldaera, komaz banatuta)
"multi" gisa sailkatu zen, komak jaurti eta `jatsi jeitsi jetxi` "esapidea"
sortu baitzuen. Horregatik, TSVko sarrera asko ez ziren benetako esaldi-mailako
zalantzak, baizik eta komak botatako aldaera-zerrendak.

TSV hori baztertu eta EBE PDFetik erauzketa berria egin behar da, sarreren
egitura benetan ulertuz.

### EBE sarreren egitura (grammar)

EBE *Zalantza eragiten duten zenbait hitz* atalean (pp. 479–490), sarrera
guztiek egitura bera dute:

| Elementua | Esanahia | Adibidea |
|---|---|---|
| `/` | Desgogokoaren (RED) eta gomendatutakoaren (BOLD) arteko bereizlea | `<R>abots / <B>ahots` |
| `,` edo `;` | Aldaerak banatzen ditu alde berean | `<R>jatsi, <R>jeitsi / <B>jaitsi` |
| `(letra)` | Artikulu/morfema atzizkia — kendu | `ikurriñ(a) → ikurrin` |
| `(esapidea)`| Alternatiba-taldea — edukia mantendu, parentesiak = aldaera-bereizle | `(haize girotu) aire girotu` |
| `(-)` edo `(<kol>-)` | Marratxo-konposatua — marratxo bat da, ez hitz | `aire(-)garraio → aire-garraio` |
| Lerro-anitz | Parentesi ireki bat 2 lerro bete ditzake | `(haize egokitu,\n haize girotu) aire girotu` |

**Kolorea da norabide-seinale bakarra**: RED (CMYK 0,1,1,0) = desgogokoa, BOLD
= estandarra, testu arrunta = bigarren mailakoa (ezikusi). `ebe-zal.txt`
testu soilak kolorea galtzen du, eta beraz ezin da erabili erauzketarako.

### Extraktorea (v6)

`docs/ebe-reference/extract-zalantza.py` berridatzi da (v6) prozesu hau egiteko:

1. **pdfplumber kolore-analisia** — hitz bakoitzaren CMYK balioa irakurri,
   `<R>` (RED), `<B>` (BOLD), edo `` (arrunt) etiketa jarri.
2. **Marratxo-konposatuak** — `(-)` / `(<R>-)` / `(<B>-)` marratxo bat da,
   ez hitz bereizi. Char-korrontean marratxo bat bezala tratatu.
3. **Artikulu-atizkiak** — `(a)`, `(e)`, `(o)`, `(u)` eta maiuskulazkoak kendu.
4. **Parentesiak → komak** — `(` eta `)` komaz ordezkatu (aldaera-bereizlea).
5. **`;` → `,`** — punttuak eta komak ezberdindu.
6. **`/` → `,`** — alde-bereizlea komaz ordezkatu.
7. **Lerro-anitz batzea** — lerro batek parentesi ireki bat badu, hurrengo lerroa
   batu (ikus beheko bug-a).
8. **Aditzi-kolisio iragazkia** — `gara` baztertu ("geltoki" = mailegua RED,
   baina "gara" = "gu gara" aditza ere bai).

### Bug kritikoa: mega-line joining

Lehenengo bertsioek (v1–v5) lerro-anitzeko batze akats larri bat zuten:
parentesi ireki bat duen lerro bat (adib. `(edo Sin.` — ohar bat, non `)` galdu
den PDF erauzketan) hurrengo lerro guztiak irensteko zuen. Parentesi-balantze
metatua zen (`count("(") > count(")")`), eta batuketa ez zen inoiz geratzen
zamaketa-balantzea positibo mantendu arte. Emaitza: orrialde oso bat lerro
bakar batean batu zen, eta ehunka sarrera galdu ziren (adib. `harri bitxi`,
`kontutan hartu`, `labe handi`).

**Konponbidea**: batuketa 1 lerrotara mugatu (ez metatu). Lerro batek
parentesi irekia badu, hurrengo lerroa batu eta geratu — balantzea positibo
badago ere. Honek mega-line saihesten du; galtutako sarrerak berreskuratzen
dira; 1-2 sarrerako galerak onargarriak dira.

### Emaitzak (v6)

| Kategoria | Kopurua |
|---|---|
| Single-bold bikote (RED→BOLD bakarra) | 806 |
| ─ Batch 1-ean daudenak | 626 |
| ─ **Berrriak (batch 1-eko hutsunea)** | **116** (hauetatik ~18 izen bereziak) |
| Multi-word bikoteak | 55 |
| ─ A (esapidea→konposatua) | 11 (6 garbiak, 2 izen berezi, 3 artifaktu) |
| ─ B (esapidea→esapidea) | 13 (denak garbiak) |
| ─ C (hitza→esapidea, token bakuna RED) | 23 (17 garbiak, 6 izen berezi) |
| ─ D (marratxoduna→...) | 8 (denak garbiak) |
| Anbiguo-helburua (RED→BOLD₁|BOLD₂) | 6 |
| Anbiguo-egitura (RED→helburu anitz) | 123 |
| Izen bereziak (single) | 18 |
| Izen bereziak (multi) | 8 |
| Idempotentzia-overlap (multi) | 0 ✓ |

**Gako-aurkikuntza**: batch 1-ek **~116 sarrera galdu zituen** komak-botatze
bug-aren ondorioz. `jatsi→jaitsi`, `ikurriñ→ikurrin`, `enpresari→enpresaburu`,
`eskubi→eskuin`, `rugby→errugbi`, `scout→eskaut` eta antzekoak "multi"
sartu ziren komak jaurti zituelako. Hauek hitz bakuneko bikote garbiak dira.

### Segurtasun-egiaztapenak

#### 1. Idempotentzia (X→Y→Z katearriska)

Iterative re-lint motorrak gainzuzenketak sor ditzake X→Y eta Y→Z kateak
baldin eta RED bat BOLD baten berdina bada. Bi kontrol egin dira:

- **Single-word**: RED guztiak vs BOLD guztiak (batch 1 + berriak). Emaitza:
  **2 self-mapping** (`bizkaiko golkoa→bizkaiko golkoa`, `mota→mota` — EBE
  datu-akatsak, ez kate arriskutsuak). Arloaren `replacement !== tok.text`
  guard-ak hauek automatikoki saltatzen ditu. **0 kate erreal**.
- **Cross-chain** (berriak vs batch 1): **0 arrisku** — ez dago bikote
  berririk non RED bat batch 1-eko BOLD bat den.
- **Multi-word**: **0 overlap** ✓

#### 2. Aditzi-kolisioa (gara arazoa)

`gara` baztertuta dago: polisemikoa da ("geltoki" = frantsesezko mailegua
RED, baina "gara" = "gu gara" aditza ere bai). Testuingururik gabe hitz-arau
batean arriskutsuegia da. Bikote berrietan ez dago beste aditz-kolisionik
(beharintzat ez da `da`, `dira`, `naiz` etab. bezalako aditz laguntzaile
frekuenterik aurkitu).

#### 3. Izen berezien detekzioa

Izen bereziek (leku-izenak, izen biblikoak) maiuskula espezifikoa dute eta
F5 gazetteer-era atzeratzen dira (ez zalantza lexikoa). 18 single + 8 multi =
26 izen berezi. Adibideak: `Adan→Adam`, `Ernio→Hernio`, `Deba Behea→Debabarrena`,
`Donejakue→Donejakue bidea`, `Haizkorri→Aizkorri`.

### Inplementazio-plana

#### 1. fasea: zalantza.js osatu (~115 sarrera berri)

Bi motatako sarrerak `zalantza.js`-ra gehitu (kode-aldaketarik gabe):

- **~98 hitz bakuneko berriak** (batch 1-eko hutsunea: `jatsi→jaitsi`,
  `eskubi→eskuin`, `rugby→errugbi`, `scout→eskaut`, `enpresari→enpresaburu`...)
  izen bereziak (18) eta aditz-kolisioak (0) salbuetsita.
- **17 Type C bikote** (hitza→esapidea): `abioneta→hegazkin txiki`,
  `egunon→egun on`, `eskerrikasko→eskerrik asko`, `ingurutren→aldiriko tren`...
  Hauek **kode-aldaketarik gabe** funtzionatzen dute: `matchCase()` funtzioak
  jada hitz anitzeko helburuak maneiatzen ditu (`target.toLowerCase()` /
  `target.toUpperCase()` / Title-case guztiek stringak espazioekin maneiatzen
dituzte).

#### 2. fasea: zalantza-phrases arau berria (~31 bikote)

Arau berri bat sortu behar da **multi-token RED** duten bikoteentzat
(Type A + B + D + marratxodun-singleak):

- **Type A** (6 garbiak): `agi denez→agidanez`, `etxeko andre→etxekoandre`,
  `harri bitxi→harribitxi`, `itsas korronte→itsaslaster`, `ipar ekialde→ipar-ekialde`...
- **Type B** (13): `haize girotu→aire girotu`, `asper egin→asper-asper egin`,
  `kontutan hartu→kontuan hartu`, `kosta ala kosta→kosta ahala kosta`,
  `labe handi→labe garai`...
- **Type D** (8): `aire-garraio→aireko garraio`, `big-bang→big bang`,
  `bular-angina→bularreko angina`, `elektro-tresna→tresna elektriko`...
- **Marratxodun singleak** (4): `bana-bana→banan-banan`, `bideo-kasete→bideokasete`...
- **Artifaktu zuzenduak** (2): `autonomi elkarte→autonomia-elkarte`,
  `merkatal zentro→merkataritza-zentro` (helburuak trunkatuta zeuden;
  eskuz zuzendu).

**Fitxategiak**:
- `src/core/data/zalantza-phrases.js` — ~31 bikote
- `src/core/rules/zalantza-phrases.js` — sliding-window araua

#### 3. fasea: atzerapenak

- **26 izen bereziak** → F5 gazetteer (`src/core/dictionary.js`)
- **129 anbiguoak** (6 helburu + 123 egitura) → batch 3+ (testuingurua/POS
  beharrezkoa: `asanblada→batzar|biltzar`, `espresatu→adierazi|aditzera eman`)

### Matching-mekanismoaren diseinua

#### Arazoa: marratxodun formak token anitz dira

Tokenizatzaileak (`document.js`) `\p{P}+` erabiltzen du puntuaziorako,
marratxoa barne. Beraz, `aire-garraio` ez da token bat; hiru dira:
`[word:aire, punct:-, word:garraio]`. Hau da, hitz bakuneko `zalantza-words.js`
arauak (zeinak `ZALANTZA[tok.text]` begiratzen duen token bakun batean) ezin
du marratxodunik maneiatu.

#### Konponbidea: sliding-window token-sekuentzia bat etortzea

```
For each RED phrase in ZALANTZA_PHRASES:
  Tokenize RED phrase using same tokenize() from document.js
  Filter to non-whitespace tokens → redTokens[]
  For each starting position i in doc.tokens (non-whitespace):
    If redTokens matches content[i..i+N]:
      Span = {start: content[i].start, end: content[i+N-1].end}
      Replacement = matchCase(content[i].text, boldTarget)
      If replacement !== sourceText: emit lint
```

**Klabea**: RED esapidia tokenizatzean, tokenizatzaile berdina erabiltzen da
(dokumentuaren tokenizatzailea). Beraz, `aire-garraio` RED esapidea
`[word:aire, punct:-, word:garraio]` bihurtzen da — dokumentuaren token
sekuentziaren konparagarria. Ez dago kasuren bereizketarik.

**Konplexutasuna**: O(N × M × K) non N = edukiko tokenak, M = esapideak (~31),
K = esapide luzeena (4 token). Testu tipikoetarako arbuiagarria.

#### Kasua mantentzea

`matchCase(source, target)` funtzioak lehen tokenaren kasua erabiltzen du:
- lower → `target.toLowerCase()` (adib. `haize girotu` → `aire girotu`)
- Title → `target[0].toUpperCase() + target.slice(1).toLowerCase()` (adib. `Haize girotu` → `Aire girotu`)
- UPPER → `target.toUpperCase()` (adib. `HAIZE GIROTU` → `AIRE GIROTU`)
- mixed → skip (izen berezien guard-a)

Honek funtzionatzen du esapidetan lehen hitza bakarrik begiratzen delako;
geratutako hitzek helburuaren kasu kanonikoa jarraitzen dute.

#### Idempotentzia (motor iterative)

Motorrak arau bat aplikatzen du pass-ero, berriro tokenizatu, eta berriro
lint. Baldin eta esapide bat ordezkatzen bada (adib. `haize girotu` →
`aire girotu`), hurrengo pass-ean `aire girotu` ez da RED esapidea (ez dago
ZALANTZA_PHRASES-en), ber ez da berriro ordezkatuko. **0 idempotentzia-overlap**
egiaztatuta ✓.

### Type C — kode-aldaketarik gabe

**Aurkikuntza gakoa**: Type C bikoteak (hitza→esapidea, adib.
`abioneta→hegazkin txiki`) ez dute arau berririk behar. `zalantza-words.js`-ren
`matchCase()` funtzioak jada maneiatzen ditu hitz anitzeko helburuak, eta
`replaceWith("hegazkin txiki")` string bat espazioekin ondo funtzionatzen du.
Bikote hauek `zalantza.js`-n gehitzen dira balio gisa (gako bakuna, balio
hitz anitzekoa). Arauaren `lint()` funtzioak `ZALANTZA[lower]` begiratzen du
— gakoa hitz bakuna da — eta `matchCase(tok.text, target)` aplikatzen du,
non target hitz anitzekoa izan daitekeena. **Funtzionatzen du**.

Honek inplementazioa nabarmen sinplifikatzen du: soilik ~31 multi-token RED
bikoteek behar dute arau berria. ~17 Type C + ~98 single berriak zuzenean
`zalantza.js`-ra doaz.

### Laburpena

| Fasea | Sarrera kopurua | Kode berria? |
|---|---|---|
| 1: zalantza.js osatu | ~115 sarrera berri | Ez (datuak soilik) |
| 2: zalantza-phrases araua | ~31 bikote | Bai (`zalantza-phrases.js` + `.js` data) |
| 3: atzerapenak | 26 izen berezi + 129 anbiguo | F5 / batch 3+ |

**Total**: ~146 bikote berri gehituko dira (batch 1-en 628 + 146 = ~774
guztira). 0 idempotentzia-arrisku, 0 aditzi-kolisio berri, 0 erregresio
esperoa (arau berria priority 46-n, single-word-aren atzetik).

## 7.14 Berria Estilo Liburua — bigarren iturri administraria (F5 + zalantza-osagarria)

*Research conducted 2026-08-27. Berria.eus-eko Estilo Liburua aztertuta EBEren
ondoren bigarren autoritate-iturri gisa, F5 maiuskula-gazetteer-erako eta
zalantza-hiztegiaren osagarrirako.*

### Atzeoharra — zergatik aztertu Berria

EBE (Euskara Batuaren Eskuliburua) jadanik erregela-iturri autoritatea da
(§7.7, §7.12, §7.13) eta P1 arau-geruzaren oinarria da. Baina EBEk ez ditu
estaltzen kazetaritza-estiloko arau praktiko guztiak: izen berezien idazkera
(toponimoak, pertsona-izenak, erakundeak, kirol-taldeak), zenbakien formatua,
laburdurak, akronimoak. Euskal Herriko egunkari nagusiak, **Berria**-k, bere
estilo-liburua publikoki argitaratzen du linean, eta EBEren osagarri naturala
da: kazetariek egunero aplikatzen dituzten arau konkretu eta praktikoak
biltzen ditu, adibide ugarirekin.

Helburua: Berriaren Estilo Liburuaren atalak **txukun-en errepertoriora
mapatzea** — zein atal eman dezakeen datu zuzena F5 gazetteer-erako, zein
osatu dezakeen zalantza-hiztegia, eta zein geratu behar den etorkizuneko
estilo-arauentzat.

### Gunearen egitura eta URL mapa

Berriaren Estilo Liburua `https://www.berria.eus/estiloliburua`-n dago.
Atalen URL-egitura bi motatakoa da:

| Mota | Aurrizkia | Atalak |
|---|---|---|
| Liburu-kapituluak | `/eliburua/` | `ortotipografia`, `idazkuntza`, `onomastika`, `informazioa-eta-interpretazioa`, `deontologia`, `internet`, `bibliografia-hautatua` |
| Atal autonomoak | (erroa) | `mundua`, `euskal-herria`, `hiztegia`, `gaikako-hiztegiak`, `galdera-erantzunak`, `azken-aldaketak` |

**Oharra teknikoa**: hasieran 404 akatsa `/eliburua/` aurrizkirik gabe;
aire-aurreko bisitak orri nagusia berreskuratu behar izan zuen URL zuzenak
aurkitzeko. Atal autonomoetako sarrera indibidualak `/azken-aldaketak/hiztegia/{id}`
URLetan daude (adib. `/azken-aldaketak/hiztegia/10599`).

### Atalez ataleko azterketa → txukun-en kasuak

#### Ortotipografia (`/eliburua/ortotipografia`, ~6.500 hitz)

**Atalik emankorrena txukun-erako.** Eduki nagusiak:

- **LETRA ETZANA (italikak)**: tituluak, atzerriko hitzak, aldakiak.
- **LETRA LARRIA / XEHEA / MAIUSKULA TXIKIA (maiuskulak)**: izen berezien
  taxonomia osoa — pertsonak, animaliak, lekuak, gorputz zerutiarrak,
  erakundeak, gertakariak, tituluak, dokumentuak, historia, gaiak,
  markak, objektuak; minuskula-arauak; versal txikia (small caps).
  → **F5 gazetteer-erako datu-iturri zuzena**.
- **ZENBAKIAK**: deklinabidea, datak, orduak, kirol-emaitzak, ehunekoak,
  digituak vs letrak, zenbaki erromatarrak, dirua, ordinalak, bereizgailuak.
  → Etorkizuneko zenbaki-formateatze-arauetarako (orain P1-eskopotik kanpo).
- **IZEN BEREZIAK NOLA DEKLINATU**: izen berezien deklinabidea.
  → F5 gazetteer-aren osagarria (declined-form handling, batch 3+).
- **LABURTZAPENAK**: laburdurak, siglak eta akronimoak (nola idatzi,
  deklinatu, irakurri).
  → Etorkizuneko arau potentziala (siglen puntua, deklinabidea).

**Txukun-erako mapaketa**:
- Maiuskulen taxonomia → **F5 gazetteer** (§7.13-etik datozen 35 izen bereziekin batera).
  EBEren maiuskulak sarrerak (§7.7, id=1023) baino askoz zabalagoa eta adibide gehiagorekin.
- Zenbaki-formatua → P3+ (orain ez da larria).
- Laburdurak/siglak → P3+ (orain ez da larria).

#### Idazkuntza (`/eliburua/idazkuntza`, ~16.000 hitz)

Atalik luzeena, baina txukun-en oraingo P1 ortografia-eskoporik **gutxien
zuzenki erabilgarria**. Estilo- eta idazkera-arauetara bideratuta:

- **HIZKUNTZA EREDUA** (language model): eredu lexikoaren aukeraketa.
- **ESTILOA**: argitasuna, laburtasuna, aditz-estiloa, ahots aktiboa,
  orainaldia, testu-hasierak, erritmoa, inpertsonaltasuna, errepikapenik/
  kliseerik/argotik ez.
- **TESTUAREN EGITURA: PARAGRAFOA**: paragrafoen antolaketa.
- **ESALDIAREN ANTOLAMENDUA**: ordena, aposizioak, aipamenak.

**Txukun-erako mapaketa**: Etorkizuneko **estilo-arauentzat** (P4+), ez P1.
Hauek ez dira ortografia-akatsak zuzentzaileak, baizik eta estilo-gomendioak
(adib. "erabili ahots aktiboa", "saihestu errepikapena"). Oraingo P1
motorrarentzat (ortografia + puntuazioa + maiuskulak + zalantza) ez dute
eragin zuzenik. Baliteke etorkizunean "style suggestions" gisa gehitzea
(Grammarly-ren tone-detector-en antzera), baina hori P4-ren geruza da.

#### Onomastika (`/eliburua/onomastika`)

Izen berezien idazketa-arauak: pertsonak, erakundeak, gertakariak, lanak,
kirol-taldeak.

**Txukun-erako mapaketa**: **F5 gazetteer-erako datu-iturri zuzena**,
Ortotipografiaren maiuskulen taxonomiarekin batera. Kirol-taldeen izenak
(erreala, athletic, osasuna — minuskulak, ez maiuskulak izen arruntetan)
berezi garrantzitsuak dira gazetteer-erako.

#### Mundua (`/mundua`) eta Euskal Herria (`/euskal-herria`)

Leku-izenen gazetteerrak: munduko eta Euskal Herriko toponimoen euskal izenak
eta demonym formak (jendeari buruzko izenak: donostiarra, bilbotarra, etab.).

**Txukun-erako mapaketa**: **F5 toponimo-gazetteer**. Hauek zuzenki
erabilgarriak dira maiuskula-arauetarako: toponimoak maiuskulaz hasten dira,
baina ez dute beti letra larri osoa behar (adib. "Euskal Herria" baina
"euskal" adjektibo gisa minuskulaz). EBEren §7.7 maiuskulak sarrerarekin
batera, toponimo-gazetteer honek F5 araua elikatuko luke.

#### Hiztegia (`/hiztegia`) — urrez mekanikoki irakurria

A-Z hiztegi modukoa, zalantza-hitzak eta gomendioak biltzen dituena.
**Aurkikuntza gakoa**: sarrerak **mekanikoki irakurgarriak** dira, anotazio-
sinbolo estandarizatuekin:

| Sinboloa | Esanahia |
|---|---|
| `*` | ez erabili (adib. `antigitanismo*`) |
| `✗` | hobetu beharrekoa |
| `→` | hobe (adib. `munizipalismo → munizipalista`) |
| `[e.]` | erabili |
| `[h.]` | hobetsi |

Sarrera indibidualak `/azken-aldaketak/hiztegia/{id}` URLetan, formatua:
`headword, gomendatutako forma` (adib. `munizipalismo, munizipalista`).

**Txukun-erako mapaketa**: **Zalantza-hiztegiaren osagarria**. EBEren
zalantza atala (§7.12, §7.13 — jadanik 628 bikote erauzita) Berriaren
hiztegiarekin gurutzatuz gero, estaldura handiagoa lortuko da. Hau ez da
oraindik erauzi — **batch 3+ atazatzat markatuta**, EBEren zalantza lana
amaitu ondoren. Baliteke Berriaren formatua EBErena baino errazagoa izatea
erauzteko (sinboloak argiagoak, kolorearen mendekoak ez).

#### Gaikako hiztegiak (`/gaikako-hiztegiak`)

Domeinuko hiztegi espezifikoak: gerra, unibertsitateak, gaitz infekziosoak,
ingurumena, feminismoa, hauteskundeak, etab.

**Txukun-erako mapaketa**: **Domeinu-hiztegia** (orain P1-eskopotik kanpo).
Etorkizunean, erabiltzaileak domeinu bat aukeratzean (adib. "medikuntza"),
hiztegi espezifikoa kargatuko litzateke berariazko terminoak ezagutzeko.
Hau P3+ edo P4-ren ezaugarri potentziala da, ez oraingo priorititatea.

#### Galdera-erantzunak eta Azken aldaketak

FAQa eta aldaketa-loga. Ez dira zuzenki erabilgarriak txukun-en
errepertoriorako, baina Azken aldaketak-ek erakusten du nola eguneratzen
den hiztegia (zer sarrera gehitu diren azkenaldian) — hau baliagarria da
zalantza-hiztegia mantentzeko eta fresko edukitzeko.

### Lizentzia eta autore-posizioa — egiaztapen kritikoa

Atal hau ikerketaren azken pausuan egiaztatu da (2026-08-27, "Zer den/Nola
erabili" orria bisitatuta) eta aurreko atalen mapaketaren markoa berridatzi
du. Bi aurkikuntza kritiko:

**1. Lizentzia: gutun eskubide guztiak erreserbatuta (all-rights-reserved).**
Berriaren Estilo Liburuko orriek copyright ohar arrunta daramate:

> © Berria.eus - Euskal Editorea SM • Martin Ugalde kultur parkea, Andoain 20140

Ez dago Creative Commons markarik, berrerabilera-baimenik, ez CC-BY/CC0
adierazpenik inon. Beraz, berariazko baimenik gabe, **ezin da Berriaren
Estilo Liburuan oinarritutako datu-base eratorria osorik banatu**. Baina
gertaera linguistiko indibidualak ("X toponimoaren euskal izena Y da") ez
dira copyright-ableak; babestuta dagoena hautatutako/ateratutako *datu-base
konpilatua* da. Honek hiru erabilera-modu bereizten ditu:

- ✅ **Garapen-erreferentzia** — garatzaile batek Berria irakurtzea EBEtik
  eratorritako arauak gurutzatzeko eta egiaztatzeko = bidezko erabilera
  (fair use), banaketarik gabe.
- ✅ **Curazio eskuzko txikia** — garatzaile batek Berria Hiztegia irakurri,
  20 balio handiko hobespen editorial eskuz aukeratu, EBE-oinarritutako
  arau-sarrera gisa idatzi `style` banderarekin eta `source: "Berria
  (consulted)"` oharrarekin. Gertaerak, eskuz aukeratuta, multzo txikia.
- ❌ **Ateratze masibo scriptatua** — Berria Hiztegiaren 500+ sarrera
  script batez ateratzea `zalantza.js`-ra datu-base eratorri gisa =
  baimenik gabe banatzeko arriskutsua.

**2. Autore-posizioa: estilo-liburua, ez gramatika-liburua.** Berriak
berariaz urruntzen du bere burua autoritate normatibotik ("Zer den/Nola erabili"):

> "Hizkuntza kontuetan, ez dagokio BERRIAri zuzena edo okerra zer den
> erabakitzea. Gogoan izan hau **estilo liburu bat dela, ez gramatika liburu
> bat**. BERRIAk bere aukera estilistikoak egiten ditu... Beraz, izarrak ez
> du ezinbestean esan nahi hitz, egitura edo dena delako hori gramatikaren
> kontrakoa denik, baizik eta BERRIAk ez duela erabiltzen."

Hau da, Berriaren zalantza `*` markak **egunkari baten hobespen editorialak**
dira, ez epai normatiboak. EBEn (Euskaltzaindia) "erabili Y, ez X" bikoteek
indar normatiboa dute ("akademiak Y agintzen du"); Berriarenek indar
editoriala soilik ("egunkari batek ez du X erabiltzen"). Erabiltzaileari
"erabili Y X-en ordez" esaten dion zuzentzaile baterako, EBE bikoteek
pisu normatiboa dute; Berriaren bikoteek ez.

### Sinteesia — hiru mailako eredu berria

Aurreko atalen mapaketak ("F5 gazetteer-erako datu-iturri zuzena",
"zalantza-hiztegiaren osagarria") goiko lizentzia- eta autore-aurkikuntzen
argitan **berridatzi behar dira**. Berriak ezin da EBEren osagarri gisa
banatu datozen datu-fitxategietan (lizentzia), eta bere zalantzak ez dute
indar normatiborik (autore-posizioa). Baina honek ez du esan nahi baliogabea
denik — baizik eta **hiru mailako eredu batera** pasatzen dela:

| Maila | Iturria | UX etiketa | Banatu datu gisa? |
|---|---|---|---|
| **Zuzenketak** (normatiboak) | EBE / Euskaltzaindia | "Akatsa" / azpimarra gorria | Bai — masiboa, banatuta |
| **Estilo-iradokizunak** (editorialak) | Berria (eskuzko curazioa soilik, lizentzia errespetatuz) | "Estiloa" / azpimarra urdina, baztergarria | Bai — txikia, eskuz aukeratua, atribuitua |
| **Garapen-erreferentzia** | Biak | (UXrik ez) | Ez — prozesua soilik |

| Dimension | EBE | Berria |
|---|---|---|
| Autoritatea | Euskaltzaindia (akademikoa, normatiboa) | Kazetaritza-praktika (editoriala, ez-normatiboa) |
| Lizentzia | EBE erreferentzia (Euskaltzaindia) | All-rights-reserved (© Berria) |
| Indar linguistikoa | "akademiak agintzen du" | "egunkari batek ez du erabiltzen" |
| Estaldura | Arau orokorrak + zalantza-hiztegi zabala | Arau praktikoak + izen berezi zehatzak + estiloa |
| Formatua | PDF (kolore-sinalearen mendeko §7.12) | HTML (mekanikoki irakurgarria, anotazio-sinboloekin) |
| Zalantza-hitzak | 774 bikote erauzita (batch 1+2a) | Hiztegia — erauzi gabe (eta ez da masiboki erauziko) |
| Izen bereziak | Maiuskulak sarrera (id=1023) | Ortotipografia + Onomastika + Mundua + Euskal Herria (askoz zabalagoa) |
| Estiloa | ez estaltzen | Idazkuntza atal osoa (~16.000 hitz) |

**Ondorioa**: Berria **ez da EBEren ordezkoa**, eta ezin da EBEren osagarri
normatibo gisa banatu ere. EBE autoritate primarioa izaten jarraitzen du
erregela-geruzarentzat (jadanik 774 zalantza-bikote erauzita eta 5 arau
inplementatuta). Berriaren rola **hirugarren maila** batekoa da:

1. **Garapen-erreferentzia** — beti baliozkoa: EBEtik eratorritako arauak
   gurutzatzeko eta egiaztatzeko, garapen-prozesu gisa (commit mezuak,
   RESEARCH.md oharrak), banaketarik gabe.
2. **Estilo-iradokizunak** (P2/P3): etorkizuneko "style suggestions" geruzan
   (Grammarly-ren clarity/consistency saskia), **eskuzko curazio txiki
   batekin soilik** (ez ateratze masiboa), `style` etiketarekin eta
   atribuzio argiarekin. `LintKind.Style` jada existitzen da
   (`src/core/types.js`), eta TODO.md-ko P2-k aurreikusten du "akatsa vs
   hobe izan liteke" bereizketa.
3. **Ez da inoiz izango zalantza/izen-berezi iturri nagusia** — EBEk
   betetzen du rola hau.

### Gomendio zuzenak roadmap-erako (lizentzia-egiaztapenaren ondoren berridatzita)

1. **F5 gazetteer — iturriak EBE/Euskaltzaindiara bideratu** (P1 batch 3 / P2):
   Berriaren Ortotipografia + Onomastika + Mundua + Euskal Herria atalek datu
   zabalagoa dute, baina lizentziak ez du uzten datu-base eratorria banatzen.
   **Pibotea**: erabili Euskaltzaindiaren berezko toponimo/onomastika baliabideak
   (Euskal Onomastika Datubasea, Euskaltzaindiaren Hiztegia) F5 datu iturri
   gisa, EBEren §7.13-etik datozen 35 izen bereziekin batera. Berria garapen-
   erreferentzia gisa kontsultatu daiteke toponimo zehatzak egiaztatzeko, baina
   ez da banatutako zerrenda elikatzeko iturri. Honek F5 akatsak konponduko
   lituzke (c091 erakundeen maiuskulak, c095 gorputz zerutiarrak, c096 modelaren
   gehiegizko maiuskulak).

2. **Zalantza-osagarria — BERTAN BEHAR DA** (bertan behera utzita): Berriaren
   Hiztegia atala ez da zalantza-iturri banatu gisa erabiliko. Bi arrazoi:
   (a) lizentziak ez du uzten ateratze masiboa; (b) Berriaren `*` markak
   editorialak dira, ez normatiboak — "akatsa" gisa banatzeak bere indarra
   gehiegiz neurtuko luke. **EBEren 774 bikoteak dira zalantza-iturria;
   ez dago Berria delta-rik.**

3. **Estilo-iradokizunak** (P2/P3): Berriaren Idazkuntza + Hiztegia atalen edukia
   etorkizuneko "style suggestions" geruzarako material gisa balio du, baina
   **eskuzko curazio txiki batekin soilik** (20-30 sarrera handi, atribuituta,
   `LintKind.Style` etiketarekin, baztergarriak). Ez da ateratze masiboa.
   Ikus TODO.md P2/P3.

4. **Domeinu-hiztegiak** (P3+): Gaikako hiztegiak atala ez da oraingo
   prioritatea, eta lizentzia-murrizketa berak aplikatzen zaio.

5. **Aukeran: baimena eskatu** — `estiloliburua@berria.eus` helbidera
   CC-BY baimena eskatzeko mezua bidal daiteke Berrian oinarritutako
   gazetteer bat banatzeko. Baina editorial-vs-normatibo aurkikuntzagatik,
   ROI baxua da: hobespen editorialak lizentziatzea genuke, eta guk epai
   normatiboak behar ditugu, EBEk ematen dituenak.

### Egiaztapen-egoera

| Baieztapena | Iturria | Egiaztatuta? |
|---|---|---|
| Berriaren Estilo Liburua linean publikoa da | berria.eus/estiloliburua (orri nagusia) | Bai |
| Atalen URL-egitura bi motatakoa da (`/eliburua/` + erroa) | Orri nagusia + site map | Bai |
| Ortotipografiak maiuskulen taxonomia osoa du | `/eliburua/ortotipografia` (6.529 hitz irakurrita) | Bai |
| Ortotipografiak zenbaki-arauak ditu | atal bera | Bai |
| Idazkuntzak estilo- eta paragrafo-arauak ditu | `/eliburua/idazkuntza` (16.099 hitz irakurrita) | Bai |
| Hiztegiak anotazio-sinbolo estandarizatuak ditu | `/azken-aldaketak/hiztegia/{id}` sarrerak | Bai |
| Onomastikak izen berezien arauak ditu | `/eliburua/onomastika` | Bai (izen laburra) |
| Mundua/Euskal Herria toponimo-gazetteerrak dira | `/mundua`, `/euskal-herria` atalak | Bai (izen laburra) |
| Gaikako hiztegiak domeinu-hiztegiak dira | `/gaikako-hiztegiak` | Bai (izen laburra) |
| **Lizentzia: all-rights-reserved** (CC-rik ez) | `zer-den-nola-erabili` orriko copyright oharra | **Bai** |
| **Berria = estilo-liburua, ez gramatika-liburua** (autore-posizioa) | `zer-den-nola-erabili`: "ez dagokio BERRIAri zuzena edo okerra zer den erabakitzea" | **Bai** |
| Berriaren `*` markak editorialak dira, ez normatiboak | atal bera | **Bai** |

**Muga**: Onomastika, Mundua, Euskal Herria, eta Gaikako hiztegiak atalen
eduki osoa ez da hitzez hitz irakurrita — izenak eta deskribapen orokorrak
baizik. F5 gazetteer-a erauzteko unean, atal hauen eduki osoa berreskuratu
eta erauzketa-datua egiaztatu beharko da.

---

## 7.15 Kalko lexiko-semantikoak — EBE §1 analisia eta egiaztapena (batch 2b)

### Aurrekariak

EBEren *Kalko desegoki nabarmen batzuk* atalak bi azpi-atal ditu:

1. **§1 Kalko lexiko-semantikoak** (ebe-kal.txt lerroak 5–96): hitz- edo
   esapide-mailako ordezkapenak — batch 2b-ren esparrua
2. **§2 Kalko morfosintaktikoak** (lerroak 97–477): esaldi-mailako berridazketak
   — batch 3-ra atzeratuta (POS/gramatika behar du)

Zalantzak (§7.12–7.13) ez bezala, kalkoak **itzulpen-okerrak** dira: erderaren
(esgelaiera/frantsesa) eredu bat euskarara kopiatzea, jatorrizko hitza erabili
beharrean. Zalantzak, berriz, bi hitz balioren arteko aukeraketa zalantzatsuak
dira.

### §1 sarrera-analisia (34 sarrera)

`/tmp/extract_calques.py` extraktorearekin kategorizatu ziren 34 sarrerak:

| Kategoria | Kop. | Adibideak | Statusa |
|---|---|---|---|
| CLEAN_WORD | 5 | `belgiar→belgikar`, `balore→balio` | Ship (3 zalantzan errepikatuta) |
| CLEAN_PHRASE | 4 | `pena merezi→merezi`, `zentzu bakarreko→noranzko bakarreko` | Ship (2 errepikatuta/deferred) |
| SENTENCE | 9 | `*Euria dago→Euria ari du` | Atzeratu (batch 3) |
| CONTEXT_DEP | 6 | `proba/froga`, `gizona/gizakia` | Atzeratu (testuingurua behar) |
| MULTI_TARGET | 5 | `*ideologia anitza→askotariko/ideologia plurala` | Atzeratu (2+ helburu) |
| OPTIONAL | 3 | `*eta abar luze bat→eta abar(,) eta abar` | Atzeratu (aukerazko elementuak) |
| MORPHOLOGICAL | 3 | `*berdina→bera` (deklinabidea), `*jolastu→jokatu` (adierazpena) | Atzeratu (stem+atzizkia) |
| PROPER_NOUN | 1 | `*Errege Katolikoak→Errege-erregina Katolikoak` | Atzeratu (F5) |
| QUESTIONABLE | 1 | `?eskaini` (galdera-marka) | Atzeratu |
| USAGE_NOTE | 1 | `ospatu bilera→bilera egin` (erabilera, ez kalko) | Atzeratu |

**Emaitza**: 8 sarrera garbi, 26 atzeratuta.

### Hiztegi-egiaztapena (Euskaltzaindiaren Hiztegia)

8 sarrera garbiak Euskaltzaindiaren Hiztegiaren bilatzailearen bidez
egiaztatu ziren (`com_hiztegianbilatu` osagaiak, `osagaiakHasi` irizpidea):

| Hitza | EH emaitzak | OEH | Oharrak | Erabakia |
|---|---|---|---|---|
| `belgiar` | (zalantzan jada) | `* e.` marka | Atzizki kalkeztatua (-ar) | Zalantzan ✅ |
| `europear` | **0 emaitza** | — | Ez dago hiztegian | Ship ✅ |
| `egipziar` | (belgiar eredu bera) | — | Atzizki kalkeztatua | Ship ✅ |
| `balore` | 3 emaitza | Bai | `balio`-rako erreferentzia gurutzatua | Ship (leunagoa) ⚠️ |
| `erabakior` | 1 emaitza | Bai | `erabakigarri`-rako redirect | Ship ✅ |
| `erasokor` | 1 emaitza | Bai | OEH bakarrik (historikoa), ez EH | Ship ✅ |
| `pena merezi` | — | — | `pena` bakarrik = baliozkoa (mina) | Esapidea bakarrik ✅ |
| `zentzu bakarreko` | — | — | `zentzu` bakarrik = baliozkoa (zentzua) | Esapidea bakarrik ✅ |

**Gako-aurkikuntza**: 4 sarrera garbi (`belgiar`, `europear`, `egipziar`,
`erabakior`) **jada `zalantza.js`-n daude** — EBEk bi ataletan zerrendatzen
ditu (zalantza + kalko). Helburuak identikoak dira bi iturrietan
(egiaztatuta: `belgiar→belgikar` zalantzan eta kalkoan). Ez dugu bikoiztu
ez dutelako funtzionatzen — zalantza-arauak (priority 45) aurretik hartzen ditu.

### `balore` kasu berezia

`balore`k 3 emaitza ditu EH-n, baina denak `balio`-rako erreferentzia
gurutzatuak dira (adib. `balore-eskala→balio eskala`). EBEk ez du `*` markarik
jarri (§1-eko beste sarrera batzuk bezala: `erabakior`, `erasokor`,
`ospatu`). Hau **zalantza>kalke** mugikorra da: `balore` hiztegian badago,
baina EBEk normatiboki `balio` gomendatzen du. Grammarly-moduko zuzentzaile
normatibo baterako, markatzea egokia da — erabiltzaileak baztertu dezake.

### Diseinu-erabakiak

1. **Fitxategi bereizia**: `src/core/data/calque.js` + `src/core/rules/calque.js`.
   Kalkoak linguistikoki desberdinak dira zalantzak ez bezala (itzulpen-okerrak
   vs. aukeraketa zalantzatsuak). `LintKind.Calque` erabiltzen du (jada existitzen
   zen `types.js`-n!), ez `LintKind.Confusable`.

2. **Arau bakarra, fase bikoitza**: `calque.js`-k hitz bakuna (priority 47) eta
   esapidea (priority 48) arau bakar batean konbinatzen ditu. Zalantzak bezala,
   bi arau bereizi beharrean (priority desberdinak), arau bakarrak bi fase
   exekutatzen ditu. 4 sarrera baino ez daudenez, 4 fitxategi sortzea (datu +
   arau × 2) gehiegi litzateke.

3. **`matchCase()` berrerabiltzea**: zalantza-words.js-tik inportatzen da
   (`import { matchCase } from './zalantza-words.js'`). Menpekotasun norabide
   bakarra (kalke → zalantza), ziklorik gabe. YAGNI: ez generic util-era
   ateratako.

4. **Esapide-matching berrerabili**: zalantza-phrases-en algoritmo bera
   (sliding-window token-sequence match). Hitzak case-insensitive match;
   puntuazioa exact match (marratxoa ≠ zuriunea). Case lehen hitzetik mantentzen
   da `matchCase()` bidez.

5. **`pena merezi→merezi`**: esapidea 2 token, helburua 1 hitz. Matcherrak
   2-token span-a 1-hitza helburuarekin ordezten du. Case kontserbatzea funtzionatzen
   du: `Pena merezi → Merezi` (Title), `PENA MEREZI → MEREZI` (UPPER).

6. **False-positive zaindariak**: `pena` bakarrik ez da markatzen (mina =
   baliozkoa). `zentzu` bakarrik ez da markatzen (zentzua = baliozkoa).
   `zentzu bakar bat` ez da markatzen (ez da kalke-esapidea). Esapide-matcherrak
   bakarrik 2-token sekuentzia zehatza markatzen du.

### Egiaztapenak

`/tmp/validate_calques.mjs` scriptak 26 egiaztapen exekutatu zituen:
- 0 barne-bikoiztu, 0 idempotentzia-kate, 0 no-op
- 0 overlap zalantza datuarekin (bai hitzetan, bai esapidetan)
- 0 kate-arrisku zalantza↔kalke (bi noranzketetan)
- 0 word/phrase first-word overlap

### Emaitzak

- **41 test berri** (`tests/core/calque.test.mjs`): data integrity, hitz
  ordezkapena, case kontserbatzea (lower/Title/UPPER), mixed-case skip,
  esapide ordezkapena, false-positive zaindariak, idempotentzia, full-stack
  integrazioa (zalantza + kalko elkarrekin)
- **189 core test guztiak pasa** (148 aurretik + 41 berri)
- **Cap-punct eval: 22/33 strict** (aldaketarik gabe — 0 regressio)
- **Vite build: OK**
- **7 arau orain** (allRules: sentence-boundary, sentence-initial-cap,
  vocative-comma, terminal-punct, zalantza-words, zalantza-phrases, calque)

### Atzeratutako sarrerak (batch 3+)

26 sarrera atzeratuta daude, hurrengo arrazoiengatik:

1. **Esaldi-maila (9)**: `*Euria dago→Euria ari du` — aditz-egituren
   berridazketa osoa, POS/gramatika behar du
2. **Testuinguru-mendeko (6)**: `proba/froga` — `proba` baliozkoa da testuinguru
   batzuetan (proba fisikoa) baina ez bestetan (froga legala)
3. **Multi-helburu (5)**: `*ideologia anitza→askotariko ideologia, ideologia
   plurala` — 2+ zuzenak, aukeraketa testuinguruaren araberakoa
4. **Morfologiko (3)**: `*berdina→bera` deklinabide osoa (berdinean→berean,
   berdinak→berak...), `*jolastu→jokatu` adierazpena (jolasten→jokatuen...).
   Stem+atzizki match behar du
5. **Izen berezi (1)**: `*Errege Katolikoak→Errege-erregina Katolikoak` — F5
   gazetteer-era
6. **Zalantzazkoa (1)**: `?eskaini` — galdera-markak ziurtasunik ez duela adierazten du
7. **Erabilera-oharra (1)**: `ospatu` — baliozko hitza (ospatu = ospakizuna egin),
   baina erabilera okerra bilera/partidetan. Ez da kalkea, erabilera-gomendioa

### Egiaztapen-egoera

| Baieztapena | Iturria | Egiaztatuta? |
|---|---|---|
| EBE §1-k 34 sarrera ditu | `ebe-kal.txt` lerroak 5–96 | Bai |
| 8 sarrera garbi dira (hitza/esapide ordezkapena) | extraktorearen kategorizazioa | Bai |
| 4 garbi zalantzan daude jada | `validate_calques.mjs` cross-check | Bai |
| `europear` ez dago EH-n (0 emaitza) | EH bilaketa `osagaiakHasi` | Bai |
| `erabakior` EH-k `erabakigarri`-ra redirect | EH bilaketa (1 emaitza, redirect) | Bai |
| `erasokor` OEH-n bakarrik (historikoa) | EH bilaketa (OEH cross-link) | Bai |
| `balore` EH-n dago baina `balio`-ra cross-ref | EH bilaketa (3 emaitza, cross-ref) | Bai |
| Helburuak identikoak bi EBE ataletan | node script konparaketa | Bai |
| 0 zalantza↔kalke kate-arrisku | `validate_calques.mjs` (26 check) | Bai |

## 7.16 F5 ikerketa eta zalantza izendunak — testuinguru-menpekotasuna eta exonoimoak (batch 2a Phase 3)

### Aurkikuntza nagusia: F5 ezin da gazetteer hutsez ebatzi

EBE Maiuskulak atala (id=1023) sakon aztertu ondoren, **F5 (maiuskula
semantikoak) testuinguru-menpekoa dela baieztatu da**, eta ezin da
gazetteer (zerrenda determinista) hutsez ebatzi. Bi adibide argi:

1. **Erakundeak (§1.3)**: "Donostiako **Udala**" (erakunde zehatza, maiuskula)
   vs "Gipuzkoako **udaletan**" (orokorra, minuskula) — hitz bera,
   testuinguruaren arabera maiuskula edo minuskula

2. **Izar gorputzak (§1.6)**: "**Eguzkia**" (izarrondo-izena) vs "**eguzkia**"
   (izen arrunta, eguzki-argia) — EBE-k bereizketa hau ez du esplizituki
   zehazten, baina erabilera orokorrean bi adierak badaude

Gazetteer hutsak **gain-maiuskulatuko luke** eta c050 kasua apurtuko luke
("gaur eguzkia atera da" → minuskula "eguzkia"). Beraz, c091 (erakunde-maius),
c095 (izar gorputzak), c096 (ereduak gain-maiuskulatu) benetan
"zail-ezagunak" dira — testuinguru/POS analisia behar dute, ez arau
determinista.

### Birbideraketa: zalantza izendunak (exonoimoak)

F5 saihestuta, EBE zalantza-ataleko **izendunak** (proper nouns) aztertu
ziren. `zalantza-proper.tsv`-ko 35 sarreretatik 27 bikote bakar dira.
Hiru baztertu dira:

| Sarrera | Arrazoia |
|---|---|
| `ozkabarte` | Erauzketa hautsia ("santo domingo de la" — "Calzada" falta).
  Ziurrenik sarrera gaizki bideratua. Berriro erauzi arte baztertu |
| `donejakue` | Faltsu-positibo arriskua. "Donejakue" bakarrik baliozko hitza da
  (adjektiboa: "Donejakue bidea" ez ezik "donejakue eliza"). Helburua
  "Donejakue bidea" bakarrik Donejakue bideari buruz hitz egitean aplikatzen da |
| `donibane` | Faltsu-positibo arriskua. "Donibane" izen-osagai bat da, leku
  ANITZETAN erabiltzen dena (Donibane Garazi ≠ Donibane Lohizune). Helburua
  bakarrik Saint-Jean-de-Luz-i aplikatzen zaio |

### Norabidea egiaztatzea: kolore-analisia egia da

`ebe-zal.txt`-k kolorea galtzen du (testu soila). Erauzketak PDF kolore-analisia
erabili zuen (RED=gaitzespena, BOLD=estandarra). Bi sarrera zalantzan jarri
ziren baina egiaztatu ziren:

- **`kalagorria→Calahorra`**: EBE aurkibide analitikoak `*Kalagorria/Calahorra`
  erakusten du (`*` = gaitzetsia). EODA-k (Euskaltzaindiaren Onomastika
  Datubasea) "Calahorra" baieztatzen du forma ofizial bezala. Exonoimo bat da
  (Errioxako hiria, ez du euskal forma tradizionalik, gaztelaniazkoa mantendu)
- **`pertsia→Persia`**: ez da euskaratu gehiegi. "Persia" forma internazionala
  da, "Pertsia" goi-euskaraketa da

### matchCaseProper() — funtzio berria

Proper noun-entzako kasu-mantentze funtzio berezia sortu da. `matchCase()`-ren
(desberdintasun gakoa: proper noun-ak BETI maiuskulaz idazten dira:

| Sarrera (input) | `matchCase()` (izen arrunta) | `matchCaseProper()` (izenduna) |
|---|---|---|
| minuskula (`ukrania`) | `ukraina` (minuskula) | `Ukraina` (Title) |
| Title (`Ukrania`) | `Ukraina` (Title) | `Ukraina` (Title) |
| UPPER (`UKRANIA`) | `UKRAINIA` (UPPER) | `UKRAINA` (UPPER) |
| nahastua (`uKrania`) | `null` (saltatu) | `null` (saltatu) |

Helburua datu-fitxategian aurre-maiuskulatuta dago (adibidez,
"Erdialdeko Amerika", "Donibane Lohizune"). `matchCaseProper()` helburua
gorde den bezala itzult du minuskula/Title sarrerarako, eta `toUpperCase()`
UPPER sarrerarako.

### Inplementazioa

- **Datu-fitxategia**: `src/core/data/zalantza-proper.js` — 21 hitz bakun +
  3 esapide (24 sarrera guztira)
- **Araua**: `src/core/rules/zalantza-proper.js` — arau konbinatua
  (hitza bilaketa priority 49 + esapide leiho irristakorra priority 50)
- **LintKind**: `Confusable` (zalantzarekin partekatua)
- **`matchCaseProper()`** esportatzen da zalantza-proper.js-tik

### Egiaztapena

`/tmp/validate_proper.mjs` scriptak 24 check egin zituen — denak gainditu:

| Check | Emaitza |
|---|---|
| 21 hitz bakun + 3 esapide | ✓ |
| 0 bikoiztu | ✓ |
| 0 zalantza.js-rekin gainjartzea | ✓ |
| 0 zalantza-phrases.js-rekin gainjartzea | ✓ |
| 0 calque.js-rekin gainjartzea | ✓ |
| 0 idempotzia-kate (helburua RED-a da) | ✓ |
| RED guztiak minuskulaz | ✓ |
| Helburu guztiak maiuskulaz hasi | ✓ |
| 0 no-op (RED = helburua) | ✓ |
| 0 zalantza RED izango liratekeen helburuak | ✓ |

### Test emaitzak

- 46 test berri (`tests/core/zalantza-proper.test.mjs`) — denak gainditu
- Core testak: 41+18+50+39+41+46 = **235 guztira** — denak gainditu
- Cap-punct eval: 22/33 strict (aldaketarik gabe, zero erregresio)
- Vite build: OK

### Aurkikuntza gehigarriak

1. **`matchCaseProper` ez da `matchCase`-ren ordezkoa**: bi funtziok
   helburu desberdinak dituzte. Izendunentzako `matchCaseProper`, izen
   arruntentzako `matchCase`. Hirugarren kontsumitzaile batek (`calque.js`)
   `matchCase` erabiltzen du oraindik

2. **Esapide-puntuazio sentsibilitatea**: "big-bang" (marratxoa) ≠ "big bang"
   (hutsunea) — RED desberdinak dira, helburu desberdinekin. Esapide-arauak
   puntuazioa zehatz-mehatz konparatzen du, hitzak case-insensitive

3. **`donejakue` eta `donibane` ez dira F5 kasuak**: hauek ez dira maiuskula-
   arazoak, baizik eta testuinguru-menpeko ordezkapenak. F5 (maiuskula
   semantikoak) guztiz desberdina da — hitz bera bi testuingurutan
   (orokorra vs berezia). `donejakue`/`donibane` dira hitz zuzen bat
   testuinguru batzuetan baina ez besteetan

4. **c091/c095/c096 ezin dira arau deterministez ebatzi**: testuinguru/POS
   analisia behar dute. Etorkizuneko lana (batch 3+: POS tokenizatzailea)

### Egiaztapen-egoera

| Baieztapena | Iturria | Egiaztatuta? |
|---|---|---|
| F5 testuinguru-menpekoa da, ez gazetteer | EBE Maiuskulak id=1023 (§1.3, §1.6) | Bai |
| 24 izendun-bikote seguruak dira | `validate_proper.mjs` (24 check) | Bai |
| `kalagorria→Calahorra` norabidea zuzena da | EBE aurkibide analitikoa + EODA | Bai |
| `pertsia→Persia` norabidea zuzena da | EBE zalantza testua + linguistika | Bai |
| `ozkabarte` erauzketa hautsita dago | `ebe-zal.txt` lerroak 840-841 | Bai |
| `donejakue`/`donibane` faltsu-positibo arriskua | linguistika-analisia | Bai |
| `matchCaseProper` funtzioak proper noun-ak beti maiuskulatzen ditu | 46 unit test | Bai |
| 0 erregresio cap-punct ebaluan | `eval.mjs --check` 22/33 strict | Bai |

