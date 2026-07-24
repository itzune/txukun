# 🧹 Txukun — Euskarazko testu zuzentzailea

> Basque text correction tool — capitalization, punctuation, and spelling

[![Deploy](https://github.com/itzune/txukun/actions/workflows/deploy.yml/badge.svg)](https://github.com/itzune/txukun/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Txukun** is a browser-based tool that restores capitalization and punctuation in Basque text. It's the downstream complement to [Parakeet-eu](https://github.com/itzune/parakeet-eu) ASR, completing the speech-to-text pipeline:

```
🎤 Audio → Parakeet-eu (ASR) → lowercase text → 🧹 Txukun → properly formatted text
```

## 🌐 Website

[https://itzune.eus/txukun/](https://itzune.eus/txukun/)

## ✨ Features

- **Capitalization & punctuation** — restores caps and punctuation to raw/lowercase text
- **Privacy-first** — everything runs in your browser, text never leaves your device
- **Free & open-source** — built with open models and tools
- **Basque-first** — UI available in Basque and English
- **Fast** — models are loaded once and cached

- **Spell checking** — word-list–based Basque spell checker (160k words) with click-to-fix suggestions, enhanced by **BERTeus neural re-ranking** (int4 ONNX, 85 MB) for context-aware candidate selection
- **Grammar correction** — GECToR edit-based grammar correction (int4 ONNX, ~85 MB) fixes real-word errors like verb agreement, case, tense, and suffix mistakes that spell check cannot detect
- **Error detection heatmap** — GECToR's detection head flags suspected error words directly on the input text with a color-coded heatmap (amber → red by confidence), before any correction is applied

### Coming soon (Phase 2)

- **Diff view** — see exactly what changed
- **Real-time mode** — correct as you type

## 🧠 Models

Txukun uses **three neural models**, each addressing a different layer of Basque text quality. All run entirely in the browser via ONNX Runtime (WASM):

| # | Model | Role | Size | What it fixes |
|---|---|---|---|---|
| 1 | **[cap-punct-eu](https://huggingface.co/itzune/txukun-cap-punct-eu)** | Capitalization & punctuation | ~77 MB (int8) | Missing caps, periods, commas — e.g. `euskal herrian euskaraz bizi nahi dugu` → `Euskal Herrian euskaraz bizi nahi dugu.` |
| 2 | **[berteus-onnx](https://huggingface.co/itzune/berteus-onnx)** | Spell-check re-ranking | 85 MB (int4) + 74 MB (f16 embeddings) | Picks the right correction when multiple candidates exist — e.g. `batzutan` → `batzuetan` (not `batsutan`) |
| 3 | **[gector-eus](https://huggingface.co/itzune/gector-eus-onnx)** | Grammar correction + error detection | ~85 MB (int4) | Real-word grammar errors (wrong inflection) — e.g. `dio` → `zaio`, `zaidalaren` → `zaidalako` |

Each model is **lazy-loaded** only when needed, so they add no cost to normal typing. All three degrade gracefully — if any model fails to load, the pipeline falls back to the previous tier.

### Pipeline flow

```
Input text
  │
  ├─ 1. Spell check (Tier 1: dictionary + edit distance → Tier 2: BERTeus re-ranking)
  ├─ 2. Cap-punct (MarianMT)
  ├─ 3. Grammar correction (GECToR)
  │     └─ also: error detection heatmap on input (GECToR detect head)
  └─ 4. Spell check (remaining errors annotated)
  │
Output text
```

### Model 1 — Cap-punct (MarianMT)

### Model 2 — BERTeus (spell re-ranking)

For Tier 2 neural re-ranking, Txukun uses **[itzune/berteus-onnx](https://huggingface.co/itzune/berteus-onnx)** — an unofficial ONNX int4 conversion of [BERTeus](https://huggingface.co/ixa-ehu/berteus-base-cased), a monolingual Basque BERT model pre-trained on 224.6M tokens by the [IXA NLP Group](https://ixa.eus/) (UPV/EHU):

| Property | Value |
|---|---|
| Architecture | BERT (encoder only) |
| Parameters | ~110M (encoder) + ~39M (embeddings) |
| Quantized size | **85 MB** (int4 ONNX) + 74 MB (float16 embeddings) |
| Usage | Masked embedding similarity for candidate re-ranking |
| License | Apache 2.0 |

The model is lazy-loaded only when a spell error with ≥2 candidates is found.

### Model 3 — GECToR (grammar correction + detection)

For Tier 3 grammar correction, Txukun uses a **GECToR** (edit-based grammatical error correction) model fine-tuned on **RoBERTa-eus-base** (`ixa-ehu/roberta-eus-euscrawl-base-cased`), trained on 1M sentence pairs from the [Elhuyar GEC corpus](https://hitz.eus/es/geleriak/corpus-and-resources/erreparatu-corpus). The model is exported to ONNX int4 for browser deployment:

| Property | Value |
|---|---|
| Architecture | GECToR (RoBERTa encoder + label/detect heads) |
| Base model | RoBERTa-eus-base (110M params, 12L/768H) |
| Quantized size | ~85 MB (int4 ONNX) |
| Training data | 1M Elhuyar GEC pairs (grammar errors: verb agreement, case, tense, suffix) |
| Usage | Edit-based correction ($KEEP/$DELETE/$REPLACE/$APPEND), iterative (up to 5 passes) |
| Performance | F0.5 = 90.2, exact match 82.8%, false-positive 3.6% (at min_error_prob=0.5) |
| License | CC-BY-NC-SA 4.0 (trained on Elhuyar GEC corpus) — see license section below |

The model has **two heads** trained jointly, giving it two capabilities:

1. **Correction (Tier 3):** The label head predicts edit operations ($KEEP/$DELETE/$REPLACE/$APPEND) per token. This fixes real-word grammar errors — cases where every word is a valid dictionary word but the inflection is wrong in context (e.g. `zaidalaren` → `zaidalako`, `dio` → `zaio`).

2. **Detection (Tier 2.5):** The detect head predicts P(INCORRECT) per token — a confidence score for whether each word is wrong. This powers the **input heatmap**: after correction, the input text is overlaid with color-coded highlights (transparent → amber → red by confidence) showing which words the model suspected were errors. On the Elhuyar benchmark, the detect head achieves F1=95.0% and 99.5% locate accuracy (finds the exact error word).

**Correction benchmark** (full model, 1M pairs, Elhuyar Dem_single/none):

| min_error_prob | F0.5 | Exact match | FP rate |
|---|---|---|---|
| 0.0 | 90.0 | 82.8% | 4.4% |
| **0.5** | **90.2** | 81.4% | **3.6%** |
| 0.8 | 90.8 | 76.9% | 2.8% |

For comparison, GECToR-2024 (English, RoBERTa-large 300M, millions of pairs) scores F0.5=72.9 on BEA-dev.

The model is lazy-loaded in the background after the main pipeline initializes.

## ⚠️ Limitations & Disclaimer

### 🔴 Hallucinations

The underlying **HiTZ/cap-punct-eu** model can produce **hallucinations** — made-up words that don't exist — especially on short, unusual, or out-of-distribution input. This is a known limitation of the model, not a bug in Txukun. The ONNX quantization to int8 slightly alters the hallucinations (different nonsense words) but does not change the root cause.

For best results, provide complete, well-formed sentences.

### 🟡 Spell checking

Spell correction runs in **two tiers**:

1. **Tier 1 — Candidate generation (deterministic):** A static 160,000-word dictionary (derived from [Xuxen](https://xhuxen.eus/) + a frequency-ranked corpus of 2.8M Basque sentences) generates candidates by **Levenshtein distance**, ranked by corpus frequency. No machine learning is involved in this step.

2. **Tier 2 — Neural re-ranking (BERTeus):** When a misspelled word has ≥2 candidates, a **[BERTeus](https://huggingface.co/ixa-ehu/berteus-base-cased)** model (Basque BERT, 110M params, int4 ONNX, 85 MB) re-ranks them by **masked embedding similarity** — it masks the misspelled word, reads the surrounding context bidirectionally, and scores each candidate by how well it fits. This resolves cases where frequency alone picks the wrong word (e.g. `batzutan` → wrong `batsutan` instead of correct `batzuetan`). On a 933-case benchmark, Tier 2 improves accuracy from 73.6% → 85.5% (+110 net corrections).

3. **Tier 3 — Grammar correction (GECToR):** After cap-punct and spell check, a **GECToR** model fine-tuned on RoBERTa-eus-base detects and corrects **real-word grammar errors** — cases where every word is a valid dictionary word but the inflection is wrong in context (e.g. `zaidalaren` → `zaidalako`, `dio` → `zaio`). The model uses an edit-based approach ($KEEP/$DELETE/$REPLACE/$APPEND) with iterative prediction (up to 5 passes) and a detection threshold to avoid overcorrection.

4. **Error detection heatmap (GECToR detect head):** The same GECToR model's detect head provides a per-word P(INCORRECT) confidence score. After correction, the input text is overlaid with a **color-coded heatmap** — words the model suspects are wrong are highlighted from amber (low confidence) to red (high confidence). This gives instant visual feedback on which words the model flagged, before the user even looks at the output.

The BERTeus and GECToR models are **lazy-loaded** only when needed, so they add no cost to normal typing.

### 🟦 Scope

Txukun is designed for **Basque text** (`eu`/`eus`). It will not work correctly for other languages.

## 🛡️ Error handling & fallback

Txukun is designed to **degrade gracefully** — if any component fails, the pipeline falls back to the previous tier rather than crashing:

| Component | Failure mode | Fallback behavior |
|---|---|---|
| **MarianMT cap-punct** | Model fails to load | Toast notification shown; correction disabled. Text passes through unmodified. |
| **MarianMT hallucination** | Model invents a word substitution (e.g. `Nire`→`Auzo`) | `constrainCapPunct()` compares input vs. output token-by-token: if the lowercase word form differs, the substitution is **rejected** and the original word is kept. If the token count changes, the entire line is rejected. Only capitalization/punctuation changes pass through. |
| **BERTeus re-ranker** | Model fails to load or errors | `bertRerank()` returns all-zero scores → candidates are ranked by **Tier 1 frequency alone** (the pre-BERTeus behavior). No crash, no broken output. |
| **GECToR grammar** | Model fails to load or errors | `correctGrammar()` returns the original text unchanged. Grammar correction is silently skipped — text still gets cap-punct + spell correction. | |
| **Spell worker** | WASM Hunspell fails to init | Spell checking disabled; text still gets cap-punct + grammar correction. |
| **GECToR detection** | Detection forward pass errors | `detectGrammar()` returns empty detections — no heatmap shown. Correction still runs normally. |

The net effect: **the worst case is that text comes out with only cap-punct correction and dictionary-frequency spell fixes** — never corrupted, never empty. GECToR can be disabled via `?grammar=0` URL parameter.

## 🎯 Confidence filtering

Each model produces a confidence score for every suggestion. Low-confidence corrections are automatically suppressed to reduce **over-correction** (wrong changes) and **false positives** (inventing errors in clean text).

| Model | Confidence source | Threshold |
|---|---|---|
| GECToR (grammar) | P(INCORRECT) from detection head (0.0–1.0) | **0.05** |
| BERTeus (spelling) | Cosine similarity, normalized to 0–1 | **0.50** |
| MarianMT (cap-punct) | LCS alignment rate (1.0 = no word substitution) | **1.00** |

These thresholds were calibrated on a 220-case evaluation dataset (see [`txukun-cli/tests/gec-benchmark/`](https://github.com/itzune/txukun-cli/tree/main/tests/gec-benchmark)) via grid search. The MarianMT threshold of 1.00 effectively means: only accept corrections where the model changed case/punctuation but never substituted a word — this filters hallucinations like `Gaur`→`Euskarri` automatically.

**Result**: 22.7% → 38.6% accuracy (+15.9% absolute), cutting over-corrections from 139 → 66 and false positives from 12 → 1.

> ⚠️ **If models are updated or retrained**, these thresholds should be reviewed. Re-run the evaluation:
> ```bash
> # In txukun-cli:
> uv run python tests/gec-benchmark/run_eval.py --output /tmp/eval_results.json
> uv run python tests/gec-benchmark/confidence_per_model.py
> ```

Config is in `src/analyze.js` (`CONFIDENCE_THRESHOLDS` constant).

## 🚀 Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev          # → http://localhost:3000/txukun/

# Build for production
npm run build        # → dist/

# Preview production build
npm run preview

# Deploy to GitHub Pages
npm run deploy
```

### Project structure

```
txukun/
├── index.html              # Main page (Itzune design system)
├── public/                 # Static assets (CNAME)
├── src/
│   ├── main.js             # Entry point, model loading, correction pipeline, constrainCapPunct()
│   ├── spell.js            # Spell checking, candidate generation (Tier 1), BERTeus integration
│   ├── spell-worker.js     # WASM Hunspell worker (dictionary lookup + Levenshtein)
│   ├── bert-rerank.js      # BERTeus neural re-ranking (Tier 2, lazy-loaded, int4 ONNX)
│   ├── gector.js           # GECToR grammar correction (Tier 3) + error detection (Tier 2.5, int4 ONNX)
│   ├── i18n.js             # Basque/English translations
│   ├── ui-bindings.js      # DOM bindings, buttons, status
│   ├── ui-examples.js      # Example sentences
│   └── ui-toast.js         # Toast notifications
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Pages deploy
├── package.json
├── vite.config.js
└── README.md
```

## 🔗 Related projects

- **🔌 Txukun CLI** — same model as a command-line tool: [itzune/txukun-cli](https://github.com/itzune/txukun-cli)
- [Parakeet-eu](https://github.com/itzune/parakeet-eu) — Basque ASR (speech-to-text)
- [Nongoeuskara](https://github.com/itzune/nongoeuskara) — Basque dialect identification
- [Evaleu](https://github.com/itzune/evaleu) — Basque LLM evaluation leaderboard
- [HiTZ/cap-punct-eu](https://huggingface.co/HiTZ/cap-punct-eu) — The underlying model
- [itzune/txukun-cap-punct-eu](https://huggingface.co/itzune/txukun-cap-punct-eu) — ONNX int8 quantized model
- [itzune/berteus-onnx](https://huggingface.co/itzune/berteus-onnx) — BERTeus int4 ONNX (spell-check re-ranking)
- [ixa-ehu/berteus-base-cased](https://huggingface.co/ixa-ehu/berteus-base-cased) — Original BERTeus model (IXA NLP Group)
- [ixa-ehu/roberta-eus-euscrawl-base-cased](https://huggingface.co/ixa-ehu/roberta-eus-euscrawl-base-cased) — RoBERTa-eus-base (GECToR base model)
- **[gector-eus](https://github.com/itzune/gector-eus)** — Basque GECToR training (RoBERTa-eus-base + Elhuyar GEC)
- [itzune/gector-eus-onnx](https://huggingface.co/itzune/gector-eus-onnx) — GECToR int4 ONNX (grammar correction + detection)
- [gotutiyan/gector](https://github.com/gotutiyan/gector) — GECToR PyTorch implementation
- [Elhuyar GEC corpus](https://hitz.eus/es/geleriak/corpus-and-resources/erreparatu-corpus) — Basque GEC training data (CC-BY-NC-SA)

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

The model (`HiTZ/cap-punct-eu`) is licensed under Apache 2.0 by HiTZ Zentroa.

The BERTeus model (`ixa-ehu/berteus-base-cased`) is licensed under Apache 2.0 by the IXA NLP Group.

The RoBERTa-eus-base model (`ixa-ehu/roberta-eus-euscrawl-base-cased`) is licensed under Apache 2.0.

The GECToR grammar model (`itzune/gector-eus-onnx`) is licensed under **CC-BY-NC-SA 4.0**. The model weights are a derivative work of the **Elhuyar GEC corpus** (CC-BY-NC-SA): under the ShareAlike clause, the weights inherit the same license. This means **no commercial use** of the GECToR model weights. See the [gector-eus README](https://github.com/itzune/gector-eus#license) for details.

---

<p align="center">
  <sub>🧹 Built with ❤️ by <a href="https://itzune.eus">Itzune</a> — for Euskara</sub>
</p>
