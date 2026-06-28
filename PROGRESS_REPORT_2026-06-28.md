# Txukun — Hunspell WASM Integration Progress Report

**Date:** 2026-06-28  
**Status:** Core integration complete, one blocker remains

---

## 1. What Was Achieved

### hunspell-wasm-bare: Bare WASM Hunspell (v0.2.0)

We successfully compiled Hunspell 1.7.2 to bare WebAssembly using `wasi-sdk` v33 — **no Emscripten at all**.

**Repo:** https://github.com/xezpeleta/hunspell-wasm-bare  
**Release:** [v0.2.0](https://github.com/xezpeleta/hunspell-wasm-bare/releases/tag/v0.2.0)

| Metric | Value |
|--------|-------|
| Binary size | 712KB (180KB gzipped) |
| WASI functions shimmed | 16 (args, environ, fd, clock, random) |
| External dependencies | **Zero** — no Emscripten, no JS runtime |
| Exports | `hunspell_create`, `hunspell_destroy`, `hunspell_spell`, `hunspell_suggest`, `hunspell_get_dic_encoding`, `hunspell_set_cwd` |

### Key technical hurdles overcome:

1. **wasi-libc C++ locale crash** (`ios_base::getloc()`): Replaced Hunspell's `std::ifstream` with raw `open()/read()` using `int fd`. Patched 6 source files in `filemgr.{hxx,cxx}`, `csutil.{hxx,cxx}`, `hunzip.{hxx,cxx}`.

2. **wasi-libc stdio corruption**: After the C++ fix, `fgetc` via `FILE*` had corrupted internal pointers under wasi-libc. Switched to direct `read()` syscalls on the raw fd, bypassing stdio entirely.

3. **64KB stack overflow**: `FileMgr::getline()` allocates `rdbuf[4096]` on the stack. Combined with the deep wasi-libc call chain (`read` → `readv` → `__wasi_fd_read`), the 64KB default stack overflowed. Increased to 256KB (`-z stack-size=262144`).

4. **Memory growth during init**: Xuxen dict parsing expands WASM memory. All JS views must use closure-based factories (`mem()`, `mem8()`) that create fresh TypedArrays on every access.

### Txukun Integration

The spell worker (`src/spell-worker.js`, 273 lines) is a self-contained ES module Web Worker that:

- Instantiates `hunspell.wasm` with a minimal WASI shim (16 functions, ~100 lines)
- Maps dictionary files into an in-memory virtual filesystem via `Map<string, Uint8Array>`
- Sets CWD to `/dict` via `hunspell_set_cwd()` (calls wasi-libc `chdir`)
- Creates Hunspell with bare filenames: `hunspell_create("eu.aff", "eu.dic")`
- Communicates via postMessage with ID-matched request/response protocol

Build: `spell-worker-OwaujE8n.js` (5.44KB bundled) — Vite automatically tree-shakes the worker.

### Dictionary

Full Xuxen Basque dictionary:
- `eu.aff`: 121,686 lines (2.7MB) — suffix rules + REP table + TRY characters
- `eu.dic`: 142,304 entries (2.3MB) — base word stems with numeric flags
- ~3M valid word forms after affix expansion

---

## 2. Current Blocker: `hunspell_spell` False Negatives

### Symptoms

`hunspell_spell()` returns `0` (false) for **all** words when the full Xuxen dictionary is loaded, including valid stems like `"etxe"`, `"gizon"`, `"etxea"`.

`hunspell_suggest()` works correctly and returns accurate Basque word forms:
- Input `"etxee"` → suggestions: `etxe`, `etxea`, `etxeen`, …

System Hunspell 1.7.0 with the identical dictionary files works correctly (`spell("etxe")` returns true).

### What We've Ruled Out

| Hypothesis | Test | Result |
|------------|------|--------|
| File I/O corruption | Tiny 3-word dict works perfectly (`spell("etxe")=true`) | Dict reading is correct |
| Numeric flag parsing broken | Custom PFX+SFX test dict works (`spell("etxea")=true` with suffix rule) | Flag parsing works |
| Flag value overflow | Max flag in Xuxen: 1002, `FLAG` is `unsigned short` (max 65535) | No overflow |
| Affix count mismatch | All 121K SFX rules load, no stderr from Hunspell | Silent parse |
| Stack overflow during spell | Increased stack to 256KB, no change in spell behavior | Not stack |
| `chrono::now()` returning 0 | `TIMELIMIT_GLOBAL_MS=250ms`, check is `now()-start > 250ms`. `now()`=0, `start`=0 → 0ms > 250ms = false → continues fine. Tiny dict works. | Not timelimit |
| Encoding mismatch | `SET UTF-8` in affix, `get_dic_encoding()` returns "UTF-8" | Encoding correct |
| Memory corruption during init | Tiny dict and full Xuxen both use same `mem()`/`mem8()` pattern | Not JS memory |

### Remaining Hypotheses (ranked by likelihood)

**A) `checkword()` flag lookup fails silently with numeric multi-flag combinations**

Xuxen uses flag combinations like `etxe/10,1` where `/10,1` means word belongs to flags 10 AND 1. With `FLAG num`, Hunspell parses `10,1` into a `char[CONTSIZE]` bit array. If the `HashMgr::decode_flags()` or flag array indexing has an off-by-one or endianness issue in wasi-libc's compiled code, `checkword()` would fail every lookup while `suggest()` (which uses n-gram similarity, not flag matching) would still work.

**Investigation needed:** Add debug logging to `AffixMgr::decode_flags()` and `HashMgr::lookup()` to see which flags are being decoded for `"etxe"` and whether the `m_HMgrs[0]->lookup("etxe")` returns a valid `hentry*`.

**B) `cleanword2()` or `spellsharps()` capitalization handling edge case**

Hunspell's spell pipeline goes: `cleanword2()` → case normalization → `checkword()` → flag check. If `cleanword2()` (which handles capital letters, German sharp s, etc.) modifies the word in a way that mismatches the dictionary stem, `checkword()` would fail.

**Investigation needed:** Test `spell()` with all-caps (`ETXE`), title-case (`Etxe`), and lowercase (`etxe`) to see if capitalization affects the result. (System 1.7.0 handles all correctly.)

**C) `std::chrono::steady_clock` resolution difference between wasi-libc and native libc**

Our shim's `clock_time_get` returns `0n` for all times. The `now()` function is:
```cpp
auto now() { return time_point(duration(clock_gettime(...))); }
```
With our shim returning 0, `now()` = `time_point(0ms)`. The check `now() - start > 250ms` correctly passes (0 < 250). But in other places, time arithmetic with `time_point::max()` (used as the default `suggest_start`) might overflow in wasi-32 under wasi-libc's chrono implementation.

**Investigation needed:** Check if any `spell_internal()` code path uses `time_point::max()` comparisons differently than `suggest()`.

**D) `WARN` flag or `nosuggest`/`needaffix`/`onlyincompound` flag misconfiguration**

Xuxen affix defines `WARN 0` and various morphological flags. If `WARN` causes words to be silently rejected, or if a `needaffix` flag is accidentally set on the stem, `spell()` would fail even though `suggest()` finds the word.

**Investigation needed:** Check Xuxen affix for `WARN`, `NEEDAFFIX`, `NOSUGGEST`, `ONLYINCOMPOUND` flags and verify they don't affect `"etxe"`.

### Current Workaround

`handleSpell()` in `spell-worker.js` falls back to `suggest()`: if the word's first suggestion is identical (case-insensitive), treat as correct. This covers the most common false negatives but misses edge cases where `suggest()` returns a different but valid form.

### Request for Advice

The senior engineer should advise on:

1. Which hypothesis (A/B/C/D) seems most likely given Hunspell internals experience
2. Whether a **debug build** of `hunspell.wasm` with `-O0 -g` and console logging would be useful (and how to capture stdout from WASM)
3. Whether switching to **Hunspell 1.7.0** (the version that works with system hunspell) might resolve the issue — the API is identical, just recompile
4. If the **suggest-based fallback workaround** is acceptable for production deployment or if we should block on fixing `spell`

---

## 3. Integration Status

| Component | Status |
|-----------|--------|
| hunspell.wasm compiled + tested | ✅ v0.2.0 |
| WASI shim (16 functions) | ✅ |
| Xuxen dict loading (eu.aff + eu.dic) | ✅ 2.7s init |
| `hunspell_create` (full Xuxen) | ✅ returns valid handle |
| `hunspell_suggest` | ✅ correct Basque forms |
| `hunspell_spell` | ⚠️ false negatives (workaround in place) |
| Worker communication protocol | ✅ ID-matched postMessage |
| Async spell.js proxy API | ✅ backward compatible |
| Parallel loading (model + worker) | ✅ |
| Vite bundling (ES module worker) | ✅ 5.4KB output |
| Build succeeds | ✅ |
| GitHub release | ✅ [v0.2.0](https://github.com/xezpeleta/hunspell-wasm-bare/releases/tag/v0.2.0) |

---

## 4. Files Changed

### hunspell-wasm-bare (v0.2.0)
- `src/hunspell/src/hunspell/filemgr.{hxx,cxx}` — `std::ifstream` → `int fd` + `read()`
- `src/hunspell/src/hunspell/csutil.{hxx,cxx}` — `myopen()` returns `int fd`
- `src/hunspell/src/hunspell/hunzip.{hxx,cxx}` — `std::ifstream` → `int fd` + `read()`
- `src/bridge/hunspell_bridge.cpp` — added `hunspell_set_cwd()`
- `Makefile` — 256KB stack, `crt1-reactor.o`, export `chdir` + `hunspell_set_cwd`
- `dist/hunspell.js` — closure-based `mem()`/`mem8()`, `path_filestat_get`, directory filetype=3

### txukun (v1.5.0 → v2.0 dev)
- `src/spell-worker.js` — new: bare WASM worker + WASI shim + postMessage protocol
- `src/spell.js` — refactored: sync word-list → async worker proxy
- `src/main.js` — parallel loading, loading-spell status
- `public/hunspell.wasm` — 712KB binary
- `HUNSPELL_*.md` — research + feasibility + integration docs

---

## 5. Next Steps After Blocker Resolution

1. Browser testing with real Basque text
2. Deploy to GitHub Pages (`https://itzune.eus/txukun/`)
3. Performance comparison vs. current word-list approach
4. Remove unused deps (`hunspell-asm`, `nspell`, optionally `dictionary-eu`)
5. Bump version to v2.0
