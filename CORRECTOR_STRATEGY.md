# Corrector Strategy — AI-Powered Basque Autocorrection

> Architecture document for upgrading txukun's autocorrect from a static Hunspell-first lookup to a multi-signal neural re-ranker. This is the design spec for Phase 2 spell-correction work.

**Status:** Proposed (Tier 1 implemented, Tier 2 in progress, Tiers 2.5–4 proposed)
**Date:** 2026-06-29 (updated 2026-06-30)
**Related:** [`XUXEN_ISSUES.md`](./XUXEN_ISSUES.md), [`RESEARCH.md`](./RESEARCH.md), [`PROGRESS_REPORT_2026-06-28.md`](./PROGRESS_REPORT_2026-06-28.md), [`GEC_RESEARCH_2025.md`](./GEC_RESEARCH_2025.md)

---

## TL;DR

Txukun's current autocorrect is broken at the architectural level: it puts the **worst** detector (Hunspell) **first and alone**, then blindly accepts that detector's first suggestion with zero context awareness. This causes documented bugs like `batzutan → batsutan` (wrong) when the correct word `batzuetan` is sitting right there in the dictionary.

The fix is a **noisy-channel candidate re-ranker** that gives each job to the component that does it well:

```
                         ┌──────────────────────────────────────────┐
  input text ───────────▶│ 1. DETECTION (layered)                    │
                         │    1a. corpus dict (791k Set, O(1))      │
                         │        word ∈ dict? → real word (ax 1)   │
                         │    1b. futo surprisal [Tier 2.5, free]   │
                         │        logP(w|ctx)−logP(w) > τ? → flag   │
                         │    1c. BERTeus MLM [Tier 3, heavy]       │
                         │        bidirectional, for hard cases     │
                         └──────────────┬───────────────────────────┘
                                        │ misspelled OR surprising
                         ┌──────────────▼───────────────────────────┐
                         │ 2. CANDIDATES (pure JS)                   │
                         │    edit-distance 1/2 → filter by Set      │
                         │    → only real words                      │
                         └──────────────┬───────────────────────────┘
                                        │ N candidates
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
   ┌──────────────────┐    ┌──────────────────────┐   ┌───────────────────┐
   │ a) GGUF LM       │    │ b) Corpus frequency  │   │ c) Xuxen bonus    │
   │  surprisal(c|ctx)│    │  log f(c)            │   │  +γ if c ∈ Xuxen  │
   │  = logP(c|ctx)   │    │  (axis 1)            │   │  (axis 3, +only)  │
   │     − logP(c)    │    │                      │   │                   │
   │  via wllama      │    │                      │   │                   │
   │  (axis 2)        │    │                      │   │                   │
   └────────┬─────────┘    └──────────┬───────────┘   └─────────┬─────────┘
            └─────────────────────────┼─────────────────────────┘
                                      ▼
                         ┌────────────────────────────┐
                         │ 3. RANK: α·a + β·b + γ·c   │
                         │    + δ·editdist(typed,c)   │
                         │    → best candidate        │
                         └────────────┬───────────────┘
                                      ▼
                         4. MarianMT cap-punct (existing, unchanged)
```

Each component owns one axis of "correct." No single source is asked to do a job it's bad at.

---

## 1. What's wrong today

### 1.1 The autocorrect function

`autoCorrect()` in [`src/spell.js:236-261`](./src/spell.js) does this:

```js
const corrected = err.suggestions[0];   // ← Hunspell's first suggestion. No context.
```

Hunspell ranks suggestions by edit distance + TRY-character heuristics. It has no idea what word came before or after. So when the user types `batzutan`, Hunspell proposes `batsutan` first (an edit-distance-1 form), and txukun silently replaces the user's text with the wrong word.

### 1.2 Hunspell does two jobs and is bad at both

Hunspell is used for **detection** (is this word misspelled?) *and* **candidate generation** (what should it be?). It fails at both:

| Job | Hunspell in txukun today | Problem |
|-----|--------------------------|---------|
| **Detection** (`spell()`) | Broken — Hunspell 1.7.3 WASM returns `spell()=0` for ALL words due to `NEEDAFFIX 1` flag. Needs a 3-layer fallback (word-list Set → `hunspell_spell` → suggest-as-spell). See [`XUXEN_ISSUES.md` §2](./XUXEN_ISSUES.md). | Detection already doesn't trust Hunspell — the word-list `Set` does the real work |
| **Candidate generation** (`suggest()`) | Mis-ranks. `batzutan → batsutan` (wrong) even though `batzuetan` (correct) is in the dictionary. Suggests corpus-absent forms via affix rules. | [`XUXEN_ISSUES.md` §1](./XUXEN_ISSUES.md) |
| **Coverage** | 30,178 documented gaps (e.g. `entzuten` is missing). Needs separate `eu-words.txt` fallback. | [`XUXEN_ISSUES.md` §3](./XUXEN_ISSUES.md) |
| **Frequency data** | None | Can't rank candidates by likelihood |

The 3-layer detection workaround in `spell-worker.js` is effectively a tombstone for Hunspell's detection — it's already not trusted.

### 1.3 Putting the worst detector first

The current pipeline in [`src/main.js`](./src/main.js):

```
autoCorrect()  →  MarianMT cap-punct  →  autoCorrect()
```

Hunspell detection runs **first and alone**. Everything downstream is contaminated by its false positives and missed words. This is the core architectural mistake.

### 1.4 The detection blind spot: real-word errors

Dictionary-based detection catches non-words (typos like `kaixp`) but has a fundamental blind spot: **real-word errors** — correctly-spelled words used in the wrong context. When the user types `Nire izena inaki da` and the dictionary sees `izaki` (a real Basque word meaning "being/creature"), it says "correct, no error" — and the LM re-ranker never gets a chance to run, because no candidates are generated.

| Error type | Dictionary detects? | Example |
|-----------|-------------------|--------|
| Non-word typo | ✅ Yes | `kaixp` (not a word) |
| Real-word error | ❌ **No** | `izaki` where `iñaki` was meant |
| Grammar error | ❌ **No** | Wrong case ending (real word, wrong form) |

This is the `inaki → izaki` bug documented during Tier 2 testing. The fix is a **contextual detection layer** that flags words the LM finds surprising given their context — even if they're in the dictionary. Tiers 2.5 and 3 below address this gap.

---

## 2. The three axes of "correct Euskara"

The key conceptual insight: "correct Basque" is not one thing. It's three, and they're **independent**. A word can be right on one axis and wrong on another.

| Axis | Question | Adjudicated by | Precision | Recall |
|------|----------|----------------|-----------|--------|
| **1. Lexical** | Is it a real word? | Corpus dictionary (791k) | high | high |
| **2. Contextual** | Is it the right word *here*? | GGUF LM probability | — | — |
| **3. Normative** | Is it standard *Batua*? | Xuxen (160k) | **high** | **low** |

A word can be lexically valid + contextually right + **non-normative** (a dialectal form in correct usage). Or normative but contextually wrong (`batzuetan` vs `batzutan` are both real words; only context decides).

The current architecture collapses all three into one signal (Hunspell), which is bad at all of them. The new architecture gives each axis to its best component.

---

## 3. The components

### 3.1 Corpus dictionary (axis 1 — lexical)

**Source:** [`itzune/futo-transformer-basque`](https://github.com/itzune/futo-transformer-basque) → `dictionaries/eu_wordlist.combined.gz` (4.0 MB)

Built by streaming 600k lines of the **Latxa v2** Basque corpus (3 sources × 200k lines: `euscrawl-v2`, `colossal-oscar`, `wikipedia`, `hplt-v2` — all quality-rated Q4.4+ and Morpheus-cleaned), counting word frequencies, filtering by hunspell validation + a proper-noun capitalization-ratio heuristic, and emitting AOSP `.combined` format.

**Stats (vs Helium314's referenced Basque dictionary — the one FUTO links to):**

| Field | Ours | H314 |
|-------|------|------|
| Unigrams | **791,021** | 106,786 |
| Bigrams | **80,000** | 0 |
| Autocorrect test targets covered | **40/40** | 39/40 |
| Proper nouns | **338,308** | 7,986 |
| `da` frequency | f=248, rank #2 | f=109, rank #5313 |

**Why it beats Hunspell for detection:**
- O(1) Set lookup — no WASM, no affix engine, no `NEEDAFFIX` regression
- Contains inflected surface forms directly (`etxea`, `etxeko`, `etxera`, `etxearen` are all separate entries), so we get agglutinative coverage without needing Hunspell's 121k affix rules
- Every word has a frequency `f ∈ [174, 255]` (log-scale) — free ranking signal
- 80k bigrams capture real collocations (`ez da`, `eskerrik asko`, `egin behar`)

**In txukun:** loaded as a `Set<string>` + `Map<string, number>` (word → frequency). ~16MB in memory. Replaces both `eu.aff`/`eu.dic` (5MB) and the `eu-words.txt` fallback (1.6MB).

### 3.2 GGUF language model (axis 2 — contextual)

**Source:** [`itzune/futo-transformer-basque`](https://github.com/itzune/futo-transformer-basque) → `gguf/eu_futo_v2.gguf` (49 MB)

A 25M-parameter Llama-architecture model (8 layers, d=512, 2048 context, SentencePiece tokenizer) trained on 3B tokens of Latxa v2. Originally built for FUTO Keyboard's hybrid autocorrect engine.

**Verified capabilities:**
- **Autocorrect (FUTO format):** 82.5% top-1 (33/40) via the `<XBU>typo<XBC>correct<XEC>` keypress-token format. *Not used this way in txukun* — too brittle (17.5% failure with degenerate repetition).
- **Next-word prediction:** 50% top-1, 28.9% keystrokes-saved top-5
- **Contextual re-ranking (raw text, surprisal reduction):** **90% (9/10)** — the signal we actually want. ⚠️ **Naive `P(candidate|context)` logprob does NOT work** (1/10) due to token-length bias — a high-probability multi-token word like `musika` beats the contextually-correct `mutila` regardless of context. The fix is **surprisal reduction**: `log P(candidate|context) − log P(candidate)`, which cancels the word's inherent token-probability and isolates the *contextual* signal. Verified directly against the shipped GGUF (no BOS). See **Appendix B** for the full test matrix. This disproves the claim that "raw text is out-of-distribution for this model" — the model is 60% trained on plain text (`plain_ratio: 0.60` in the finetune config); the failure was in the scoring method, not the model.

**Bridge technology: [wllama](https://github.com/ngxson/wllama)** — WASM bindings for llama.cpp that run GGUF models directly in the browser. No GGUF→ONNX conversion (which is problematic), WASM fallback (unlike WebGPU-only WebLLM), runs in a Web Worker. Supports log-probability scoring via the OpenAI-compatible API and a native rerank endpoint.

**Why re-ranking beats direct neural autocorrect for txukun:**
- Direct XBU/XBC/XEC generation has ungraceful failures — when the model is unsure, it degenerates into repetition
- Re-ranking degrades gracefully — if the LM is unsure, it falls back to frequency ordering
- Hunspell (or our dictionary) guarantees real-word candidates — the LM only picks *which* real word, never invents one
- Fits txukun's paste-and-correct use case (vs FUTO's per-keypress simulation)

**In txukun:** lazy-loaded only when a spell error is found (not on page load). 49MB is smaller than the MarianMT model (77MB) already shipped. Hosted on HuggingFace Hub (e.g. `itzune/eu-futo-lm`), loaded via `wllama.loadModelFromHF()`.

### 3.3 Xuxen (axis 3 — normative)

**Source:** existing `public/dicts/eu.dic` / `eu.aff` (Xuxen, 142k lemmas → 160k surface forms) — already in the repo.

**The critical subtlety — Xuxen is asymmetric:**

If Xuxen says a word **is** valid → it's definitely standard Batua (high precision).
If Xuxen says a word is **not** valid → you learn **nothing**. It might be real-but-unenumerated.

This asymmetry is why Xuxen must be a **scoring bonus, never a rejection gate**.

#### The empirical evidence

Cross-referencing our 791k corpus dictionary against Xuxen's 160k surface forms:

```
Common-track words (lowercase):        452,713
  ✓ In Xuxen (normative Batua):         65,928  (14.6%)
  ✗ NOT in Xuxen:                      386,785  (85.4%)  ← looks catastrophic
```

**85% of our words aren't in Xuxen — so we learned 386k bad words, right? No.** Bucketing those 386k by corpus frequency reveals the truth:

```
Words NOT in Xuxen, by corpus frequency:
  f>=230 (very common)      0    ← none
  220<=f<230                0
  200<=f<220               49    ← biztanleria-piramidea, nekazaritza-ustiategi
  180<=f<200            5,963    ← administrazio-kontseiluaren, autodeterminazio-eskubidea
  f<180 (rare)        380,773    ← the bulk, all low-frequency
```

The 386k "not in Xuxen" splits into:

- **~384,000 legitimate Basque** — deep agglutinations and compounds (`biztanleria-piramidea` = "population pyramid", `nekazaritza-ustiategi` = "agricultural holding") that Xuxen's finite affix rules simply **cannot enumerate**. Basque generates forms combinatorially; no finite dictionary captures them all. This is the same "30k coverage gap" txukun already documents (`entzuten` missing), just at 13× scale.
- **~2,408 genuine noise** — fragments and Spanish leakage (`abaia`, `acera`, `adioa`), all at the frequency floor (appeared <5 times in 600k lines of corpus).

**The dirtiness is 0.3%, not 85%.** The 85% is Xuxen's *incompleteness*, not our *dirtiness*.

#### Why Xuxen-as-rejection-gate would be catastrophic

If we used Xuxen as a final gate ("reject candidate if not in Xuxen"), we'd reject 85% of valid Basque. We'd "correct" `biztanleria-piramidea` into something wrong. This is exactly the failure mode that made Hunspell's `spell()` unusable in txukun — rejecting valid rare words.

#### The correct role: normative bonus, additive-positive only

```
score(candidate) = α · LM_surprisal(candidate | context)      # axis 2
                 + β · freq_log(candidate)                   # axis 1
                 + γ · normative_bonus(candidate ∈ Xuxen)    # axis 3, +only
                 + δ · editdist_score(typed, candidate)      # noisy channel
```

The Xuxen term `γ` is **added when the candidate IS in Xuxen**, never subtracted when it isn't. It gently biases toward standard Batua *when candidates are otherwise tied* (similar frequency, similar LM surprisal), without ever rejecting the 85% of valid words Xuxen can't enumerate.

- When `musika` (in Xuxen) and a rare dialectal variant (not in Xuxen) have similar LM scores → the bonus tips it to `musika` ✓
- When the only valid candidate is `biztanleria-piramidea` (not in Xuxen) → the absence of the bonus doesn't block it ✓

This makes Xuxen a **high-precision positive signal**, which is the only role its asymmetric coverage supports.

### 3.4 BERTeus — bidirectional detection (axis 2, detection only)

**Source:** [`ixa-ehu/berteus-base-cased`](https://huggingface.co/ixa-ehu/berteus-base-cased) on HuggingFace (498 MB safetensors, ~110M params)

A Basque BERT model trained on 224.6M tokens of Basque news + Wikipedia. Bidirectional (sees context on both sides). Used by Mendez (2023) for grammatical error *detection* (GED) — the binary "is this sentence grammatical?" task.

**Why it fills a gap the futo LM can't:**
- **Bidirectional**: BERT processes the full sentence in both directions. The futo LM is causal (left context only). For errors where the disambiguating signal is in the *following* words, BERT sees it; the futo LM doesn't.
- **Token-understanding specialist**: BERT is trained on the masked-LM objective (predict the hidden token from surrounding context) — this is exactly the "is this the right word here?" question. The futo LM is trained on next-token prediction — a related but different signal.
- **110M params** (vs futo's 25M): more capacity for fine-grained grammaticality judgments.

**The costs:**

| Factor | BERTeus | Our futo model |
|--------|---------|----------------|
| Architecture | BERT (encoder, bidirectional) | Llama (decoder, causal) |
| Params | ~110M | ~25M |
| Model size (raw) | 498 MB (safetensors) | 49 MB (GGUF) |
| Model size (quantized ONNX int8) | **~125 MB** | N/A (already GGUF) |
| ONNX version exists? | ❌ No (need to convert) | N/A |
| GED fine-tune published? | ❌ No (only base model) | N/A |
| Runtime | Transformers.js | wllama |

**Detection method (raw MLM, no fine-tune needed):** Run BERTeus on the full sentence. For each token, compare the model's top-k MLM predictions at that position against the actual word. If the actual word is not in the top-k and the model's confidence is high for a different word → flag as potential error. One forward pass per sentence (not per word).

**Candidate generation (bonus):** When a word is flagged, mask it and take BERT's top-k predictions as contextually-motivated candidates — these complement edit-distance candidates by including words that are contextually likely but not spelling-similar.

**In txukun:** only loaded if Tier 2.5 (futo surprisal detection) proves insufficient. Transformers.js is already a dependency (used for MarianMT), so no new library — just a new model. 125 MB extra download is heavy but txukun already loads MarianMT (77 MB) + futo GGUF (49 MB), so total would be ~251 MB. Consider lazy-loading BERTeus only when Tier 2.5 detection confidence is low.

---

## 4. Should we retrain the GGUF on only newspapers/publications?

**No.** Three reasons.

### 4.1 The corpus is already newspaper-grade

Latxa v2's 11 sources are all quality-rated Q4.4+ and Morpheus-cleaned:

```
euscrawl-v2      Q5.0  — news/media crawl, BEST source (56% of v1)
colossal-oscar   Q4.7  — cleaned Common Crawl
wikipedia        Q4.6  — Basque Wikipedia dump (Sep 2025)
hplt-v2          Q4.4  — HPLT v2 crawl
```

`euscrawl-v2` (news/media, the highest quality tier) is the dominant source. The conversational/social-media data (BERnaT BSM) is a *separate tier* used only for a separate conversational model — **not** used for `eu_futo_v2`. So "retrain on only newspapers" is largely what was already done.

### 4.2 The noise is already self-suppressed

The 2,408 genuinely-suspicious tokens all sit at the frequency floor (f<178 = appeared <5× in 600k lines). An LM trained on 3B tokens assigns such rare forms near-zero probability. The model already discounts the noise — `abaia` and `acera` don't win candidate rankings because the model rarely saw them. A retrain buys ~0.3% cleanliness at best.

### 4.3 Restricting sources sacrifices breadth for marginal cleanliness

The compounds and agglutinations that make Basque *Basque* (`biztanleria-piramidea`, `autodeterminazio-eskubidea`) come from the diverse news/legal/Wikipedia mix. Narrowing to "only newspapers" would **reduce** coverage of the exact forms that make the dictionary beat Xuxen and H314. You'd trade 0.3% noise removal for real vocabulary loss.

### 4.4 Where retraining WOULD help (different goal)

If you wanted the model to **generate** corrections (seq2seq GEC, txukun Phase 2), not just **score** them. Generation is more sensitive to corpus noise than scoring. But that's a different model for a different task — a future project, not a tweak to this one. For now, the Xuxen bonus term delivers more normative-ness for free than a retrain would.

---

## 5. Implementation plan

### Tier 1 — Frequency re-ranking (no new model, ~1 day)

Generate candidates via edit-distance against the wordlist, then rank by corpus frequency from the existing `public/dicts/eu-words-freq.txt` (2MB, already shipped, currently unused for ranking) instead of taking Hunspell's `suggestions[0]`.

**Scope:**
- Modify `autoCorrect()` in `src/spell.js:236-261`: candidate pool = `(edit-distance-1 variants ∩ wordlist) ∪ (Hunspell suggestions)`, scored `score = β·freq + δ·editdist`, pick best
- Load `eu-words-freq.txt` into a `Map<string, number>` at spell-checker init
- Keep Hunspell for detection + as a *secondary* candidate source. **Hunspell's suggestions alone do not contain the correct word** — for `batzutan` it returns `batsutan`, `batzotan` but never `batzuetan` (see XUXEN_ISSUES.md §1) — so candidate generation *must* include edit-distance ∩ wordlist or Tier 1 fixes nothing. (Tier 2 replaces Hunspell entirely.)

**Deliverable:** Fixes the `batzutan`-class bugs. Verified empirically — `batzuetan` (correct, count=14,790 in the shipped wordlist) outranks `batsutan` (absent from the wordlist entirely) by frequency alone. Ships with **zero new ML dependency**.

**This is the highest-ROI piece.** Remove the worst detector's mis-ranking, fix documented bugs, ship a working improvement.

### Tier 2 — Neural re-ranking via wllama (~3-5 days)

Add the GGUF LM for the ambiguous cases the frequency tie-break can't resolve.

**Scope:**
- Add `@wllama/wllama` dependency
- Create `src/lm-rerank.js` (wllama wrapper, mirrors existing `spell.js` pattern)
- Optional: `src/lm-worker.js` (isolate LM inference in a Web Worker, like `spell-worker.js`)
- Host `eu_futo_v2.gguf` on HuggingFace Hub (`itzune/eu-futo-lm`)
- Lazy-load the LM only when a spell error is found (not on page load)
- Modify `autoCorrect()` to invoke LM scoring when multiple candidates have close frequency scores
- **No COEP/COOP header changes** — WebGPU (the primary path) needs no cross-origin isolation (§11 #2, Appendix A.7). GitHub Pages deploys as-is.
- Replace Hunspell with corpus dictionary + edit-distance candidates (drop `hunspell.wasm`, `eu.aff`, `eu.dic`, the WASI shim, the 3-layer detection workaround)
- **Patch the GGUF** to set `tokenizer.add_bos_token=false` before hosting (Appendix A.5, B.6 — BOS penalty confirmed on both autocorrect and re-ranking tasks)
- **Use surprisal reduction** (`log P(c|ctx) − log P(c)`, two passes) for the LM score — NOT naive logprob (§7, Appendix B)

**Fast path vs slow path:**
- **Fast path** (no LM call): single candidate, or top-freq candidate >> others → apply directly. ~99% of cases, sub-millisecond.
- **Slow path** (LM needed): multiple candidates with close frequencies → invoke wllama for surprisal score. The rare hard cases (e.g. `mutika` → mutila/musika/mutiko, all valid, context decides).

**Deliverable:** Full neural re-ranking. The architecture from the diagram in §0.

### Tier 2.5 — Futo surprisal detection (free, no new model, ~1 day)

**The problem:** Tier 2 only re-ranks candidates when the dictionary flags a word as misspelled. Real-word errors (a valid word used in the wrong context, like `izaki` where `iñaki` was meant) pass detection unchecked — the dictionary says "valid word" and the LM re-ranker never runs.

**The fix:** Use the already-loaded futo LM to compute surprisal for every word, even in-dictionary ones. If a word's surprisal `log P(word | context) − log P(word)` exceeds a threshold → flag as potential real-word error → generate candidates → re-rank (Tier 2).

**Why it's free:** The LM is already loaded for Tier 2 re-ranking. Detection needs only the in-context pass (`log P(word | context)`) — one forward pass per word, no baseline pass needed (we're looking for anomalously low-probability words, not comparing candidates). The surprisal threshold can be tuned against the evaluation benchmark.

**Limitation:** Causal (left context only). 25M params. Catches easy real-word errors but misses cases where the disambiguating signal is in the *following* words. This is where Tier 3 (BERTeus) earns its keep.

**Scope:**
- Add a detection pass in `autoCorrect()` before the dictionary check: compute `log P(word | leftContext)` for each word via wllama
- If surprisal > threshold AND word is in dictionary (would otherwise be skipped) → generate edit-distance candidates → proceed to Tier 2 re-ranking
- Tune the threshold against the evaluation benchmark ([`GEC_RESEARCH_2025.md`](./GEC_RESEARCH_2025.md) §4)
- Non-dictionary words still go through the existing Tier 1/2 path (no change)

**Deliverable:** Catches real-word errors like `izaki → iñaki` using the model already deployed. Zero new dependencies, zero new download.

### Tier 3 — BERTeus bidirectional detection (~1-2 weeks)

Add BERTeus (Basque BERT, 110M) for contextual detection when the futo LM's causal signal is insufficient. See §3.4 for model details and costs.

**Scope:**
- Convert BERTeus PyTorch → ONNX int8 (~125 MB) — `optimum-export-cli` or `torch.onnx.export`
- Create `src/detection.js` (Transformers.js wrapper, mirrors existing MarianMT pattern in `src/main.js`)
- Add MLM-based detection: run BERTeus on full sentence, flag tokens where actual word ∉ top-k predictions
- Optional: use BERTeus masked predictions as additional candidates (contextually-motivated, not just spelling-similar)
- Lazy-load only when Tier 2.5 detection confidence is low (threshold of a threshold)

**Deliverable:** Bidirectional contextual detection. Catches the hard real-word errors and grammar errors that causal futo surprisal misses. The heavy option — only justified if Tier 2.5's accuracy on the evaluation benchmark is insufficient.

### Tier 4 — Full neural GEC (future)

Train a seq2seq Basque grammar corrector (no Basque GEC model exists yet — this is txukun's stated Phase 2 goal). Out of scope for this document; would require a new training run and a different model format. See [`GEC_RESEARCH_2025.md`](./GEC_RESEARCH_2025.md) for the research landscape — the Elhuyar/Mendez synthetic-error methodology and the 2025-2026 SOTA survey.

---

## 6. File-by-file integration points

| File | Change |
|------|--------|
| `src/spell.js` | Rewrite `autoCorrect()` (line 236) to use multi-signal scoring instead of `suggestions[0]`. Tier 1: freq + editdist. Tier 2: add LM + Xuxen terms. |
| `src/spell-worker.js` | **Tier 2:** Replace Hunspell WASM worker with corpus-dictionary Set lookup + edit-distance candidate generator. Drop `hunspell.wasm`, WASI shim, `eu.aff`/`eu.dic`, NEEDAFFIX stripping hack. |
| `src/main.js` | Pipeline stays `autoCorrect → MarianMT → autoCorrect`, but `autoCorrect` is now smart. May add LM init/lazy-load hooks (Tier 2). |
| `src/lm-rerank.js` | **New (Tier 2).** wllama wrapper: `loadModel()`, `scoreCandidate(context, candidate) → surprisal` (two-pass: in-context − baseline). **Tier 2.5:** also exposes `detectSurprisal(context, word) → logprob` (single-pass, in-context only) for real-word error detection. Mirrors `spell.js` module pattern. |
| `src/lm-worker.js` | **New (Tier 2, optional).** Isolate LM inference in Web Worker (like `spell-worker.js`). |
| `src/detection.js` | **New (Tier 3).** Transformers.js BERTeus wrapper: `loadDetector()`, `detectErrors(sentence) → [{index, word, topK}]`. MLM-based detection (one forward pass per sentence). Mirrors existing MarianMT pattern in `src/main.js`. |
| `public/dicts/` | **Tier 2:** Replace `eu.aff`+`eu.dic`+`eu-words.txt` (8.4MB total) with `eu_wordlist.combined.gz` (4.0MB). Keep Xuxen `eu.dic`/`eu.aff` for the normative bonus Set. |
| `vite.config.js` | **No change.** WebGPU needs no COEP/COOP (§11 #2, Appendix A.7). Default deploy works as-is. |
| `package.json` | **Tier 2:** Add `@wllama/wllama` dependency. |

---

## 7. The scoring formula (Tier 2, final form)

```
score(candidate) = α · LM_surprisal(candidate | context)      # GGUF — axis 2
                 + β · freq_log(candidate)                   # corpus dict — axis 1
                 + γ · normative_bonus(candidate ∈ Xuxen)    # Xuxen — axis 3, +only
                 + δ · editdist_score(typed, candidate)      # noisy channel

where  LM_surprisal(c | ctx) = log P(c | ctx) − log P(c)
```

**⚠️ The LM term is surprisal reduction, NOT naive logprob.** This is the single most important technical detail in this document. It is empirically verified (Appendix B):

| Scoring method | Accuracy | Verdict |
|---|---|---|
| `sum P(c\|ctx)` (naive logprob) | **1/10** | what a naive test measures — useless due to length bias |
| `P(c\|ctx) / n_tokens` (per-token) | 3/10 | still biased |
| **`log P(c\|ctx) − log P(c)` (surprisal)** | **9/10** ✅ | **use this** |

### Why naive logprob fails (the trap)

A word like `musika` tokenizes into high-probability tokens and has a high *inherent* probability — `log P(musika)` is large regardless of context. A word like `mutila` tokenizes differently. So when you score `log P(c|context)` directly, `musika` wins almost every slot not because the context predicts music, but because `musika` is intrinsically a high-probability token sequence. **This is a tokenization/length bias, not a model failure.** An agent tested this naive way, got ~0/5, and wrongly concluded "the model can't do raw text." The model can — the scoring was wrong.

### Why surprisal reduction works

`log P(c|context) − log P(c)` asks: *how much does the context increase this word's probability above its baseline?* This cancels `musika`'s inherent advantage. When the model sees `Nire anaia ___` ("my brother ___"), `mutila` ("the boy") gets a large surprisal boost while `musika` ("music") gets none — because the context genuinely predicts "boy," not "music." This is contextual divergence (a.k.a. PMI / pointwise mutual information between context and word), a standard technique from the language-modeling literature. It is what isolates the *contextual* axis (axis 2) from the *lexical* axis (axis 1, frequency).

**Implementation cost:** two forward passes per candidate instead of one — one for `log P(c|context)` (prompt = `context + ' ' + candidate`), one for the baseline `log P(c)` (prompt = `' ' + candidate`, no context). On the slow path only (close-frequency ties), for a handful of candidates, on a 25M model — negligible. See §A.2 for the exact wllama calls.

Where:
- `LM_surprisal` — `log P(candidate|context) − log P(candidate)`, both computed via wllama `createCompletion` with `logprobs` (§A.2)
- `freq_log` — `log(f)` from corpus dictionary (f ∈ [174, 255], log-scale)
- `normative_bonus` — `1` if candidate ∈ Xuxen surface-form set, `0` otherwise (NEVER negative)
- `editdist_score` — `1 / (1 + edit_distance(typed, candidate))`

**Tuning:** Fit α/β/γ/δ against txukun's autocorrect test set. This is where the real calibration lives — not in retraining the model. Start with α=1.0, β=0.3, γ=0.15, δ=0.5 and grid-search.

**The Xuxen term `γ` is the answer to the question "should we integrate Xuxen as last step?"** — yes, as an additive bonus, never as a rejection gate.

---

## 8. What gets removed (Tier 2)

Dropping Hunspell entirely removes:

- `public/dicts/hunspell.wasm` (~712KB)
- The WASI shim in `spell-worker.js` (~100 lines)
- `public/dicts/eu.aff` + `eu.dic` (5MB) — *kept only for the Xuxen normative-bonus Set*
- The 3-layer detection workaround (word-list Set → `hunspell_spell` → suggest-as-spell)
- The `NEEDAFFIX` stripping hack
- The coverage-gap `eu-words.txt` fallback (superseded by the 791k dictionary)

### Honest tradeoffs of dropping Hunspell

| We lose | Impact | Mitigation |
|---------|--------|------------|
| Affix-rule suggestions (REP table, phonetic tries) | Low — our corpus list already contains the inflected *forms*; we lose the *rules* but keep the *coverage* | None needed |
| Edit-distance-2 candidate generation slower than Hunspell's indexed lookup | ed-2 = ~90k Set lookups (~50ms) | Only invoke ed-2 when ed-1 finds nothing; or precompute SymSpell on top-50k for ed-2 |
| Hunspell's diacritic-aware TRY | Low — our edit generator includes `ñüçáéíóú` in its alphabet | Include Basque alphabet in edits |

None are dealbreakers. The affix intelligence was Hunspell's one genuine advantage, and our corpus-derived approach neutralizes it by having the surface forms already present.

---

## 9. Verified evidence (the `batzutan` case)

The documented Hunspell failure: input `batzutan`, Hunspell suggests `batsutan` first (wrong), even though `batzuetan` (correct) exists in its dictionary.

What our dictionary + simple edit-distance + frequency does with the same input:

```
typo: 'batzutan'
  correct:     'batzuetan'  (in our dict: True,  f=221)
  HSpell pick: 'batsutan'   (in our dict: False, f=-)   ← not even a real corpus word!

Edit-distance-1 candidates (filtered by our 791k dict), ranked by frequency:
  batzuetan   f=221  ← CORRECT, ranked #1
  batutan     f=156
  batzetan    f=155
  baltzutan   f=147
```

> **Note on frequency values:** the `f=` numbers above are AOSP log-scale values (`f ∈ [0,255]`) from the **791k corpus dict** (`eu_wordlist.combined`, the Tier 2 target). The shipped Tier 1 file `public/dicts/eu-words-freq.txt` (160k words) uses **raw corpus counts** instead — there `batzuetan`=14,790. The two are monotonic transforms of the same underlying corpus frequencies, so the ranking conclusion is identical on either file: `batzuetan` ranks #1, `batsutan` is absent. (Verified against the shipped file.)

**Hunspell's "correction" (`batsutan`) isn't even in our 791k-word corpus-derived dictionary** — it's a technically-valid affix-generated form that real Basque never uses. Our list, built from actual Latxa v2 text, naturally excludes it. And the correct word `batzuetan` is the **top candidate by frequency alone** — no LM even needed for this case.

Six more typos, all resolved by dictionary + edit-distance + frequency:

```
kaixp     → kaixo      ✓ (sole candidate)
narkatu   → barkatu    ✓ (ranked #1 by freq)
inaki     → iñaki      ✓ (ranked #1, ñ restored)
eskkerrik → eskerrik   ✓ (sole candidate)
mesedez   → mesedez    ✓ (already correct, ranked #1)
mutika    → mutila     ✓ (ranked #4 — HERE the LM would help: mutila vs musika vs mutiko)
```

Tier 1 (frequency re-ranking alone) fixes the first five. Tier 2 (LM) earns its keep on the sixth — the genuine ambiguities where multiple valid candidates compete and only context decides. **This is now empirically verified** (Appendix B): the `mutika → mutila (not musika)` class of disambiguation is exactly what surprisal reduction scores at 90%.

---

## 10. Summary of architectural decisions

| Decision | Rationale |
|----------|-----------|
| **Drop Hunspell, use corpus dictionary for detection** | Hunspell's `spell()` is broken (NEEDAFFIX regression), coverage has 30k gaps, no frequency data. Corpus dict is O(1), 791k forms, has frequencies. |
| **Edit-distance candidate generation, not Hunspell suggest** | Hunspell mis-ranks (`batzutan→batsutan`). Our dict already contains inflected forms, so edit-distance + Set filter captures morphology for free. |
| **Re-ranking, not direct neural generation** | Direct XBU/XBC/XEC has ungraceful failures (17.5%, degenerate repetition). Re-ranking degrades gracefully (falls back to frequency if LM unsure). Hunspell/dict guarantees real-word candidates. |
| **wllama over WebLLM/Transformers.js** | No GGUF→ONNX conversion (unlike Transformers.js), WASM fallback (unlike WebGPU-only WebLLM), runs GGUF as-is. |
| **Surprisal reduction, not naive logprob, for LM scoring** | Naive `log P(c\|ctx)` scores 1/10 due to token-length bias (a high-probability multi-token word wins regardless of context). Surprisal reduction `log P(c\|ctx) − log P(c)` cancels the word's inherent probability and isolates the contextual signal → 9/10. Verified empirically (Appendix B). Cost: 2 forward passes per candidate, only on the slow path. |
| **Xuxen as additive bonus, never rejection gate** | Xuxen is asymmetric: high precision (if valid → definitely Batua), low recall (85% of real Basque not enumerated). Rejection would be catastrophic; bonus captures the strength. |
| **No retrain on "only newspapers"** | Corpus is already newspaper-grade (euscrawl-v2 Q5.0 news/media is dominant source). Noise is 0.3% and self-suppressed by low frequency. Restricting sources sacrifices vocabulary breadth. |
| **Tiered rollout** | Tier 1 (freq re-rank, no new deps) → Tier 2 (neural re-rank via wllama) → Tier 3 (full GEC, future). Each tier degrades gracefully and ships independently. |
| **Lazy-load the LM** | 49MB futo GGUF loaded only when a spell error is found, not on page load. Smaller than the MarianMT model (77MB) already shipped. |
| **Layered detection** (Tier 2.5 + 3) | Dictionary lookup catches non-words (typos). Futo surprisal (free, causal) catches easy real-word errors. BERTeus MLM (heavy, bidirectional) catches hard cases where right context disambiguates. Each layer adds cost only when the previous is insufficient. |
| **Start with futo surprisal detection** (Tier 2.5 before Tier 3) | The futo LM is already loaded for re-ranking — detection is a free byproduct (one extra forward pass per word, in-context only). Only add BERTeus (125 MB) if the evaluation benchmark shows futo surprisal detection is insufficient. Don't pay the download cost until the free option is measured inadequate. |

---

## 11. Open questions

1. **Xuxen surface-form expansion** — Xuxen ships as lemmas + affix flags (`eu.dic`/`eu.aff`). For the normative-bonus Set, we need the *expanded* surface forms. The existing `public/dicts/eu-words.txt` (160k words) is already expanded — use that as the Xuxen Set.
2. **wllama COOP/COEP hosting — ✅ RESOLVED (do nothing)** — Researched and resolved. The original premise ("multi-threaded WASM required → need COOP/COEP headers → GitHub Pages can't set them") was based on a false assumption: that multi-threaded CPU WASM is the primary inference path. It isn't. **WebGPU is the primary path, and WebGPU needs no cross-origin isolation.** See Appendix A.7 for the full evidence chain. Summary:
   - **WebGPU ≠ SharedArrayBuffer.** Cross-origin isolation (COOP/COEP) is required *only* for `SharedArrayBuffer` (WASM pthreads) — [web.dev guide](https://web.dev/articles/cross-origin-isolation-guide) is explicit. WebGPU is a separate API, not in that list.
   - **wllama auto-enables WebGPU by default** (`n_gpu_layers: 99999`), and GPU offload is **independent** of the multi-thread flag (verified in `src/wllama.ts:482-500`: `useMultiThread = supportMultiThread && nbThreads > 1` controls pthreads; `n_gpu_layers` is a separate axis).
   - **wllama README line 37**: COOP/COEP headers are "to enable multi-thread" — not for WebGPU.
   - **Result:** on GitHub Pages with **zero header changes**, WebGPU works and offloads the whole model to GPU. The COOP/COEP question only affects the *CPU fallback* (browsers without working WebGPU), where wllama silently degrades to single-threaded CPU WASM — still functional.
   - **WebGPU coverage (mid-2026, [gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)):** Chrome/Edge 113+ (Apr 2023, desktop + Android 12+), Safari 26 (Sept 2025, Apple platforms), Firefox 141+ Windows / 145+ macOS. Gaps: Firefox Linux (Nightly only) & Android (behind flag); plus wllama v3.5.1 conservatively disables WebGPU on Firefox unless compat mode is set.
   - **For our 25M model** the fallback (single-threaded CPU) is likely acceptable on the slow path — the model is ~68× smaller than the 1.7B model benchmarked at 60 tok/s on WebGPU ([mikeesto](https://mikeesto.com/posts/wllama/)). Confirm with the #3 measurement during Tier 2; if a non-WebGPU browser is too slow, the reserves are `coi-serviceworker` (fragile — [issue #31](https://github.com/gzuidhof/coi-serviceworker/issues/31): Chrome reload bug) or migrating to Cloudflare Pages. Neither is a prerequisite.
   - **Action: no hosting changes for Tier 2.** Deploy to GitHub Pages as-is.
3. **LM scoring latency** — only relevant for the non-WebGPU fallback (see #2). **Note: surprisal needs 2 forward passes per candidate** (in-context + baseline), but only on the slow path (close-frequency ties, a handful of candidates). WebGPU path: ~60 tok/s for a 1.7B model ([mikeesto](https://mikeesto.com/posts/wllama/)); our 25M model is ~68× smaller, so expect comfortably fast. Single-threaded CPU fallback: unmeasured, but for a 25M model scoring a few candidates on the slow path, likely acceptable. Confirm during Tier 2.
4. **Weight tuning (α/β/γ/δ)** — needs a labeled autocorrect test set. Start with txukun's existing example sentences + the FUTO 40-case eval set.
5. **BOS handling (see Appendix A.5)** — the shipped GGUF lacks `tokenizer.add_bos_token`, so llama.cpp defaults to BOS-on for the Llama architecture. We measured 82.5% autocorrect without BOS vs 60% with BOS. **The surprisal-reduction test (Appendix B) independently confirms the BOS penalty:** 9/10 without BOS vs 7/10 with BOS for contextual re-ranking. Two different tasks, same direction, same magnitude. Must patch the GGUF metadata (`tokenizer.add_bos_token=false`) or verify/suppress at runtime. The fix is now doubly motivated.

---

## Appendix A — wllama integration reference

> **Verified against wllama v3.5.1 source** (`src/wllama.ts`, `src/types/oai-compat.ts`, `src/types/types.ts`, `examples/main/src/config.ts`). All signatures below are copied from the actual TypeScript definitions, not from memory.

This appendix exists so Tier 2 implementation starts from **correct API calls**, not assumptions. Two claims from earlier research were checked against the source and found wrong — see §4 below.

### A.1 Install & initialize

```bash
npm i @wllama/wllama   # v3.5.1, no runtime deps
```

**Vite wasm-path pattern** (txukun uses Vite — this is the correct way to reference the wasm binary):

```js
// src/lm-rerank.js
import { Wllama } from '@wllama/wllama';
import wllamaWasm from '@wllama/wllama/src/wasm/wllama.wasm?url';

const CONFIG_PATHS = { default: wllamaWasm };
let wllama = null;

export async function loadLM() {
  wllama = new Wllama(CONFIG_PATHS, { logger: LoggerWithoutDebug });
  await wllama.loadModelFromHF(
    { repo: 'itzune/eu-futo-lm', file: 'eu_futo_v2.gguf' },
    {
      n_ctx: 2048,          // matches model's training context
      n_threads: 4,         // or omit → defaults to hardwareConcurrency/2
      progressCallback: ({ loaded, total }) => {
        console.log(`LM downloading... ${Math.round(loaded/total*100)}%`);
      },
    }
  );
  return wllama;
}
```

The `?url` suffix is Vite's [explicit URL import](https://vitejs.dev/guide/assets#explicit-url-imports) — it emits the wasm as a hashed asset and returns its URL. This is the pattern from wllama's own React/Vite example (`examples/main/src/config.ts`).

### A.2 The scoring primitive: surprisal reduction via `createCompletion` with `logprobs`

**Use `createCompletion` (raw text completion), NOT `createChatCompletion`.** The futo model is a base Llama model (no instruction tuning, no chat template). `createChatCompletion` would apply a chat template the model never saw.

**The LM term is surprisal reduction**, not naive logprob (see §7 and Appendix B — naive logprob scores 1/10, surprisal scores 9/10). This means **two forward passes per candidate**: one in-context, one baseline.

Verified signature:

```ts
// from src/types/oai-compat.ts
type RawCompletionParams = {
  prompt: string | string[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  logprobs?: number | null;   // ← number of top logprobs to return per position
  echo?: boolean;
  stop?: string | string[];
  // ... + SamplingParams (top_k, top_p, temp, grammar, ...)
};

interface RawCompletionResponse {
  choices: RawCompletionChoice[];
  usage: ChatCompletionUsage;
}

interface RawCompletionChoice {
  text: string;
  index: number;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
  logprobs: {
    tokens: string[];                 // the token strings
    token_logprobs: number[];         // ← logprob of each token
    top_logprobs: Record<string, number>[];  // top-N per position
    text_offset: number[];
  } | null;
}
```

Scoring `log P(candidate|context) − log P(candidate)` — the core of Tier 2's axis-2 signal:

```js
// Sum the logprobs of the candidate's tokens, given a prompt where the
// candidate appears at the end. The leading space on the candidate ensures
// SentencePiece tokenizes it the same way in both the in-context and
// baseline prompts (space is absorbed into the first token).
async function sumCandidateLogprobs(prompt, candidate) {
  if (!wllama) await loadLM();
  const resp = await wllama.createCompletion({
    prompt,                        // ends with ' ' + candidate
    max_tokens: 0,                 // don't generate — we only want prompt logprobs
    logprobs: 0,                   // return logprobs for the chosen tokens
    temperature: 0,
  });
  const lp = resp.choices[0].logprobs;
  if (!lp) return -Infinity;
  // The candidate spans the last N tokens of the prompt.
  const candTokens = await wllama.tokenize(' ' + candidate);  // match the prompt's tokenization
  const total = lp.token_logprobs.length;
  const start = total - candTokens.length;
  let sum = 0;
  for (let i = start; i < total; i++) sum += lp.token_logprobs[i];
  return sum;
}

export async function scoreCandidate(context, candidate) {
  // Two passes — surprisal reduction cancels the word's inherent token-probability
  const inContext = await sumCandidateLogprobs(context + ' ' + candidate, candidate);  // log P(c|ctx)
  const baseline  = await sumCandidateLogprobs(' ' + candidate, candidate);             // log P(c)
  return inContext - baseline;   // surprisal = log P(c|ctx) − log P(c)
}
```

**Caveat (needs runtime validation):** whether `max_tokens: 0` + `logprobs` returns logprobs for *prompt* tokens depends on llama.cpp's server behavior. If it only returns logprobs for *generated* tokens, fall back to **iterative scoring** — feed `context`, generate 1 token with `logprobs: 20`, look up each candidate's first token; for multi-token candidates, extend the prompt token-by-token. This is more forward passes but unambiguous (2× as many for the baseline pass). Validate against the shipped model before committing to either path. The surprisal *formula* is identical either way — only the per-pass mechanics change.

### A.3 Candidate scoring in the pipeline

Wire into `autoCorrect()` — only on the slow path (close-frequency candidates):

```js
import { scoreCandidate } from './lm-rerank.js';

// inside autoCorrect(), after generating edit-distance candidates:
async function rankCandidates(typed, candidates, leftContext) {
  // Fast path: single candidate or clear frequency winner → skip LM
  if (candidates.length === 1) return candidates[0];
  // Slow path: invoke LM to break ties (surprisal reduction — see §A.2, Appendix B)
  const scored = await Promise.all(
    candidates.map(async c => ({
      word: c.word,
      score: 1.0 * await scoreCandidate(leftContext, c.word)   // α (LM surprisal)
           + 0.3 * Math.log(c.freq)                              // β (corpus)
           + 0.15 * (c.inXuxen ? 1 : 0)                          // γ (normative bonus)
           + 0.5 * (1 / (1 + c.editDist))                        // δ (noisy channel)
    }))
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0].word;
}
```

### A.4 Corrections to earlier research (verified against source)

Two claims from the pre-research summary were **wrong**. Checking the source caught both:

1. **"wllama has a native rerank endpoint we can use"** — ❌ Wrong on two counts:
   - The method is `createRerank()` (not `rerank()`).
   - It requires the model be loaded with `embeddings: true` **and** `pooling_type: 'rank'`. That's a cross-encoder model type (jina-reranker style), **not a causal LM**. Our futo GGUF is a causal Llama LM. `createRerank` will throw `"Rerank is not enabled"` with our model.
   - **Correct primitive:** `createCompletion` with `logprobs` (§A.2). This is what actually computes `P(candidate | context)` with a causal LM.

2. **"Use `createChatCompletion` for scoring"** — ❌ Wrong for our model:
   - `createChatCompletion` applies the model's chat template (Jinja). The futo model is a **base** Llama model with no chat template. Applying one would corrupt the prompt.
   - **Correct:** `createCompletion` (raw text completion) — passes the prompt through unchanged.

### A.5 The BOS problem (critical, verified)

We measured the futo model at **82.5% autocorrect without BOS** vs **60.0% with BOS**. Whether wllama prepends BOS is controlled by the GGUF metadata field `tokenizer.add_bos_token` — there is **no API parameter to override it** (confirmed: `RawCompletionParams` has no BOS field; BOS is purely model-metadata-driven).

Checking the shipped GGUF:

```
tokenizer.ggml.bos_token_id   = 1        ✓ present
tokenizer.ggml.eos_token_id   = 2        ✓ present
tokenizer.add_bos_token       = NOT PRESENT   ← problem
tokenizer.add_eos_token       = NOT PRESENT
```

The field is **absent**. When `tokenizer.add_bos_token` is missing, llama.cpp defaults to **BOS-on** for the Llama architecture — which would give us 60%, not 82.5%.

**Impact varies by position** (this is the nuance):
- **Mid-sentence corrections** (the common case — a misspelled word with real text before it): BOS sits at the start of a long context; attention dilutes it. Impact is small.
- **Sentence-initial / no-context corrections** (the misspelled word is the first word): BOS sits immediately before the candidate. This is the regime where we measured the 60%-vs-82.5% gap. Impact is large.

**Fix options (in order of preference):**
1. **Patch the GGUF** to set `tokenizer.add_bos_token=false` (one-time, using `gguf-set-metadata` from llama.cpp, or Python `gguf` lib). Cleanest — fixes it for every consumer, not just wllama.
2. **Verify at runtime** via `wllama.getLoadedContextInfo().add_bos_token`. If `true` and option 1 isn't done, accept the 60% regime for sentence-initial cases (mid-sentence stays unaffected).
3. **`kv_overrides`** in `LoadModelParams` (`{ 'tokenizer.add_bos_token': 'false' }`) — *may* work, unverified. Test before relying on it.

This is flagged as open question #5 and is the single biggest risk to reproducing the 82.5% result in-browser.

### A.6 Other verified API facts

| Need | API | Notes |
|------|-----|-------|
| Load from HF | `loadModelFromHF({ repo, file }, params)` | `params` is `LoadModelParams & DownloadOptions` |
| Load from URL | `loadModelFromUrl(urlOrSource, params)` | for non-HF hosts |
| Load from Blob | `loadModel(blobs, params)` | for user-uploaded files |
| Raw completion | `createCompletion(params)` | **use this** (base model) |
| Chat completion | `createChatCompletion(params)` | don't use (no chat template) |
| Embeddings | `createEmbedding({ input })` | requires `embeddings: true` at load |
| Rerank | `createRerank({ query, documents, top_n })` | **not applicable** — requires `pooling_type: 'rank'` |
| Tokenize | `wllama.tokenize(text)` | for counting candidate tokens |
| Context info | `getLoadedContextInfo()` | returns `add_bos_token`, `token_bos`, `n_ctx`, metadata |
| Unload | `wllama.exit()` | frees memory |
| WebGPU | `n_gpu_layers` in load params | auto-offloads all layers if WebGPU available |

**COEP/COOP headers** — **NOT required for the WebGPU path** (see A.7). Only needed to enable multi-threaded *CPU* WASM (pthreads / SharedArrayBuffer), which is the fallback for browsers without working WebGPU. wllama README line 37: "To enable multi-thread, you must add `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` headers."

GitHub Pages **cannot** set HTTP headers (no `_headers` support — that's Netlify/Cloudflare). Since WebGPU needs no headers and covers the majority of browsers, **the default deploy works as-is**. If the single-threaded CPU fallback proves too slow on a specific browser, reserves are `coi-serviceworker` (service-worker header injection, but fragile — [issue #31](https://github.com/gzuidhof/coi-serviceworker/issues/31)) or migrating to Cloudflare Pages. Neither is a prerequisite for Tier 2.

Inference always runs in a Web Worker regardless of threading — it never blocks the UI thread.

### A.7 Why COOP/COEP is not required (evidence chain)

The original concern was "wllama needs multi-threaded WASM → needs SharedArrayBuffer → needs COOP/COEP headers → GitHub Pages can't set them." Research against primary sources breaks that chain at the first link:

1. **WebGPU is the primary inference path, not multi-threaded CPU WASM.** wllama v3.1+ auto-enables WebGPU and offloads all layers by default. From `src/wllama.ts` load path: `n_gpu_layers: params.n_gpu_layers ?? 99999` ("if WebGPU is available" — `LoadModelParams` comment). The GPU does the compute; CPU threading is irrelevant when the model runs on GPU.

2. **WebGPU does not require cross-origin isolation.** The [web.dev cross-origin isolation guide](https://web.dev/articles/cross-origin-isolation-guide) lists exactly what requires it: `SharedArrayBuffer`, `performance.measureUserAgentSpecificMemory()`, and high-precision timers. WebGPU is **not** in that list — it is a separate API with its own security model.

3. **GPU offload and CPU threading are independent axes in wllama.** From `src/wllama.ts:482-500`:
   ```js
   const supportMultiThread = await isSupportMultiThread(); // checks SharedArrayBuffer
   this.useMultiThread = supportMultiThread && nbThreads > 1;
   // ...
   n_threads: this.useMultiThread ? nbThreads : 1,   // CPU threads
   n_gpu_layers: params.n_gpu_layers ?? 99999,        // GPU offload — separate axis
   ```
   Without cross-origin isolation, `supportMultiThread` is `false` → CPU falls to 1 thread, **but `n_gpu_layers` stays 99999** → GPU offload is unchanged.

4. **wllama README confirms the scope.** Line 37: "To enable **multi-thread**, you must add COOP/COEP headers" — i.e., headers are for the CPU multi-thread feature, not for WebGPU.

5. **WebGPU browser coverage (mid-2026, [gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)):** Chrome/Edge 113+ (Apr 2023), Safari 26 (Sept 2025), Firefox 141+ Windows / 145+ macOS. The non-WebGPU fallback (single-threaded CPU) only hits: Firefox Linux (Nightly only) / Android (behind flag), older browsers, and wllama v3.5.1's conservative Firefox handling (disables WebGPU unless compat mode set).

6. **For our 25M model the fallback is likely fine anyway.** A 1.7B model hits ~60 tok/s on WebGPU ([mikeesto benchmark](https://mikeesto.com/posts/wllama/)); ours is ~68× smaller. Even single-threaded CPU WASM for a 25M model scoring a few candidates on the slow path should be sub-second. Confirm with the #3 measurement during Tier 2.

**Conclusion:** deploy to GitHub Pages as-is. No header changes, no service worker, no hosting migration. The COOP/COEP concern was a red herring rooted in assuming CPU multi-thread was the primary path.

---

## Appendix B — Surprisal-reduction evidence (Tier 2 viability)

> Tested 2026-06-29 against the shipped `gguf/eu_futo_v2.gguf` via `llama-cpp-python` (`logits_all=True`, `llm.reset()` between cases). Test script: [`scripts/eval/surprisal_test.py`](https://github.com/itzune/futo-transformer-basque/blob/main/scripts/eval/surprisal_test.py) in the futo-transformer-basque repo.

### B.1 The question

An agent reported a "negative result": that raw-text logprob scoring of the futo model scored 0/5 on contextual re-ranking, concluding the model is "a keyboard autocomplete model, not a text LM" and that "raw text is out-of-distribution."

This appendix documents the test that disproves that claim.

### B.2 Why the agent's test failed (the trap)

Naive logprob scoring — `log P(candidate | context)` — has a fatal tokenization/length bias. A word like `musika` tokenizes into high-probability tokens and has a large *inherent* probability, so it wins almost every candidate slot regardless of whether the context predicts music. This is not a model failure; it's a scoring-method failure. The model is 60% trained on plain text (`plain_ratio: 0.60` in `configs/phase4_multitask.yaml`) — raw text is in-distribution by construction.

### B.3 The fix: surprisal reduction

Score `log P(candidate | context) − log P(candidate)` — "how much does the context *increase* this word's probability above its baseline?" This cancels `musika`'s inherent advantage and isolates the contextual signal. (This is contextual divergence / PMI between context and word — a standard technique from the language-modeling literature.)

### B.4 Results (10 contextual re-ranking cases, no BOS)

| Scoring method | Accuracy | Verdict |
|---|---|---|
| `sum log P(c\|ctx)` (naive) | **1/10** | what the agent tested — dominated by length bias |
| `log P(c\|ctx) / n_tokens` (per-token) | 3/10 | still biased |
| **`log P(c\|ctx) − log P(c)` (surprisal sum)** | **9/10** ✅ | **use this** |
| surprisal per-token | 8/10 | also good, slightly noisier |
| surprisal ratio (per-token both) | 8/10 | also good |

The 9/10 winner is **surprisal sum** (no per-token normalization on the surprisal itself).

### B.5 The one failure

`Haurrak eta ___` ("Children and ___") → picked `mutiko` instead of `mutila`. Both mean "boy/child" in different registers, and "Children and ___" is genuinely ambiguous between them. A reasonable miss — not a model failure.

### B.6 BOS penalty independently confirmed

| Setting | surprisal_sum accuracy |
|---|---|
| No BOS (correct for this model) | **9/10** |
| With BOS (wllama default — GGUF lacks `tokenizer.add_bos_token`) | 7/10 |

Two different tasks (FUTO-format autocorrect and raw-text re-ranking) show the same BOS penalty in the same direction at the same magnitude. This reinforces open question #5 / Appendix A.5: **patch the GGUF metadata** before hosting for Tier 2.

### B.7 What this means for the strategy

1. **Tier 2 is viable.** The agent's "negative result" was a broken test (naive logprob). With surprisal reduction, the 25M futo model re-ranks candidates at 90% accuracy — more than good enough for a candidate scorer on the slow path.
2. **The §7 formula uses surprisal, not naive logprob.** This is the key technical correction.
3. **The model is not "a keyboard model, not a text LM."** It is a multitask model (60% plain text / 40% keypress). Both capabilities are real and verified.

---

## Appendix C — BERTeus re-ranking benchmark (empirical, 2026-01)

### C.1 Summary

Full-scale benchmark on 933 synthetic-typo cases (Elhuyar GEC correct sentences + typo injection) with ≥2 Tier 1 candidates. Pre-computed scores, grid-searched weights.

| Approach | Accuracy | Improved | Worsened | Net |
|---|---|---|---|---|
| Tier 1 baseline (freq re-rank) | 687/933 (73.6%) | — | — | — |
| Futo surprisal (w=0.2) | 693/933 (74.3%) | 44 | 40 | +6 |
| Futo surprisal gated (t1<0.5, lm>3.0) | 690/933 (74.0%) | 9 | 6 | +3 |
| **BERTeus embedding sim (w=12)** | **786/933 (84.2%)** | **116** | **17** | **+99** |
| BERTeus pure (w→∞, no Tier 1) | 678/933 (72.7%) | 144 | 153 | −9 |

**BERTeus beats futo by +93 net cases.** The 25M futo model's surprisal signal is too noisy (44:40 improved/worsened ratio). The 110M BERTeus encoder's bidirectional embedding similarity is 8× more precise (116:17).

### C.2 Critical finding: BERTeus has NO MLM head

The `ixa-ehu/berteus-base-cased` checkpoint was saved as a `BertModel` (encoder only) — 199 keys, no `cls.*` (MLM prediction head). Loading as `BertForMaskedLM` silently randomizes the decoder, making pseudo-log-likelihood (PLL) scores meaningless (+0 net at any weight).

**Solution: masked embedding similarity.** Replace the target word with `<tool_call>`, run the BERT encoder, compute cosine similarity between the `<tool_call>` position's hidden state and each candidate's word embedding. This is the standard approach for lexical substitution with BERT when the MLM head is unavailable (Paetzold & Specia 2017; Zhou et al. 2019).

### C.3 Why BERTeus beats futo

1. **Bidirectional context.** BERTeus sees both left AND right context. Futo (causal LM) sees only left context. This matters especially for first-word typos (8.1% of cases have empty left context → futo surprisal=0). BERTeus fixes `Haur → Gaur` (empty context) that futo couldn't touch.
2. **4× larger model.** 110M params (BERT-base) vs 25M (futo Llama). More capacity for contextual understanding.
3. **One forward pass per case.** Futo needs two passes per candidate (in-context + baseline). BERTeus needs one pass per case (single `<tool_call>`). On GPU: 4.2s vs 217s for 933 cases (50× faster).

### C.4 Grid search results

```
Weight   T2   Imp   Wor   Net
  0.0   687     0     0    +0
  0.5   703    16     0   +16
  1.0   709    23     1   +22
  2.0   722    37     2   +35
  5.0   754    71     4   +67
  8.0   773    94     8   +86
  9.0   777    98     8   +90
 10.0   776   101    12   +89
 11.0   783   111    15   +96
 12.0   786   116    17   +99  ◄ PEAK
 13.0   784   117    20   +97
 15.0   785   123    25   +98
 20.0   777   130    40   +90
 50.0   735   140    92   +48
 999.   678   144   153    −9  (pure BERTeus, no Tier 1)
```

The curve is flat from w=9 to w=15 (+90 to +99) — robust to weight tuning. Pure BERTeus (w→∞) is worse than Tier 1 alone: the frequency-based Tier 1 score still adds value as a tiebreaker.

### C.5 Combined score formula (revised)

```
combined = tier1_score + 12.0 × cosine_sim( mask_hidden_state, candidate_embedding )
```

Where:
- `tier1_score` = frequency-based score from `getRankedCandidates()` (range ~0.5–3.5)
- `cosine_sim` = cosine similarity between BERT `<tool_call>` hidden state and candidate's mean subword embedding (range −1 to +1)
- Weight 12.0 means BERTeus dominates the ranking but Tier 1 breaks ties

### C.6 Browser feasibility

| Factor | Futo GGUF (current Tier 2) | BERTeus ONNX (proposed) |
|---|---|---|
| Model size | 49 MB | ~125 MB (int8) or ~62 MB (int4) |
| Runtime | wllama (WASM) | Transformers.js (WASM/WebGPU) |
| Forward passes per case | 2 × n_candidates | **1** (single <tool_call>) |
| Speed (GPU) | 4.3/s | **220/s** |
| Net improvement | +6 | **+99** |
| Already a dependency? | No (new wllama dep) | Yes (Transformers.js already loaded for MarianMT) |

BERTeus is heavier (125 MB vs 49 MB) but:
- Transformers.js is already loaded for MarianMT — no new library
- One forward pass per case (fast even on WASM/CPU)
- Can be lazy-loaded only when spell error is detected
- int4 quantization would bring it to ~62 MB

### C.7 Revised tiered plan

Based on empirical evidence, the tiered plan is revised:

| Tier | Original plan | Revised plan |
|---|---|---|
| Tier 1 | Frequency re-ranking | **Unchanged** — 73.6% baseline |
| Tier 2 | Futo surprisal re-ranking via wllama | **Replace with BERTeus** — +99 net vs +6 |
| Tier 2.5 | Futo surprisal detection (free) | **Optional** — futo signal is weak. Use BERTeus embedding similarity for detection instead (same model, same pass) |
| Tier 3 | BERTeus MLM detection (heavy) | **Merged into Tier 2** — BERTeus does both re-ranking AND detection in one pass |

**New Tier 2 = BERTeus embedding similarity re-ranking.** Drop futo/wllama entirely for re-ranking. The futo model remains valuable for FUTO Keyboard's keypress autocorrect (82.5% top-1), but for txukun's text correction, BERTeus is strictly better.

### C.8 Worsenings analysis (17 cases at w=12)

The 17 worsenings are genuine ambiguities — BERTeus picks a contextually plausible but wrong word:
- `gerro → gerra` (want `gero`) — both real words, context doesn't disambiguate
- `Onork → Nork` (want `Inork`) — empty context, all three are question words
- `gein → zein` (want `egin`) — `zein` is contextually plausible

These are inherent limitations of the approach, not bugs. A larger or fine-tuned model might reduce them, but 116:17 (improved:worsened) is already excellent.

### C.9 Implementation notes

- **`bert_rerank.py`** in `txukun-cli/tests/gec-benchmark/` — `BerteusReranker` class, loads as `BertModel` (not `BertForMaskedLM`), uses `score_candidates(sentence_words, target_idx, candidate_words)`
- Scoring: `cosine_sim(normalize(mask_hidden), normalize(mean(candidate_token_embeddings)))`
- Cache: `bert_scores_cache.json` (pre-computed scores for instant grid search)
- GPU: 933 cases in 4.2s on NVIDIA L40
- Reproduce: `cd txukun-cli && uv run --extra bench python tests/gec-benchmark/eval.py --berteus`

---

## References

- **Corpus dictionary source:** [`itzune/futo-transformer-basque`](https://github.com/itzune/futo-transformer-basque) — `dictionaries/eu_wordlist.combined.gz`, `dictionaries/eu.dict`
- **GGUF model source:** same repo — `gguf/eu_futo_v2.gguf` (25M params, 49MB, 82.5% autocorrect top-1)
- **wllama:** [github.com/ngxson/wllama](https://github.com/ngxson/wllama) v3.5.1 — WASM llama.cpp for browsers. API reference: [github.ngxson.com/wllama/docs/](https://github.ngxson.com/wllama/docs/)
- **Latxa v2 corpus:** [HiTZ/latxa-corpus-v2](https://huggingface.co/datasets/HiTZ/latxa-corpus-v2) on HuggingFace
- **Xuxen:** [xhuxen.eus](https://xhuxen.eus/) — Basque spell checker (Hunspell-based)
- **Helium314 AOSP dictionaries:** [codeberg.org/Helium314/aosp-dictionaries](https://codeberg.org/Helium314/aosp-dictionaries) — FUTO's referenced Basque dict
- **BERTeus:** [`ixa-ehu/berteus-base-cased`](https://huggingface.co/ixa-ehu/berteus-base-cased) — Basque BERT (110M, bidirectional), for Tier 3 detection. Agerri et al. (2020), *Give your Text Representation Models some Love: the Case for Basque*, LREC.
- **Noisy-channel spelling correction:** Jurafsky & Martin, *Speech and Language Processing*, Ch. 5 — the classical architecture this implements
- **GEC research landscape:** [`GEC_RESEARCH_2025.md`](./GEC_RESEARCH_2025.md) — Basque GEC datasets, benchmarks, and 2025-2026 SOTA survey
