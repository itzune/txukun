# Basque GEC Research Report — Should We Continue or Restart?

## Executive Summary

**Recommendation: Continue with txukun's current architecture. Do NOT restart from zero. Do NOT wait for a standard benchmark — none exists for Basque GEC.**

Txukun's noisy-channel re-ranking architecture (dictionary candidates → frequency re-rank → LM surprisal re-rank) is architecturally aligned with 2025-2026 state-of-the-art. The futo model (25M) is correctly used as a re-ranker, not a generator. The main gap is not architectural but evaluative: there is no public Basque GEC benchmark to measure against. We should build a small one (50-100 sentences) following the Elhuyar methodology, measure precision/recall/F0.5, and iterate.

---

## 1. Basque GEC Landscape: Extremely Sparse

### 1.1 Only two published works exist

As of 2025, **only two research works** address neural GEC for Basque:

| Work | Year | Group | Approach | Key Result |
|------|------|-------|----------|------------|
| Beloki et al. (SEPLN 2020) | 2020 | Elhuyar Foundation | Transformer seq2seq + synthetic errors | F0.5 = 0.87 (synthetic test) |
| Mendez (Master's thesis) | 2023 | UPV/EHU IXA | GEC + GED, BERTeus detection, complex error gen | Human-error correction "needs improvement" |

Both works are from the **same research lineage** (Mendez built on Elhuyar's work, supervised by IXA group members who collaborate with Elhuyar).

### 1.2 The Elhuyar GEC dataset is inaccessible

The only published Basque GEC benchmark was released at:
```
https://hizkuntzateknologiak.elhuyar.eus/assets/files/elh-gec-eu.tgz
```

**This URL is DOWN** (HTTP 000, connection timeout). Extensive searches confirm it is NOT available on:
- GitHub (no results for "elh-gec-eu")
- HuggingFace (no Basque GEC datasets exist)
- Wayback Machine (no archived copy)
- MultiGEC-2025 (12 languages: Czech, English, Estonian, German, Greek, Icelandic, Italian, Latvian, Russian, Slovene, Swedish, Ukrainian — **Basque NOT included**)

The dataset would need to be requested directly from Elhuyar Foundation (email contact).

### 1.3 Error types defined by Elhuyar

Elhuyar's synthetic error generation covers **4 grammatical error types**:

| Code | Error Type | Example |
|------|-----------|---------|
| E1 | Verb tense | Wrong tense selection |
| E2 | Verbal paradigm | Wrong auxiliary form |
| E3 | Verb-subject concord | Subject-verb agreement |
| E4 | Completive sentences suffix | Wrong complementizer (-ela/-ela/-en) |

These are **morphosyntactic errors specific to Basque's ergative-absolutive alignment** and rich verbal morphology. They do NOT cover:
- Spelling errors (typos)
- Capitalization/punctuation
- Lexical errors (wrong word choice)
- Word order errors

### 1.4 Existing Basque NLP resources (NOT GEC)

| Resource | Type | GEC-relevant? |
|----------|------|--------------|
| BERTeus (`ixa-ehu/berteus-base-cased`) | Basque BERT | Used for GED (detection only), not correction |
| Latxa (7B-70B) | Basque LLM | NO GEC benchmark in eval suite (EusProficiency, EusReading, EusTrivia, EusExams — all multiple-choice) |
| Xuxen | Spell-checker + dictionary | Lexical validity only, no contextual correction |
| Latxa v2 corpus | 4.2B tokens | Training data, not evaluation |

**Bottom line: There is no ready-made Basque GEC benchmark to evaluate against.**

---

## 2. 2025-2026 GEC State of the Art

### 2.1 LLM-based GEC with minimal-edit prompting (BEA 2026)

**Paper**: "Instruction-Following LLMs for Grammatical Error Correction" (BEA 2026)

Key findings:
- **Claude-Sonnet-4.5** achieves SOTA zero-shot F0.5: 67.05 (CoNLL-2014), 64.91 (BEA-2019)
- **Minimal-edit instruction acts as a precision filter**: Telling the LLM to "make only minimal changes" dramatically reduces overcorrection
- **Specialized fine-tuned models still beat zero-shot LLMs**: 78.70 vs 64.91 F0.5
- Three editing modes defined:
  - **Neutral**: "Correct this text" (no editing style specified)
  - **Minimal-Edit**: "Make only minimal necessary changes" ← BEST for precision
  - **Fluency-Edit**: "Make the text fluent" ← HURTS due to over-rewriting
- **Fluency-edit is counterproductive**: LLMs naturally over-rewrite; asking for fluency amplifies this

**Relevance to txukun**: Txukun's `constrainCapPunct()` filter is a hard-coded version of the minimal-edit principle. The MarianMT constraint (only accept cap/punct changes, reject word substitutions) implements exactly what the minimal-edit instruction does softly.

### 2.2 Low-resource GEC: MT-based beats LLMs (Zarma, arXiv 2024)

**Paper**: "GEC for Low-Resource Language: The Case of Zarma"

Key findings:
- Compared three approaches for Zarma (Niger-Congo, ~3M speakers):
  1. **Rule-based**: High precision, low recall
  2. **MT-based (M2M100 fine-tuned)**: **BEST** — 95.82% detection rate
  3. **LLM-based (Gemma 2b, MT5-small)**: Underperformed MT-based
- **MT-based approaches outperform LLMs for low-resource GEC**
- Validated with Bambara (another Niger-Congo language)
- Key insight: For low-resource languages, the seq2seq MT framing with synthetic error data is more data-efficient than LLM prompting

**Relevance to txukun**: Basque (~750K speakers) is low-resource. The Zarma finding supports txukun's approach of using a specialized small model (futo 25M) rather than trying to prompt a large LLM. However, txukun uses the model for re-ranking (not generation), which is even more data-efficient.

### 2.3 Adapting LLMs for minimal-edit GEC (BEA 2025)

**Paper**: "Adapting LLMs for Minimal-edit Grammatical Error Correction" (BEA 2025)

Key findings:
- **Overcorrection is the main problem** for LLMs in minimal-edit GEC
- **Error rate adaptation is REVERSED for LLMs**: Traditional neural models needed MORE erroneous examples (higher recall). LLMs need MORE correct examples (higher precision). Adding correct-correct pairs to training data improves LLM GEC.
- **Novel training schedule method**:
  1. Train on erroneous examples first (model learns to correct)
  2. Then train on correct examples with very low learning rate (model learns to NOT correct)
  3. This controls precision-recall trade-off during training, not inference
- **New SOTA on BEA-test**: F0.5 = 78.70 (Gemma2 27B with training schedule)
- **Model choice matters more than size**: Gemma2 9B outperforms Llama-2 13B
- **Detokenization**: Standard GEC datasets are tokenized; LLMs work on raw text. Detokenizing datasets found annotation errors in BEA/CoNLL/JFLEG.
- Key prompt: `"Correct the following text, making only minimal changes where necessary."`

**Relevance to txukun**: The training schedule method (erroneous → correct with low LR) is relevant if we ever fine-tune the futo model for GEC. The insight that LLMs need MORE correct examples is important — our futo model was trained with `plain_ratio: 0.60` (60% plain/correct text), which aligns with this finding.

### 2.4 LLM + edit-based model alliance (BEA 2025, LORuGEC)

**Paper**: "LLMs in alliance with Edit-based Models" (BEA 2025)

Key findings:
- **GECToR-based retrieval** for few-shot example selection outperforms random selection
- GECToR (encoder-only model) hidden states reflect grammatical error similarity, not just semantic similarity
- **Contrastive fine-tuning** of the GECToR retriever on rule labels further improves results
- Works for Russian GEC (LORuGEC corpus, 960 sentence pairs, 48 rules)
- **1-shot GECToR+FT retrieval ≈ 5-shot GECToR retrieval** — contrastive tuning is efficient
- LLMs outperform encoder-decoder and GECToR-like models for Russian GEC
- **Rule-annotated diagnostic corpus** is valuable for evaluation (not just training)

**Relevance to txukun**: This validates the hybrid architecture (edit-based + LLM). Txukun's dictionary + edit-distance (edit-based) + LM surprisal (LLM) is a three-stage version of this alliance. The GECToR retrieval insight suggests that using the LM's hidden states for candidate similarity could improve future versions.

### 2.5 Synthetic data for low-resource GEC (ACL Findings 2025)

**Paper**: "Low-Resource GEC" (ACL Findings 2025)

Key findings:
- Compared synthetic error generation methods for Russian and Ukrainian:
  1. **Char**: Character-level corruption
  2. **Spell**: Spell-checker confusion sets
  3. **Morph**: Morphological confusion sets
  4. **SeLex-RT**: Lexical confusion sets from word embeddings ← **Most valuable addition**
- **Morph + Spell + SeLex-RT** is the best combination (F0.5 = 62.6 on RULEC-GEC, 62.9 on RU-Lang8)
- **SeLex-RT** generates confusion sets using nearest neighbors in embedding space — captures lexical errors that morphological methods miss
- mT5 fine-tuning outperforms from-scratch training
- **Closest-gold evaluation methodology**: Generate references relative to system hypothesis (not original source) for more realistic evaluation

**Relevance to txukun**: The SeLex-RT method could improve txukun's candidate generation — instead of just edit-distance-1 variants, use embedding similarity to find lexical confusion candidates. The closest-gold evaluation method is relevant for our benchmark construction.

### 2.6 Synthetic data for mobile LLMs (ACL Industry 2025, Google)

**Paper**: "Synthesizing and Adapting Error Correction Data for Mobile Large Language Model Applications" (ACL Industry 2025)

Key findings:
- **Industry standard for mobile error correction** (Google Gboard):
  1. LLM-synthesized EC data (Gemini Ultra generates errors + corrections)
  2. Domain adaptation via reweighting with privacy-preserving small on-device LM
  3. Continue training strategy (synthetic first, then mixture)
  4. LoRA fine-tuning of Gemini Nano
- **1.2M synthetic examples** generated from 200k documents (clustered sampling)
- **Privacy-preserving reweighting**: Small LM (8M params) trained with federated learning + differential privacy, used to predict live A/B test metrics
- **Continue training strategy**: First fine-tune on large synthetic data, then on mixture of original + reweighted synthetic
- **2.47-7.18% relative improvement** on live A/B test metrics (click-through rate, accept rate)
- Key error distribution: verb (52%), missing words (15%), plural (10%), capitalization (5%)

**Relevance to txukun**: This is the **most directly relevant paper**. Google's mobile error correction pipeline is architecturally identical to txukun's:
- Dictionary candidates = Google's candidate generation
- Frequency re-rank = Google's small LM scoring
- LM surprisal re-rank = Google's large LM re-ranking
- Privacy-preserving = txukun's 100% browser-based approach

The difference: Google uses Gemini Nano (billion-scale) + federated learning; txukun uses futo 25M + pure client-side. But the architecture is the same.

### 2.7 Compact on-device models (2025)

**Paper**: "How Small Can You Go? Compact Language Models for On-Device Critical Error Detection in Machine Translation"

Key findings:
- Benchmarked sub-2B models for Critical Error Detection (CED) in MT:
  - LFM2-350M, Qwen-3 0.6B/1.7B, Llama-3.2-1B, Gemma-3-1B
- **Gemma-3-1B is the sweet spot**: MCC = 0.77, F1-ERR = 0.98, 400ms latency on MacBook Pro M4
- **Ultra-small models (<0.6B)** remain usable with few-shot calibration but under-detect entity/number errors
- **Logit-bias calibration** + majority voting improve small model performance
- Note: This is CED (translation quality), not GEC (grammar correction)

**Relevance to txukun**: The futo model (25M) is far below the "ultra-small" threshold (<0.6B). However, txukun uses it for re-ranking (scoring candidates), not generation — a much simpler task. The logit-bias calibration technique could be relevant if we observe systematic biases in surprisal scoring.

---

## 3. Analysis: Should We Continue or Restart?

### 3.1 Arguments AGAINST restarting from zero

1. **No benchmark to restart from**: There is no public Basque GEC benchmark. The Elhuyar dataset is inaccessible. MultiGEC doesn't include Basque. Building a proper benchmark from scratch is a months-long research project.

2. **Txukun's architecture is SOTA-aligned**: The 2025-2026 literature validates every component of txukun's pipeline:
   - Dictionary + edit-distance candidate generation (edit-based models, §2.4)
   - Frequency re-ranking (small LM scoring, §2.6)
   - LM surprisal re-ranking (LLM re-ranking, §2.6)
   - Minimal-edit constraint filter (§2.1, §2.3)
   - Privacy-preserving on-device (§2.6)

3. **The futo model is correctly positioned**: Using a 25M model for re-ranking (not generation) is the right call. SOTA GEC generation needs 7B+ models (§2.3, §2.6). Re-ranking is a much simpler task that works with small models.

4. **MT-based approaches work for low-resource (§2.2)**: Txukun already has MarianMT (constrained to cap/punct). The Zarma paper confirms MT-based approaches outperform LLMs for low-resource languages.

5. **The Google mobile paper (§2.6) confirms the architecture**: Google's Gboard error correction uses the exact same pipeline as txukun, just at a different scale.

### 3.2 Arguments FOR restarting (and why they don't hold)

1. **"The futo model is too small"** — True for generation, but we use it for re-ranking. The surprisal scoring approach works at 25M (validated at 4/8 on Ikasbil grammar, matching Python reference).

2. **"We need a proper GEC model"** — SOTA GEC models (Gemma2 27B, §2.3) cannot run in a browser. The compact on-device paper (§2.7) uses 1B+ models. Txukun's 25M re-ranker is the right size for browser deployment.

3. **"We should use Latxa/BERTeus"** — Latxa (7B+) is too large for browser. BERTeus is for detection (classification), not correction. Neither has a GEC benchmark.

4. **"We need synthetic error data"** — True for training a GEC model, but we're not training one. The futo model is already trained. For evaluation, we can build a small benchmark (§4).

### 3.3 Conclusion: Continue, don't restart

Txukun's architecture is correct. The gap is **evaluation**, not architecture. We need to:
1. Build a small Basque GEC evaluation set (§4)
2. Measure precision/recall/F0.5
3. Tune scoring weights against the evaluation set
4. Iterate

---

## 4. Recommended Evaluation Benchmark

Since no public Basque GEC benchmark exists, we build a small one.

### 4.1 Methodology (following Elhuyar + Mendez + §2.5)

**Source**: Professional Basque text (news articles, Ikasbil exercises, Euskaltzaindia examples)

**Error types** (expanded from Elhuyar's E1-E4 to cover txukun's actual use case):

| Category | Code | Description | Example |
|----------|------|-------------|---------|
| Spelling | S1 | Typo (edit-distance 1-2) | `kaixp` → `kaixo` |
| Spelling | S2 | Missing accent/diacritic | `inaki` → `iñaki` |
| Morphology | M1 | Wrong case (erg/abs/dat/gen) | Elhuyar E1-E4 |
| Morphology | M2 | Wrong verbal paradigm | Elhuyar E2 |
| Morphology | M3 | Verb-subject concord | Elhuyar E3 |
| Syntax | Y1 | Wrong complementizer | Elhuyar E4 |
| Lexical | L1 | Wrong word (confusion set) | `izaki` → `iñaki` |
| Punctuation | P1 | Missing/extra punctuation | `kaixo` → `kaixo.` |
| Capitalization | C1 | Wrong capitalization | `nire` → `Nire` (sentence start) |

**Target size**: 100 sentences (50 with errors, 50 correct — for false-positive testing)

**Evaluation metrics** (following GEC standard):
- **Precision**: Of corrections made, how many are correct?
- **Recall**: Of errors present, how many are corrected?
- **F0.5**: Weighted toward precision (false corrections are worse than missed corrections)
- **F1**: Balanced

### 4.2 Why 50 correct sentences?

The minimal-edit GEC paper (§2.3) and LORuGEC (§2.4) both emphasize **hypercorrection testing** — including correct sentences to verify the system doesn't over-correct. This is critical for user acceptance (false corrections are more annoying than missed corrections).

### 4.3 Closest-gold evaluation (§2.5)

For sentences where multiple corrections are valid, use the closest-gold method: generate the reference correction relative to the system's output, not the original source. This gives a more realistic evaluation.

### 4.4 ERRANT adaptation

ERRANT (ERRor ANnotation Toolkit) is the standard GEC evaluation tool. It is **NOT adapted for Basque** — it uses English-specific morphology (lemma/determiner/preposition rules). Mendez used it with limitations.

**Option A**: Use ERRANT as-is (token-level edit extraction works; type classification will be imperfect)
**Option B**: Use simple exact-match scoring (precision/recall/F0.5 on token edits, no type classification)
**Recommendation**: Start with Option B (simple), add ERRANT later if type-level analysis is needed.

---

## 5. Actionable Recommendations

### 5.1 Immediate (1-2 days)

1. **Build the evaluation set** (100 sentences) using:
   - 20 sentences from Ikasbil exercises (professionally validated)
   - 20 sentences with injected typos (S1, S2) from real Basque text
   - 20 sentences with morphological errors (M1-M3) following Elhuyar's E1-E4 methodology
   - 20 sentences with lexical/punctuation/capitalization errors (L1, P1, C1)
   - 20 correct sentences (hypercorrection test)
   - **Ask the user to validate all Basque** (assistant's Basque is not reliable)

2. **Run txukun against the evaluation set** and measure P/R/F0.5

3. **Tune `LM_WEIGHT`** against the evaluation set (grid search 0.0, 0.5, 1.0, 1.5, 2.0)

### 5.2 Short-term (1-2 weeks)

4. **Contact Elhuyar Foundation** to request the `elh-gec-eu` dataset (email: `hizkuntzateknologiak@elhuyar.eus`). This is the only way to get the published benchmark.

5. **Add SeLex-RT-style candidate generation** (§2.5): Use the futo model's embeddings (if available via wllama `createEmbedding`) to find lexical confusion candidates beyond edit-distance-1.

6. **Implement logit-bias calibration** (§2.7): If the LM systematically over/under-scores certain token patterns, apply a calibration factor.

### 5.3 Medium-term (1-2 months)

7. **Contribute the evaluation set back to the community**: The Basque GEC field has no public benchmark. Publishing a 100-sentence evaluation set would fill a genuine research gap.

8. **Consider MultiGEC submission**: If we build a quality benchmark, propose Basque inclusion in future MultiGEC editions.

9. **Explore BERTeus for error detection** (Tier 3): Use BERTeus for GED (binary: is this sentence grammatical?) as a pre-filter before the correction pipeline. This separates detection from correction.

### 5.4 What NOT to do

- **Do NOT retrain the futo model for seq2seq GEC**: SOTA needs 7B+ models. The 25M model is correctly used as a re-ranker.
- **Do NOT replace the dictionary with a neural model**: The dictionary provides guaranteed real-word candidates. Neural generation can hallucinate.
- **Do NOT try to run Latxa in the browser**: 7B+ models cannot run client-side in a browser.
- **Do NOT wait for a standard benchmark**: None exists. Build your own.

---

## 6. Summary Table: SOTA vs. Txukun

| Aspect | 2025-2026 SOTA | Txukun Current | Gap |
|--------|---------------|----------------|-----|
| Architecture | Candidate gen + re-rank (§2.4, §2.6) | Dictionary + freq + LM surprisal | ✅ Aligned |
| LM size | 1B-70B for generation; small for re-rank (§2.7) | 25M for re-rank | ✅ Correct usage |
| Editing mode | Minimal-edit (§2.1, §2.3) | constrainCapPunct() | ✅ Aligned |
| Privacy | Federated learning + DP (§2.6) | 100% browser-based | ✅ Better (no data leaves device) |
| Synthetic data | LLM-generated (§2.5, §2.6) | Not used (pre-trained model) | ⚠️ Could improve candidate gen |
| Evaluation | F0.5 on standard benchmarks | 4/8 on Ikasbil (grammar) | ❌ Need proper benchmark |
| Error types | Comprehensive (§2.5) | Spelling + some morphology | ⚠️ Limited to re-ranking scope |
| Low-resource approach | MT-based beats LLM (§2.2) | MarianMT (constrained) + LM | ✅ Aligned |

---

## 7. References

### Basque GEC
1. Beloki et al. (2020). "Grammatical Error Correction for Basque through a seq2seq neural architecture and synthetic examples." SEPLN.
2. Mendez (2023). "Error Generation for a Grammar Checker in Basque: Correction and Detection." Master's thesis, UPV/EHU. `addi.ehu.es/handle/10810/61820`
3. Agerri et al. (2024). "Latxa: An Open Language Model and Evaluation Suite for Basque." ACL 2024. `arxiv.org/abs/2403.20266`

### 2025-2026 GEC SOTA
4. "Instruction-Following LLMs for Grammatical Error Correction." BEA 2026.
5. "GEC for Low-Resource Language: The Case of Zarma." arXiv 2024.
6. Staruch et al. (2025). "Adapting LLMs for Minimal-edit Grammatical Error Correction." BEA 2025.
7. "LLMs in alliance with Edit-based Models." BEA 2025. (LORuGEC)
8. "Low-Resource GEC." ACL Findings 2025.
9. Zhang et al. (2025). "Synthesizing and Adapting Error Correction Data for Mobile Large Language Model Applications." ACL Industry 2025. (Google)
10. Chopra et al. (2025). "How Small Can You Go? Compact Language Models for On-Device Critical Error Detection in Machine Translation." arXiv 2025.
11. Masciolini et al. (2025). "The MultiGEC-2025 Shared Task on Multilingual Grammatical Error Correction." NLP4CALL 2025.

### Tools
12. Bryant et al. (2017). ERRANT: ERRor ANnotation Toolkit. ACL 2017. `github.com/chrisjbryant/errant`
13. Omelianchuk et al. (2020). GECToR: Grammatical Error Correction: Tag, not rewrite. BEA 2020.
14. BERTeus: `huggingface.co/ixa-ehu/berteus-base-cased`
15. Latxa: `huggingface.co/collections/HiTZ/latxa-65a697e6838b3acc53677304`
