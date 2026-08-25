# Hunspell WASM integration — history archive

These documents record the research, failed approaches, and final solution for
integrating Hunspell spell-checking into Txukun (browser, no server). They're
archived here (out of the repo root) because they have historical value but no
longer describe active work — the integration is done.

## Current state

Txukun uses a **bare WASM Hunspell build** (`public/hunspell.wasm`, 728 KB),
compiled from Hunspell 1.7.3 with `wasi-sdk` (no Emscripten). It runs in
`src/spell-worker.js`. See `ISSUE_LOG.md` for the known bug (`spell()` returns
false for all words under Hunspell 1.7.3; `suggest()` works) and `XUXEN_ISSUES.md`
for dictionary coverage gaps.

> **P0.1 (todo):** rebuild with Hunspell 1.7.0 to fix the `spell()` regression.
> System Hunspell 1.7.0 with identical dictionary files works correctly.

## Archived documents

| File | Content |
|---|---|
| `HUNSPELL_WASM_RESEARCH.md` | Full research report: why server-side Hunspell won't work, JS port options, Emscripten collision with ONNX Runtime Web |
| `HUNSPELL_WASM_RESEARCH_SUMMARY.md` | TL;DR of the above |
| `HUNSPELL_BARE_WASM_FEASIBILITY.md` | Proof that Hunspell compiles with wasi-sdk (no Emscripten) — the breakthrough |
| `HUNSPELL_INTEGRATION_PLAN.md` | Step-by-step integration plan (the approach that shipped) |
| `SPELL_DEBUG_LOG.md` | Debug log of spell-checker integration attempts and failures |

## Why the standard approaches failed

1. **`hunspell-asm` (Emscripten)** — collides with ONNX Runtime Web (both can't
   coexist in the same JS context). Tried in main thread, module worker, classic
   worker, self-hosted CJS — all failed.
2. **`nspell` / `typo-js` (pure JS ports)** — dictionary parsing blocks the main
   thread >30s.
3. **Bare WASM (wasi-sdk)** — ✅ works. No Emscripten, no collision. This is what
   shipped.

The dead `hunspell-asm` and `nspell` npm dependencies were removed in P0.3
(2026-08-25) since the bare WASM build made them unnecessary.
