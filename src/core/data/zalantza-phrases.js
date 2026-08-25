/**
 * Txukun — Zalantza esapideak data (EBE *Zalantza eragiten duten zenbait hitz*)
 *
 * Multi-token (phrase-level) dispreferred → recommended pairs from Euskaltzaindia's
 * EBE appendix (PDF pp. 479–490). These are RED forms that span multiple tokens
 * (spaces and/or hyphens) and thus cannot be matched by the single-word
 * zalantza-words rule (which checks one 'word' token at a time).
 *
 * Two sources, merged here:
 *   - 33 explicit multi-word phrases (§7.13 v6 extractor):
 *     e.g. 'aire-garraio' → 'aireko garraio', 'kontutan hartu' → 'kontuan hartu'
 *   - 19 hyphenated compounds reclassified from zalantza.js:
 *     single-source-text units that orthographically contain a hyphen, so the
 *     tokenizer splits them into [word, '-', word]. The single-word rule could
 *     never match these (it checks single 'word' tokens only). e.g.
 *     'gora-behera' → 'gorabehera', 'ipar-izar' → 'iparrizar'
 *
 * Matching: the phrase rule tokenizes each RED, keeps non-whitespace tokens
 * (words + punctuation), and slides a window over the document's non-whitespace
 * tokens. Words match case-insensitively; punctuation matches exactly. Case is
 * preserved from the first word token via matchCase().
 *
 * Validation (see /tmp/validate_phrases.mjs + /tmp/check_overlaps.mjs):
 *   - 0 duplicates, 0 within-phrase chains, 0 cross-rule conflicts
 *   - 1 overlap (gora-behera ⊂ gutxi gora-behera) — converges to same output ✓
 *   - 0 divergent overlaps
 *
 * Source: https://www.euskaltzaindia.eus/components/com_ebe/pdf/EBE-eranskinak.pdf
 *
 * @module txukun/core/data/zalantza-phrases
 */

export const ZALANTZA_PHRASES = Object.freeze([
  { red: 'agi denez', bold: 'agidanez' },
  { red: 'agi zenez', bold: 'agidanez' },
  { red: 'aingeru zaindari', bold: 'aingeru zaintzaile' },
  { red: 'aire egokitu', bold: 'aire girotu' },
  { red: 'aire-bidaia', bold: 'aireko bidaia' },
  { red: 'aire-garraio', bold: 'aireko garraio' },
  { red: 'aiton-amonak', bold: 'aitona-amonak' },
  { red: 'amona mantalgorri', bold: 'amona mantangorri' },
  { red: 'anaia-arrebak', bold: 'anai-arrebak' },
  { red: 'asper egin', bold: 'asper-asper egin' },
  { red: 'autonomi elkarte', bold: 'autonomia-elkarte' },
  { red: 'bana-bana', bold: 'banan-banan' },
  { red: 'banan banan', bold: 'banan-banan' },
  { red: 'banan-bana', bold: 'banan-banan' },
  { red: 'banan-banako', bold: 'bana-banako' },
  { red: 'bataz beste', bold: 'batez beste' },
  { red: 'bertso-paper', bold: 'bertsopaper' },
  { red: 'bideo-kasete', bold: 'bideokasete' },
  { red: 'bideo-zinta', bold: 'bideokasete' },
  { red: 'bizkar-hezur', bold: 'bizkarrezur' },
  { red: 'bular-angina', bold: 'bularreko angina' },
  { red: 'elektro-tresna', bold: 'tresna elektriko' },
  { red: 'erakus-leiho', bold: 'erakusleiho' },
  { red: 'erakus-mahai', bold: 'erakusmahai' },
  { red: 'eskrezio-aparatu', bold: 'iraitzaparatu' },
  { red: 'etxeko andre', bold: 'etxekoandre' },
  { red: 'euskaldun-berri', bold: 'euskaldun berri' },
  { red: 'gaur eguneko', bold: 'gaur egungo' },
  { red: 'gora-behera', bold: 'gorabehera' },
  { red: 'gutxi gora-behera', bold: 'gutxi gorabehera' },
  { red: 'haize egokitu', bold: 'aire girotu' },
  { red: 'haize girotu', bold: 'aire girotu' },
  { red: 'harri bitxi', bold: 'harribitxi' },
  { red: 'harridura-ikur', bold: 'harridura-marka' },
  { red: 'hortz-artatzaile', bold: 'aho-artatzaile' },
  { red: 'hortz-ore', bold: 'hortzetako pasta' },
  { red: 'hurrena arte', bold: 'hurren arte' },
  { red: 'ikus-entzutezko', bold: 'ikus-entzunezko' },
  { red: 'ipar ekialde', bold: 'ipar-ekialde' },
  { red: 'ipar-izar', bold: 'iparrizar' },
  { red: 'ipar-orratz', bold: 'iparrorratz' },
  { red: 'itsas korronte', bold: 'itsaslaster' },
  { red: 'itsas-zain', bold: 'itsasozain' },
  { red: 'kanpaina-denda', bold: 'kanpadenda' },
  { red: 'kapaza izan', bold: 'kapaz izan' },
  { red: 'kontutan hartu', bold: 'kontuan hartu' },
  { red: 'kosta ala kosta', bold: 'kosta ahala kosta' },
  { red: 'labe handi', bold: 'labe garai' },
  { red: 'merkatal zentro', bold: 'merkataritza-zentro' },
  { red: 'odol-baso', bold: 'odol-hodi' },
  { red: 'saski-baloi', bold: 'saskibaloi' },
  { red: 'te-ontzi', bold: 'teontzi' },
]);

// 52 phrase pairs (33 from §7.13 TSV + 19 reclassified from zalantza.js).
