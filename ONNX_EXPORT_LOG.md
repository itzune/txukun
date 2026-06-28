# Txukun ONNX Export Log

## Context

**Goal:** Convert the `HiTZ/cap-punct-eu` MarianMT model to ONNX format suitable for browser inference via Transformers.js + ONNX Runtime Web.

**Model:** MarianMT (Apache 2.0), 6 encoder + 6 decoder layers, d_model=512, SentencePiece tokenizer, ~154MB safetensors.

**Requirements for Transformers.js:**
1. `encoder_model.onnx` — standalone encoder
2. `decoder_model_merged.onnx` — decoder with KV-cache support (encoder_hidden_states input + present.* outputs)
3. `tokenizer.json` — HuggingFace unified tokenizer format (model uses SentencePiece, not native tokenizer.json)
4. Config files: `config.json`, `tokenizer_config.json`, `generation_config.json`
5. ONNX Runtime Web WASM backend supports up to **IR version 8**

---

## Attempts

### ✅ Attempt 1: Tokenizer generation — SUCCESS
- Used `sentencepiece` Python library to extract vocab/scores from `source.spm`
- Built a Unigram tokenizer with Metaspace pre-tokenizer matching SentencePiece behavior
- Output: `tokenizer.json` (2.1MB)
- Verified encoding matches original `MarianTokenizer` identically

### ❌ Attempt 2: optimum CLI export (seq2seq-lm) — PARTIAL
- Command: `optimum-cli export onnx --model HiTZ/cap-punct-eu --task seq2seq-lm onnx-export-legacy/`
- Result: Only produced `encoder_model.onnx` and `decoder_model.onnx` (standalone, no KV-cache)
- `decoder_model.onnx` lacks KV-cache — Transformers.js requires it for autoregressive generation
- **Missing:** `decoder_model_merged.onnx` with KV-cache support

### ✅ Attempt 3: optimum CLI export (seq2seq-lm-with-past) — SUCCESS but IR 9
- Command: `OPTIMUM_EXPORT_USE_LEGACY=1 optimum-cli export onnx --model HiTZ/cap-punct-eu --task seq2seq-lm-with-past onnx-with-past/`
- Result: Produced all 4 ONNX files including `decoder_model_merged.onnx` with correct I/O shape
- Encoder: IR 8 ✅
- `decoder_model.onnx`: IR 8 ✅ (standalone, no KV-cache)
- `decoder_with_past_model.onnx`: IR 8 ✅ (no encoder_hidden_states input, uses KV-cache for cross-attention)
- **`decoder_model_merged.onnx`: IR 9 ❌** — correct I/O but IR 9

### ❌ Attempt 4: IR version downgrade (v9 → v8) — FALSE NEGATIVE
- Manually set `model.ir_version = 8` on the protobuf
- `onnx.checker.check_model()` passes validation
- Native ONNX Runtime (Python and Node.js) loads it successfully
- ORT Web WASM in Node.js also loads it successfully
- **Runtime error in browser:** `ERROR_CODE: 7, ERROR_MESSAGE: Failed to load model because protobuf parsing failed.`
- This was NOT because of IR version — the real cause was discovered later in Attempts 10-11

### ❌ Attempt 5: torch.onnx.export with custom DecoderWithCache wrapper — FAILED
- Built a custom wrapper combining decoder + lm_head + KV-cache reconstruction
- `torch.export` failed with `AttributeError: 'tuple' object has no attribute 'shape'` in Marian's forward pass
- The Marian decoder's `past_key_values` handling conflicts with `torch.export`'s tracing

### ❌ Attempt 6: ONNX opset downgrade (opset 14) — FAILED
- Re-exported with `--opset 14` via optimum
- `decoder_model_merged.onnx` still produced IR 9
- ONNX version converter (opset 18→14) fails due to `LayerNormalization` op having no downgrade path

### ❌ Attempt 7: onnx-simplifier — NO EFFECT
- `onnxsim.simplify()` on `decoder_model_merged.onnx` preserves IR 9
- The single `If` node (for `use_cache_branch` branching) IS the entire model graph

### ❌ Attempt 8: Older optimum version (1.19.0) — FAILED
- Downgraded optimum to 1.19.0
- Requires PyTorch ≥2.1.2, but we have 2.0.1

### ❌ Attempt 9: Using decoder_with_past_model.onnx as decoder_model_merged — INCOMPATIBLE
- `decoder_with_past_model.onnx` (IR 8) lacks `encoder_hidden_states` input
- Transformers.js feeds `encoder_hidden_states` directly — model expects them pre-computed as KV-cache
- I/O shape mismatch with what Transformers.js expects

### ❌ Attempt 10: Manual If node assembly from two IR 8 subgraphs — ORT REJECTION
- Tried to build a new `decoder_model_merged.onnx` wrapping the two working IR 8 subgraphs (`decoder_model.onnx` + `decoder_with_past_model.onnx`) inside an `If` node
- ONNX checker validated the model, but ORT rejected it at runtime because:
  - Subgraphs with explicit inputs require the `If` node's input list to declare them — but ONNX `If` (v16) only takes 1 input (condition)
  - Subgraphs with 0 declared inputs (like the reference IR 9 model) rely on implicit parent-graph name resolution — an IR 9+ feature not available in IR 8
- **Conclusion:** manual assembly in IR 8 is impossible with this approach

### ✅ Attempt 11: IR downgrade + MIME type fix + Transformers.js config — **SUCCESS**

**Root cause analysis:**

After discovering that the IR-downgraded model loaded fine in ORT Web WASM in Node.js but not in the browser, the investigation revealed **two separate problems**, neither of which was the IR version:

1. **Missing Content-Type header on .onnx files**
   - Vite's dev server was serving `.onnx` files with an empty `Content-Type` header
   - The browser's ORT Web WASM couldn't parse files without a proper MIME type
   - **Fix:** Added a Vite plugin to set `Content-Type: application/octet-stream` for `.onnx` files in `vite.config.js`

2. **Transformers.js `subfolder` default**
   - Transformers.js' `pipeline()` defaults to `subfolder: 'onnx'`, expecting model files inside `{model_dir}/onnx/*.onnx`
   - Our files were directly in `txukun-cap-punct-eu/` without an `onnx/` subdirectory
   - This caused TF.js to look for `txukun-cap-punct-eu/onnx/encoder_model.onnx` (wrong path)
   - Combined with `dtype` defaulting to `q8`, it was also looking for `_quantized` suffixed files
   - **Fix:** Added `subfolder: ''` and `dtype: 'fp32'` to the pipeline options in `src/main.js`

**The actual IR 9 → IR 8 downgrade was never the problem.** The simple `model.ir_version = 8` on the optimum-generated `decoder_model_merged.onnx` produces a valid model that ORT Web WASM handles correctly — as proven by both Node.js ORT Web WASM tests and the final successful browser load.

---

## Working Configuration

### Final file layout in `public/txukun-cap-punct-eu/`:
```
txukun-cap-punct-eu/
├── config.json
├── generation_config.json
├── tokenizer_config.json
├── tokenizer.json              (custom-built, 2.1MB)
├── encoder_model.onnx          (IR 8, opset 18, 136MB)
└── decoder_model_merged.onnx   (IR 8, opset 18, 168MB, downgraded from IR 9)
```

### Final pipeline options in `src/main.js`:
```javascript
const { pipeline, env } = await import('@huggingface/transformers');
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = import.meta.env.BASE_URL;

const correctorPipeline = await pipeline(
  'translation',
  'txukun-cap-punct-eu',
  {
    device: 'wasm',
    dtype: 'fp32',          // no _quantized suffix
    subfolder: '',           // files directly in model dir, not in onnx/
    local_files_only: true,
    progress_callback: (info) => { /* ... */ },
  }
);
```

### Vite config for ONNX MIME type:
```javascript
plugins: [
  {
    name: "onnx-mime",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith(".onnx")) {
          res.setHeader("Content-Type", "application/octet-stream");
        }
        next();
      });
    },
  },
],
```

---

## Key Lessons

1. **ORT Web WASM is picky about HTTP headers.** Always serve ONNX files with `Content-Type: application/octet-stream`. An empty or missing Content-Type causes protobuf parsing failures that look like IR version problems.

2. **Transformers.js has opinionated defaults.** `subfolder: 'onnx'` and `dtype: 'q8'` are sensible for HuggingFace Hub models that follow Xenova's ONNX export conventions, but break with custom local file layouts.

3. **Test ORT Web WASM in Node.js first.** The Node.js WASM backend uses the same code as the browser but without HTTP and caching issues. If it works there but not in the browser, the problem is infrastructure (MIME types, paths, CORS, caching).

4. **The IR 9 → IR 8 protobuf hack is sufficient.** Simply setting `model.ir_version = 8` on the optimum-generated decoder_model_merged.onnx produces a valid model. The subgraphs' implicit parent-graph input resolution (0 declared inputs) works in both IR 8 and IR 9 in practice, despite being an IR 9+ feature on paper.

---

## Next Steps

- [x] Test end-to-end inference in the browser (type text, click "Zuzendu", verify output)
- [ ] Validate output quality against the original MarianMT model in Python
- [x] Host model files on HuggingFace (done: `itzune/txukun-cap-punct-eu`)

---

## Quantization Attempts

### ❌ Attempt 12: Float16 conversion — FAILED (ORT Web WASM incompatibility)

- Converted both models from fp32 to fp16 using `onnxconverter-common.float16.convert_float_to_float16()`
- Result: `encoder_model_fp16.onnx` (68 MB) + `decoder_model_merged_fp16.onnx` (81 MB) — 50% reduction
- Renamed with `_fp16` suffix for Transformers.js auto-detection
- Uploaded to HF Hub under `_fp16` filenames
- Updated Txukun code to `dtype: 'fp16'`
- **Failed in browser**: `ERROR_CODE: 1, Type Error: Type (tensor(float16)) of output arg does not match expected type (tensor(float))`
- **Root cause**: ONNX Runtime Web WASM's CPU backend does NOT support float16 tensors. The fp16 conversion produces `Cast` nodes from float16→float that ORT Web cannot execute.
- **Supported dtypes in ORT Web WASM**: float32, int8, uint8, q8 (via Q/DQ nodes). Float16 is only available when a GPU/WebGPU backend is present.
- **Reverted**: Models back to fp32 on HF Hub.

### ✅ Attempt 13: Int8 quantization — PARTIAL (encoder only)

- Quantized fp32 models with `onnxruntime.quantization.quantize_dynamic(..., QuantType.QInt8)`
- Encoder: 136 MB → 34 MB (✅ 75% reduction, ONNX check passes)
- Decoder merged: 160 MB → 160 MB (❌ no reduction)
- **Root cause**: The decoder's `decoder_model_merged.onnx` wraps both `then_branch` and `else_branch` inside a single `If` node. Subgraph initializers = 0 (weights are in the parent graph via name resolution). `quantize_dynamic` cannot traverse into the `If` node's subgraphs to quantize the 159 float32 initializers.
- **Future solution**: Re-export the decoder without the `If` merge (use separate `decoder_model.onnx` + `decoder_with_past_model.onnx`), then quantize each independently. This requires patching Transformers.js' `seq2seqForward` to load two separate decoder models instead of one merged model.

---

## Key Lessons (updated)

5. **ORT Web WASM does NOT support float16.** Any fp16 model will fail with a type mismatch error at the Cast node. Use fp32, int8, or q8 only.

6. **`quantize_dynamic` cannot handle If-node-wrapped models.** The optimum `seq2seq-lm-with-past` export produces a single `If` node in the merged decoder. Weights live in the parent graph and are shared across branches. ORT's quantizer can't see them. To quantize, either: (a) re-export without merge, or (b) write custom code to extract quantize merge subgraphs.
