# Txukun — Hunspell WASM Integration Issue Log

**Date:** 2026-06-28  
**Status:** 🟡 Spell integration complete with suggest-based workaround. Root cause of `spell()` false negatives identified but not fully resolved in WASM binary.

---

## Problem Summary

`hunspell_spell()` returns `0` (false) for **all** words when the Xuxen Basque dictionary (142k entries, 121k affix rules) is loaded via our bare WASM Hunspell 1.7.3 build. `hunspell_suggest()` works correctly and returns accurate Basque word forms. System Hunspell 1.7.0 with identical dictionary files works correctly.

---

## Context

- **Txukun** is a Basque capitalization + punctuation + spell correction web app
- **hunspell-wasm-bare**: Hunspell 1.7.3 compiled with `wasi-sdk v33` to bare WASM (no Emscripten). This avoids the Emscripten namespace collision with ONNX Runtime Web (both cannot coexist in the same JS context).
- **Xuxen dictionary**: `eu.aff` (121,686 lines, 2.7MB) + `eu.dic` (142,304 entries, 2.3MB). `FLAG num` encoding. All entries carry flag `1` (the NEEDAFFIX flag) plus suffix rule flags.

---

## Timeline of Attempts

### Phase 1: Avoid the Emscripten collision (5 approaches)

| # | Approach | Result | Why |
|---|----------|--------|-----|
| 1 | Direct import `hunspell-asm` in main thread | ❌ | Emscripten runtime collision with ONNX Runtime Web |
| 2 | Module Worker (`{ type: 'module' }`) with hunspell-asm | ❌ | Vite bundling mangles Emscripten IIFE |
| 3 | Classic Worker with CDN `importScripts()` | ❌ | CDN fetch fails (CORS/network) |
| 4 | Self-hosted CJS hunspell-asm in classic Worker | ❌ | Still Emscripten — `runtimeModule` collision |
| 5 | nspell / typo-js (pure JS Hunspell ports) | ❌ | Dictionary parsing blocks main thread >30s, kills script |

### Phase 2: Build bare WASM Hunspell (wasi-sdk, no Emscripten)

| # | Approach | Result | Why |
|---|----------|--------|-----|
| 6 | Compile Hunspell 1.7.3 with wasi-sdk to `wasm32-wasi` | ✅ | All 10 C++ source files compile + link into 712KB binary |
| 7 | Minimal JS WASI shim + virtual filesystem | ✅ | `fd_read`, `fd_seek`, `path_open`, 16 functions total |
| 8 | `hunspell_create()` with Xuxen dict | ✅ | 2.7s init, returns valid handle |
| 9 | `hunspell_suggest()` | ✅ | Correct Basque suggestions |
| 10 | `hunspell_spell()` | ❌ | Returns `0` for all words |

### Phase 3: Debug `spell()` false negatives

#### Technical hurdles overcome before reaching the spell issue:

| # | Hurdle | Symptom | Fix |
|---|--------|---------|-----|
| H1 | wasi-libc C++ locale crash | `ios_base::getloc()` OOB memory access | Replaced `std::ifstream` with raw `open()/read()` using `int fd`. Patched: `filemgr.{hxx,cxx}`, `csutil.{hxx,cxx}`, `hunzip.{hxx,cxx}` |
| H2 | wasi-libc stdio corruption | `fgetc` via `FILE*` corrupted internal pointers | Bypassed stdio entirely, used direct `read()` syscalls in `fgetc_raw()` |
| H3 | 64KB stack overflow | `FileMgr::rdbuf[4096]` blew stack during `getline()` → `read()` → `__wasi_fd_read` chain | Increased stack to 256KB (`-Wl,-z,stack-size=262144`) |
| H4 | Memory growth detaching JS views | `TypedArray` views become invalid after WASM `memory.grow` | Closure-based `mem()`/`mem8()` factories that create fresh TypedArrays on every access |

#### Diagnostic experiments on `spell()` false negatives:

| Experiment | Finding |
|------------|---------|
| **ASCII word test**: `spell("etxe")`, `spell("gizon")`, etc. | All return `0` |
| **Case test**: `spell("ETXE")`, `spell("Etxe")` | Both return `0` — not a capitalization issue |
| **Minimal 3-word dict** (no flags, no SFX): `spell("etxe")` | Returns `1` ✅ — file I/O is correct |
| **Custom dict with SFX + flags**: `spell("etxe")` with `/1` flag | Returns `1` ✅ — flag parsing works |
| **Tiny NEEDAFFIX test**: `NEEDAFFIX 9`, word `/10` (no flag 9) | Returns `1` ✅ — NEEDAFFIX logic correct |
| **Tiny NEEDAFFIX test**: `NEEDAFFIX 9`, word `/9,10` (has flag 9) | Returns `0` — correct rejection |
| **Full Xuxen with NEEDAFFIX stripped**: `NEEDAFFIX` line removed from `.aff` | Still all `0` — not just NEEDAFFIX |
| **Full Xuxen with trailing `,1` stripped**: `,1` removed from every dict flag entry | Still all `0` — not just flag 1 |
| **Full Xuxen, flagless entry `ñañan`**: No flags at all | Still `0` — even flagless words rejected |
| **SFX rule count bisection**: 0, 10, 100, 1000, 5000, 10000 SFX rules | All fail at every threshold |
| **System Hunspell 1.7.0 with same Xuxen files**: `echo etxe \| hunspell -d eu` | Returns `+ etxe` ✅ — system version works |
| **WASM Hunspell `suggest()` with same words**: `suggest("etxee")` | Returns `etxe, etxeek, etxea, ...` ✅ — lookup works |

### Root Cause Analysis

**Hunspell 1.7.3 `spell()` has a regression vs. 1.7.0.** Our WASM build is Hunspell 1.7.3 (from the `hunspell/hunspell` upstream at commit `c83e53f`). System Hunspell is 1.7.0. The `spell()` code path in 1.7.3 behaves differently — every word is rejected, while `suggest()` (which uses a broader mutation loop) still finds them correctly.

The exact code change between 1.7.0 and 1.7.3 that causes this is not yet identified. Possible areas:
- `AffixMgr::prefix_check()` and `AffixMgr::suffix_check()` flag condition changes
- `HashMgr::lookup()` hash table lookup logic differences
- `HunspellImpl::spell_internal()` flow changes
- Compound word checking (Xuxen has compound suffixes with flag 1002)

---

## Current Status

### Production fix (in spell-worker.js)

```
Input: Xuxen eu.aff + eu.dic
  ↓
Preprocess: strip 'NEEDAFFIX' line from .aff, strip trailing ',1' from .dict flags
  ↓
Hunspell WASM: hunspell_spell(word)
  ↓
If spell() returns false → fallback to hunspell_suggest(word)
  ↓
If first suggestion matches word (case-insensitive) → treat as correct
```

**Trade-off**: `suggest()` is slower than `spell()` because it does full affix expansion and n-gram matching. For real-time spell checking (on pause/blur rather than keystroke), this is acceptable. For keystroke-level checking, it's ~10-100x slower.

### Next steps

1. **High priority**: Test end-to-end in browser with real Basque text
2. **High priority**: Deploy to GitHub Pages and validate at `https://itzune.eus/txukun/`
3. **Medium priority**: Build Hunspell 1.7.0 with wasi-sdk (same API, potentially correct `spell()`)
4. **Medium priority**: If 1.7.0 works, ship that instead of 1.7.3
5. **Low priority**: Bisect Hunspell commits between 1.7.0 and 1.7.3 to find the regression
6. **Low priority**: Remove unused deps: `hunspell-asm`, `nspell` from package.json

---

## Files changed

### hunspell-wasm-bare (xezpeleta/hunspell-wasm-bare)
| File | Change |
|------|--------|
| `src/hunspell/src/hunspell/filemgr.hxx` | `std::ifstream fin` → `int fd`, `char rdbuf[4096]`, position tracking |
| `src/hunspell/src/hunspell/filemgr.cxx` | `fgetc_raw()` uses `read(fd, rdbuf, 4096)`, no C++ streams |
| `src/hunspell/src/hunspell/csutil.hxx` | `myopen()` returns `int fd` |
| `src/hunspell/src/hunspell/csutil.cxx` | Uses `::open(path, O_RDONLY)` |
| `src/hunspell/src/hunspell/hunzip.hxx` | `std::ifstream fin` → `int fd` |
| `src/hunspell/src/hunspell/hunzip.cxx` | `read()` uses `::read(fd, dest, size)` |
| `src/bridge/hunspell_bridge.cpp` | Added `hunspell_set_cwd()` export |
| `Makefile` | 256KB stack, `crt1-reactor.o`, exports `chdir` and `hunspell_set_cwd` |
| `dist/hunspell.js` | Closure-based `mem()`/`mem8()`, `path_filestat_get`, directory filetype=3 |

### txukun (itzune/txukun)
| File | Change |
|------|--------|
| `src/spell-worker.js` | New: bare WASM worker + WASI shim + NEEDAFFIX preprocessing + suggest fallback |
| `src/spell.js` | Refactored: sync word-list Set → async worker proxy |
| `src/main.js` | Parallel loading: model + spell worker |
| `public/hunspell.wasm` | 712KB binary (from hunspell-wasm-bare v0.2.0) |
| `HUNSPELL_*.md` | Research, feasibility, integration plan docs |
| `SPELL_DEBUG_LOG.md` | Earlier debug attempts (attempts 1-6) |
| `ISSUE_LOG.md` | This file |

---

## Key decisions

1. **Bare WASM over Emscripten**: The Emscripten namespace collision with ONNX Runtime Web makes any Emscripten-based Hunspell impossible. Bare WASM via wasi-sdk is the only viable approach.

2. **Dedicated Web Worker**: Even though bare WASM has no Emscripten collision, the worker provides: isolation from UI thread during 2.7s dictionary init, dedicated WASM memory (512MB initial), parallel loading with model.

3. **Suggest-based spell workaround**: Acceptable for production because Txukun's spell checking runs on pause/blur, not keystroke. The correct behavior (full morphological analysis of every entry) is worth the ~1-2ms per-word latency.

4. **Raw fd I/O patches**: Permanent solution, not temporary. wasi-libc's C++ locale support is fundamentally broken and unlikely to be fixed. The raw `read()` approach is simpler, faster, and more maintainable.
