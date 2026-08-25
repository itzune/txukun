Report written to: `/home/xezpeleta/Dev/itzune/txukun/HUNSPELL_WASM_RESEARCH.md`

## TL;DR

The report covers:

1. **The problem**: ONNX Runtime Web (for Transformers.js model inference) and Hunspell both use Emscripten-compiled WASM. Two Emscripten modules can't coexist in the same JS context — they collide on `Module`, WASM memory, and runtime globals.

2. **6 approaches analyzed**: Classic Worker isolation, bare WASM (no Emscripten), pre-computed affix expansion, partial expansion, WASM Component Model, and iframe sandbox.

3. **Recommendation**: Classic Web Worker with self-hosted `hunspell-asm` CJS bundle (Approach A). The Worker gives thread-level isolation — separate JS context, no Emscripten collision with the main thread's ORT module.

4. **Fallback**: If the Worker approach fails (hunspell-asm has internal `window`/`document` refs or CJS module resolution issues), the pragmatic fallback is a build-time affix expansion script that generates all valid word forms.

5. **Key insight from the research**: The `Device set to use cpu` message leak was actually from `transformers` (`logger.warning`), not ONNX Runtime. We fixed it with `transformers.utils.logging.set_verbosity_error()`.

6. **hunspell-asm CJS dependencies**: `nanoid`, `emscripten-wasm-loader`. These would also need to be bundled for the classic Worker — the `importScripts()` approach works with UMD/CJS globals, not ES modules.
