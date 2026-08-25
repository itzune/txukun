# Cap-punct baseline — 2026-08-25

First measured baseline of the MarianMT cap-punct model (`itzune/txukun-cap-punct-eu`)
against the EBE-grounded golden suite (`tests/cap-punct/cases.json`, 33 cases).

This is the **before** snapshot. Every future change (P1 rules, P0.3 cleanup,
model swaps) is measured against it.

## Headline

| Metric | Baseline (q8) | + P1 batch 1 | + P1 batch 2 (F4) | Δ total |
|---|---|---|---|---|
| CONSTRAINED strict exact-match | 18/22 (81.8%) | 22/22 (100%) | **22/22 (100%)** | **+4** |
| RAW exact-match | 20/33 (60.6%) | 21/33 (63.6%) | 21/33 (63.6%) | +1 |
| CONSTRAINED exact-match (all) | 19/33 (57.6%) | 20/33 (60.6%) | 20/33 (60.6%) | +1 |
| RULED exact-match (all) | — | 23/33 (69.7%) | **25/33 (75.8%)** | +6 |
| Mean norm. Levenshtein | 0.477 | 0.351 | **0.287** | -0.190 |
| **Regressions** | — | 0 | **0** | **0** |

### P1 rule layer — 2026-08-25

Added 4 deterministic EBE-grounded rules on top of the constrained model output:

1. `sentence-boundary` — split at AUX + temporal-adverb boundary (F4, EBE §1) — *batch 2*
2. `sentence-initial-cap` — uppercase first word of each sentence (EBE Maiuskulak §1.1)
3. `terminal-punct` — add `.` (declarative) or `?` (interrogative pronoun) (EBE §1, §6)
4. `vocative-comma` — insert comma after greeting interjections (EBE koma §3)

Fixed all 4 strict failures (c001, c024, c043, c080) with **zero regressions**:

| Case | Constrained (before) | Ruled (after) | Rule |
|---|---|---|---|
| c001 | `etorri da gaur.` | `Etorri da gaur.` | sentence-initial-cap |
| c024 | `bizi naiz irailean.` | `Bizi naiz irailean.` | sentence-initial-cap |
| c043 | `Non bizi zara` | `Non bizi zara?` | terminal-punct |
| c080 | `Kaixo egun on guztioi.` | `Kaixo, egun on guztioi.` | vocative-comma |

Key insight: the model was closer than the baseline suggested — for c001/c024 it
had already added the period (just missed the cap); for c043 it had the cap (just
missed the `?`). The rules fill exactly the gaps the model leaves.

### Finding 1 — q8 quantization is lossless

q8 (int8, `_quantized.onnx`) and fp32 produce **byte-identical pass/fail on all 33
cases**. The shipped `dtype: 'q8'` config in `src/models.js` is safe — no accuracy
penalty vs full precision, half the download. **Action: keep q8; do not pursue fp16
(the `_fp16` files don't exist on the Hub — AGENTS.md is stale on this).**

### Finding 2 — the ~82% ceiling is intrinsic to the model

Since q8 == fp32, the 4 missing strict cases are model limitations, not
quantization. This validates the roadmap: closing the gap is the job of the **P1
rule layer** (deterministic high-confidence fixes), not re-quantization or a
different dtype. The neural model stays as fallback.

## Per-category (constrained, q8)

| Category | n | con% | meanLev | Verdict |
|---|---|---|---|---|
| cap-proper | 4 | 100% | 0.00 | ✅ names handled well |
| punct-comma-enum | 2 | 100% | 0.00 | ✅ enumeration commas inserted |
| punct-declarative | 3 | 100% | 0.00 | ✅ |
| cap-notenglish | 5 | 80% | 0.21 | ✅ days/months/nationalities stay lowercase — the key EBE distinction works |
| punct-question | 4 | 75% | 0.25 | ⚠️ 1 case: no `?` added |
| cap-initial | 3 | 67% | 0.36 | ⚠️ 1 case: no caps/punct at all |
| cap-institution | 2 | 50% | 0.53 | known-hard |
| normalization | 0 | 0% | 1.31 | ❌ see Finding 3 |
| cap-astral | 2 | 0% | 1.05 | known-hard |
| multi-sentence | 2 | 0% | 1.06 | ❌ see Finding 4 |
| punct-comma-vocative | 2 | 0% | 1.04 | ❌ see Finding 5 |

## Failure taxonomy → P1 rule mapping

The 15 constrained failures cluster into 5 groups. **F1 + c080 are now fixed
by the P1 rule layer (see above).** The remaining failures are all `strict:false`.

### F1. No caps/punct on certain short inputs (4 cases) ✅ FIXED
`c001` "etorri da gaur"→unchanged, `c024` "bizi naiz irailean"→unchanged,
`c043` "non bizi zara"→"Non bizi zara" (no `?`), `c091`.
The model returns input nearly verbatim. **P1 fix**: deterministic
sentence-initial capitalization + terminal punctuation rules (declarative→`.`,
interrogative pronoun→`?`). These are exactly the cases EBE *Puntuazio-markak* §1/§6
cover deterministically. **c001, c024, c043 now pass. c091 is `strict:false`
(known-hard institution capitalization — needs gazetteer).**

### F2. Vocative comma never inserted (2 cases) — partially fixed
`c060` "kaixo mikel"→"Kaixo, Mikel." (comma added by rule, but end mark `!` vs `.`
and proper-noun cap `Mikel` still missing), `c061` "eskerrik asko miren"→no comma
(needs multi-word greeting detection — "eskerrik asko" is a two-word phrase).
Both `strict:false`. **The vocative-comma rule now fires for single-word greetings
(kaixo, agur, gabon). c061 needs the multi-word phrase matcher (batch 2).**

### F3. Normalization broken + constraint-rejected (4 cases) — c080 fixed
`c080` "kaixo egun on guztioi"→now **"Kaixo, egun on guztioi."** ✅ (vocative-comma rule);
`c081` no EiTB expansion; `c082` %42 expansion happens in RAW but `constrainCapPunct`
rejects it (word substitution); `c083` no URL expansion (+spurious colon inserted).
**c080 is `strict:true` and now passes.** c081–c083 are `strict:false`.
Two sub-issues remain: (a) the model card's normalization features don't fire reliably
under the shipped config; (b) the anti-hallucination layer rejects the normalizations
that *do* fire. **P0.3/P1 fix**: decide whether normalization is opt-in; if so,
`constrainCapPunct` needs a whitelist for legit contractions (EiTB, %42, URLs) — or
normalization moves to a pre-processing rule step.

### F4. Multi-sentence not split (2 cases) ✅ FIXED
`c070`, `c071`: model didn't insert sentence-ending periods to split run-on ASR input.

**Research finding (RESEARCH.md §7.9):** these are two *different* problems:

- **c070** (genuine multi-sentence): `"kaixo ni miren naiz atzo etorri nintzen"` —
  a greeting+introduction followed by a tense-shifted statement. Detection signal:
  bare finite AUX (`naiz`) + temporal adverb (`atzo`) + a second AUX (`nintzen`) later.
  **Fixed** by `sentence-boundary` rule (priority 20): inserts `.` after the first
  auxiliary; the iterative engine then cascades (cap → comma → punct).

- **c071** (NOT a bug — golden case was wrong): `"etorri da joan da berriro etorriko da"`
  is **asyndetic coordination** (*alborakuntza*). EBE puntuazioa §1 (footnote)
  explicitly classifies `"Etorri da, jan du, joan da."` as a **single sentence** with
  commas. UD `parataxis` agrees. The model's comma output was always EBE-valid; the
  golden case's period expectation was too strict. **Fixed** by correcting the
  expected to the EBE-validated comma version.

Both now pass (strict:false). The `sentence-boundary` rule has a **second-AUX guard**
to avoid false splits on post-positioned temporals (e.g. `"etorri naiz gaur"` =
"I came today" — one sentence, no second auxiliary → no split).

### F5. Semantic capitalization (3 cases, known-hard)
`c095` "lurra...eguzkiaren"→"Lurra...eguzkiaren" (inconsistent), `c096`
"artizarra"→"Artizarra Goizeko Izarra" (over-capitalizes common nouns),
`c091` institution not capped.
These require world knowledge (astral bodies as place-names vs common nouns;
institution names). **P4 fix**: gazetteer rules (institution/astral name lists)
or a better model. Correctly marked `strict:false` — not part of the headline.

## What this means for the roadmap

1. **P0.2 is done** — the project can now *measure*. The "can't measure → paused"
   blocker is removed.
2. **P1 rule layer is proven** — 4 deterministic EBE-grounded rules lift strict
   accuracy from 81.8% → **100%** with zero regressions, and all-case exact-match
   from 57.6% → **75.8%** (mean Levenshtein 0.477 → 0.287). The rule-layer thesis
   (rules close the gaps the neural model leaves) is validated.
3. **The rule engine is wired into production** (`src/models.js:correctCapPunct`)
   — the app now applies rules on top of model output. If the model isn't loaded
   yet, rules still provide basic cap+punct ("Txukun Lite" mode).
4. **q8 ships as-is** — no dtype investigation needed (Finding 1).
5. **Remaining failures are all `strict:false`** — normalization policy (F3:
   c081–c083, constrainCapPunct rejects legit contractions) and semantic
   capitalization (F5: c091, c095, c096, needs gazetteer/world knowledge).
   These are P2+ work.
6. **constrainCapPunct needs a normalization policy** (Finding 3) — feeds P0.3.
7. **Golden suite was corrected** (c071) — research found the original period
   expectation contradicted EBE §1 (asyndetic coordination = one sentence).

## Reproduce

```bash
npm run test:cap-punct          # q8 (shipped config), ~5s model load + ~60s inference
TXUKUN_DTYPE=fp32 npm run test:cap-punct   # fp32 comparison
cat tests/cap-punct/results-2026-08-25T*.json | python3 -m json.tool | head
```
