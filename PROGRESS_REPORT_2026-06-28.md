# Txukun — Hunspell WASM Integration Progress Report

**Date:** 2026-06-28  
**Status:** ✅ Core integration complete. 🟡 `spell()` uses suggest-based fallback due to Hunspell 1.7.3 regression.

> See [ISSUE_LOG.md](./ISSUE_LOG.md) for full diagnostic history of all 10+ development attempts.

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

## 2. `hunspell_spell` False Negatives — Root Cause

### Diagnosis (2026-06-28)

**Root cause: Hunspell 1.7.3 `spell()` regression vs. 1.7.0.**

Our WASM build is Hunspell 1.7.3 (upstream commit `c83e53f`). System Hunspell is 1.7.0. The `spell()` code path in 1.7.3 rejects every word from the Xuxen dictionary, while `suggest()` (broader mutation loop) works fine. Even completely flagless dict entries like `ñañan` are rejected.

The exact 1.7.0→1.7.3 commit causing this is not yet identified.

**Contributing factor: `NEEDAFFIX 1`** — Xuxen's affix declares `NEEDAFFIX 1` and every dict entry carries flag `1`. Stripping both (NEEDAFFIX line from .aff, trailing `,1` from .dict flags) is done in the worker but doesn't fully resolve the issue — the 1.7.3 regression is deeper.

### Workaround (production)

`spell-worker.js` uses a two-stage spell check:
1. `hunspell_spell()` → direct lookup  
2. If false → `hunspell_suggest()` → if first suggestion matches word, treat as correct

This is correct but slower (~1-2ms per word vs ~0.1ms for direct `spell()`). Acceptable for pause/blur-based checking, not ideal for keystroke-level.

### Path to definitive fix

1. Build Hunspell 1.7.0 with wasi-sdk (same raw fd I/O patches, same API) — test if `spell()` works
2. If yes → ship 1.7.0 binary, remove suggest fallback
3. If still broken → bisect Hunspell commits between 1.7.0 and 1.7.3 to find the regression

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

## 5. Next Steps

1. Browser testing with real Basque text at `https://itzune.eus/txukun/`
2. Performance comparison vs. current word-list approach
3. Build Hunspell 1.7.0 with wasi-sdk to test if `spell()` works
4. Remove unused deps (`hunspell-asm`, `nspell`)
5. Bump version to v2.0

---

> Full development log with all 10+ approaches, diagnostic experiments, and technical hurdles: [ISSUE_LOG.md](./ISSUE_LOG.md)
