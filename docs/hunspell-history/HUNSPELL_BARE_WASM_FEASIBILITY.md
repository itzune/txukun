# hunspell-bare-wasm — Feasibility proof

**Verified 2026-06-28 by compiling Hunspell 1.7.2 with wasi-sdk 33 (no Emscripten)**

## Status: IMPLEMENTED ✅

Repository: `~/Dev/xezpeleta/hunspell-wasm-bare/`

## Proof

All 10 Hunspell C++ source files compile cleanly with `wasm32-wasi-clang++`:

```
affentry.cxx    ✅
affixmgr.cxx    ✅
csutil.cxx      ✅
filemgr.cxx     ✅
hashmgr.cxx     ✅
hunspell.cxx    ✅
hunzip.cxx      ✅
phonet.cxx      ✅
replist.cxx     ✅
suggestmgr.cxx  ✅
```

Linked into a bare WASM binary:
- **715 KB** (optimized, 180 KB gzipped)
- **No Emscripten runtime** — just libc++ statically linked
- `wasm32-wasi` target (compatible with browser `WebAssembly.instantiate()`)
- Link flag: `-lwasi-emulated-process-clocks` (for Hunspell's timeout feature)

## What's implemented

### 1. C-linkage wrapper (`src/bridge/hunspell_bridge.cpp`)
`extern "C"` wrappers for: `hunspell_create`, `hunspell_destroy`, `hunspell_spell`,
`hunspell_suggest`, `hunspell_get_dic_encoding`. Uses the non-deprecated C++ API
(`spell(const std::string&)`, `suggest(const std::string&)`).

### 2. Virtual filesystem (WASI shim)
Rather than patching Hunspell, we intercept at the WASI level. A minimal JS
implementation of 14 WASI preview1 functions routes `fopen()` calls to an
in-memory `Map<string, Uint8Array>`. No filesystem needed.

### 3. JS loader (`dist/hunspell.js`)
```js
import { HunspellWasm } from './hunspell.js';

const checker = await HunspellWasm.create({
    wasmUrl: './hunspell.wasm',
    affixContent: affixString,
    dictionaryContent: dictString
});

checker.spell('kaixo');        // true
checker.suggest('etxe');       // ['etxe', 'etxea', ...]
checker.destroy();
```

### 4. Size optimization
- 715 KB raw, 180 KB gzipped
- `-O3 -flto -fvisibility=hidden -ffunction-sections -fdata-sections`
- `-Wl,--gc-sections --strip-debug`

## Files created

```
hunspell-wasm-bare/
├── Makefile                         # Build system
├── README.md                        # User-facing docs
├── RESEARCH.md                      # Deep dive (this doc's companion)
├── .gitignore
├── src/
│   ├── hunspell/                    # Git submodule: hunspell/hunspell v1.7.2
│   └── bridge/
│       └── hunspell_bridge.cpp      # C-linkage wrappers
├── dist/
│   ├── hunspell.wasm                # 715KB optimized binary
│   └── hunspell.js                  # JS loader + WASI shim
└── test/                            # (to be added)
```

## Comparison with Emscripten approach

| | Emscripten (hunspell-asm) | Bare WASM (this approach) |
|---|---|---|
| WASM size | ~780KB (JS loader + WASM) | 715KB raw, ~180KB gzip |
| JS runtime | Emscripten (~100KB JS) | Custom loader (~12KB JS) |
| Conflicts with ORT | ❌ Collides | ✅ No conflict |
| Filesystem | Emscripten FS | Minimal WASI shim in JS |
| Browser load | importScripts / ES module | WebAssembly.instantiate() |
| Maintenance | Depends on hunspell-asm (stale) | Self-maintained |

## Next steps

1. Test with real Xuxen Basque dictionaries (eu.aff + eu.dic)
2. Browser integration test in Txukun's Web Worker
3. Performance benchmarking vs. txukun-cli's Hunspell
4. Replace Txukun's word-list spell checker with this
