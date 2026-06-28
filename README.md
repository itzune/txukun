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

- **Spell checking** — word-list–based Basque spell checker (160k words) with click-to-fix suggestions

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

## ⚠️ Limitations & Disclaimer

### 🔴 Hallucinations

The underlying **HiTZ/cap-punct-eu** model can produce **hallucinations** — made-up words that don't exist — especially on short, unusual, or out-of-distribution input. This is a known limitation of the model, not a bug in Txukun. The ONNX quantization to int8 slightly alters the hallucinations (different nonsense words) but does not change the root cause.

For best results, provide complete, well-formed sentences.

### 🟡 Spell checking

Txukun's spell checker is **not an AI or LLM**. It uses a static 160,000-word dictionary derived from:

- The [Xuxen](https://xhuxen.eus/) Basque spell checker (Hunspell-based)
- A frequency-ranked corpus of 2.8M Basque sentences

Corrections are made by **Levenshtein distance** (edit distance) against this dictionary, sorted by corpus frequency. No machine learning or language model is involved in the spell-checking step.

### 🟦 Scope

Txukun is designed for **Basque text** (`eu`/`eus`). It will not work correctly for other languages.

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
│   ├── main.js             # Entry point, model loading, correction logic
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

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

The model (`HiTZ/cap-punct-eu`) is licensed under Apache 2.0 by HiTZ Zentroa.

---

<p align="center">
  <sub>🧹 Built with ❤️ by <a href="https://itzune.eus">Itzune</a> — for Euskara</sub>
</p>
