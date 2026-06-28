# Txukun + Hunspell WASM — Integration Plan

**Date:** 2026-06-28
**Status:** Integration complete, spell workaround in place

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main thread (txukun)                                       │
│                                                             │
│  ┌──────────────────┐   ┌──────────────────────────────┐   │
│  │ Transformers.js   │   │ spell.js                     │   │
│  │ (ONNX Runtime Web)│   │ (word list, 160k words)      │   │
│  │  WASM backend     │   │ Set<String>, O(1) lookups    │   │
│  │  77MB model       │   │ 2.0MB freq + 1.6MB words     │   │
│  └──────────────────┘   └──────────────────────────────┘   │
│                                                             │
│  Pipeline:                                                  │
│    1. Input text                                            │
│    2. autoCorrect(input) → simple word-list suggestions     │
│    3. MarianMT model → cap + punct restoration             │
│    4. autoCorrect(output) → simple word-list suggestions    │
│    5. checkSpelling(output) → annotate remaining errors     │
└─────────────────────────────────────────────────────────────┘
```

### Current spell checker limitations:
- **160k flat word list** — no morphological analysis, no affix rules
- **Suggestions via Levenshtein distance** — iterates entire Set, O(n) per query
- **High false positive rate** — valid declined forms flagged as errors
- **High false negative rate** — misspelled words accepted if base form matches any entry
- **No Basque-specific rules** — pluralization, declensions, verb conjugations all missed

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main thread (txukun)                                       │
│                                                             │
│  ┌──────────────────┐                                       │
│  │ Transformers.js   │                                      │
│  │ (ONNX Runtime Web)│                                      │
│  │  WASM backend     │                                      │
│  │  77MB model       │    ┌────────────────────────────┐   │
│  └──────────────────┘    │ spell-worker.js             │   │
│                          │  ┌────────────────────────┐ │   │
│                          │  │ HunspellWasm            │ │   │
│                          │  │ (wasm-bare, 715KB)      │ │   │
│                          │  │ + eu.aff (2.7MB)       │ │   │
│                          │  │ + eu.dic (2.2MB)       │ │   │
│                          │  └────────────────────────┘ │   │
│                          └────────────────────────────┘   │
│                                                             │
│  Pipeline (unchanged flow):                                 │
│    1. Input text                                            │
│    2. autoCorrect(input) → Hunspell suggestions             │
│    3. MarianMT model → cap + punct restoration             │
│    4. autoCorrect(output) → Hunspell suggestions            │
│    5. checkSpelling(output) → Hunspell spell()             │
└─────────────────────────────────────────────────────────────┘
```

### Key architectural decision: Dedicated Web Worker

The Hunspell WASM module running `wasm-bare` with wasi-sdk has NO Emscripten
dependencies, so it WON'T conflict with ONNX Runtime Web. However, two good
reasons to put it in its own worker:

1. **Initialization time**: Loading and parsing Xuxen dictionaries (~3M words
   after affix expansion) takes non-trivial time. Running this in a worker
   avoids blocking the UI thread or competing with model loading on main.

2. **Suggestion latency**: `suggest()` with Levenshtein over 160k entries is
   O(n), but Hunspell's `suggest()` is O(m+n) where m is the edit distance
   tree. Still, running this in a background thread prevents suggestion
   computation from causing UI jank.

3. **Future-proofing**: If Hunspell analysis ever includes morphological
   analysis (future: `hunspell_analyze` export), that's more CPU work that
   belongs off the main thread.

## Files to Create/Modify

### New files

| File | Purpose |
|------|---------|
| `public/hunspell.wasm` | Pre-built Hunspell WASM binary (from release) |
| `dist/hunspell.js` | Copy of JS loader from hunspell-wasm-bare |
| `public/hunspell-worker.js` | Web Worker that wraps HunspellWasm |

### Modified files

| File | Changes |
|------|---------|
| `src/spell.js` | Replace word-list Set with Hunspell worker proxy |
| `src/main.js` | Change `loadSpellChecker()` to spawn worker |
| `package.json` | Add `copy-wasm` script, consider removing `dictionary-eu` |
| `vite.config.js` | Ensure `.wasm` files served with correct MIME type |

### Removable files

| File | Reason |
|------|--------|
| `public/dicts/eu-words.txt` | Replaced by hunspell + eu.dic |
| `public/dicts/eu-words-freq.txt` | Hunspell suggestions use affix rules, not frequency |
| `node_modules/hunspell-asm` | Emscripten port, blocked by ORT collision |
| `node_modules/nspell` | Wrapper for hunspell-asm, blocked |
| `node_modules/dictionary-eu` | Only needed for .aff/.dic files, now copied manually |

## Detailed Integration Plan

### Step 1: Copy WASM binary + loader

```bash
# From hunspell-wasm-bare to txukun
cp ~/Dev/xezpeleta/hunspell-wasm-bare/dist/hunspell.wasm \
   ~/Dev/itzune/txukun/public/hunspell.wasm

cp ~/Dev/xezpeleta/hunspell-wasm-bare/dist/hunspell.js \
   ~/Dev/itzune/txukun/src/hunspell-loader.js
```

### Step 2: Create spell-worker.js

```js
// public/spell-worker.js
// Web Worker that hosts HunspellWasm
// Communicates via postMessage with the main thread.

importScripts('../src/hunspell-loader.js');
// Actually, we need ES module support. Workers can use:
// const worker = new Worker('spell-worker.js', { type: 'module' })

// Messages from main thread:
//   { type: 'init', affixContent, dictionaryContent }
//   { type: 'spell', word }
//   { type: 'suggest', word }
//   { type: 'destroy' }

// Worker must:
// 1. Fetch hunspell.wasm (relative URL)
// 2. Create HunspellWasm with affix/dictionary content
// 3. Respond to spell/suggest queries
```

**Problem:** Workers with `type: 'module'` can import ES modules via `import`,
but `importScripts` is only for classic workers. We need to decide:

- **Option A:** ES module worker — `import { HunspellWasm } from '../src/hunspell-loader.js'`
  - Simpler, no bundler needed for the worker
  - Vite handles ES module workers natively with `new Worker(new URL(...), {type:'module'})`

- **Option B:** Classic worker with `importScripts`
  - Need to bundle the loader first
  - Simpler worker code

I recommend **Option A**: Use Vite's native support for ES module workers.
Vite bundles the worker dependency automatically.

### Step 3: Refactor spell.js

Current `spell.js` exports:
```
loadSpellChecker() → loads word list from /txukun/dicts/eu-words.txt
spell(word) → checks word in Set
suggest(word) → Levenshtein over Set
checkSpelling(text) → tokenize + spell check
annotateSpelling(text, errors) → HTML annotation
autoCorrect(text) → auto-correct with first suggestion
annotateCorrections(text, corrections) → green spans
annotateBoth(text, corrections, errors) → combined annotation
tokenize(text) → Basque-aware tokenizer
stripAnnotations(html) → HTML → plain text
```

New `spell.js` API (backward compatible):
```
// Same exports, different implementation:
loadSpellChecker() → spawns worker, loads hunspell.wasm + dicts
spell(word) → worker.postMessage({ type: 'spell', word }) → await result
suggest(word) → worker.postMessage({ type: 'suggest', word }) → await result
checkSpelling(text) → tokenize + batch spell check via worker
autoCorrect(text) → tokenize + batch suggest via worker
// annotate*, tokenize, stripAnnotations → unchanged
```

**Key design constraint:** All spell/suggest calls are now async (worker
messaging). The current API is synchronous:

```js
// main.js line 122-125 (current, sync)
if (spellReady && spellEnabled) {
    const corrected = autoCorrect(input);  // sync
    if (corrected.changes > 0) modelInput = corrected.text;
}
```

This becomes:
```js
// main.js (new, async)
if (spellReady && spellEnabled) {
    const corrected = await autoCorrect(input);  // async
    if (corrected.changes > 0) modelInput = corrected.text;
}
```

Since `correctText()` is already `async`, this is a clean change — just add
`await` in front of `autoCorrect` and `checkSpelling` calls.

### Step 4: Update main.js

Minimal changes:

1. `loadSpellChecker()` now spawns worker, loads dicts
2. Add `await` before `autoCorrect()` and `checkSpelling()` calls (already
   inside `async function correctText()`)
3. Update `setSpellStatus()` parameters — worker may report dict size,
   loading progress

### Step 5: Update package.json

```json
"scripts": {
    "copy-dicts": "mkdir -p public/dicts && cp node_modules/dictionary-eu/index.aff public/dicts/eu.aff && cp node_modules/dictionary-eu/index.dic public/dicts/eu.dic",
    "copy-wasm": "cp dist/hunspell.wasm public/hunspell.wasm"  // or download from release
}
```

### Step 6: Update vite.config.js

Ensure `.wasm` files are served correctly. Vite 5 handles this by default,
but we may need to set Content-Type headers:

```js
// No changes needed — Vite serves .wasm with application/wasm by default
```

## Worker Communication Protocol

```
Main thread                         spell-worker
    │                                    │
    │── { type: 'init',                  │
    │     affixContent: string,          │
    │     dictionaryContent: string,     │
    │     wasmUrl: string } ──────────→  │
    │                                    │  Load wasm, parse dicts
    │  ←── { type: 'ready' } ─────────── │
    │                                    │
    │── { type: 'spell',                 │
    │     id: number,                    │
    │     word: string } ─────────────→  │
    │                                    │  hunspell.spell(word)
    │  ←── { type: 'spellResult',        │
    │        id: number,                 │
    │        correct: boolean } ──────── │
    │                                    │
    │── { type: 'suggest',               │
    │     id: number,                    │
    │     word: string } ─────────────→  │
    │                                    │  hunspell.suggest(word)
    │  ←── { type: 'suggestResult',      │
    │        id: number,                 │
    │        suggestions: string[] } ─── │
    │                                    │
    │── { type: 'destroy' } ──────────→  │
    │                                    │  hunspell.destroy()
```

Each `spell`/`suggest` request includes an `id` for matching the response,
allowing multiple in-flight requests.

## Remaining Work

| Task | Est. time | Status |
|------|-----------|--------|
| Copy WASM binary to txukun | 5 min | ✅ Done |
| Copy loader JS, adapt for Worker | 1-2 hours | ✅ Done |
| Write spell-worker.js | ~3 hours | ✅ Done |
| Refactor spell.js (sync→async API) | 2-3 hours | ✅ Done |
| Update main.js integration points | 1-2 hours | ✅ Done |
| Update package.json, vite.config | 30 min | ⏳ Pending |
| Remove unused deps (hunspell-asm, nspell) | 10 min | ⏳ Pending |
| Browser testing with real Basque text | 2-3 hours | ⏳ Pending |
| Spell workaround (suggest-based fallback) | 30 min | ✅ Done |
| Performance comparison vs current word-list | 1 hour | ⏳ Pending |
| **Total** | **~1.5 days** | ⏳ Core integration complete | |

## Known Challenges

### 1. First load time
- Xuxen `.aff` (121K lines, 2.7MB) + `.dic` (142K entries, 2.2MB)
- Hunspell parses and builds internal hash tables from these at init time
- **Estimate:** 3-5 seconds on modern hardware
- **Mitigation:** Show progress, parallelize with model loading (model is ~15s)

### 2. Worker startup
- Worker must fetch `hunspell.wasm` (~715KB) from CDN
- Then fetch `.aff` and `.dic` from `/txukun/dicts/`
- Show "Hiztegia kargatzen..." status (already exists in UI)

### 3. Dictionary file size in deployment
- `.aff` (2.7MB) + `.dic` (2.2MB) + `.wasm` (0.7MB) = **5.6MB total downloaded**
- Current: `eu-words.txt` (1.6MB) + `eu-words-freq.txt` (2.0MB) = 3.6MB
- **Increase:** ~2MB — acceptable for the massive quality improvement

### 4. Vite bundling of the worker
- Vite's `new Worker(new URL('./spell-worker.js', import.meta.url), { type: 'module' })`
  automatically bundles the worker and its dependencies
- The loader (`hunspell-loader.js`) must be importable from the worker
- The `.wasm` binary is NOT bundled — it's fetched at runtime from `public/`

## Expected Quality Improvements

| Metric | Current (word list) | New (Hunspell + Xuxen) |
|--------|---------------------|------------------------|
| Dictionary size | 160k words | 142k base + affix rules → ~3M valid forms |
| False positives | High (declensions flagged) | Very low (affix rules cover all forms) |
| False negatives | Medium (typos accepted) | Low (full morphological checking) |
| Suggestions | Levenshtein O(n) | Hunspell n-gram O(m+n) |
| Suggestion quality | Ok for simple typos | Excellent (language-specific rules) |
| Init time | ~200ms (parse text) | ~3-5s (parse dict + build hash) |
| Memory | ~10MB (Set) | ~50MB (hash tables + WASM) |
| Download size | 3.6MB | 5.6MB |

## Recommendations

1. **Parallel loading**: Start Hunspell worker at the same time as model loading.
   Both should show progress in the UI.

2. **Graceful fallback**: If the worker fails, fall back to the current word-list
   approach. Keep `eu-words.txt` as a fallback.

3. **Don't remove word-list dicts yet**: Ship both during transition, remove the
   word-list after validating Hunspell performance.

4. **Consider lazy suggestions**: `checkSpelling()` batches many words — send
   them in groups of 10 to the worker to avoid blocking.

5. **Cache the worker**: Store the `Worker` reference in module scope, reuse
   across `correctText()` calls.

6. **Release v2.0**: This is a major quality improvement over the word-list
   approach. Bump to v2.0.
