/**
 * Txukun — Example sentences
 */

export const examplesEu = [
  'kaixo egun on guztioi',
  'faktoria e i te beko irratian entzuten da',
  'gutxi gora behera ehuneko berrogeita bikoa',
  'nire jaio urtea mila bederatziehun eta laurogeita hamasei da',
  'informazio gehiago hitz puntu e hatxe u puntu eus web horrian',
  'euskal herrian euskaraz bizi nahi dugu',
  'atzoko bileran erabaki garrantzitsuak hartu genituen',
  'astelehenean zortziretan geratuko gara plazan',
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
