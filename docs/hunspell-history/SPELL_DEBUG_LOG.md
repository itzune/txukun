# Txukun — Spell checker integration debug log

## Context

**Txukun** is a Basque language capitalization, punctuation, and spelling correction tool. It runs entirely client-side in the browser (no server). The tech stack:

- **Vite 5** + vanilla JS
- **Transformers.js** — loads ONNX models via ONNX Runtime Web (WASM backend, `ort-wasm-simd-threaded.jsep.wasm`, ~21MB)
- **cap-punct-eu model** — HiTZ Zentroa's MarianMT model converted to ONNX + int8 quantized (77MB total: 34MB encoder + 41MB decoder + 2MB tokenizer)
- Deployed to GitHub Pages at `https://itzune.eus/txukun/`
- GitHub repo: `itzune/txukun`

## Goal

Add Basque spell checking to the output using **Hunspell WASM** with the **Xuxen Basque dictionary** (`dictionary-eu`, 85k words, ~5MB .aff + .dic).

## Problem

**Two Emscripten-compiled WASM modules cannot coexist in the same JavaScript context.** ONNX Runtime Web's WASM and hunspell-asm's WASM both compile with Emscripten's `MODULARIZE=1` and both expect to own the `Module` object, the WASM memory heap, and the Emscripten runtime globals. Loading the second one corrupts or collides with the first.

The result: `hunspell-asm` fails to initialize, throwing `runtimeModule is not a function` or `A network error occurred` when the Worker tries to fetch the WASM binary.

## Attempts

### Attempt 1: Direct import in main thread

**Approach:** `import('hunspell-asm')` directly in `src/spell.js`, load dictionary, create spell checker.

**Result:** ❌ `runtimeModule is not a function`. The Emscripten factory from hunspell-asm conflicts with ORT's already-loaded WASM runtime.

### Attempt 2: Module Web Worker (`new Worker(new URL(...), { type: 'module' })`)

**Approach:** Move `import('hunspell-asm')` into a Vite-bundled ES module worker. The worker runs in a separate thread with its own module scope.

**File:** `src/spell-worker.js`

**Result:** ❌ `runtimeModule is not a function`. Vite bundles the worker, but the Emscripten module format (IIFE with `Module` global) doesn't work correctly inside a module worker. The `import * as runtime from './lib/node/hunspell'` in `loadModule.js` resolves to `./lib/browser/hunspell.js` (via `package.json` browser field), but Vite's bundler mangles the Emscripten preamble.

### Attempt 3: Classic Web Worker with CDN `importScripts` (current)

**Approach:** Use a classic (non-module) Web Worker with `importScripts()` to load hunspell-asm's CDN CJS build. The classic worker has a completely isolated global scope — no Vite bundling, no module system conflicts.

**File:** `public/spell-worker.js`  
**CDN URL:** `https://cdn.jsdelivr.net/npm/hunspell-asm@4.0.2/dist/cjs/hunspell-asm.js`

**Result:** ❌ `Failed to load hunspell-asm: A network error occurred`. The worker fails to fetch the CDN URL. Possible causes:
- jsDelivr CORS or MIME type issues
- The worker's `fetch` being blocked by CSP
- GitHub Pages won't serve the file at runtime (it's in `public/` which Vite copies to `dist/`, but the CDN dependency still needs to load)
- `importScripts` from a cross-origin CDN may fail in some browser contexts

## Key observations

1. **ONNX Runtime Web's WASM is the root blocker.** It uses Emscripten with `MODULARIZE=1`, `EXPORT_NAME`, and a large SIMD + multi-threaded WASM binary. Any second Emscripten module loaded in the same context will collide.

2. **Web Workers are the right isolation mechanism**, but getting `hunspell-asm` to load inside one is tricky because:
   - Module workers (`{ type: 'module' }`) go through Vite bundling which doesn't preserve Emscripten's expected module structure.
   - Classic workers (`importScripts`) need the library in a format that works with `importScripts` — CJS or IIFE with globals. The `dist/cjs/hunspell-asm.js` file on jsDelivr should work, but network issues are blocking it.

3. **The `dictionary-eu` files are fine** — they're plain text (.aff/.dic) and are already in `public/dicts/`, served correctly by GitHub Pages.

## Possible solutions (not yet tried)

### A. Self-host the hunspell-asm CJS build
Copy `node_modules/hunspell-asm/dist/cjs/hunspell-asm.js` to `public/` so the classic worker loads it from the same origin. Avoids CDN/CORS issues.

### B. Pure JS spell checker
Use a non-WASM spell checker like `nspell` (pure JS Hunspell-compatible) with the Xuxen dictionary. No Emscripten at all. `nspell` reads .aff/.dic files and runs entirely in JS.

### C. Build hunspell as a side module
Compile hunspell C code as an Emscripten side module that can share the ORT WASM heap. Complex, requires Emscripten toolchain expertise.

### D. Precompute spell check corpus
Build a Set of all valid Basque words from `dictionary-eu` and ship it as a JSON file. Simple lookup, no WASM. Trade-off: ~85k words × ~10 bytes = ~850KB, but loses affix rules (declensions, conjugations, etc.). Would flag many valid Basque words as misspelled.

### E. Use `nspell` with the Xuxen dictionary
`nspell` is a pure JavaScript Hunspell-compatible spell checker. It can read the same .aff/.dic files and doesn't use WASM at all. This avoids the Emscripten conflict entirely. ~50KB gzipped, runs in main thread or worker.

## Recommendation

Option **E (nspell)** is the most promising — it uses the same dictionary files we already have, runs in pure JS, and avoids all WASM conflicts. Option **A (self-host CJS)** is the quickest next test for the classic worker approach.

---

## Attempt 4: nspell (pure JS) ✅ loads, ❌ too slow

**Approach:** Replace `hunspell-asm` with `nspell`, a pure-JS Hunspell-compatible spell checker. Same `.aff`/`.dic` files, no WASM, no Emscripten.

**Implementation:**
- `npm install nspell`
- `src/spell.js`: `import('nspell')`, init with `nspell(affBody, dicBody)` passing strings (not buffers — nspell's `is-buffer` check doesn't recognize `Uint8Array`)
- `src/main.js`: sync `checkSpelling()` call
- Removed worker files

**Result:** ✅ nspell loads and can be imported. No Emscripten conflicts. ❌ Dictionary parsing blocks the main thread for >30s on 130k Basque entries with complex affix rules. Browser kills the script with "Script terminated by timeout". Even Node.js doesn't finish in 30s.

### Attempt 4b: typo-js

**Approach:** Same as nspell but with `typo-js`, another pure-JS Hunspell port.

**Result:** Same result — also times out on 130k-entry dictionary.

**Root cause:** Pure-JS Hunspell ports (nspell, typo-js) parse the full `.aff` affix rule table synchronously. The Xuxen Basque dictionary has 130k entries with extensive agglutinative morphology rules (prefixes, suffixes, compound rules). These parsers weren't designed for dictionaries this large and complex. The parsing is O(n × rules) and takes exponentially longer as the dictionary grows.

## Attempt 5: Build-time pre-serialization

**Approach:** Parse the dictionary with nspell at build time (Node.js), serialize the parsed data structures to JSON, load the JSON in the browser (instant).

**Result:** ❌ Even in Node.js, nspell doesn't finish parsing in 30s.

## Attempt 6: Word-list extraction (current)

**Approach:** Extract just the base words from the `.dic` file at build time — strip affix flags (everything after `/`), deduplicate, sort. Ship as a compact newline-separated text file (~1.3MB). In the browser, build a `Set` for O(1) lookups. For suggestions, use Levenshtein edit distance on a first-letter-filtered subset.

**Trade-off:** No affix rule support. `etxean` won't be found even though `etxe` is in the dictionary. This means:
- False negatives on declined/conjugated forms ("etxean", "etxetik", "etxearekin" all fail)
- Still catches truly misspelled words and hallucinated model output ("Ser", "aubisa", "IMAIO")

**Status:** Word list built (`public/dicts/eu-words.txt`, 130k words, 1.3MB). ✅ Working in browser. Loads in <1s. O(1) Set lookups.

### Attempt 6b: Fix suggestion quality

**Issue:** Initial suggestions were nonsensical — `startsWith(firstChar)` matched ~5000 words per letter, producing unrelated suggestions like "ger" and "germaniar" for "gerttu".

**Fix 1:** Changed prefix matching from 1-char to 3-char. Improved but still had issues.

**Fix 2:** Full-scan approach with Levenshtein distance ≤ 2 on all 160k words. Scoring: `dist * 100 - prefixMatch` (distance is primary, prefix is tiebreaker). Works well for most words.

**Current issue:** "zer" (distance=1, correct suggestion for "ser") does not appear in top-5. Root cause: the suggestion array gets filled with distance-1 words that share "ser*" prefix ("sere", "se", "seg", "sei", "sem", "sen") before reaching "zer" because the `score` tiebreaker is too weak — distance-1 "zer" (score=100) should beat distance-1 "sere" (score=97), but alphabetical sorting among same-score candidates pushes "s*" before "z*" in the final slice(0,5).

Ultimately the JS spell checker's suggestion system needs a full deterministic tiebreaker:
- For same distance, prefer words with **higher prefix match** (more characters in common), not lower.
- Alternatively: prefer shorter words or more frequent words.
