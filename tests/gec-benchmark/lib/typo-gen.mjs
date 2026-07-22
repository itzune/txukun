/**
 * Synthetic typo generator — JS port of futo-transformer-basque's
 * scripts/lib/typo_synthesis.py.
 *
 * Strategies (weighted, mixed per-word):
 *   1. Keyboard-adjacency (QWERTY, letters only)
 *   2. Missing-diacritic / ñ loss (NFD decompose, drop combining marks)
 *   3. Transposed adjacent letters
 *   4. Single-char insertion
 *   5. Single-char deletion
 *   6. Doubled char
 *
 * Used to generate synthetic spelling-error sentences from the Elhuyar
 * correct-sentence set (Dem_none / Dea_none). The correct version is known
 * by construction — no Basque expertise needed.
 */

// QWERTY adjacency map (letters only — digits/hyphens filtered for
// realistic Basque text typos). Each key → its letter neighbours.
const ADJ = {
  q: 'wa', w: 'qesa', e: 'wrds', r: 'etfd', t: 'rygf',
  y: 'tuhg', u: 'yijh', i: 'uokj', o: 'iplk', p: 'ol',
  a: 'qsz', s: 'awxd', d: 'sexf', f: 'drcvg', g: 'ftvbh',
  h: 'gybnj', j: 'hubmnk', k: 'jimol', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xvdf', v: 'cbfg', b: 'vghn',
  n: 'bhjm', m: 'njkl',
};

const EU_ALPHABET = 'abcdefghijklmnopqrstuvwxyzáéíóúüñçàèìòùâêîôû';

// ── Helpers ─────────────────────────────────────────

/**
 * Strip accents via NFD: á→a, ñ→n, ü→u.
 */
function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

/**
 * Check if a word has accented characters.
 */
function hasAccent(s) {
  return s.normalize('NFD') !== s; // NFD adds combining marks if accents present
}

// ── Typo rules ──────────────────────────────────────

function adjTypo(w, rng) {
  if (!w) return w;
  const chars = [...w];
  const candidates = [];
  for (let i = 0; i < chars.length; i++) {
    if (ADJ[chars[i].toLowerCase()]) candidates.push(i);
  }
  if (candidates.length === 0) return w;
  const i = candidates[Math.floor(rng() * candidates.length)];
  const c = chars[i].toLowerCase();
  const neighbours = ADJ[c];
  if (!neighbours) return w;
  let newC = neighbours[Math.floor(rng() * neighbours.length)];
  if (chars[i] === chars[i].toUpperCase() && chars[i].toLowerCase() !== chars[i]) {
    newC = newC.toUpperCase();
  }
  chars[i] = newC;
  return chars.join('');
}

function dropAccent(w, rng) {
  if (!hasAccent(w)) return w;
  return stripAccents(w);
}

function transpose(w, rng) {
  if (w.length < 3) return w;
  const i = Math.floor(rng() * (w.length - 1));
  return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
}

function insert(w, rng) {
  if (!w) return w;
  const i = Math.floor(rng() * (w.length + 1));
  const extra = EU_ALPHABET[Math.floor(rng() * EU_ALPHABET.length)];
  return w.slice(0, i) + extra + w[i];
}

function deleteChar(w, rng) {
  if (w.length <= 2) return w;
  const i = Math.floor(rng() * w.length);
  return w.slice(0, i) + w.slice(i + 1);
}

function double(w, rng) {
  if (!w) return w;
  const i = Math.floor(rng() * w.length);
  return w.slice(0, i) + w[i] + w.slice(i);
}

// ── Rule selection ──────────────────────────────────

// Per-rule weight (matches Python: adjacency dominates, accent-drop lighter
// because standard Basque uses few diacritics).
const RULES = [
  [dropAccent,  20],
  [adjTypo,     30],
  [transpose,   15],
  [deleteChar,  12],
  [insert,      11],
  [double,      12],
];

/**
 * Mulberry32 — small, fast, seedable PRNG (deterministic for reproducibility).
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a rule by weight.
 */
function pickRule(rng) {
  const total = RULES.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [rule, w] of RULES) {
    r -= w;
    if (r <= 0) return rule;
  }
  return RULES[0][0];
}

/**
 * Generate one plausible typo for `word`.
 * Returns { typo, type } or null if word is too short / non-alphabetic.
 *
 * @param {string} word   correct word
 * @param {function} rng  seedable PRNG (0..1)
 */
export function synthTypo(word, rng) {
  if (word.length < 3 || !/^[A-Za-zÀ-ÿ''\-]+$/.test(word)) return null;

  const ruleNames = ['dropAccent', 'adjTypo', 'transpose', 'delete', 'insert', 'double'];
  for (let attempt = 0; attempt < 3; attempt++) {
    const idx = RULES.findIndex((_, i) => i === RULES.findIndex(([r]) => r === pickRule(rng)));
    const ruleIdx = Math.floor(rng() * RULES.length);
    const [rule] = RULES[ruleIdx];
    const type = ruleNames[ruleIdx];
    const out = rule(word, rng);
    if (out && out !== word) {
      return { typo: out, type };
    }
  }
  return null;
}

/**
 * Generate synthetic typo sentences from a list of correct sentences.
 *
 * For each sentence, picks 1 word (length ≥ 4, alphabetic, not a proper noun
 * unless it has accents) and injects a single typo. Returns the original
 * (correct) and erroneous versions, plus metadata for evaluation.
 *
 * @param {string[]} sentences   correct Basque sentences
 * @param {number} seed          PRNG seed (deterministic)
 * @param {number} typosPerSentence  how many words to corrupt (default 1)
 * @returns {Array<{correct: string, erroneous: string, edits: Array<{word: string, typo: string, type: string}>}>}
 */
export function generateTypoSentences(sentences, seed = 42, typosPerSentence = 1) {
  const rng = mulberry32(seed);
  const results = [];

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    const eligible = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/[^A-Za-zÀ-ÿ''\-]/g, '');
      if (w.length >= 4 && /^[A-Za-zÀ-ÿ''\-]+$/.test(w)) {
        eligible.push({ index: i, word: w, raw: words[i] });
      }
    }
    if (eligible.length === 0) continue;

    // Shuffle eligible indices and pick up to typosPerSentence
    const shuffled = [...eligible].sort(() => rng() - 0.5);
    const chosen = shuffled.slice(0, Math.min(typosPerSentence, shuffled.length));

    const edits = [];
    const newWords = [...words];
    let success = false;

    for (const { index, word, raw } of chosen) {
      const result = synthTypo(word, rng);
      if (!result) continue;

      // Preserve surrounding punctuation from the original word
      const prefix = raw.match(/^[^A-Za-zÀ-ÿ''\-]*/)[0];
      const suffix = raw.match(/[^A-Za-zÀ-ÿ''\-]*$/)[0];

      // Match case of the original word
      let typo = result.typo;
      if (word[0] === word[0].toUpperCase() && word[0].toLowerCase() !== word[0]) {
        typo = typo.charAt(0).toUpperCase() + typo.slice(1);
      }

      newWords[index] = prefix + typo + suffix;
      edits.push({ word, typo, type: result.type, position: index });
      success = true;
    }

    if (success) {
      results.push({
        correct: sentence,
        erroneous: newWords.join(' '),
        edits,
      });
    }
  }

  return results;
}
