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

*This research was conducted on 2026-06-28 by analyzing HiTZ's cap-punct-eu model, Xuxen/Basque Hunspell ecosystem, Transformers.js MarianMT support, existing Basque GEC literature, and Itzune's project patterns.*
