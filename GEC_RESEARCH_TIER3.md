# Tier 3 Research: GECToR vs Seq2Seq for Basque Grammar Correction

**Date:** 2026-06-29
**Question:** Should txukun's Tier 3 grammar corrector use seq2seq, GECToR (seq2edit), or LLM? Should we skip the GED classifier head? Do we have the data?

---

## TL;DR

| Question | Answer |
|----------|--------|
| Is seq2seq the most promising approach? | **No.** GECToR (seq2edit, encoder-only) is better for our constraints: 10× smaller, 10× faster, proven for agglutinative languages, naturally minimal-edit. |
| Skip the GED classifier head? | **Yes.** GECToR *has* a detect head built-in (`detect` → CORRECT/INCORRECT). One model = detection + correction. |
| Do we have the data? | **Yes.** Elhuyar Dt3.tsv = 9.3M sentence pairs, ready for GECToR preprocessing. Dem_single/multi/none = evaluation with R1-R4 error types. CC-BY-NC-SA license. |

**Recommended path:** Fine-tune **RoBERTa-eus-base** (`ixa-ehu/roberta-eus-euscrawl-base-cased`, 110M) as a GECToR model on Elhuyar 9.3M pairs. Export to int4 ONNX (~85MB). Deploy alongside existing Tier 1+2 spelling pipeline.

**Encoder choice:** RoBERTa-eus-base over BERTeus-base because (1) 1.9× more pretraining data (423M vs 224.6M tokens), (2) EusCrawl is a cleaner tailored-crawl corpus, (3) RoBERTa is the exact architecture GECToR-2024 SOTA uses, (4) identical deployment cost (~85MB int4). See §4.1.

---

## 1. Is seq2seq GEC the most promising approach in 2026?

### No — GECToR (seq2edit) wins for browser-deployed, low-resource GEC

The **Pillars of GEC** paper (BEA 2024, Grammarly — [arXiv:2404.14914](https://arxiv.org/abs/2404.14914)) comprehensively compared all three GEC approaches on identical data:

| Approach | Model | Params | F0.5 (BEA-test) | Speed | Browser? |
|----------|-------|--------|-----------------|-------|----------|
| LLM (zero-shot) | GPT-4 | ~1.7T | 58.2 | slow API | ❌ |
| LLM (fine-tuned) | Chat-LLaMa-2-13B-FT | 13B | 74.6 | slow | ❌ |
| Seq2Seq | T5-11B | 11B | 73.2 | autoregressive | ❌ |
| Seq2Seq | UL2-20B | 20B | 74.1 | autoregressive | ❌ |
| **Seq2Edit** | **GECToR-2024 (RoBERTa-L)** | **~300M** | **77.7** | **10× faster than seq2seq** | **✅ (with int4)** |

Key findings from the paper:

> "A relatively small model such as GECToR-2024 (≈300M parameters) still performs well enough compared to much larger models (≈7-20B parameters). We hypothesize that the limiting factor for English GEC is the amount of high-quality data rather than model size."

> "Edit-based GEC systems... are based on encoder-only architectures and are non-autoregressive; therefore, they are less resource-consuming and more attractive for productization."

> "We don't find that any single-model system approach is dominant across all benchmarks. While in general, fine-tuning the larger models leads to higher F0.5 scores, the 10–50× increase in model size leads to rather small improvements (up to 1–2 F0.5 points)."

### Why GECToR is the right choice for txukun

| Factor | Seq2Seq (MarianMT) | GECToR (RoBERTa-eus-base) |
|--------|--------------------|-------------------|
| **Model size** | 77M encoder + 77M decoder = 154M | 110M encoder + 2 small heads ≈ 112M |
| **int4 ONNX** | ~80MB | ~85MB |
| **Inference** | Autoregressive (token-by-token) | Non-autoregressive (single pass + iterate) |
| **Speed** | Slow (generates each token) | 10× faster than seq2seq |
| **Overcorrection** | High risk (rewrites whole sentence) | Low risk (edit operations constrain changes) |
| **Minimal-edit friendly** | No (free generation) | Yes ($KEEP is the default tag) |
| **Detection** | No (rewrites only) | Yes (built-in `detect` head) |
| **Agglutinative proof** | ❌ No evidence | ✅ gector-ja (Japanese, agglutinative) |

### Proof: GECToR works for agglutinative languages

**gector-ja** ([github.com/jonnyli1125/gector-ja](https://github.com/jonnyli1125/gector-ja)) adapted GECToR for Japanese — an agglutinative language like Basque:

> "The g-transformations in this model were redefined to accommodate for Japanese verbs and i-adjectives, which both inflect for tense."

Example from gector-ja:
```
Input:  西口側までは宿泊から施設や地元の日本酒や、山の幸を揃えた飲食は店、呑み屋など多くあろう。
Tags:   $KEEP $KEEP $KEEP $REPLACE_に $KEEP $KEEP $DELETE ... $TRANSFORM_VBV_VB $KEEP $KEEP
Output: 西口側には宿泊施設や地元の日本酒や海、山の幸を揃えた飲食店、呑み屋など多くある。
```

The `$TRANSFORM_VBV_VB` tag transforms verb conjugation — exactly what Basque R1 (tense) errors need (`etortzen` → `etorriko`).

gector-ja achieved GLEU 0.81 on Japanese, outperforming prior CNN-based SOTA.

### Why seq2seq (MarianMT) is the wrong tool for grammar

We already have MarianMT deployed for cap-punct correction. It works there because cap-punct is a constrained task with `constrainCapPunct()` filtering. But for grammar:

1. **Autoregressive generation is slow on WASM** — each output token requires a full decoder forward pass
2. **Free generation = hallucination risk** — we already saw MarianMT hallucinate `Nire` → `Auzo` (word substitution). Grammar correction needs even more freedom = more hallucination
3. **Seq2Seq rewrites the whole sentence** — even for a one-suffix fix, it regenerates everything. GECToR only touches the tagged tokens
4. **No detection** — seq2seq can only correct, not flag. GECToR's `detect` head solves Tier 2.5

---

## 2. Should we skip the GED classifier head?

### Yes — GECToR IS a GED + correction model

The Tier 2.5 prototype (raw BERTeus embedding similarity for detection) failed:
- All-words approach: F1=18.2%, precision=16.2%
- Confusable approach: F1=25.0%, precision=19.8%
- Conclusion: "raw base model insufficient for detection, fine-tuned GED classifier head needed"

**GECToR's architecture includes the GED classifier head:**

```
RoBERTa encoder → [labels head] → edit operation ($KEEP, $DELETE, $REPLACE_x, $TRANSFORM_x)
               → [detect head] → CORRECT / INCORRECT (binary)
```

From the gector-ja README:
> "The model consists of a pretrained BERT encoder layer and two linear classification heads, one for `labels` and one for `detect`. `labels` predicts a specific edit transformation (`$KEEP`, `$DELETE`, `$APPEND_x`, etc), and `detect` predicts whether the token is `CORRECT` or `INCORRECT`."

### Why GECToR's detect head will work where Tier 2.5 didn't

| Factor | Tier 2.5 (failed) | GECToR (will work) |
|--------|-------------------|---------------------|
| Encoder | Frozen BERTeus (no fine-tuning) | Fine-tuned RoBERTa-eus-base |
| Detection method | Cosine similarity of raw embeddings | Trained binary classifier head |
| Training signal | None (unsupervised) | 9.3M labeled error/correct pairs |
| Detection + correction | Separate steps | One model, one pass |

The Tier 2.5 failure was NOT because Basque encoders can't detect errors — it was because we used **raw, unfine-tuned embeddings** as a similarity proxy. Mendez (2023) fine-tuned BERTeus for GED and achieved usable results, proving fine-tuning is the key. GECToR does the same fine-tuning (on RoBERTa-eus-base), but adds the correction head too.

**Going to GECToR directly = one training run gives us both detection AND correction.** No need for a separate GED model.

### Inference-time detection control

GECToR exposes `min_error_probability` — a sentence-level threshold from the detect head. This is the precision/recall knob:
- High threshold → fewer corrections, higher precision (fewer false positives)
- Low threshold → more corrections, higher recall

This is exactly the control we need for a writing assistant where false positives are worse than false negatives.

---

## 3. Do we have the required labeled data?

### Yes — the Elhuyar GEC dataset is ideal for GECToR

**Training data:** `/tmp/elh-gec-eu/train/Dt3.tsv`
- **9,333,672 sentence pairs** (1.9 GB)
- Format: `ORIGINAL_SENTENCE<tab>SENTENCE_WITH_ERRORS` (column 1 = correct, column 2 = errorful)
- **Synthetic errors** generated by applying grammar rules to correct sentences (same methodology as gector-ja)
- Includes **correct-correct pairs** ("We also add pairs composed of the original unmodified sentences") — BEA 2025 research shows this reduces overcorrection
- Trivially compatible with GECToR: swap columns, run `preprocess_data.py`

**Evaluation data:** `/tmp/elh-gec-eu/evaluation/`
- `Dem_single.tsv` — 221 manually revised sentences with single errors, **with R1-R4 error type annotations**
- `Dem_multi.tsv` — 221 manually revised sentences with multiple errors
- `Dem_none.tsv` — 201 manually revised clean sentences (for false-positive testing)
- `Dea_*.tsv` — 6,000 auto-generated evaluation pairs
- Format: `ORIGINAL<tab>ERRORFUL<tab>ERROR_TYPES` (e.g., `R4`, `R2`)

**Error type breakdown** (from Dem_single analysis):
| Type | Description | Example | Count |
|------|-------------|---------|-------|
| R1 | Tense | `etortzen` → `etorriko` | 7 |
| R2 | Verb agreement/argument | `dio` → `zaio` | 118 |
| R3 | Case/agreement | `gehienak` → `gehienek` | 25 |
| R4 | Suffix | `zaidalaren` → `zaidalako` | 71 |

All are **real-word errors** — every erroneous form is a valid Basque word with wrong inflection. The dictionary can NEVER catch these. GECToR can.

### GECToR preprocessing is compatible

The gotutiyan/gector implementation uses the official preprocessing:
```bash
python utils/preprocess_data.py -s SOURCE -t TARGET -o OUTPUT
```

This auto-aligns sentence pairs and extracts token-level edit tags ($KEEP, $DELETE, $REPLACE_x, etc.). The Elhuyar TSV format is directly compatible — just split on tabs and swap column order.

### License: CC-BY-NC-SA

The Elhuyar dataset is **non-commercial** (CC-BY-NC-SA). Three options (already documented in CORRECTOR_STRATEGY.md):

| Option | Pros | Cons |
|--------|------|------|
| **(a) Ship model with NC license** | Simple, uses real data, txukun is open-source (not commercial) | Can't be used in commercial products |
| **(b) Synthetic errors from Wikipedia** | No license restriction (gector-ja did this) | Need to build Basque error generation rules; lower quality |
| **(c) Seek Elhuyar permission** | Best for production | Takes time, may require negotiation |

**Recommendation:** Start with option (a) for prototyping — txukun is open-source and non-commercial. If commercial use is needed later, pursue (b) or (c).

---

## 4. Implementation plan

### Architecture

```
Input sentence
    │
    ├─ Tier 1+2 (spelling, EXISTING):
    │   Dictionary check → edit-distance candidates → BERTeus re-rank
    │   (handles non-word errors: typos, misspellings)
    │
    └─ Tier 3 (grammar, NEW):
        RoBERTa-eus-GECToR → detect head (CORRECT/INCORRECT?)
                           → labels head ($KEEP / $REPLACE_x / $TRANSFORM_x)
        (handles real-word errors: R1-R4 grammar)
```

**GECToR does NOT replace Tier 1+2.** The two systems are complementary:
- Tier 1+2 handles **non-word errors** (word not in dictionary) — dictionary + edit-distance generates candidates for ANY typo
- GECToR handles **real-word errors** (valid word, wrong inflection) — learned from 9.3M grammar error pairs
- GECToR can only $REPLACE with words it's seen in training; dictionary + edit-distance handles novel typos

### Model: RoBERTa-eus-GECToR

| Component | Value |
|-----------|-------|
| Encoder | `ixa-ehu/roberta-eus-euscrawl-base-cased` (110M, RoBERTa, pre-trained on EusCrawl) |
| Heads | 2 linear layers: `labels` (edit ops) + `detect` (binary) |
| Framework | gotutiyan/gector (PyTorch, MIT license, supports `--model_id` for any RoBERTa) |
| Training data | Elhuyar Dt3.tsv (9.3M pairs) |
| Evaluation | Dem_single/multi/none (manually revised, R1-R4) |
| Export | PyTorch → ONNX (int4 quantized, ~85MB) |
| Browser runtime | Transformers.js (already a dependency) |

### 4.1 Encoder choice: why RoBERTa-eus-base

Three Basque encoder models were considered:

| Model | Architecture | Params | int4 est. | Pretraining tokens | Corpus |
|-------|-------------|--------|-----------|-------------------|--------|
| `ixa-ehu/berteus-base-cased` | BERT | ~110M | ~85 MB | 224.6M | news + Wikipedia |
| **`ixa-ehu/roberta-eus-euscrawl-base-cased`** | **RoBERTa** | **~110M** | **~85 MB** | **423M** | **EusCrawl (tailored crawl, cleaner)** |
| `ixa-ehu/roberta-eus-euscrawl-large-cased` | RoBERTa | ~335M | ~220 MB | 423M | EusCrawl |
| `HiTZ/gpt2-eus-euscrawl` | GPT2 (causal) | ~124M | ~87 MB | 423M | EusCrawl |

**Decision: RoBERTa-eus-base.** Reasons:
1. **1.9× more pretraining data** than BERTeus (423M vs 224.6M tokens)
2. **Cleaner corpus** — EusCrawl uses tailored scrapers on 33 high-quality Basque sites, vs BERTeus's news+wiki
3. **GECToR-native architecture** — GECToR-2024 SOTA uses RoBERTa-large; gotutiyan/gector explicitly supports `roberta-**`
4. **Identical deployment cost** to BERTeus (~85MB int4, same 12-layer/768-hidden)
5. **Beats BERTeus on downstream tasks** — Artetxe et al. (2022) reports roberta-eus-euscrawl-base averages 66.5 vs BERTeus's ~66 across 5 tasks (topic/sentiment/stance/NER/QA)

**Rejected alternatives:**
- **RoBERTa-eus-large** (~335M, ~220MB int4): 2.6× heavier and ~2× slower on WASM for a writing assistant. Reserve as a fallback if base underperforms.
- **GPT2-eus** (causal/decoder-only): architecturally incompatible with GECToR, which requires a bidirectional encoder. GPT2 could only do seq2seq generation — the approach we rejected.
- **BERTeus-base**: viable, but strictly dominated by RoBERTa-eus-base on data, corpus quality, and architecture fit at equal cost.

Note: the existing **Tier 2 spelling re-ranker stays on BERTeus** (already deployed, +110 net validated). Only Tier 3 (grammar) uses RoBERTa-eus-base.

### Basque g-transformations (optional optimization)

GECToR's basic 4 tags ($KEEP, $DELETE, $APPEND_x, $REPLACE_x) handle any edit. But for Basque morphology, custom g-transformations can compress common patterns:

| Transform | Maps to | Error type |
|-----------|---------|------------|
| `$TRANSFORM_TENSE` | verb tense changes | R1 |
| `$TRANSFORM_AGREEMENT` | verb agreement (nor/nork/nori) | R2 |
| `$TRANSFORM_CASE` | case suffix changes (ak→ek, etc.) | R3 |
| `$TRANSFORM_SUFFIX` | other suffix corrections | R4 |

**Start without g-transformations** — the basic $REPLACE_xxx tag handles everything. Add g-transformations later if the tag vocabulary is too large or specific error types underperform.

### Training plan

1. **Preprocess** Elhuyar Dt3.tsv (swap columns, run `preprocess_data.py`)
2. **Stage 1**: Train on synthetic data (Elhuyar Dt3 = already synthetic, 9.3M pairs)
3. **Stage 2**: Fine-tune on manually revised subset (Dem_single + Dem_multi, if convertible to training format)
4. **Export to ONNX** (fp32 → int4 quantized, same pipeline as existing BERTeus)
5. **Browser integration**: Lazy-load alongside MarianMT, run after Tier 1+2 spelling pass
6. **Inference**: `keep_confidence` and `min_error_probability` as precision knobs

### Estimated timeline

| Step | Time |
|------|------|
| Data preprocessing | 1 day |
| Training (GPU server, 9.3M pairs, 3-10 epochs) | 1-2 days |
| ONNX export + int4 quantization | 1 day |
| Browser integration (Transformers.js) | 1-2 days |
| Evaluation + parameter tuning | 1 day |
| **Total** | **5-7 days** |

---

## 5. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| GECToR tag vocabulary too large for Basque morphology | Start with 5k vocab (standard), fall back to $APPEND/$DELETE for rare forms |
| RoBERTa-eus tokenizer doesn't split Basque suffixes well | RoBERTa-eus uses BPE trained on Basque — should handle suffixes. Verify during preprocessing. |
| int4 quantization degrades GECToR accuracy | Test int4 vs fp32 on Dem_single (we did this for re-ranker: int4 was actually better) |
| CC-BY-NC-SA license blocks commercial use | Option (a) for now (open-source), option (b)/(c) later |
| Overcorrection on clean text | Dem_none (201 clean sentences) for false-positive testing. `min_error_probability` knob. Correct-correct pairs in training. |
| Model too slow on WASM | GECToR is 10× faster than seq2seq. Single forward pass + 2-5 iterations. BERTeus int4 (same size class) loads in 2.8s. |
| RoBERTa-eus-base underperforms BERTeus on GEC specifically | Downstream task scores don't perfectly predict GEC. If smoke test fails, fall back to BERTeus-base or step up to RoBERTa-eus-large. |

---

## 6. Key references

1. **Pillars of GEC** (BEA 2024) — [arXiv:2404.14914](https://arxiv.org/abs/2404.14914) — Comprehensive comparison of LLM/seq2seq/GECToR. "GECToR-2024 (≈300M) still performs well enough compared to much larger models."
2. **GECToR** (BEA 2020) — [arXiv:2005.12592](https://arxiv.org/abs/2005.12592) — Original paper. "Tag, not rewrite." 10× faster than seq2seq.
3. **gector-ja** — [github.com/jonnyli1125/gector-ja](https://github.com/jonnyli1125/gector-ja) — Japanese GECToR with custom verb g-transformations. Proves agglutinative language viability.
4. **gotutiyan/gector** — [github.com/gotutiyan/gector](https://github.com/gotutiyan/gector) — Modern PyTorch implementation, MIT license, supports any BERT-like encoder via `--model_id`.
5. **Elhuyar GEC** (SEPLN 2020) — Beloki et al. — 9.3M Basque GEC pairs, synthetic, CC-BY-NC-SA.
6. **Mendez (2023)** — Fine-tuned BERTeus for GED. Confirms fine-tuning (not raw embeddings) is needed for detection.
7. **Artetxe et al. (2022)** — [arXiv:2203.08111](https://arxiv.org/abs/2203.08111) — "Does corpus quality really matter for low-resource languages?" Introduces RoBERTa-eus (EusCrawl, 423M tokens), beats BERTeus on 5 downstream tasks.
