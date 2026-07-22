/**
 * Txukun — Internationalization (Basque-first, English fallback)
 */

export const i18n = {
  eu: {
    nav: {
      brand: 'Itzune',
    },
    hero: {
      subtitle: 'Euskarazko testuaren maiuskulak, puntuazioa, ortografia eta gramatika zuzentzen dituen tresna. Doakoa, pribatua — zure nabigatzailean exekutatzen da.',
    },
    features: {
      cap: 'Maiuskulak',
      punct: 'Puntuazioa',
      spell: 'Ortografia',
      grammar: 'Gramatika',
    },
    examples: {
      title: 'Adibideak — klik egin probatzeko',
    },
    input: {
      label: 'Sarrera',
      placeholder: 'Idatzi edo itsatsi euskarazko testu bat hemen...',
      clear: 'Garbitu',
    },
    output: {
      label: 'Emaitza',
      placeholder: 'Emaitza hemen agertuko da...',
      copy: 'Kopiatu',
      download: 'Deskargatu',
    },
    action: {
      correct: 'Zuzendu',
    },
    status: {
      idle: 'Eredua kargatu gabe',
      loading: 'Eredua kargatzen...',
      ready: 'Eredua prest',
      processing: 'Prozesatzen...',
      error: 'Errorea kargatzean',
    },
    corrections: {
      title: 'Zuzenketak',
    },
    about: {
      title: 'Nola dabil?',
      p1: 'Txukun-ek <strong>hiru eredu neuronal</strong> konbinatzen ditu euskal testua zuzentzeko, denak zure nabigatzailean exekutatzen direnak:',
      p2: '<strong>1. Maiuskulak eta puntuazioa</strong> — <a href="https://hitz.eus/" target="_blank" rel="noopener">HiTZ Zentroak</a> (UPV/EHU) garatutako <a href="https://huggingface.co/HiTZ/cap-punct-eu" target="_blank" rel="noopener">cap-punct-eu</a> ereduak testu gordinari maiuskulak eta puntuazioa berreskuratzen dizkio (adibidez, ahots-ezagutzatik ateratako testua txukuntzeko).',
      p3: '<strong>2. Ortografia</strong> — <a href="https://ixa.eus/" target="_blank" rel="noopener">IXA NLP Taldeak</a> (UPV/EHU) prestatutako <a href="https://huggingface.co/itzune/berteus-onnx" target="_blank" rel="noopener">BERTeus</a> ereduak hitz okerrak berriro ordenatzen ditu, testuingurua kontuan hartuta. Ez dago hiztegirik: ereduak esaldi osoa irakurtzen du erabaki hartzeko.',
      p4: '<strong>3. Gramatika</strong> — <a href="https://github.com/itzune/gector-eus" target="_blank" rel="noopener">GECToR-eus</a> ereduak (Itzune-k entrenatua, <a href="https://www.orai.eus/" target="_blank" rel="noopener">Orai/Elhuyar</a>ren datu-multzoan oinarritua) akats gramatikalak zuzentzen ditu: aditz-komunikazioa (adib. <code>dit</code> → <code>zait</code>), kasua (<code>alderdiak</code> → <code>alderdiek</code>), denbora (<code>etortzen</code> → <code>etorriko</code>) eta atzizkiak (<code>delako</code> → <code>denaren</code>).',
      p5: 'Den-dena zure nabigatzailean gertatzen da. Zure testua <strong>ez da inoiz zure gailutik ateratzen</strong>. Ereduak behin deskargatzen dira eta cachean gordetzen dira hurrengo bisitetarako.',
      p6: '⚠️ Ereduak <strong>aluzinazioak</strong> sor ditzakete — existitzen ez diren hitzak — bereziki testu labur edo arraroa sartzean. AI eredu sortzaile guztien berezko arazoa da.',
    },
    toast: {
      modelReady: 'Eredua kargatu da! Orain testua zuzendu dezakezu.',
      modelError: 'Errorea eredua kargatzean',
      noText: 'Idatzi testuren bat zuzentzeko.',
      modelNotReady: 'Eredua oraindik kargatzen ari da. Itxaron mesedez.',
      corrected: 'Testua zuzenduta!',
      noChanges: 'Ez da aldaketarik aurkitu.',
      correctError: 'Errorea testua zuzentzean',
      copied: 'Testua arbelean kopiatu da!',
      downloaded: 'Fitxategia deskargatu da!',
    },
    spell: {
      toggle: 'Auto-zuzenketa',
      toggleHint: 'Aktibatuta, akats ortografikoak automatikoki zuzentzen dira lehen iradokizunarekin. Desaktibatuta, soilik azpimarratuko dira.',
      suggestions: 'Zuzenketak',
      ignore: 'Alde batera utzi',
    },
  },
  en: {
    nav: {
      brand: 'Itzune',
    },
    hero: {
      subtitle: 'A tool that restores capitalization, punctuation, spelling and grammar in Basque text. Free, private — runs in your browser.',
    },
    features: {
      cap: 'Capitalization',
      punct: 'Punctuation',
      spell: 'Spelling',
      grammar: 'Grammar',
    },
    examples: {
      title: 'Examples — click to try',
    },
    input: {
      label: 'Input',
      placeholder: 'Type or paste Basque text here...',
      clear: 'Clear',
    },
    output: {
      label: 'Output',
      placeholder: 'Corrected text will appear here...',
      copy: 'Copy',
      download: 'Download',
    },
    action: {
      correct: 'Correct',
    },
    status: {
      idle: 'Model not loaded',
      loading: 'Loading model...',
      ready: 'Model ready',
      processing: 'Processing...',
      error: 'Error loading model',
    },
    corrections: {
      title: 'Corrections',
    },
    about: {
      title: 'How does it work?',
      p1: 'Txukun combines <strong>three neural models</strong> to correct Basque text, all running in your browser:',
      p2: '<strong>1. Capitalization & punctuation</strong> — The <a href="https://huggingface.co/HiTZ/cap-punct-eu" target="_blank" rel="noopener">cap-punct-eu</a> model by <a href="https://hitz.eus/" target="_blank" rel="noopener">HiTZ Zentroa</a> (UPV/EHU) restores capitalization and punctuation to raw text (e.g. cleaning up speech recognition output).',
      p3: '<strong>2. Spelling</strong> — The <a href="https://huggingface.co/itzune/berteus-onnx" target="_blank" rel="noopener">BERTeus</a> model by the <a href="https://ixa.eus/" target="_blank" rel="noopener">IXA NLP Group</a> (UPV/EHU) re-ranks misspelled words using full sentence context. No dictionary lookup — the model reads the whole sentence to decide.',
      p4: '<strong>3. Grammar</strong> — The <a href="https://github.com/itzune/gector-eus" target="_blank" rel="noopener">GECToR-eus</a> model (trained by Itzune on <a href="https://www.orai.eus/" target="_blank" rel="noopener">Orai/Elhuyar</a>\'s dataset) fixes real-word grammar errors: verb agreement (e.g. <code>dit</code> → <code>zait</code>), case (<code>alderdiak</code> → <code>alderdiek</code>), tense (<code>etortzen</code> → <code>etorriko</code>), and suffixes (<code>delako</code> → <code>denaren</code>).',
      p5: 'Everything happens in your browser. Your text <strong>never leaves your device</strong>. The models are downloaded once and cached for future visits.',
      p6: '⚠️ The models can produce <strong>hallucinations</strong> — made-up words — especially on short or unusual input. This is an inherent limitation of all generative AI models.',
    },
    toast: {
      modelReady: 'Model loaded! You can now correct text.',
      modelError: 'Error loading the model',
      noText: 'Please type some text to correct.',
      modelNotReady: 'Model is still loading. Please wait.',
      corrected: 'Text corrected!',
      noChanges: 'No changes found.',
      correctError: 'Error correcting text',
      copied: 'Text copied to clipboard!',
      downloaded: 'File downloaded!',
    },
    spell: {
      toggle: 'Auto-correct',
      toggleHint: 'Spelling errors are automatically corrected with the first suggestion. When disabled, errors are only underlined.',
      suggestions: 'Suggestions',
      ignore: 'Ignore',
    },
  },
};

/**
 * Get a translation string using dot-separated path.
 */
export function t(path, lang = 'eu') {
  const dict = i18n[lang] || i18n.eu;
  const keys = path.split('.');
  let value = dict;
  for (const key of keys) {
    if (value === undefined || value === null) break;
    value = value[key];
  }
  return typeof value === 'string' ? value : path;
}

/**
 * Detect user's preferred language.
 * Priority: saved preference > browser > default (eu)
 */
export function detectLanguage() {
  // Check saved preference
  const saved = localStorage.getItem('txukun-lang');
  if (saved === 'eu' || saved === 'en') return saved;

  // Check browser
  const browser = (navigator.language || navigator.userLanguage || '').toLowerCase();
  if (browser.startsWith('en')) return 'en';

  // Default: Basque
  return 'eu';
}
