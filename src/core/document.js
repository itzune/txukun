/**
 * Txukun — Document + Tokenizer (Span-based token model)
 *
 * Minimal JS port of Harper's `Document` + `Token` + `Span` (see RESEARCH.md
 * §7.8). Text is tokenized into tokens with end-exclusive {start, end} spans;
 * rules navigate via iterSentences() and produce Lints referencing these spans.
 *
 * Token kinds:
 *   'word'        — letters + numbers (Basque accented chars via \p{L})
 *   'whitespace'  — spaces, tabs, newlines
 *   'punctuation' — any Unicode punctuation (\p{P})
 *
 * No POS tagging, no morphology — that's deferred until a rule actually
 * demands it (§7.8 decision). This is enough for phrase/token-level EBE rules.
 *
 * @module txukun/core/document
 */

// Matches: whitespace | punctuation | word (letters+numbers). Unicode-aware.
const TOKEN_RE = /(?<ws>\s+)|(?<punct>\p{P}+)|(?<word>[\p{L}\p{N}]+)/gu;

/**
 * Tokenize text into tokens with spans.
 * @param {string} text
 * @returns {Array<{start:number,end:number,kind:string,text:string}>}
 */
export function tokenize(text) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const kind = m.groups.ws ? 'whitespace' : m.groups.punct ? 'punctuation' : 'word';
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      kind,
      text: m[0],
    });
  }
  return tokens;
}

// ── Token-string navigation utilities ───────────────
// (Harper's TokenStringExt: first_non_whitespace, iter_sentences, etc.)

/** First token of kind 'word' in a token slice. */
export function firstWord(tokens) {
  for (const t of tokens) {
    if (t.kind === 'word') return t;
  }
  return null;
}

/** First non-whitespace token in a slice (skips leading whitespace). */
export function firstNonWhitespace(tokens) {
  for (const t of tokens) {
    if (t.kind !== 'whitespace') return t;
  }
  return null;
}

/** Last non-whitespace token in a slice. */
export function lastNonWhitespace(tokens) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].kind !== 'whitespace') return tokens[i];
  }
  return null;
}

/** Does this punctuation text contain a sentence-ending mark (. ? !)? */
function isSentenceEnd(punctText) {
  return /[.?!]/.test(punctText);
}

/**
 * Is a word token entirely numeric (digits)?
 *
 * Used to detect ordinal / thousands-separator periods. Per EBE Puntuazioa
 * §1.2.2 "Zenbakietakoa", a period after a digit number replaces the
 * -garren ordinal suffix (e.g. "7." = 7garren, "1993. urtean" =
 * "1993garren urtean") or acts as a thousands separator ("2.018").
 * Such a period is NOT a sentence terminator. EBE itself uses the form
 * "1927. urtearen" (ebe-punt.txt line 174).
 */
function isNumericWord(tok) {
  return tok.kind === 'word' && /^\p{N}+$/u.test(tok.text);
}

/**
 * A document: source text + tokenized tokens.
 * Provides iterSentences() for rule navigation.
 */
export class Document {
  /**
   * @param {string} text
   */
  constructor(text) {
    this.text = text;
    this.tokens = tokenize(text);
  }

  /** Get the source substring covered by a span. */
  getSpanContent(span) {
    return this.text.slice(span.start, span.end);
  }

  /**
   * Split tokens into sentences. A sentence runs from the first non-whitespace
   * token after a sentence-ending punctuation (or start of text) to the next
   * sentence-ending punctuation (inclusive), or end of text.
   *
   * For unpunctuated ASR input, the whole text is one sentence.
   * @returns {Array<Array>} array of token arrays
   */
  iterSentences() {
    const sentences = [];
    let sentStart = null;
    for (let i = 0; i < this.tokens.length; i++) {
      const tok = this.tokens[i];
      if (sentStart === null && tok.kind !== 'whitespace') {
        sentStart = i;
      }
      if (sentStart !== null && tok.kind === 'punctuation' && isSentenceEnd(tok.text)) {
        // EBE §1.2.2 "Zenbakietakoa": a period following a digit number is
        // an ordinal marker ("1993. urtean" = 1993garren urtean) or a
        // thousands separator ("2.018"), NOT a sentence terminator. Skip
        // the split so the following word is not treated as sentence-initial.
        if (/\./.test(tok.text) && i > 0 && isNumericWord(this.tokens[i - 1])) {
          continue;
        }
        sentences.push(this.tokens.slice(sentStart, i + 1));
        sentStart = null;
      }
    }
    if (sentStart !== null) {
      sentences.push(this.tokens.slice(sentStart));
    }
    return sentences;
  }
}
