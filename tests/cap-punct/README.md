# Cap-punct golden-case suite (P0.2)

Regression harness for the MarianMT cap-punct model (`itzune/txukun-cap-punct-eu`)
against **EBE-grounded** golden cases (Euskara Batuaren Eskuliburua).

See `RESEARCH.md` §7.7 and `docs/ebe-reference/` for the authoritative sources.

## Files

| File | Purpose |
|---|---|
| `cases.json` | Golden cases: `{input (lowercase/no-punct) → expected (EBE-correct)}`, categorized |
| `eval.mjs` | Evaluation script (loads model via Transformers.js, runs cases, reports metrics) |
| `results-*.json` | Historical results (one per run, timestamped) |

## Usage

```bash
# Validate cases.json structure only (no model download — fast)
npm run test:cap-punct:check

# Full evaluation (downloads ~150MB model on first run, then cached)
npm run test:cap-punct

# Filter by category, limit, skip constraint layer, or change dtype
node tests/cap-punct/eval.mjs --category cap-notenglish
node tests/cap-punct/eval.mjs --limit 5
node tests/cap-punct/eval.mjs --no-constrain
TXUKUN_DTYPE=fp16 node tests/cap-punct/eval.mjs
```

## Metrics

The harness reports **two** accuracy figures to separate intrinsic model quality
from pipeline behavior:

- **RAW** — model output after special-token cleanup only (intrinsic quality)
- **CONSTRAINED** — + `constrainCapPunct` anti-hallucination layer (user-facing)

The **headline metric** is `CONSTRAINED (strict)` — exact-match over `strict:true`
cases. The RAW→CONSTRAINED gap reveals what the constraint layer rejects (notably
the model's normalization cases `c081`–`c083`, which change words and are
intentionally rejected as potential hallucinations).

## Case categories

| Category | What it tests | EBE source |
|---|---|---|
| `cap-initial` | Sentence-initial capitalization | Maiuskulak §1.1–1.4 |
| `cap-proper` | Proper names (person, place) | Maiuskulak §1.1, §1.2 |
| `cap-notenglish` | Days/months/nationalities **lowercase** mid-sentence (≠ English/Spanish) | Maiuskulak |
| `punct-question` | `?` on interrogatives | Puntuazio-markak §6 |
| `punct-declarative` | `.` on declaratives | Puntuazio-markak §1 |
| `punct-comma-vocative` | Comma before vocative | Puntuazio-markak §2 (koma §3) |
| `punct-comma-enum` | Comma in enumerations | Puntuazio-markak §2 (koma §2) |
| `multi-sentence` | Segmentation + per-sentence caps | — |
| `normalization` | Model card examples (number/URL/abbrev expansion) | model card |
| `cap-institution` | Institutions partial caps (Donostiako Udala) | Maiuskulak §1.3 |
| `cap-astral` | Astral bodies as place-names (Lurra, Eguzkia) | Maiuskulak §1.6 |

`strict:false` cases (ambiguous end-mark, variable segmentation, constraint-rejected,
or known-hard) are excluded from the headline metric but still reported in the
soft metrics (full exact-match %, mean normalized Levenshtein).

## Adding cases

Append to `cases.json` `cases[]`. Each case:

```json
{
  "id": "c100",
  "input": "lowercase no punctuation input",
  "expected": "EBE-correct output.",
  "category": "cap-initial",
  "strict": true,
  "note": "EBE citation (optional)"
}
```

Ground every `expected` in EBE — see `docs/ebe-reference/`. Do **not** use
unverified error patterns (e.g. the `onek→honek`/`hau→au` speculation from
`gector-eus/TODO.md` — see `RESEARCH.md` §7.7 "Ezabatutako baieztapenak").
