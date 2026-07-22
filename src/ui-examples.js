/**
 * Txukun — Example sentences
 */

/**
 * Example sentences — from the Elhuyar/Orai GEC benchmark (Dem_single.tsv),
 * with capitalization and punctuation destroyed (lowercased, punctuation
 * stripped) so the full 3-model pipeline is demonstrated:
 *   1. MarianMT restores capitalization + punctuation
 *   2. BERTeus re-ranks spelling candidates
 *   3. GECToR fixes real-word grammar errors (verb agreement, case, tense, suffix)
 *
 * Each example was cherrypicked by running it through the live pipeline and
 * verifying the output matches the Orai dataset's gold correction.
 */
export const examplesEu = [
  // R1 (tense): etortzen → etorriko
  'karlismoaren babesa galdu ondoren jeltzaleen babesa etortzen zen',
  // R2 (verb agreement): dit → zait
  'asko gustatzen dit eta harreman ona dut sarearekin',
  // R2 (verb agreement): dizu → zaizu  (+ proper noun + question mark)
  'zer iruditzen dizu euskal herriko kultura musikala',
  // R3 (case): alderdiak → alderdiek  (+ question mark)
  'ezkerreko alderdiak nola babestu dezakete lege hau',
  // R3 (case): udaltzainak → udaltzainek  (+ proper noun)
  'eta udaltzainak beste lagun bat atzeman zuten gasteizen',
  // R4 (suffix): delako → denaren
  'nire jarduna lehen astean gertatzen delako araberakoa izango da',
];

/**
 * Render example chips in the examples grid.
 */
export function renderExamples(lang = 'eu') {
  const grid = document.getElementById('examplesGrid');
  if (!grid) return;

  const examples = examplesEu; // Same for both langs (Basque input)

  grid.innerHTML = examples.map(text => `
    <button class="example-chip" data-example="${escapeAttr(text)}" title="${escapeAttr(text)}">
      ${escapeHtml(text.length > 50 ? text.slice(0, 47) + '...' : text)}
    </button>
  `).join('');
}

/**
 * Bind click handlers to example chips.
 */
export function bindExampleClicks(callback) {
  const grid = document.getElementById('examplesGrid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    const chip = e.target.closest('.example-chip');
    if (!chip) return;
    const text = chip.dataset.example;
    if (text && callback) {
      callback(text);
    }
  });
}

// ── Helpers ─────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
