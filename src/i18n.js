/**
 * Txukun — Internationalization (Basque-first, English fallback)
 */

export const i18n = {
  eu: {
    nav: {
      brand: 'Itzune',
    },
    hero: {
      subtitle: 'Euskarazko testuaren maiuskulak, puntuazioa eta ortografia zuzentzen dituen tresna. Doakoa, pribatua — zure nabigatzailean exekutatzen da.',
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
      p1: 'Txukun-ek <a href="https://hitz.eus/" target="_blank" rel="noopener">HiTZ Zentroak</a> (UPV/EHU) garatutako <a href="https://huggingface.co/HiTZ/cap-punct-eu" target="_blank" rel="noopener">cap-punct-eu</a> adimen artifizialeko eredua erabiltzen du. Eredu hau 9.78 milioi euskarazko esaldirekin entrenatu da eta testuaren maiuskulak eta puntuazioa berreskuratzen ditu — adibidez, ahots-ezagutzatik ateratako testu gordina txukuntzeko.',
      p2: 'Den-dena zure nabigatzailean gertatzen da. Zure testua <strong>ez da inoiz zure gailutik ateratzen</strong>. Eredua behin deskargatzen da eta cachean gordetzen da hurrengo bisitetarako.',
      p3: '⚠️ Ereduak <strong>aluzinazioak</strong> sor ditzake — existitzen ez diren hitzak — bereziki testu labur edo arraroa sartzean. AI eredu sortzaile guztien berezko arazoa da. <strong>Auto-zuzenketa ez da AI bidezkoa</strong>: 160.000 hitzeko hiztegi estatiko bat eta Levenshtein distantzia erabiltzen ditu, ez machine learning edo LLM teknologiak.',
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
      subtitle: 'A tool that restores capitalization, punctuation and corrects spelling in Basque text. Free, private — runs in your browser.',
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
      p1: 'Txukun uses the <a href="https://huggingface.co/HiTZ/cap-punct-eu" target="_blank" rel="noopener">cap-punct-eu</a> AI model developed by <a href="https://hitz.eus/" target="_blank" rel="noopener">HiTZ Zentroa</a> (UPV/EHU). The model was trained on 9.78 million Basque sentences and restores capitalization and punctuation — for example, to clean up raw text from speech recognition.',
      p2: 'Everything happens in your browser. Your text <strong>never leaves your device</strong>. The model is downloaded once and cached for future visits.',
      p3: '⚠️ The model can produce <strong>hallucinations</strong> — made-up words — especially on short or unusual input. This is an inherent limitation of all generative AI models. <strong>Auto-correct is not AI-based</strong>: it uses a static 160k-word dictionary and Levenshtein distance, not machine learning or LLM technology.',
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
