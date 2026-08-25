# LLM-RESEARCH.md — Fine-tuning a small LLM for Basque GEC via synthetic data

> **Ikerketa-data**: 2026-08-25
> **Galdera**: Is it viable to generate a synthetic Basque GEC dataset (using EBE + Berria Estilo Liburua as the error taxonomy) and fine-tune a small LLM on it, replacing/augmenting txukun's current 3-model + rule pipeline?
> **Laburbildura (TL;DR)**: **Bai — egiaztagarria eta frogatua dago.** The exact approach has already been published for Basque (Beloki et al., SEPLN) and the broader technique is the industry-standard method (Grammarly, Google Research). The hard constraint is **browser deployment**, not the dataset or training.

---

## 1. Executive summary

| Question | Answer | Confidence |
|---|---|---|
| Is the LLM-for-GEC trend real? | **Yes.** Grammarly, BEA-2025, EMNLP-2025 all confirm it. | High |
| Is synthetic error generation a proven technique? | **Yes.** Stahlberg & Kumar (2021, cited 148×), Google Research. Industry standard. | High |
| **Has it been done for Basque?** | **YES — Beloki et al. (SEPLN).** Seq2seq Transformer, rule-based error injection, 0.87 F0.5. | High |
| Do Basque LLMs exist to fine-tune? | **Yes.** Latxa (7B–70B), Llama-eus-8B (NAACL 2025, SOTA sub-10B). | High |
| Can a non-ML-expert execute this? | **Partially.** Dataset generation = pure programming (✓). Fine-tuning = needs LoRA tooling (Unsloth) — accessible but new skill. | Medium |
| Can the result run in txukun's browser? | **This is the hard constraint.** WebLLM ceiling = ~8B quantized (5GB, 1–3 min cold start). Current txukun models = ~85MB each. A 1–3B model is realistic; 7–8B is heavy. | Medium-Low |

**Verdict**: The synthetic dataset is **unambiguously worth building** — it is a reusable asset that improves txukun's rule layer *today* (as eval/training data for corruption rules) and enables LLM fine-tuning *tomorrow*. Whether a fine-tuned LLM replaces the current pipeline depends on solving the browser-size problem. The recommended path is **phased**: build the dataset first (no ML needed), then experiment with fine-tuning a small model, then evaluate browser viability last.

---

## 2. The trend: LLMs for GEC (industria-joera)

### 2.1 Grammarly — the industry leader's actual architecture

Grammarly's Strategic Research team has published their approach in two papers:

- **CoEdIT** (2023): LLMs trained *specifically* for text editing outperform general-purpose LLMs on editing tasks.
- **mEdIT** (NAACL 2024, Raheja et al.): Multilingual extension. Fine-tuned multilingual LLMs for **three tasks simultaneously**: grammatical error correction (GEC), text simplification, and paraphrasing.

Key findings from mEdIT, directly relevant to txukun:

1. **Small-to-medium LLMs suffice.** They fine-tuned models from ~1B to 15B parameters (mT5, mT0, BLOOMZ, PolyLM). "We push the performance of small- (~1B) to medium-sized LLMs (1-15B parameters)."
2. **Quality > quantity for training data.** "Quality doesn't improve noticeably as a function of data size; it improves as a function of data quality instead." They sampled only **10K examples per task per language** (398 for Spanish GEC — very low).
3. **Decoder-only (CLM) models performed best.** "CLMs either matched or exceeded the performance of all other models."
4. **Cross-task transfer works.** Training on GEC improved simplification and paraphrasing too.
5. **Generalizes to unseen languages.** The model worked on languages it wasn't fine-tuned on, as long as the base LLM had seen them in pre-training.
6. **Not yet in product for non-English.** "Grammarly does not incorporate this research into its product today." Their product remains English-focused; multilingual is research-stage.

**Source**: [Grammarly Engineering Blog — "Advancing AI-Powered Intelligent Writing Assistance across Multiple Languages"](https://www.grammarly.com/blog/engineering/advancing-intelligent-writing/) (Dec 2024)

### 2.2 Academic state (2025–2026)

The field has decisively moved to LLM-based GEC:

- **"Adapting LLMs for Minimal-edit Grammatical Error Correction"** (BEA 2025, Staruch et al.): Instruction-tuned LLMs produce high-quality corrections even zero-shot. Fine-tuning on detokenized GEC datasets improves results.
- **"Multi-Dimensional Evaluation of LLMs for Grammatical Error Correction"** (arXiv 2026): Fine-tuned GPT-4o evaluated; LLM judges reach 64% consensus on corrections where the model diverged from gold references.
- **"Post-Correction via LLM Grammatical Error Overcorrection"** (EMNLP 2025): Addresses the overcorrection problem — exactly the failure mode we see in txukun's MarianMT cap-punct model (the AHT article 100% FP rate).
- **"An LLM-Powered Grammatical Error Correction Agent"** (ACM 2026): LLM-based GEC agent for second-language learning.

The sequence-tagging approach (GECToR, which txukun uses) and seq2seq approach (MarianMT, which txukun uses) are now considered **baseline/legacy architectures**. The SOTA is instruction-tuned LLMs.

**Implication for txukun**: The current 3-model architecture (MarianMT cap-punct + GECToR grammar + BERTeus reranker) is a 2022-era design. The field has moved on. However — and this is important — txukun's *product* (the rule engine + pipeline orchestration + UI) is model-agnostic. Swapping the neural backend for a fine-tuned LLM is an architectural option, not a rewrite.

---

## 3. Synthetic data generation (datu sintetikoen sorkuntza)

### 3.1 The technique is established and proven

Synthetic error generation — taking correct text, injecting realistic errors, and training on the (corrupted, correct) pairs — is the **standard method** for GEC dataset creation, especially for low-resource languages.

**Foundational paper — Stahlberg & Kumar (BEA 2021, cited 148×)**:
["Synthetic Data Generation for Grammatical Error Correction with Tagged Corruption Models"](https://aclanthology.org/2021.bea-1.4/) (Google Research).

Key contribution: **"tagged corruption models"** — instead of random noise, they use **ERRANT error-type tags** to guide synthetic data generation. A corruption model produces an ungrammatical sentence given (a) a clean sentence and (b) an error-type tag. The error-type frequency distribution is matched to a real development set, so synthetic errors mirror real error distributions.

> This is **exactly** what the user is proposing: use EBE's error categories (punt/zal/kal) as the "error-type tags" and generate corrupted text accordingly. The user's idea is not novel — it is the published SOTA method. That's a *good* thing: it means the blueprint exists.

### 3.2 ERRANT — the error-type annotation toolkit

[ERRANT](https://github.com/chrisjbryant/errant) (ERRor ANnotation Toolkit, Bryant et al. 2017, cited 506×) automatically extracts and classifies edits from parallel (original, corrected) sentence pairs. It produces standardized error-type tags like `R:VERB:TENSE`, `M:DET`, `R:ORTH`, `U:ADJ`.

ERRANT exists for English, Greek (ELERRANT), and has been adapted for other languages. **There is no Basque ERRANT** — this is a gap txukun could fill, OR txukun could use its own EBE-based taxonomy (which is arguably better: EBE is normative, ERRANT is descriptive).

### 3.3 The corruption-script approach (Keita et al. 2024 — Zarma)

["Grammatical Error Correction for Low-Resource Languages: The Case of Zarma"](https://arxiv.org/abs/2410.15539) (Keita et al., 2024, cited 11×).

This is the closest analog to txukun's situation. They built a GEC system for Zarma (Nilo-Saharan, ~5M speakers, no annotated data) using:

1. **A noise/corruption script** with 4 operations: deletions (δ), insertions (μ), substitutions (σ), transpositions (τ).
2. Error types calibrated from real human transcription errors (5 native speakers transcribed audio; errors analyzed: 23% insertions, 12% deletions, <2% transpositions, <7% double vowels).
3. **248K synthetic + 2K human-annotated examples** = 250K total.
4. Trained 3 models: Gemma 2B (LLM), MT5-small (LLM), M2M100 (MT model).

**Results (critical for txukun)**:

| Method | Detection | Correction | FP rate | Manual eval (1-5) |
|---|---|---|---|---|
| Rule-based | 100% | 96.27% | 2.5% | 0.4 (failed context) |
| Gemma 2B (LLM) | 76.19% | 43.28% | 15.3% | 1.0 |
| MT5-small (LLM) | 90.62% | 57.15% | 8.7% | 1.7 |
| **M2M100 (MT)** | **95.82%** | **78.90%** | **4.2%** | **3.0** |

**Key lesson**: In a truly low-resource setting, **MT models beat LLMs** for GEC. The LLMs (Gemma, MT5) were *not pre-trained on Zarma*, so they performed poorly and had high false-positive rates (15.3%, 8.7%). The MT model (M2M100) won because it learns the incorrect→correct mapping directly.

**Does this apply to Basque?** **No — and this is the crucial difference.** Basque is NOT truly low-resource in the LLM sense:
- Basque HAS dedicated LLMs (Latxa 7B–70B, Llama-eus-8B) that *were* pre-trained on Basque.
- The Zarma LLMs' disadvantage (no pre-training data) **does not apply** to Basque.
- A Basque-pre-trained LLM fine-tuned on synthetic GEC data should perform far better than Gemma-2B-on-Zarma did.

The Zarma paper's authors explicitly hypothesize this: *"in higher computational resource settings, LLMs could outperform all other methods, leveraging their capacity for nuanced language understanding when adequately pre-trained and resourced."* Basque meets that condition; Zarma did not.

### 3.4 The Emergent Mind survey (Dec 2025)

["Synthetic Error Injection"](https://www.emergentmind.com/topics/synthetic-error-injection) (Emergent Mind, Dec 2025) — confirms synthetic error injection is an active, growing technique as of late 2025, with applications beyond GEC (data augmentation, robustness testing).

---

## 4. Basque-specific resources (euskara-baliabideak)

Basque is **far better positioned** than typical low-resource languages. The necessary infrastructure already exists:

### 4.1 Basque LLMs (fine-tuning base models)

| Model | Size | Base | Paper/Venue | License | Suitability for browser |
|---|---|---|---|---|---|
| **Latxa** | 7B, 13B, 70B | Llama 2 | [Etxaniz et al., ACL 2024](https://arxiv.org/abs/2403.20266) (cited 69×) | Open | 7B = 5GB (heavy but possible) |
| **Llama-eus-8B** / **Llama-eus-8B-instruct** | 8B | Llama | [Corral et al., NAACL 2025](https://aclanthology.org/2025.naacl-long.629/) (cited 13×) | — | 8B = 5GB (at the ceiling) |
| BERTeus | 110M | BERT | ixa-ehu | — | ✓ Already used by txukun (reranker) |
| RoBERTa-eus | 125M | RoBERTa | HiTZ | — | ✓ (GECToR base) |

**Latxa** (HiTZ Center): Continual pre-training of Llama 2 on a new 4.3M-document / 4.2B-token Basque corpus. Outperforms all prior open Basque models by a large margin. Competitive with GPT-4 Turbo in language proficiency. **The 7B variant is the smallest and is the realistic candidate for browser deployment.**

**Llama-eus-8B** (Corral, Sarasua, Saralegi — Elhuyar): Continual pre-training on ~600M Basque words (+12 NLU points), then instruction tuning + human-preference alignment using auto-translated datasets (+24 instruction-following points). **SOTA for Basque in the sub-10B category.** This is the strongest candidate base model.

> **Critical connection**: Ander Corral and Xabier Saralegi, the authors of Llama-eus-8B, are **also the authors of the Basque GEC synthetic-data paper** (Beloki et al., SEPLN — see §5 below). The same research group has done both pieces of work. The expertise to combine them exists in the Basque NLP community.

### 4.2 Basque corpora (source text for clean sentences)

| Corpus | Size | Source | Use |
|---|---|---|---|
| **Latxa pre-training corpus** | 4.2B tokens | Web crawl + news | Clean Basque text source |
| **Berria news archive** | ~500K articles | Berria newspaper | Used by Beloki et al.; high-quality journalism |
| **Euskorpora** | Multi-genre | euskorpora.eus | Aggregated Basque corpus |
| **HiTZ data resources** | Various | hitz.eus/data | NLP datasets |
| **Sketch Engine Basque** | Large | Commercial | Text analysis |
| **Elhuyar/Orai resources** | Various | orai.eus/resources | Language tech resources |

The Berria archive (~500K articles) is the same source Beloki et al. used. It is the natural source of "clean" Basque sentences for synthetic error injection.

### 4.3 Basque evaluation benchmarks

- **BasqueGLUE** — natural language understanding benchmark for Basque.
- **EusProficiency / EusReading / EusTrivia / EusExams** — Latxa's evaluation suite (5,169 + 352 + 1,715 + 16,774 questions).
- **No Basque GEC benchmark exists** — txukun's EBE-grounded eval suites (cap-punct 33 cases, EBE-rules 43 cases) are the only such resources. This is both a gap and an opportunity.

---

## 5. The existing Basque GEC work (aurretiazko lana)

### 5.1 Beloki et al. — THE blueprint

["Grammatical Error Correction for Basque through a seq2seq neural architecture and synthetic examples"](http://journal.sepln.org/sepln/ojs/ojs/index.php/pln/article/view/6271) (Beloki, Saralegi, Ceberio, Corral — SEPLN / Procesamiento del Lenguaje Natural).

This paper is **exactly what the user is proposing**, already executed for Basque:

- **Architecture**: seq2seq Transformer (not a modern decoder-only LLM, but the same family).
- **Problem**: "As there is no training data for this language..."
- **Solution**: "We have developed a rule-based method to generate grammatically incorrect sentences from a collection of correct sentences extracted from a corpus of **500,000 news in Basque**" (the Berria archive).
- **Method**: Rule-based error injection → synthetic (corrupted, correct) pairs → train Transformer models.
- **Experiments**: Different training datasets built according to different strategies for combining synthetic examples.
- **Result**: Best model achieved **0.87 F0.5 score**.
- **Authors**: Zuhaitz Beloki, Xabier Saralegi, Klara Ceberio, Ander Corral — **Elhuyar/HiTZ** (Saralegi and Corral are the Llama-eus-8B authors).

**What this means for txukun**:

1. The approach is **proven for Basque**, not hypothetical.
2. The Berria-corpus source is validated.
3. 0.87 F0.5 is a strong baseline — a modern LLM fine-tune (Latxa-7B / Llama-eus-8B) should exceed it.
4. The authors are accessible (Elhuyar is a Basque-language institution; txukun is part of the Itzune ecosystem). Collaboration or at least methodological guidance is plausible.
5. The paper used seq2seq Transformers (2022-era). The natural next step — which no one has published yet for Basque — is to redo it with a **modern instruction-tuned Basque LLM**. This is the opening txukun could fill.

### 5.2 Méndez (2023) — EHU thesis

["Error Generation for a Grammar Checker in Basque: Correction and Detection"](https://addi.ehu.eus/handle/10810/61820) (Ariane Méndez Amuchategui, UPV/EHU, 2023).

Master's thesis: "A method for automatic generation of grammatically incorrect sentences, which can later be used for training Neural Grammar Error Correction and Detection models. The quality of the generated synthetic data is also evaluated in this work by training and testing such models."

Confirms the technique is being actively pursued for Basque at EH U. The methodology is established in the local academic community.

### 5.3 Other Basque GEC work

- **"Determiner errors in Basque: analysis and Automatic Detection"** (ResearchGate) — error classification work for Basque.
- **"Multilingual Grammatical Error Annotation"** (arXiv 2506.07719, 2025) — multilingual error annotation framework; may be adaptable to Basque.

---

## 6. Browser deployment feasibility (arakatzaile-mugak)

This is the **hard constraint** and the main risk.

### 6.1 WebLLM — the state of the art for in-browser LLM inference

[WebLLM](https://github.com/mlc-ai/web-llm) (MLC AI, 18,500+ GitHub stars, Apache 2.0) is the standard for running LLMs in browsers:

- **Technology**: WebGPU (GPU acceleration) + WebAssembly + Web Workers.
- **Performance**: ~80% of native inference speed.
- **API**: OpenAI-compatible (drop-in for existing code).
- **Browser support**: Chrome 113+, Edge 113+, Safari 26+, Firefox 141+, Chrome Android 121+. **~80% of users.**
- **Features**: streaming, JSON mode, function calling, Web Workers (non-blocking), Service Workers (persistent).

### 6.2 The size ceiling — the real problem

From WebLLM's documented model catalog and practical limits:

| Model | Params | Download size | VRAM | Cold start (first) | Cold start (cached) | Tok/s (WebLLM) |
|---|---|---|---|---|---|---|
| SmolLM2-360M | 360M | 130MB | low | 5–15s | 1–3s | fast |
| Llama-3.2-1B | 1B | 900MB | low | 15–45s | 3–10s | ~10 |
| Gemma-2-2B | 2B | 2GB | moderate | 15–45s | 3–10s | — |
| Llama-3.2-3B | 3B | 2.2GB | moderate | 15–45s | 3–10s | — |
| Phi-3.5-mini | 3.8B | 3.7GB | high | 15–45s | 3–10s | 71 |
| **Mistral-7B** | 7B | 5GB | 4–6GB | **1–3 min** | 10–30s | — |
| **Llama-3.1-8B** | 8B | 5GB | 4–6GB | **1–3 min** | 10–30s | 41 |

**"Practical model ceiling is ~8B parameters quantized, due to browser memory limits."** (LocalAI Master, Feb 2026)

**For txukun, compare**:
- Current models: MarianMT q8 (~77MB), BERTeus int4 (85MB), GECToR int4 (~85MB). Total ~250MB. Cold start ~8s.
- A 7B Basque LLM (Latxa-7B q4): ~5GB download, 1–3 min cold start, 10–30s cached.

**This is a 20× size increase and 10× slower cold start.** For a browser tool, that is a serious UX regression. Users on mobile or slow connections would not tolerate a 5GB download.

### 6.3 The realistic options

1. **1–3B model** (Llama-3.2-1B/3B-class, fine-tuned on Basque GEC): ~900MB–2.2GB. Heavy but conceivably acceptable for a "power user" mode. But: does a 1–3B model fine-tuned on Basque GEC actually outperform txukun's current 3-model pipeline? Unknown. Small models have less capacity.

2. **7–8B model** (Latxa-7B / Llama-eus-8B, q4): ~5GB. At the browser ceiling. Realistically a desktop-only, "opt-in AI mode" feature. Not viable as the default path.

3. **Hybrid**: Keep the rule engine + current small neural models as the default (instant, ~250MB). Offer the fine-tuned LLM as an **optional "AI suggestions" mode** for users who want deeper corrections and are willing to download a large model. This aligns with txukun's existing architecture (rules always run; models are lazy-loaded).

4. **Server-side fallback**: If browser deployment proves infeasible, the same fine-tuned model could run on a server (Orai/Elhuyar infrastructure, or HuggingFace Inference). This sacrifices the "100% private, runs in your browser" principle but is the fallback the AGENTS.md already acknowledges as a design tension.

### 6.4 Transformers.js vs WebLLM

Txukun currently uses **Transformers.js** (@huggingface/transformers) for ONNX model loading. WebLLM is a separate stack (MLC-compiled models, not ONNX). They are [compared](https://zenvanriel.com/ai-engineer-blog/transformers-js-vs-web-llm-which-is-faster/):

- **Transformers.js**: Better for encoder/classifier models (BERT, GECToR). Uses ONNX Runtime Web. What txukun uses now.
- **WebLLM**: Better for generative decoder LLMs. Uses MLC compilation. OpenAI-compatible API.

If txukun adopts an LLM, it would likely add WebLLM as a second inference engine alongside Transformers.js — a significant integration. The good news: WebLLM's OpenAI-compatible API means the integration is well-defined.

---

## 7. The proposed synthetic dataset (datu-sortzailea)

### 7.1 What the user proposed (and why it's right)

The user's proposal, mapped to the research:

| User's idea | Research validation |
|---|---|
| Take good Basque text, generate errors, pair (bad, good) | ✓ Stahlberg 2021, Keita 2024, Beloki (Basque) — standard method |
| Use EBE as the error taxonomy | ✓ Equivalent to ERRANT tags; EBE is *better* (normative vs descriptive) |
| Use Berria Estilo Liburua | ✓ Style-layer guidance; Berria corpus is the validated clean-text source |
| Structured output: categorize (grammar, spell, punct, caps) | ✓ Instruction-tuning format (Keita's "Error Causes" field); enables per-category correction |
| Choose what level of correction to apply | ✓ mEdIT's multi-task design; Grammarly's approach |
| Fine-tune a small LLM | ✓ Latxa-7B / Llama-eus-8B are the base models |

### 7.2 Error taxonomy: EBE as the corruption spec

Txukun already has the EBE error taxonomy extracted and structured:

| EBE section | Content | Txukun status | Error category |
|---|---|---|---|
| **Puntuazioa** (§1) | Punctuation + capitalization rules | ✓ Extracted (`ebe-punt.txt`), rules implemented | Punctuation, Capitalization |
| **Zalantza-hitzak** | 720 doubtful-word pairs | ✓ Data shipped (`zalantza.js`, 720 pairs) | Spelling / Word choice |
| **Zalantza-esapideak** | 52 multi-word phrases | ✓ Data shipped (`zalantza-phrases.js`) | Spelling / Word choice |
| **Zalantza izendunak** | 24 proper-noun pairs | ✓ Data shipped (`zalantza-proper.js`) | Spelling (proper nouns) |
| **Kalko lexikoak** (§1) | 4 lexical calques | ✓ Data shipped (`calque.js`) | Word choice |
| **Kalko morfosint.** (§2) | 44 syntactic calque categories | ✓ Categorized (5 tiers A–E), 2 implemented | Grammar |

This is **already a structured error taxonomy** — the corruption spec. A synthetic-data generator would, for each clean sentence, pick error-type tag(s) from this taxonomy and apply the corresponding corruption.

### 7.3 Proposed dataset format (structured output)

Building on Keita's "Error Causes" format and mEdIT's instruction format:

```json
{
  "id": "syn-00001",
  "source": "berria-2023-04-12-art42-s3",
  "clean": "Euskal Herriko tren azpiegitura hobetzeko proiektua aurkeztu zuten atzo.",
  "corrupted": "euskal herriko tren azpiegitura hobetze proiektua aurkeztu zuten atzo",
  "errors": [
    {
      "type": "capitalization",
      "ebe_ref": "Puntuazioa §1.1 (Maiuskulak)",
      "span": [0, 5],
      "from": "euskal",
      "to": "Euskal",
      "cause": "Esaldi-hasierako maiuskula falta."
    },
    {
      "type": "spelling",
      "ebe_ref": "Zalantza-hitzak",
      "span": [27, 34],
      "from": "hobetze",
      "to": "hobetzeko",
      "cause": "Hobetze → hobetzeko (zalantza-hitza)."
    }
  ],
  "categories_present": ["capitalization", "spelling"],
  "difficulty": "medium"
}
```

This format enables:
- **Seq2seq training**: `(corrupted → clean)` pairs (Beloki's approach).
- **Instruction tuning**: `"Zuzendu esaldi hau: [corrupted] → [clean]. Akatsak: [errors]"` (Keita/mEdIT approach).
- **Per-category evaluation**: measure the model on each error type separately.
- **Selective correction**: prompt the model to fix only `spelling` or only `capitalization`.

### 7.4 Corpus source and scale

- **Clean text**: Berria archive (~500K articles). Beloki et al. used this; it's validated.
- **Scale target**: Grammarly's finding (10K high-quality examples per task per language) suggests we don't need millions. A focused dataset of **50K–100K sentences** with 1–3 errors each, balanced across EBE categories, is likely sufficient for a strong fine-tune. This is far smaller than Zarma's 248K and very achievable.

### 7.5 License considerations

- **EBE** (Euskaltzaindia): Normative reference. Txukun already uses it as the rule source (see `RESEARCH.md` §7.14). Using it to *guide* synthetic data generation (the error taxonomy) is consistent with current usage.
- **Berria Estilo Liburua**: All rights reserved, editorial (not normative). See `RESEARCH.md` §7.14. Cannot be copied, but can inform the *style* layer and error-type selection. The Berria *corpus* (the news articles themselves) has its own licensing — would need to confirm with Berria/Elhuyar whether the archive is available for research/training. Beloki et al. used it, so a path exists.
- **Synthetic data we generate**: Ours to license (recommend CC-BY 4.0 or CC0 to maximize reuse — this is a community asset).

---

## 8. Fine-tuning feasibility (fine-tuning-egiaztagarritasuna)

### 8.1 The tooling is accessible (but it is ML work)

The user is "not an ML expert." Two levels of effort:

**Level 1 — Dataset generation (NO ML knowledge needed)**:
This is pure programming. A corruption script that takes clean text + EBE error rules and outputs (corrupted, clean, annotations) pairs. Txukun already has the EBE rules implemented in JavaScript (`src/core/rules/`). A Node.js script that runs the rules *in reverse* (inject errors instead of detecting them) is straightforward. This is 90% of the value and 10% of the ML difficulty.

**Level 2 — Model fine-tuning (some ML knowledge needed)**:
This requires running a LoRA/QLoRA fine-tune on a GPU. Tools that make this accessible:

- **[Unsloth](https://unsloth.ai)**: The most beginner-friendly fine-tuning framework. "If you're a beginner, it is best to start with a small instruct model like Llama 3.1 (8B)." 2× faster, 70% less memory than standard. Notebook-based tutorials. Supports Llama, Phi, Gemma, Qwen.
- **[Axolotl](https://github.com/axolotl-ai-cloud/axolotl)**: More powerful, YAML-config-driven. Added LoRA optimizations in 2025. Steeper learning curve.
- **[LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory)**: GUI-based, very accessible.

**Level 2 is where the user would need help** — either from the Elhuyar/HiTZ community (who have done exactly this for Llama-eus), from an ML collaborator, or by following Unsloth tutorials carefully. It is not out of reach for a motivated developer, but it is genuinely new skill territory.

### 8.2 Hardware requirements

- **Fine-tuning Latxa-7B / Llama-eus-8B with QLoRA**: A single consumer GPU (RTX 3090/4090, 24GB VRAM) or a cloud instance (A100, T4×2). Google Colab Pro ($10/mo) can run QLoRA on 7B models. The Zarma paper used T4×2 and P100.
- **Fine-tuning a 1–3B model**: Even cheaper — runs on free Colab.
- **This is a one-time cost** (or periodic retraining), not an ongoing operational cost.

### 8.3 The base-model decision

| Option | Pros | Cons |
|---|---|---|
| **Llama-eus-8B-instruct** | SOTA Basque sub-10B; already instruction-tuned; same authors as the GEC paper | 8B = heavy for browser; may need license check |
| **Latxa-7B** | Strong Basque; open license; 7B = slightly smaller | Not instruction-tuned (need instruction tuning step) |
| **Llama-3.2-3B + Basque GEC fine-tune** | Small enough for realistic browser deployment | Weak Basque pre-training (Llama 3.2 is multilingual but light on Basque) — may underperform |
| **SmolLM2-360M / 1B + Basque GEC** | Tiny, fast, browser-friendly | Almost certainly too small for quality GEC |

The tension: **the models with the best Basque (7–8B) are too big for comfortable browser use; the models small enough for the browser (1–3B) have weak Basque.** This is the core problem.

**Possible resolution**: Fine-tune Latxa-7B for quality (research/server mode), AND fine-tune a 3B-class model (e.g., Qwen2.5-3B or Gemma-2-2B, which have decent multilingual coverage) for browser mode. Compare. If the 3B model is "good enough," ship it; if not, the 7B becomes an opt-in power mode.

---

## 9. Viability assessment (bideragarritasuna)

### 9.1 What is clearly viable (high confidence)

1. **Building the synthetic dataset.** Pure programming. EBE taxonomy already extracted. Berria corpus validated by Beloki et al. Corruption script is the mirror of txukun's existing rule engine. **No ML knowledge required.**
2. **The dataset improves txukun immediately** — even without any LLM. It becomes: (a) a larger eval suite (replace the 33+43 case golden sets with 1000s of cases), (b) training data for expanding the rule engine's coverage, (c) the foundation for future LLM work.
3. **Fine-tuning a Basque LLM on the dataset** is technically proven (Beloki did it with seq2seq; Latxa/Llama-eus make a far better base). The method exists; the tooling (Unsloth) is accessible.

### 9.2 What is uncertain (medium confidence)

1. **Whether a fine-tuned LLM significantly outperforms txukun's current 3-model + rule pipeline.** The current pipeline, after the ASR-gate fix, has 0 false positives on well-formed text and 22/22 on the ASR golden suite. An LLM would need to beat that while controlling overcorrection (the known LLM failure mode, per EMNLP 2025). Unknown without experiment.
2. **Whether the fine-tuned model can be small enough for the browser.** This is the make-or-break question. A 1–3B fine-tuned model's quality is unknown.
3. **The effort to convert a HuggingFace fine-tuned model to WebLLM/MLC format** for browser deployment. WebLLM requires MLC-compiled models, not standard HF/ONNX. This is an extra conversion step with its own tooling.

### 9.3 What is not viable (low confidence / blocked)

1. **Replacing txukun's default path with a 7–8B LLM.** 5GB download + 1–3 min cold start is not acceptable as the default for a browser tool. At most an opt-in mode.
2. **The user doing the fine-tuning entirely solo without any ML guidance.** Possible with Unsloth tutorials, but the risk of spending weeks on a model that doesn't beat the current pipeline is real. Collaboration with Elhuyar/HiTZ (who have the exact expertise) would de-risk this enormously.
3. **A "pure LLM" replacement of the rule engine.** The Zarma paper and txukun's own experience both show rules are better at spelling/deterministic fixes (100% detection, 2.5% FP) while neural is better at context. The hybrid (rules + neural) architecture txukun already has is the correct design. An LLM would *augment*, not replace, the rule layer.

---

## 10. Recommended plan (gomendatutako plana)

Phased to deliver value at every step, with no ML required for Phase 1.

### Phase 1 — Synthetic dataset (no ML, pure programming) ✓ HIGHEST VALUE

**Goal**: Generate 50K–100K structured (corrupted, clean, annotations) pairs from Berria corpus + EBE taxonomy.

**Steps**:
1. Obtain Berria corpus access (or use HiTZ/Euskorpora Basque text if Berria licensing blocks).
2. Build the **corruption engine** — the mirror of `src/core/rules/`. For each EBE rule that detects `(bad → good)`, implement an injector `(good → bad)`. E.g., zalantza-words injector randomly replaces `ahots` with `abots` in clean sentences; cap-punct injector strips sentence-initial capitals; terminal-punct injector drops periods.
3. Calibrate error-type frequencies (Stahlberg's "match development set" insight): sample error types proportional to their real-world frequency (from txukun's eval suites + the AHT/Berria article testing).
4. Output the JSON format from §7.3, with `ebe_ref`, `cause`, `categories_present` fields.
5. **Publish as open data** (CC-BY 4.0) on HuggingFace — this is a community asset that fills a real gap (no Basque GEC dataset exists).

**Deliverable**: `itzune/txukun-gec-synthetic` dataset on HuggingFace.

**Immediate txukun benefit**: The dataset doubles as a **massive eval suite** — run the current pipeline against 1000s of cases, get real quality signal, find systematic failures. Replaces the hand-curated 33+43 case golden sets with statistically meaningful evaluation.

**Effort**: 2–4 weeks of programming. No GPU, no ML.

### Phase 2 — Baseline measurement + rule expansion (no ML)

**Goal**: Use the Phase 1 dataset to measure and improve txukun's current pipeline.

**Steps**:
1. Run the current 3-model + rule pipeline against the synthetic dataset. Measure per-category (cap/punct/spell/grammar) precision, recall, F0.5.
2. Identify the error categories where the current pipeline is weakest (likely: the EBE §2 syntactic calques, which are currently 2/43).
3. Expand the rule engine to cover more cases, using the dataset as the training/eval signal.

**Deliverable**: Txukun v3 with expanded rule coverage, measured against a real dataset.

**Effort**: 2–3 weeks. Still no ML.

### Phase 3 — LLM fine-tune experiment (ML work, needs guidance)

**Goal**: Fine-tune Latxa-7B / Llama-eus-8B on the Phase 1 dataset. Measure against the same eval.

**Steps**:
1. Format the dataset for instruction tuning (mEdIT/Keita format).
2. QLoRA fine-tune Latxa-7B-instruct or Llama-eus-8B-instruct using Unsloth, on Colab/cloud GPU.
3. Evaluate: does the fine-tuned LLM beat the Phase 2 rule-expanded pipeline? On which categories?
4. Measure overcorrection rate (the known LLM failure mode).

**Deliverable**: A fine-tuned Basque GEC LLM on HuggingFace. A decision: is it good enough to ship?

**Effort**: 2–4 weeks, requires GPU access and ML learning/collaboration.

**Risk**: The LLM may not beat the hybrid pipeline. Grammarly's own research isn't in their product yet. This is real research, not guaranteed.

### Phase 4 — Browser deployment (only if Phase 3 succeeds)

**Goal**: Make the fine-tuned LLM run in the browser via WebLLM.

**Steps**:
1. Convert the fine-tuned model to MLC format (WebLLM's requirement).
2. Test in-browser: download size, cold start, inference speed, quality.
3. If the 7–8B model is too heavy, distill/fine-tune a 1–3B model and repeat.
4. Integrate as an **opt-in "AI mode"** alongside the existing rule + small-neural default path.

**Deliverable**: Txukun with optional LLM-powered AI suggestions mode.

**Effort**: 3–6 weeks. May fail (browser constraints may be unsolvable for the needed quality).

### Decision gates

- **Gate A** (after Phase 1): Is the dataset good quality? If yes → publish, proceed. If no → improve corruption engine.
- **Gate B** (after Phase 2): Did rules close the gap? If the rule-expanded pipeline reaches ~95% F0.5, the LLM may not be worth the complexity.
- **Gate C** (after Phase 3): Does the LLM beat the pipeline by a meaningful margin (>5% F0.5) without excessive overcorrection? If no → stop, the hybrid pipeline is the product.
- **Gate D** (after Phase 4): Does the LLM run acceptably in-browser? If no → keep it server-side or as a research artifact.

---

## 11. Risks and unknowns (arriskuak)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fine-tuned LLM overcorrects (EMNLP 2025 finding) | High | High | Measure FP rate explicitly; the ASR-gate approach may generalize |
| Browser can't fit a good-enough model | Medium-High | High | Phase 4 is gated; hybrid pipeline remains the default |
| Berria corpus licensing blocks use | Medium | Medium | Use HiTZ/Euskorpora; Beloki et al. found a path |
| User lacks ML skills for Phase 3 | High (for solo) | Medium | Collaborate with Elhuyar/HiTZ; use Unsloth; Phase 1–2 deliver value regardless |
| Synthetic errors don't match real error distribution | Medium | Medium | Calibrate from real text (AHT/Berria articles); Stahlberg's frequency-matching method |
| LLM doesn't beat the current pipeline | Medium | Medium | Phase 3 is research; the dataset (Phase 1) is valuable regardless |
| WebLLM model conversion is hard/lossy | Medium | Medium | Test early with a small model in Phase 4 |
| Latxa/Llama-eus license restricts commercial use | Low-Medium | Medium | Check licenses before Phase 3; both are described as "open" |

---

## 12. Recommendation (gomendioa)

**Build the synthetic dataset (Phase 1) now.** It is:
- **Low risk** (pure programming, no ML, proven method).
- **High value** (improves txukun's eval immediately; fills a community gap; enables all future ML work).
- **Reusable** (whether txukun eventually uses an LLM, expands rules, or stays hybrid, the dataset serves all paths).
- **Aligned with the product-vs-models distinction** (the dataset is a *product* asset; any model trained on it is a *component*).

**Defer the LLM fine-tune (Phase 3) until**:
1. Phase 1–2 are done and the rule-expanded pipeline's quality is measured.
2. A collaboration or learning path for the ML work is identified (Elhuyar/HiTZ outreach, or Unsloth self-study).
3. The browser-deployment question (Phase 4) has been sanity-checked with a small model.

**The single most important insight**: txukun's *product* (rule engine + pipeline + UI + EBE grounding) is the valuable, defensible layer. The neural models are swappable components. A synthetic dataset strengthens the product layer (better eval, better rules) *and* enables better components (LLM fine-tuning). It is the highest-leverage work available, and it does not require becoming an ML expert to start.

---

## References (erreferentziak)

### Industry / architecture
- Grammarly — mEdIT (NAACL 2024): https://www.grammarly.com/blog/engineering/advancing-intelligent-writing/ · Paper: https://arxiv.org/pdf/2402.16472v2
- Staruch & Staruch — "Adapting LLMs for Minimal-edit GEC" (BEA 2025): https://aclanthology.org/anthology-files/pdf/bea/2025.bea-1.9.pdf
- "Post-Correction via LLM Grammatical Error Overcorrection" (EMNLP 2025): https://aclanthology.org/2025.emnlp-main.1431/
- "An LLM-Powered GEC Agent" (ACM 2026): https://dl.acm.org/doi/10.1145/3785987.3786075

### Synthetic data generation
- Stahlberg & Kumar — "Synthetic Data Generation for GEC with Tagged Corruption Models" (BEA 2021, cited 148×): https://aclanthology.org/2021.bea-1.4/
- Keita et al. — "GEC for Low-Resource Languages: The Case of Zarma" (2024): https://arxiv.org/abs/2410.15539
- "Synthetic Error Injection" survey (Emergent Mind, Dec 2025): https://www.emergentmind.com/topics/synthetic-error-injection

### Basque NLP
- Etxaniz et al. — "Latxa: An Open Language Model and Evaluation Suite for Basque" (ACL 2024, cited 69×): https://arxiv.org/abs/2403.20266
- Corral, Sarasua, Saralegi — "Pipeline Analysis for Developing Instruct LLMs in Low-Resource Languages: Basque" (NAACL 2025): https://aclanthology.org/2025.naacl-long.629/
- **Beloki, Saralegi, Ceberio, Corral — "GEC for Basque through a seq2seq neural architecture and synthetic examples" (SEPLN)**: http://journal.sepln.org/sepln/ojs/ojs/index.php/pln/article/view/6271
- Méndez — "Error Generation for a Grammar Checker in Basque" (UPV/EHU, 2023): https://addi.ehu.eus/handle/10810/61820

### Tooling
- WebLLM (MLC AI): https://github.com/mlc-ai/web-llm · Guide: https://localaimaster.com/blog/webllm-browser-ai-guide
- ERRANT: https://github.com/chrisjbryant/errant
- Unsloth (fine-tuning): https://unsloth.ai
- Axolotl: https://github.com/axolotl-ai-cloud/axolotl

### Txukun internal references
- EBE reference extracts: `docs/ebe-reference/` (`ebe-punt.txt`, `ebe-zal.txt`, `ebe-kal.txt`)
- RESEARCH.md §7.14 (Berria Estilo Liburua three-tier model)
- RESEARCH.md §7.17 (EBE §2 categorization, feasibility tiers)
- Current rule engine: `src/core/rules/` (8 rules, 800+ EBE-grounded pairs)
- Current eval suites: `tests/cap-punct/` (33 cases), `tests/ebe-rules/` (43 cases)
