/**
 * HunspellWasm — Load a bare WASM Hunspell binary with a minimal WASI shim.
 *
 * No Emscripten, no conflicts with ONNX Runtime Web or other WASM modules.
 *
 * Usage:
 *   import { HunspellWasm } from './hunspell.js';
 *
 *   const checker = await HunspellWasm.create({
 *       wasmUrl: './hunspell.wasm',
 *       affixContent: affixString,
 *       dictionaryContent: dictString
 *   });
 *
 *   checker.spell('kaixo');          // true
 *   checker.suggest('etxe');         // ['etxe', 'etxea', ...]
 *   checker.destroy();
 */

// ── WASI constants ──────────────────────────────────────────────

const WASI_ERRNO_SUCCESS = 0;
const WASI_ERRNO_BADF = 8;
const WASI_ERRNO_ACCES = 2;
const WASI_ERRNO_INVAL = 28;

const FILETYPE_DIRECTORY = 3;
const FILETYPE_REGULAR_FILE = 4;

// WASM uses fd=3 as the preopened /dict directory.
// Registered files get fd >= 5.
const PREOPEN_FD = 3;
const FIRST_FILE_FD = 5;

// ── WASI shim builder ────────────────────────────────────────────

/**
 * Build a WASI preview1 object whose methods have the exact signatures
 * expected by the WASM module (i32/i64 args, i32 returns).
 *
 * The `memory` reference is captured in a closure so the WASM module
 * doesn't need to pass it explicitly.
 */
function makeWasiShim(memory) {
    // Virtual filesystem: fd → { path, data (Uint8Array), pos }
    const files = new Map();

    const mem = () => new DataView(memory.buffer);
    const mem8 = () => new Uint8Array(memory.buffer);

    function registerFile(path, dataText) {
        const fd = files.size + FIRST_FILE_FD;
        files.set(fd, {
            path,
            data: new TextEncoder().encode(dataText),
            pos: 0,
        });
        return fd;
    }

    function findFile(path) {
        for (const [, f] of files) {
            if (f.path === path) return f;
        }
        return null;
    }

    return {
        registerFile,

        // ── fd_prestat_get(fd: i32, buf: i32) -> errno: i32
        fd_prestat_get(fd, bufPtr) {
            if (fd !== PREOPEN_FD) return WASI_ERRNO_BADF;
            const v = mem();
            v.setUint8(bufPtr, 0);             // tag = directory
            v.setUint32(bufPtr + 4, 5, true);  // name_len = len("/dict")
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_prestat_dir_name(fd: i32, buf: i32, buf_len: i32) -> errno: i32
        fd_prestat_dir_name(fd, bufPtr, bufLen) {
            if (fd !== PREOPEN_FD) return WASI_ERRNO_BADF;
            const name = new TextEncoder().encode('/dict');
            if (bufLen < name.length) return WASI_ERRNO_INVAL;
            mem8().set(name, bufPtr);
            return WASI_ERRNO_SUCCESS;
        },

        // ── path_open(dirfd, dirflags, path_ptr, path_len, oflags,
        //              fs_rights_base_lo, fs_rights_base_hi,
        //              fs_rights_inheriting_lo, fs_rights_inheriting_hi,
        //              fdflags, result_fd_ptr) -> errno: i32
        path_open(dirfd, dirflags, pathPtr, pathLen, oflags,
                  fsRightsBaseLo, fsRightsBaseHi,
                  fsRightsInheritingLo, fsRightsInheritingHi,
                  fdflags, resultFdPtr) {

            if (dirfd !== PREOPEN_FD) return WASI_ERRNO_BADF;

            const pathBytes = mem8().slice(pathPtr, pathPtr + pathLen);
            const filename = new TextDecoder().decode(pathBytes);
            const fullPath = '/dict/' + filename;

            const file = findFile(fullPath);
            if (!file) return WASI_ERRNO_ACCES;

            file.pos = 0;

            let actualFd = 0;
            for (const [fd, f] of files) {
                if (f === file) { actualFd = fd; break; }
            }

            mem().setUint32(resultFdPtr, actualFd, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_read(fd: i32, iovs_ptr: i32, iovs_len: i32, nread_ptr: i32) -> errno: i32
        fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
            const file = files.get(fd);
            if (!file) return WASI_ERRNO_BADF;

            let totalRead = 0;
            const v = mem();

            for (let i = 0; i < iovsLen; i++) {
                const bufPtr = v.getUint32(iovsPtr + i * 8, true);
                const bufLen = v.getUint32(iovsPtr + i * 8 + 4, true);
                const remaining = file.data.length - file.pos;
                const toRead = Math.min(bufLen, remaining);

                if (toRead > 0) {
                    mem8().set(file.data.subarray(file.pos, file.pos + toRead), bufPtr);
                    file.pos += toRead;
                    totalRead += toRead;
                }
            }

            v.setUint32(nreadPtr, totalRead, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_seek(fd: i32, offset: i64, whence: i32, newoffset_ptr: i32) -> errno: i32
        fd_seek(fd, offsetLo, offsetHi, whence, newOffsetPtr) {
            const file = files.get(fd);
            if (!file) return WASI_ERRNO_BADF;

            const offset = Number(BigInt(offsetLo) | (BigInt(offsetHi) << 32n));

            switch (whence) {
                case 0: file.pos = offset; break;
                case 1: file.pos += offset; break;
                case 2: file.pos = file.data.length + offset; break;
                default: return WASI_ERRNO_INVAL;
            }

            if (file.pos < 0) file.pos = 0;
            if (file.pos > file.data.length) file.pos = file.data.length;

            const newPos = BigInt(file.pos);
            mem().setBigUint64(newOffsetPtr, newPos, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_close(fd: i32) -> errno: i32
        fd_close(fd) {
            if (!files.has(fd)) return WASI_ERRNO_BADF;
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_fdstat_get(fd: i32, buf: i32) -> errno: i32
        fd_fdstat_get(fd, bufPtr) {
            const file = files.get(fd);
            const isKnown = file || fd <= 2;
            if (!isKnown && fd > 2) return WASI_ERRNO_BADF;

            const v = mem();
            v.setUint8(bufPtr, file ? FILETYPE_REGULAR_FILE : 2); // 2=char device
            v.setUint16(bufPtr + 2, 0, true);
            // fs_rights_base: read + seek
            v.setBigUint64(bufPtr + 8, (1n << 1n) | (1n << 11n), true);
            v.setBigUint64(bufPtr + 16, 0n, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_fdstat_set_flags(fd: i32, flags: i32) -> errno: i32
        fd_fdstat_set_flags() {
            return WASI_ERRNO_SUCCESS;
        },

        // ── fd_write(fd: i32, iovs_ptr: i32, iovs_len: i32, nwritten_ptr: i32) -> errno: i32
        fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
            let total = 0;
            const v = mem();
            for (let i = 0; i < iovsLen; i++) {
                const bufPtr = v.getUint32(iovsPtr + i * 8, true);
                const bufLen = v.getUint32(iovsPtr + i * 8 + 4, true);
                total += bufLen;
                if (fd === 2) {
                    console.warn('[hunspell]', new TextDecoder().decode(mem8().slice(bufPtr, bufPtr + bufLen)));
                }
            }
            v.setUint32(nwrittenPtr, total, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── environ_sizes_get(count_ptr, buf_size_ptr) -> errno: i32
        environ_sizes_get(countPtr, bufSizePtr) {
            const v = mem();
            v.setUint32(countPtr, 0, true);
            v.setUint32(bufSizePtr, 0, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── environ_get(environ, environ_buf) -> errno: i32
        environ_get() {
            return WASI_ERRNO_SUCCESS;
        },

        // ── clock_time_get(clock_id: i32, precision: i64, time_ptr: i32) -> errno: i32
        clock_time_get(clockId, precisionLo, precisionHi, timePtr) {
            mem().setBigUint64(timePtr, 0n, true);
            return WASI_ERRNO_SUCCESS;
        },

        // ── random_get(buf: i32, buf_len: i32) -> errno: i32
        random_get(bufPtr, bufLen) {
            crypto.getRandomValues(mem8().subarray(bufPtr, bufPtr + bufLen));
            return WASI_ERRNO_SUCCESS;
        },

        // ── proc_exit(code: i32) -> void
        proc_exit() {},
    };
}

// ── HunspellWasm ──────────────────────────────────────────────────

export class HunspellWasm {
    /**
     * Create and initialize a new Hunspell checker.
     *
     * @param {{wasmUrl: string, affixContent: string, dictionaryContent: string}} opts
     * @returns {Promise<HunspellWasm>}
     */
    static async create({ wasmUrl, affixContent, dictionaryContent }) {
        // Memory: 256MB should handle Xuxen dictionaries
        const memory = new WebAssembly.Memory({
            initial: 2048,  // 128MB
            maximum: 4096,  // 256MB
        });

        // Build WASI shim (captures memory in closure)
        const { registerFile, ...wasiObj } = makeWasiShim(memory);

        // Register dictionary files
        registerFile('/dict/eu.aff', affixContent);
        registerFile('/dict/eu.dic', dictionaryContent);

        // Fetch and instantiate WASM
        const response = await fetch(wasmUrl);
        const wasmBytes = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(wasmBytes, {
            wasi_snapshot_preview1: wasiObj,
            env: { memory },
        });

        return new HunspellWasm(instance.exports, memory);
    }

    constructor(exports, memory) {
        this._e = exports;
        this._mem = memory;
        this._handle = 0;
        this._nextAlloc = 0x10000; // bump allocator start at 64KB
        this._destroyed = false;
    }

    /**
     * Initialize the engine (called automatically by create).
     */
    init() {
        if (this._destroyed) throw new Error('Destroyed');

        const affPtr = this._alloc('/dict/eu.aff\0');
        const dicPtr = this._alloc('/dict/eu.dic\0');

        this._handle = this._e.hunspell_create(affPtr, dicPtr);
        if (this._handle === 0) {
            throw new Error('Hunspell initialization failed');
        }
        return this;
    }

    /**
     * Check spelling.
     * @param {string} word
     * @returns {boolean}
     */
    spell(word) {
        if (!this._handle) this.init();
        const ptr = this._alloc(word + '\0');
        return this._e.hunspell_spell(this._handle, ptr) !== 0;
    }

    /**
     * Get suggestions for a misspelled word.
     * @param {string} word
     * @returns {string[]}
     */
    suggest(word) {
        if (!this._handle) this.init();
        const wordPtr = this._alloc(word + '\0');

        const bufSize = 65536;
        const bufPtr = this._allocBytes(bufSize);

        const result = this._e.hunspell_suggest(this._handle, wordPtr, bufPtr, bufSize);

        if (result <= 0) return [];

        const v = new DataView(this._mem.buffer, bufPtr, result);
        const count = v.getUint32(0, true);
        const suggestions = [];

        for (let i = 0; i < count; i++) {
            const offset = v.getUint32(4 + i * 4, true);
            suggestions.push(this._readCStr(bufPtr + offset));
        }

        return suggestions;
    }

    /**
     * Get dictionary encoding.
     * @returns {string}
     */
    getDicEncoding() {
        if (!this._handle) this.init();
        const ptr = this._e.hunspell_get_dic_encoding(this._handle);
        return ptr ? this._readCStr(ptr) : 'UTF-8';
    }

    /**
     * Free all resources.
     */
    destroy() {
        if (this._destroyed) return;
        if (this._handle) {
            this._e.hunspell_destroy(this._handle);
            this._handle = 0;
        }
        this._destroyed = true;
        this._e = null;
        this._mem = null;
    }

    // ── private ───────────────────────────────────────────────

    _alloc(str) {
        const bytes = new TextEncoder().encode(str);
        return this._allocBytes(bytes.length);
    }

    _allocBytes(size) {
        const ptr = this._nextAlloc;
        this._nextAlloc = (ptr + size + 3) & ~3; // align to 4
        return ptr;
    }

    _readCStr(ptr) {
        const bytes = new Uint8Array(this._mem.buffer, ptr);
        let end = 0;
        while (end < bytes.length && bytes[end] !== 0) end++;
        return new TextDecoder().decode(bytes.subarray(0, end));
    }
}

export default HunspellWasm;
