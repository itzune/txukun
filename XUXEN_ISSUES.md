# Xuxen Dictionary Issues

Spell-checking and auto-correction issues traced to the Xuxen Hunspell dictionary (`eu.aff` / `eu.dic`), not Txukun code.

---

## 1. `batzutan` → wrong suggestion `batsutan`

- **Input**: `batzutan` (misspelling of `batzuetan`)
- **Expected correction**: `batzuetan`
- **Actual suggestions**: `batsutan`, `batzotan`
- **Correct form in dict**: `batzuetan` ✓ (Hunspell `*` = correct)
- **Issue**: `batzuetan` exists in the dictionary but Hunspell doesn't rank it as a suggestion for `batzutan`. The first suggestion `batsutan` is a valid but different word.
- **Impact**: Auto-correct replaces `batzutan` with the wrong word `batsutan`. User must disable auto-correct and manually select `batzuetan` from the popover (which won't show it either since it's not in the suggestion list).
- **Root cause**: Xuxen affix rule ranking — `batzuetan` is not recognized as a close match to `batzutan` despite differing by only one character.

---

## 2. `NEEDAFFIX 1` — Hunspell 1.7.3 spell regression

- **Issue**: `eu.aff` header contains `NEEDAFFIX 1`. All `.dic` entries end with `,1` (flag 1 = stem needs affix rule applied). Hunspell 1.7.3 (WASM) respects this and returns `spell() = 0` for all stem-only lookups, while Hunspell 1.7.0 (system) ignores it.
- **Workaround**: Txukun strips `NEEDAFFIX` from `.aff` and trailing `,1` from `.dic` at load time, plus uses word list fallback (`eu-words.txt`) and suggest-based spell validation.
- **Status**: Workaround deployed. Root cause is a Hunspell version behavioral difference when compiled via wasi-sdk.

## 3. Dictionary coverage gaps (~30k words)

- **Issue**: 30,178 words in `eu-words.txt` (corpus-extracted word list) are not covered by Xuxen dict + affix rules. Examples: `entzuten` (verb participle of `entzun` + `-ten`).
- **Workaround**: Txukun loads `eu-words.txt` as a `Set` and checks O(1) before calling `hunspell_spell()`.
- **Status**: Workaround deployed.
