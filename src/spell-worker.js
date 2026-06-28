/**
 * Txukun — Spell Worker (Hunspell via hunspell-wasm-bare)
 *
 * Web Worker that loads Hunspell compiled with wasi-sdk (bare WASM, no Emscripten)
 * with Xuxen Basque dictionaries.
 *
 * No Emscripten → no namespace collision with ONNX Runtime Web on the main thread.
 * This worker uses a minimal WASI shim over a dedicated WASM memory instance.
 *
 * Communication via postMessage:
 *   init    → { wasmUrl, affixContent, dictionaryContent }
 *   spell   → { id, word }
 *   suggest → { id, word }
 *   destroy → {}
 */

// ── State ───────────────────────────────────────────

let wasmExports = null;
let memory = null;
let handle = 0;
let nextAlloc = 0x200000; // 2MB — above Hunspell's internal allocations
let ready = false;

// ── WASI shim (minimal, self-contained) ────────────

const WASI_ERRNO_SUCCESS = 0;
const WASI_ERRNO_BADF = 8;
const WASI_ERRNO_ACCES = 2;
const WASI_ERRNO_INVAL = 28;
const FILETYPE_DIRECTORY = 3;
const FILETYPE_REGULAR_FILE = 4;
const PREOPEN_FD = 3;
const PREOPEN_DIR_NAME = 'dict';
const FIRST_FILE_FD = 10;

function makeWasiShim(mem) {
  const files = new Map();
  const memFn = () => new DataView(mem.buffer);
  const mem8Fn = () => new Uint8Array(mem.buffer);

  return {
    registerFile(path, dataText) {
      const fd = FIRST_FILE_FD + files.size;
      files.set(fd, { path, data: new TextEncoder().encode(dataText), pos: 0 });
      return fd;
    },

    // WASI preview1 methods
    args_get() { return 0; },
    args_sizes_get(c, s) { const v = memFn(); v.setUint32(c, 0, true); v.setUint32(s, 0, true); return 0; },
    environ_sizes_get(c, s) { const v = memFn(); v.setUint32(c, 0, true); v.setUint32(s, 0, true); return 0; },
    environ_get() { return 0; },

    fd_prestat_get(fd, bp) {
      if (fd !== PREOPEN_FD) return WASI_ERRNO_BADF;
      const v = memFn();
      v.setUint8(bp, 0); // tag = directory
      v.setUint32(bp + 4, PREOPEN_DIR_NAME.length, true);
      return WASI_ERRNO_SUCCESS;
    },

    fd_prestat_dir_name(fd, bp, bl) {
      if (fd !== PREOPEN_FD) return WASI_ERRNO_BADF;
      const name = new TextEncoder().encode(PREOPEN_DIR_NAME);
      if (bl < name.length) return WASI_ERRNO_INVAL;
      mem8Fn().set(name, bp);
      return WASI_ERRNO_SUCCESS;
    },

    fd_fdstat_get(fd, bp) {
      const v = memFn();
      let ftype;
      if (fd === PREOPEN_FD) ftype = FILETYPE_DIRECTORY;
      else if (files.has(fd)) ftype = FILETYPE_REGULAR_FILE;
      else if (fd <= 2) ftype = 2; // char device
      else return WASI_ERRNO_BADF;
      v.setUint8(bp, ftype);
      v.setUint16(bp + 2, 0, true);
      v.setBigUint64(bp + 8, (1n << 1n) | (1n << 11n), true); // fs_rights_base: read + seek
      v.setBigUint64(bp + 16, fd === PREOPEN_FD ? (
        (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n) |
        (1n << 4n) | (1n << 5n) | (1n << 6n) | (1n << 11n) |
        (1n << 21n) | (1n << 22n) | (1n << 23n)
      ) : 0n, true);
      return WASI_ERRNO_SUCCESS;
    },

    path_open(dirfd, df, pp, pl, ofl, a, b, c, d, rf) {
      const v = memFn();
      if (dirfd !== PREOPEN_FD) return WASI_ERRNO_BADF;
      const s = new TextDecoder().decode(mem8Fn().slice(pp, pp + pl));
      const fp = '/dict/' + s;
      for (const [fd, f] of files) {
        if (f.path === fp) { f.pos = 0; v.setUint32(d, fd, true); return 0; }
      }
      if (s === '.' || s === '') { v.setUint32(d, PREOPEN_FD, true); return 0; }
      return WASI_ERRNO_ACCES;
    },

    path_filestat_get(dirfd, df, pp, pl, bp) {
      const v = memFn();
      const s = new TextDecoder().decode(mem8Fn().slice(pp, pl));
      for (const [fd, f] of files) {
        if (f.path === '/dict/' + s) {
          v.setBigUint64(bp + 0, 0n, true); v.setBigUint64(bp + 8, 1n, true);
          v.setUint8(bp + 16, FILETYPE_REGULAR_FILE);
          v.setBigUint64(bp + 24, 1n, true);
          v.setBigUint64(bp + 32, BigInt(f.data.length), true);
          v.setBigUint64(bp + 40, 0n, true); v.setBigUint64(bp + 48, 0n, true); v.setBigUint64(bp + 56, 0n, true);
          return 0;
        }
      }
      if (s === '.' || s === '' || s === PREOPEN_DIR_NAME) {
        v.setBigUint64(bp + 0, 0n, true); v.setBigUint64(bp + 8, 1n, true);
        v.setUint8(bp + 16, FILETYPE_DIRECTORY);
        v.setBigUint64(bp + 24, 1n, true); v.setBigUint64(bp + 32, 0n, true);
        v.setBigUint64(bp + 40, 0n, true); v.setBigUint64(bp + 48, 0n, true); v.setBigUint64(bp + 56, 0n, true);
        return 0;
      }
      return WASI_ERRNO_ACCES;
    },

    fd_read(fd, iv, ic, nr) {
      const v = memFn();
      const m8 = mem8Fn();
      const f = files.get(fd);
      if (!f) return WASI_ERRNO_BADF;
      let t = 0;
      for (let i = 0; i < ic; i++) {
        const bp = v.getUint32(iv + i * 8, true);
        const bl = v.getUint32(iv + i * 8 + 4, true);
        const tr = Math.min(bl, f.data.length - f.pos);
        if (tr > 0) { m8.set(f.data.subarray(f.pos, f.pos + tr), bp); f.pos += tr; t += tr; }
      }
      v.setUint32(nr, t, true);
      return 0;
    },

    fd_seek(fd, ol, oh, wh, no) {
      const v = memFn();
      const f = files.get(fd);
      if (!f) return WASI_ERRNO_BADF;
      const off = Number(BigInt(ol) | (BigInt(oh) << 32n));
      switch (wh) {
        case 0: f.pos = off; break;
        case 1: f.pos += off; break;
        case 2: f.pos = f.data.length + off; break;
        default: return WASI_ERRNO_INVAL;
      }
      f.pos = Math.max(0, Math.min(f.data.length, f.pos));
      v.setBigUint64(no, BigInt(f.pos), true);
      return 0;
    },

    fd_close(fd) { return files.has(fd) || fd === PREOPEN_FD ? 0 : WASI_ERRNO_BADF; },
    fd_fdstat_set_flags() { return 0; },

    fd_write(fd, iv, ic, nw) {
      const v = memFn(); const m8 = mem8Fn();
      let t = 0;
      for (let i = 0; i < ic; i++) {
        const bp = v.getUint32(iv + i * 8, true);
        const bl = v.getUint32(iv + i * 8 + 4, true);
        t += bl;
        if (fd === 2) console.warn('[hunspell]', new TextDecoder().decode(m8.slice(bp, bp + Math.min(bl, 500))));
      }
      v.setUint32(nw, t, true);
      return 0;
    },

    clock_time_get(c, p, h, tp) { memFn().setBigUint64(tp, 0n, true); return 0; },
    random_get(bp, bl) { crypto.getRandomValues(mem8Fn().subarray(bp, bp + bl)); return 0; },
    proc_exit() {},
  };
}

// ── Helpers ─────────────────────────────────────────

function _alloc(str) {
  const bytes = new TextEncoder().encode(str);
  const ptr = nextAlloc;
  nextAlloc = (ptr + bytes.length + 3) & ~3; // align to 4
  new Uint8Array(memory.buffer).set(bytes, ptr);
  return ptr;
}

function _readCStr(ptr) {
  const bytes = new Uint8Array(memory.buffer, ptr);
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

// ── Message Handler ─────────────────────────────────

self.onmessage = async function (event) {
  const msg = event.data;

  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;
    case 'spell':
      handleSpell(msg);
      break;
    case 'suggest':
      handleSuggest(msg);
      break;
    case 'destroy':
      handleDestroy();
      break;
    default:
      console.warn('[spell-worker] Unknown message type:', msg.type);
  }
};

// ── Init ────────────────────────────────────────────

async function handleInit({ wasmUrl, affixContent, dictionaryContent }) {
  if (ready) {
    self.postMessage({ type: 'ready' });
    return;
  }

  try {
    // Preprocess dict data:
    // - Strip NEEDAFFIX line from .aff (Hunspell 1.7.3 issue — flag 1
    //   universally present in Xuxen dict causes all words to be rejected)
    // - Strip trailing ,1 from dict flags (Xuxen's NEEDAFFIX flag remnant)
    let affixContentFixed = affixContent.replace(/^NEEDAFFIX.*$/m, '');
    let dictionaryContentFixed = dictionaryContent.replace(/,1$/gm, '');

    // Memory: 64MB initial, 256MB max
    memory = new WebAssembly.Memory({ initial: 1024, maximum: 4096 });

    // Build WASI shim with virtual filesystem
    const { registerFile, ...wasiObj } = makeWasiShim(memory);

    // Register dictionary files
    registerFile('/dict/eu.aff', affixContentFixed);
    registerFile('/dict/eu.dic', dictionaryContentFixed);

    // Fetch and instantiate WASM
    const response = await fetch(wasmUrl);
    const wasmBytes = await response.arrayBuffer();

    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      wasi_snapshot_preview1: wasiObj,
      env: { memory },
    });

    wasmExports = instance.exports;

    // Initialize reactor
    if (wasmExports._initialize) {
      wasmExports._initialize();
    }

    // Set CWD to /dict
    nextAlloc = 0x200000;
    const cwdPtr = _alloc('/dict\0');
    if (wasmExports.hunspell_set_cwd) {
      wasmExports.hunspell_set_cwd(cwdPtr);
    }

    // Create Hunspell with bare filenames (CWD=/dict)
    const affPtr = _alloc('eu.aff\0');
    const dicPtr = _alloc('eu.dic\0');
    handle = wasmExports.hunspell_create(affPtr, dicPtr);

    if (handle === 0) {
      throw new Error('Hunspell creation failed — handle is 0');
    }

    ready = true;
    self.postMessage({ type: 'ready' });
  } catch (err) {
    console.error('[spell-worker] Init failed:', err);
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
}

// ── Spell Check ─────────────────────────────────────

function handleSpell({ id, word }) {
  if (!ready) {
    self.postMessage({ type: 'spellResult', id, correct: true, error: 'not ready' });
    return;
  }

  try {
    // Direct spell check
    const ptr = _alloc(word + '\0');
    let correct = wasmExports.hunspell_spell(handle, ptr) !== 0;

    // Hunspell 1.7.3 spell() returns false for all Xuxen words regardless of
    // NEEDAFFIX stripping — likely a flag-parsing regression vs 1.7.0.
    // suggest() works correctly. Use suggest-based validation as fallback:
    // a word is correct if suggest() includes it as the first suggestion.
    if (!correct) {
      const bufSize = 4096;
      const bufPtr = _alloc('\0'.repeat(bufSize));
      const result = wasmExports.hunspell_suggest(handle, ptr, bufPtr, bufSize);
      if (result > 0) {
        const dv = new DataView(memory.buffer, bufPtr, result);
        const count = dv.getUint32(0, true);
        if (count > 0) {
          const firstOffset = dv.getUint32(4, true);
          const firstSugg = _readCStr(bufPtr + firstOffset);
          // Correct if suggest returns the word itself
          if (firstSugg === word || firstSugg.toLowerCase() === word.toLowerCase()) {
            correct = true;
          }
        }
      }
    }

    self.postMessage({ type: 'spellResult', id, correct });
  } catch (err) {
    console.error('[spell-worker] spell error:', err);
    self.postMessage({ type: 'spellResult', id, correct: true, error: err.message });
  }
}

// ── Suggestions ─────────────────────────────────────

function handleSuggest({ id, word }) {
  if (!ready) {
    self.postMessage({ type: 'suggestResult', id, suggestions: [] });
    return;
  }

  try {
    const wordPtr = _alloc(word + '\0');
    const bufSize = 65536;
    const bufPtr = _alloc('\0'.repeat(bufSize)); // align properly

    const result = wasmExports.hunspell_suggest(handle, wordPtr, bufPtr, bufSize);

    if (result <= 0) {
      self.postMessage({ type: 'suggestResult', id, suggestions: [] });
      return;
    }

    // Read suggestion count and offsets from the buffer
    const memBuf = new Uint8Array(memory.buffer, bufPtr, result);
    const dv = new DataView(memory.buffer, bufPtr, result);
    const count = dv.getUint32(0, true);
    const suggestions = [];

    for (let i = 0; i < count; i++) {
      const offset = dv.getUint32(4 + i * 4, true);
      suggestions.push(_readCStr(bufPtr + offset));
    }

    self.postMessage({ type: 'suggestResult', id, suggestions });
  } catch (err) {
    console.error('[spell-worker] suggest error:', err);
    self.postMessage({ type: 'suggestResult', id, suggestions: [] });
  }
}

// ── Destroy ─────────────────────────────────────────

function handleDestroy() {
  if (handle && wasmExports) {
    try { wasmExports.hunspell_destroy(handle); } catch (e) { /* ignore */ }
    handle = 0;
  }
  wasmExports = null;
  memory = null;
  ready = false;
}
