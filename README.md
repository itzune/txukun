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
- **Fast** — model (~39MB quantized) is loaded once and cached

- **Spell checking** — word-list–based Basque spell checker (160k words) with click-to-fix suggestions, enhanced by **BERTeus neural re-ranking** (int4 ONNX, 85 MB) for context-aware candidate selection

### Coming soon (Phase 2)

- **Grammar correction** — AI-powered grammar suggestions
- **Diff view** — see exactly what changed
- **Real-time mode** — correct as you type

## 🧠 Model

Txukun uses **[itzune/txukun-cap-punct-eu](https://huggingface.co/itzune/txukun-cap-punct-eu)**, an ONNX int8 quantized export of [HiTZ/cap-punct-eu](https://huggingface.co/HiTZ/cap-punct-eu), a MarianMT model developed by [HiTZ Zentroa](https://hitz.eus/) (UPV/EHU):

| Property | Value |
|---|---|
| Architecture | MarianMT (encoder-decoder Transformer) |
| Parameters | ~77M |
| Training data | 9.78M Basque sentences |
| License | Apache 2.0 |
| Quantized size | ~77 MB (int8 ONNX) |

### Spell-check re-ranking model

For Tier 2 neural re-ranking, Txukun uses **[itzune/berteus-onnx](https://huggingface.co/itzune/berteus-onnx)** — an unofficial ONNX int4 conversion of [BERTeus](https://huggingface.co/ixa-ehu/berteus-base-cased), a monolingual Basque BERT model pre-trained on 224.6M tokens by the [IXA NLP Group](https://ixa.eus/) (UPV/EHU):

| Property | Value |
|---|---|
| Architecture | BERT (encoder only) |
| Parameters | ~110M (encoder) + ~39M (embeddings) |
| Quantized size | **85 MB** (int4 ONNX) + 74 MB (float16 embeddings) |
| Usage | Masked embedding similarity for candidate re-ranking |
| License | Apache 2.0 |

The model is lazy-loaded only when a spell error with ≥2 candidates is found.

## ⚠️ Limitations & Disclaimer

### 🔴 Hallucinations

The underlying **HiTZ/cap-punct-eu** model can produce **hallucinations** — made-up words that don't exist — especially on short, unusual, or out-of-distribution input. This is a known limitation of the model, not a bug in Txukun. The ONNX quantization to int8 slightly alters the hallucinations (different nonsense words) but does not change the root cause.

For best results, provide complete, well-formed sentences.

### 🟡 Spell checking

Spell correction runs in **two tiers**:

1. **Tier 1 — Candidate generation (deterministic):** A static 160,000-word dictionary (derived from [Xuxen](https://xhuxen.eus/) + a frequency-ranked corpus of 2.8M Basque sentences) generates candidates by **Levenshtein distance**, ranked by corpus frequency. No machine learning is involved in this step.

2. **Tier 2 — Neural re-ranking (BERTeus):** When a misspelled word has ≥2 candidates, a **[BERTeus](https://huggingface.co/ixa-ehu/berteus-base-cased)** model (Basque BERT, 110M params, int4 ONNX, 85 MB) re-ranks them by **masked embedding similarity** — it masks the misspelled word, reads the surrounding context bidirectionally, and scores each candidate by how well it fits. This resolves cases where frequency alone picks the wrong word (e.g. `batzutan` → wrong `batsutan` instead of correct `batzuetan`). On a 933-case benchmark, Tier 2 improves accuracy from 73.6% → 85.5% (+110 net corrections).

The BERTeus model is **lazy-loaded** only when a spell error with multiple candidates is found, so it adds no cost to normal typing.

### 🟦 Scope

Txukun is designed for **Basque text** (`eu`/`eus`). It will not work correctly for other languages.

## 🛡️ Error handling & fallback

Txukun is designed to **degrade gracefully** — if any component fails, the pipeline falls back to the previous tier rather than crashing:

| Component | Failure mode | Fallback behavior |
|---|---|---|
| **MarianMT cap-punct** | Model fails to load | Toast notification shown; correction disabled. Text passes through unmodified. |
| **MarianMT hallucination** | Model invents a word substitution (e.g. `Nire`→`Auzo`) | `constrainCapPunct()` compares input vs. output token-by-token: if the lowercase word form differs, the substitution is **rejected** and the original word is kept. If the token count changes, the entire line is rejected. Only capitalization/punctuation changes pass through. |
| **BERTeus re-ranker** | Model fails to load or errors | `bertRerank()` returns all-zero scores → candidates are ranked by **Tier 1 frequency alone** (the pre-BERTeus behavior). No crash, no broken output. |
| **Spell worker** | WASM Hunspell fails to init | Spell checking disabled; text still gets cap-punct correction. |
| **Empty input / model not ready** | — | Toast warning; no processing attempted. |

The net effect: **the worst case is that text comes out with only cap-punct correction and dictionary-frequency spell fixes** — never corrupted, never empty.

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

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

The model (`HiTZ/cap-punct-eu`) is licensed under Apache 2.0 by HiTZ Zentroa.

---

<p align="center">
  <sub>🧹 Built with ❤️ by <a href="https://itzune.eus">Itzune</a> — for Euskara</sub>
</p>
