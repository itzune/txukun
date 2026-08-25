# Txukun Web — Hunspell + Xuxen integration research report

**Date:** 2026-06-28  
**Goal:** Replace the current simple word-list spell checker in the Txukun web app
with a full Hunspell + Xuxen implementation, matching the txukun-cli capabilities.

---

## 1. Current state (what we have now)

### CLI (`txukun-cli`)
- ✅ Hunspell system package + Xuxen `.aff`/`.dic` (142k entries, 121k affix rules)
- ✅ Persistent `hunspell -a` subprocess pipe
- ✅ Full Basque morphology: declensions, conjugations, compounds
- ✅ Correctly validates `etxean`, `etxetik`, `etxearekin` (all declined forms of `etxe`)
- ✅ ~0.1ms lookup latency per word

### Web app (`txukun`)
- ⚠️ Pre-built 160k-word `Set` from `.dic` file (no affix rules)
- ⚠️ Levenshtein-based suggestions (corpus frequency tiebreaker)
- ⚠️ **Cannot** validate declined forms: `etxean` fails even though `etxe` is in dict
- ❌ No morphological analysis, no stemming, no compound support
- ✅ Loads in <1s, O(1) lookups

### Gap

The web app needs the same Hunspell + Xuxen capability as the CLI:
142k base words × thousands of affix combinations = millions of valid
Basque word forms.

---

## 2. Why it's hard: the Emscripten WASM conflict

### The problem

Browser inference in Txukun uses **ONNX Runtime Web** with WASM backend
(`ort-wasm-simd-threaded.jsep.wasm`, ~21MB). This is loaded by Transformers.js
at page init time. The WASM module is an Emscripten-compiled binary using:

- `MODULARIZE=1` — instantiates as a factory function
- Multi-threaded mode — requires SharedArrayBuffer + COOP/COEP headers
- SIMD + JSEP (JavaScript Execution Provider) extensions

**Any second Emscripten-compiled WASM module loaded in the same JavaScript
context will collide.** Emscripten assumes it owns:
- The `Module` global/closure object
- The WASM memory heap (`HEAP8`, `HEAP32`, etc.)
- The Emscripten runtime (`abort()`, `stackSave()`, etc.)
- `WebAssembly.Memory` singleton

When `hunspell-asm` (also Emscripten with `MODULARIZE=1`) tries to
initialize, it encounters:
- `runtimeModule is not a function` — the factory from the first module
  shadows the second one's expected runtime
- `A network error occurred` — the second module's WASM binary fetch
  fails because the Emscripten preamble is in a corrupted state

### Attempted isolation methods

| Method | Result | Reason |
|--------|--------|--------|
| Direct import (`import('hunspell-asm')`) | ❌ | Collides with ORT in same JS context |
| Module Worker (`new Worker(..., {type:'module'})`) | ❌ | Vite bundling mangles Emscripten IIFE |
| Classic Worker with CDN `importScripts()` | ❌ | CDN fetch fails (CORS/network) |
| Self-hosted CJS in classic Worker | ❌ | Still Emscripten — `runtimeModule` collision |

### Key insight

Web Workers give **thread-level isolation** (separate JS context), but
Emscripten WASM modules within them still need their own WASM memory.
The collision happens because both modules use the Emscripten preamble
pattern that expects to be the **sole** Emscripten module in its context.

With `importScripts()` in a classic Worker, the CJS bundle of `hunspell-asm`
does execute in an isolated context — but the Emscripten factory still
expects `Module` global which may conflict with any prior Emscripten
initialization in that Worker.

---

## 3. Approach comparison

### A. Separate classic Web Worker with self-hosted hunspell-asm CJS

**What:** Copy `node_modules/hunspell-asm/dist/cjs/` to `public/hunspell/`.
Create a `public/hunspell-worker.js` that uses `importScripts()` to load
the CJS bundle. The worker loads the dictionary and exposes
`spellcheck`/`suggest` via `postMessage`.

**Pros:**
- Full Hunspell with Xuxen affix rules
- Thread-isolated from main thread
- No Emscripten conflict with ORT (separate context)

**Cons:**
- ~780KB WASM+JS bundle for hunspell
- Worker needs to fetch `.wasm` binary — must be self-hosted
- Workers cannot share WASM memory with main thread → data copies
- Classic Worker has no ES modules → limited `importScripts` loading
- hunspell-asm hasn't been updated since 2023, may have stale deps

**Feasibility:** Medium. This is the most likely path to success but
needs careful testing. The key challenge is ensuring the hunspell-asm
CJS bundle works inside a `DedicatedWorkerGlobalScope` without any
`window` or `document` references.

### B. Non-Emscripten WASM Hunspell (`wasm-pack` / `wasm-bindgen`)

**What:** Compile Hunspell C code via `wasm-pack` (Rust toolchain binding
to C) or directly via `clang --target=wasm32` without the Emscripten
runtime. This produces a "bare" WASM module without Emscripten's
`Module`/HEAP/abort runtime.

**Pros:**
- **No Emscripten conflict at all** — the module is just `WebAssembly.Module`
- Can be instantiated side-by-side with ORT in the same context
- Smaller binary (no Emscripten runtime overhead)

**Cons:**
- Hunspell is C++ with STL dependency — complex to compile without Emscripten
- Need to manually export libc functions (malloc, free, memcpy)
- File I/O (Hunspell reads `.aff`/`.dic` via FILE*) needs in-memory virtual FS
- rotemdan/hunspell-wasm already uses Emscripten (not a pure wasm-pack build)
- Significant build toolchain effort

**Existing projects:**
- `rotemdan/hunspell-wasm` — Emscripten with `MODULARIZE=1`, `EXPORT_ES6=1`
- `discere-os/hunspell.wasm` — Emscripten
- **No known pure `wasm-pack` Hunspell port exists**

**Feasibility:** Low. Would require weeks of C++/WASM build work.

### C. Pre-computed affix expansion (trade memory for correctness)

**What:** Pre-expand all valid word forms from the Xuxen dictionary at build time.
Run `hunspell -D` or a custom script to generate all declined/conjugated forms.
Ship the expanded set as a compressed file (gzip/brotli).

**Size estimate:**
- 142k base words × average ~50 valid affix forms = ~7M word forms
- ~7M × 10 bytes avg = ~70MB raw text
- ~15-20MB gzip/brotli compressed (Basque words compress well)
- Load-time: ~3-5s on broadband

**Pros:**
- No WASM at all — pure JS Set lookup
- O(1) lookups, instant
- No Emscripten conflict
- Build once, ship static file

**Cons:**
- ~70MB dictionary (even compressed ~15-20MB)
- Suggestion generation still needs Levenshtein over 7M entries → too slow
- Static: new words can't be added at runtime
- Hunspell affix expansion is non-trivial — requires a build-time tool

**Feasibility:** Medium-Low. The expanded dictionary would be ~15-20MB gzip'd.
At 25Mbps mobile, that's ~5-8s download. Acceptable for a first-load but
painful. And suggestions would still need a separate approach.

### D. Hybrid: word list with edge-case prefix expansion

**What:** Keep the current word-list approach but expand only the most common
affix patterns (definite/indefinite suffixes, basic case marking).

**Example:** For `etxe`, pre-compute:
- `etxea`, `etxeak`, `etxearen`, `etxeko`, `etxetik`, `etxera`, `etxean`

**Size estimate:**
- 142k base words × ~15 most common forms = ~2.1M entries
- ~2.1M × 10 bytes = ~21MB raw, ~5MB gzip'd

**Pros:**
- Covers ~90% of declined forms in everyday Basque
- Much smaller than full expansion
- No WASM, no Emscripten, no Workers

**Cons:**
- Misses less common forms (e.g., `etxearentzat`, `etxeetaraino`)
- Still static — can't add new words
- Suggestion quality still limited

**Feasibility:** Medium. But is it worth half-solving the problem?

### E. WebAssembly Component Model / WASI preview2

**What:** Use the emerging WASM Component Model to run Hunspell as a
WASI component compiled with `wasi-sdk` (not Emscripten). The component
has its own isolated memory and communicates via canonical ABI.

**Pros:**
- True isolation — no Emscripten globals
- Standardized interface, future-proof
- Can use `wasi:filesystem` for dictionary loading

**Cons:**
- **Not yet available in browsers** (2026)
- Requires `jco` transpiler for JS interop
- WASI preview2/component model is still behind flags in Chrome/Firefox
- Toolchain is unstable

**Feasibility:** Future (2027+). Not viable today.

### F. Dedicated iframe sandbox

**What:** Load hunspell-asm in a hidden `<iframe>` with a different origin
(or same-origin with its own page). Communicate via `postMessage`.

**Pros:**
- Complete isolation — separate browsing context
- No Emscripten conflict (different document)
- Iframe can load hunspell-asm normally

**Cons:**
- Iframe overhead: whole document, separate JS heap, separate DOM
- `postMessage` serialization overhead for every word
- If same-origin, the iframe will compete for main thread resources
- UX: iframe blocks can cause jank
- Complex error handling for iframe crashes

**Feasibility:** Medium. Technically works but feels like overengineering.

---

## 4. Recommendation: Approach A (Classic Worker + self-hosted CJS)

### Why

- **Only approach that can give us full Hunspell+Xuxen parity with the CLI**
- Thread isolation via Worker solves the Emscripten conflict
- We already have the `.aff`/`.dic` files (5MB total) — just need to load them
- `hunspell-asm` + `dictionary-eu` is the same tech stack as CLI (Hunspell + Xuxen)
- Self-hosting avoids CDN/CORS issues that blocked attempt #3

### Implementation plan

1. **Copy hunspell-asm CJS bundle to `public/`**
   ```
   public/hunspell/
   ├── HunspellAsmModule.js
   ├── HunspellFactory.js
   ├── Hunspell.js
   ├── hunspellLoader.js
   ├── index.js
   ├── loadModule.js
   ├── wrapHunspellInterface.js
   ├── lib/
   │   └── browser/
   │       └── hunspell.js  (~780KB, contains inlined WASM)
   └── util/
       └── logger.js
   ```

2. **Create `public/hunspell-worker.js`** (classic Worker):
   ```js
   importScripts('/txukun/hunspell/index.js');
   // Initialize hunspell with aff/dic from fetch
   // Expose: postMessage({type:'spell', word}) → response
   ```

3. **Update `src/spell.js`**:
   - Spawn Worker on spell init
   - Send words one-by-one or in batch via `postMessage`
   - Collect results asynchronously

4. **Update `vite.config.js`**:
   - Ensure `public/hunspell/` is copied to dist
   - No Vite processing of Worker (it's a plain `.js`, not a module)

5. **UI integration**:
   - Spell checking moves to async (Worker round-trip)
   - Add loading state while Worker initializes
   - Batch words for better throughput (send array, receive array)

### Estimated effort

- **Copy + configure hunspell-asm files:** 1-2 hours
- **Write and debug the classic Worker:** 3-5 hours
- **Integrate with existing spell.js + UI:** 2-3 hours
- **Testing with real Basque text:** 1 hour
- **Total:** ~1-2 days

### Risk factors

- `hunspell-asm` may have browser-specific bugs (last updated 2023)
- Classic Worker `importScripts` with CJS modules may have
  `window`/`document` references that crash
- May need to patch `hunspell-asm` source to work in Worker context
- WASM binary size (780KB) is acceptable but adds to load time

### Fallback
If the Worker approach fails, we can fall back to a **two-stage load**:
- Stage 1: Load current word-list only (fast, degraded)
- Stage 2: Load Hunspell Worker asynchronously, then upgrade

---

## 5. Alternative: Build-time affix expansion (Approach C variant)

If Approach A proves too fragile, the pragmatic fallback is:

1. Write a Python build script that runs `hunspell -D` to extract all
   possible word forms from Xuxen
2. Ship the expanded list as a brotli-compressed bundle (~15-20MB)
3. Use the same Levenshtein suggestion system but now over real word
   forms, not just stems

This gives us **correct spell checking** (no more false positives on
declined forms) without solving the suggestion problem.

---

## 6. Conclusion

**Primary recommendation: Approach A** (Classic Worker + self-hosted
`hunspell-asm` CJS bundle). This is the only approach that:
- Gives full Hunspell + Xuxen parity with the CLI
- Can be implemented in ~1-2 days
- Has a clear fallback path

**Secondary (if A fails): Approach D** (expanded word list with common
affixes) — pragmatic, no WASM, but incomplete.

The fundamental issue is that **no one has built a non-Emscripten Hunspell
WASM module** — all existing Hunspell WASM ports use Emscripten. Until
that changes, we must use isolation (Worker/iframe) rather than
coexistence.
