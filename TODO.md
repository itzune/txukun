# TODO — txukun

> Lehentasun-antolaketa berrantolatua (P0–P4). Ikus `RESEARCH.md` §7.5 (Harper arkitektura)
> eta §7.6 (2026 field survey) xehetasun teknikoenetarako.
>
> Printzipio zuzentzaileak: **(1) proiektua desblokeatu ML ezagutzarik gabe,
> (2) balio bisuala goiztiarra, (3) pauso bakoitzak hurrengoa ahalbidetzen du.**
>
> Laburbilduta: **Neurtu → Arauak → Neural-fallback → Banatu → Ereduak.**

---

## 🔴 P0 — Konpondu apurtuta dagoena lehenbizi (edozein ezaugarri berriaren aurretik)

> P0ren helburua: oinarri fidagarri bat izatea. Beste guztia horren gainean eraikitzen da.
> Proiektua pausatuta dagoen arren, P0 ML jakintzarik gabe egin daiteke.

### P0.1 — Xuxen/Hunspell akats ezagunak konpondu

Jatorria: `XUXEN_ISSUES.md` eta `ISSUE_LOG.md`.

- [ ] **`batzutan` → `batzuetan` iradokizun okerra** (`XUXEN_ISSUES.md` §1)
  - Hunspellek `batsutan` iradokitzen du `batzuetan` beharrean (hitzak karaktere batean desberdindu arren)
  - Aztertu arranketa-arazoa: `batzuetan` hiztegian badago (`*` = zuzena) baina ez da hurbilekotzat jo
  - Aukera: gehitu hitz-zerrendako fallback batean rank esplizitua (`eu-words.txt` + maiztasuna) Hunspell-en suggest emaitzak berrordenatzeko
  - Aukera: ezarri `batzuetan` bezalako kasu ezagunak errebide gisa (`corrections-overrides.json`) automatikoki aplikatzeko
- [ ] **Hunspell 1.7.3 `spell()` erregresioa** (`ISSUE_LOG.md`)
  - `hunspell_spell()` `0` itzultzen du hitz guztietarako WASM 1.7.3 bertsioan (sistema 1.7.0 balio du)
  - **Eragiketa nagusia:** eraiki Hunspell 1.7.0 wasi-sdk-ekin (API bera, ziurrenik `spell()` zuzena). Probatu. Badabil bada, 1.7.3 ordez 1.7.0 banatu.
  - Bitarteko workaround-a (dagoeneko zabaldua): `spell()` faltsua → `suggest()` fallback-a lehen iradokizuna hitzarekin bat badator
  - Ebaluatu workaround-aren abiadura real-time erabilerarako (orain pause/blur-ean exekutatzen da; teklatu-mailakoa motelegia izan daiteke)
- [ ] **Hiztegi-estaldurako hutsuneak (~30k hitz)** (`XUXEN_ISSUES.md` §3)
  - `eu-words.txt` `Set` gisa kargatzen da O(1) egiaztapenerako Hunspell baino lehen — dagoeneko zabaldua
  - Berrikusi estaldura: exekutatu korpus ezagun bat (`tests/gec-benchmark/elhuyar/*.tsv`) hiztegitik kanpoko hitzen gainean eta neurtu false-positive tasa

### P0.2 — Balidazio/regresio harness-a (neurgarritasuna)

> Proiektuaren arrazoi nagusietako bat pausatuta egotea: **ezin da neurtu** eredu-aldaketek laguntzen duten.
> Harness merkeena arazo hori konpontzen du — eta etorkizuneko lan guztiarentzako regresio-suitea bihurtzen da.

**Egoera aktuala:** `tests/gec-benchmark/eval-tier1.mjs` badago baina ortografia-ebaluaziorako soilik (Elhuyar GEC benchmark-a). Ez dago maiuskulak/puntuazioa erregresio-suit erregistraturik.

- [x] **Cap-punct golden suite-a** — sortu `tests/cap-punct/cases.json`:
  - 50–100 esaldi basque finko, input (minuskulaz, puntuaziorik gabe) → expected output (maiuskulak + puntuazio zuzena)
  - Iturriak: `RESEARCH.md`-eko ereduen adibideak, ASR benetako irteerak, esaldi linguistikoki anitzak (deklariboak, galdetzekoak, luzeak, laburrak, izen bereziak)
  - Egitara proposatua: `[{ "id": "c001", "input": "kaixo ni miren naiz", "expected": "Kaixo, ni Miren naiz." }, ...]`
  - Markatu kasu ezagun zailak: izen bereziak (`Miren`, `Euskadi`), zenbakiak, URLak, elkarrizketa-markak
  - **EBEan oinarritu `expected` irteerak** (ikus `RESEARCH.md` §7.7): maiuskulak ez dira ingeles/gaztelania bezalakoak — egunak/hilabeteak/nazionalitateak minuskulaz (`astelehena`, `urtarrila`, `euskal`); izen bereziak, jaiegunak (`Aste Santua`) eta astro leku-izenak (`Lurra`, `Eguzkia`) maiuskulaz; erakundeak partzialki (`Donostiako Udala` baina `udaletan`). Puntuazioa EBE *Puntuazio-markak* atalaren araberakoa (`docs/ebe-reference/ebe-punt.txt`)
  - **Eginda:** 33 kasu, 22 strict, 11 kategoria. Ikus `tests/cap-punct/cases.json` eta `tests/cap-punct/README.md`
- [x] **Cap-punct eval script-a** — `tests/cap-punct/eval.mjs`:
  - Kargatu eredua (Transformers.js, ONNX), exekutatu kasu guztiak, konparatu output-a `expected`-ekin
  - Metrikak: karakter mailako zer exact-match %, segmentu-mailakoa, token-mailako difueta (Levenshtein normalizatua)
  - Erreportea stdout-era + `tests/cap-punct/results-<commit>.json` (historikoa gordetzeko)
  - `npm test:cap-punct` script-a gehitu `package.json`-era
  - **Eginda:** RAW + CONSTRAINED metrika bikoitza, per-kategoria banaketa, RAW≠CONSTRAINED dibergentzia-txostena (constrainCapPunct-ek baztertutako normalizazioak erakusteko). Bandkerak: `--check`/`--category`/`--limit`/`--no-constrain`/`TXUKUN_DTYPE`. Script-ak: `test:cap-punct`, `test:cap-punct:check`, `test:spell`, `test`
- [x] **Baseline-a neurtu eta erregistratu** — `tests/cap-punct/BASELINE.md`:
  - **Eginda (2026-08-25):** q8 = fp32 = **18/22 (81.8%)** strict. Quantizazioa galeragabea (Finding 1); ~82%-eko sabaila modelarena (Finding 2). 5 hutsegite-talde identifikatu (F1–F5), bakoitza P1 arau zehatz batera mapatuta. Ikus `tests/cap-punct/BASELINE.md`
- [ ] **Ortografia-harnessa zabaldu** — hedatu `eval-tier1.mjs` dagoeneko dagoen `batzutan→batzuetan` klaseko kasuak sartzeko (Xuxen ezagunak regressio gisa)
- [ ] **CI-a (aukerakoa baina gomendatua):** GitHub Actions workflow bat `npm test` exekutatzeko PR bakoitzeko. Ez du eredurik behar ortografia-rako; cap-punct-erako cache-a erabil dezake (HuggingFace cache).
- [ ] **Xuxen issue-ak regressio gisa erregistratu:** `batzutan→batzuetan`, `entzuten` (estaldura), `etxe` (`spell()` false-negative) — test egiaztapen gisa gehitu P0.1 konpondu ondoren

### P0.3 — Kode-kontzentrazioa / zaborra garbitu (kalitate funtsa)

- [x] **Special-token cleanup-a kontzentratu** — `src/models.js:255`-eko `.replace()` katea hiru tokitan zeharka da. Eraiki funtzio bakar bat (`cleanModelOutput(text)` `src/core/`-n, gerora Phase A-k berrerabiliko duena) eta deitu toki guztietatik. Gehitu `.replace(/<s>/g,'')` kasuak eta trinketu `\s{2,}` dagoeneko dago.
- [x] **Erabili gabeko menpekotasunak kendu:** `hunspell-asm`, `nspell` `package.json`-etik (`ISSUE_LOG.md`-en "Low priority" gisa zerrendatuta)
- [x] **`SPELL_DEBUG_LOG.md` eta `HUNSPELL_*.md` artxibatu** `docs/` azpikarpetan erro-era, eta README-n erreferentziatu. (Balio historikoa dute baina erroa nahasten dute.)

---

## 🟠 P1 — Phase A "Txukun Lite": arau-motorra (JS hutsa, eredu gabe)

> Ikusi `RESEARCH.md` §7.5 (arkitektura) eta §7.8 (implementazio-mailako diseinu-irakurketa). Banatzen duen balioa ereduak pausatuta egon arkin.
> Beraren kabuz funtzionatzen du; <10 ms; Grammarly eta 2026 ikerketak balidatutako konfiantza-mailakako banaketa.
>
> **§7.8-ko diseinu-erabakia (2026-08-25):** Harper-en `ExprLinter`/`Expr` combinator-DSL-a **saltatu** batch 1-erako (YAGNI: DSL bat ≥50 arauk ordaintzen du; guk 5–10 dauzkagu). Arau bat funtzio bat besterik ez da. Engine-a 4 fitxategi txiki dira, ez 4 sistema. Lehen araua (`sentenceInitialCap`) ~15 lerrokoa da eta 3 hutsegite zorrotz (c001, c024, c043) konpontzen ditu — headline 81.8%→~95% jaso.
>
> **Emaitza (2026-08-25):** 3 arauek (sentence-initial-cap + terminal-punct + vocative-comma) strict headline **81.8% → 100%** (22/22) jaso dute, zero erregresiorekin. 4 zorrotz-kasu konponduta (c001, c024, c043, c080). Eredua produzio-pipelinean txertatuta (`src/models.js`).

- [x] **`src/core/types.js`** — Harper-en `Lint` + `Suggestion` + `LintKind` datu-eredua (~30 lerro). Edit vocabularioa 3 aldaera: `replaceWith`/`insertAfter`/`remove`. `LintKind` EBE kategorietara mapatu (Calque, Confusable, Capitalization, Punctuation)
- [x] **`src/core/document.js`** — Harper-en `Document`+`Token`+`Span` erreplika minimoa: `tokenize(text) → [{start,end,kind,text}]` (~60 lerro). End-exclusive spans; `iterSentences()`/`firstNonWhitespace()` navigation
- [x] **`src/core/engine.js`** — `Linter` trait + iterative apply: `runRules(text, rules) → {corrected, lints}` (~50 lerro). Apply one suggestion → re-tokenize → re-lint (offset-shift-ariketagabea, Harper `weir/mod.rs`-en eredu)
- [x] **`src/core/rules/sentence-initial-cap.js`** — Lehen araua: segmentu bakoitzaren lehen karaktere alfabetikoa maiuskulaz. EBE Maiuskulak §1.1. **Salbuespenik ez batch 1-erako** (euskarak ez ditu `npm`/`mRNA`-estiloko minuskula-izen bereziak; esaldi-hasieran beti maiuskula). Helburua: c001, c024, c043 zorrotz-kasuak konpondu
- [x] **`src/core/rules/terminal-punct.js`** — Amaierako puntuazioa: deklaribo→`.`, galdera-pronominak→`?`, agur harridurazkoak→`!` (batch 3). `.`→`!` ordezkapena ere bai (c060). EBE Puntuazio-markak §1, §2.3, §6
- [x] **`src/core/rules/vocative-comma.js`** — Bokatiboa: agurra/eskerra (kaixo, agur, gabon) + hitza → koma. Hitz anitzeko esapideak ere (eskerrik asko, egun on). EBE koma §3. Batch 3: hitz anitzeko esapide-detekzioa
- [x] **`src/core/rules/asr-artifacts.js`** — ASR artifactuak (`<unk>`, `<pad>` etab.) — P0.3-ko `cleanModelOutput` berrerabili (jada `src/core/clean-output.js`-en dago)
- [x] **`src/core/rules/index.js`** — Rule registry: `allRules = [sentenceBoundary, sentenceInitialCap, vocativeComma, terminalPunct]`
- [x] **`src/core/rules/sentence-boundary.js`** — F4: AUX + temporal adberbioa + bigarren AUX → puntua (RESEARCH.md §7.9). Second-AUX guard-ak saihestu post-positioned temporal false-positiveak ("etorri naiz gaur"). c070 konpontzen du; c071 ez du split-ten (alborakuntza = esaldi bakarra, EBE §1)
- [x] **`src/core/rules/greetings.js`** — Agur-/esker-esapideen datuak (shared data module): EXCLAMATORY_GREETINGS, EXCLAMATORY_PHRASES, DECLARATIVE_PHRASES. RESEARCH.md §7.10
- [x] **`tests/core/rule-engine.test.mjs`** — 41 unit test (instant, eredu gabe): tokenizer, iterSentences, 4 arauak, F1 simulazioak, F2 hitz anitzeko esapideak + `.`→`!` ordezkapena, F4 split + false-positive guard-ak, regression guard, idempotency
- [x] **Produkzio-integrazioa** — `src/models.js:correctCapPunct`-en rule engine txertatuta. Eredua kargatu gabean ere arauak funtzionatzen du ("Txukun Lite" modua)
- [x] **Txukun Lite UI zuzenketa** — `src/analyze.js:detectCapPunctErrors`-en `if (!isModelReady()) return` goiztiarra kenduta. Aurretik eredu gabeZERO arau-zuzenketa agertzen zen kartetan; orain arauak (koma, maiuskula, puntuazioa) kartetan agertzen dira eredua kargatu aurretik/gabe. `src/core/diff.js` sortuta (diffWords + isCasePunctOnly — Node-testagarria). `tests/core/txukun-lite.test.mjs` (18 test)
- [x] **Eval integrazioa** — `tests/cap-punct/eval.mjs`-en RULED metrika gehituta (RAW / CONSTRAINED / RULED). `--no-rules` flag-a
- [x] **c071 golden kasua zuzenduta** — Ikerketak (§7.9) erakutsi zuen jatorrizko periodak-esperantza EBE-ren aurkakoa zela: alborakuntza (asyndetic coordination) esaldi bakarra da komekin (EBE puntuazioa §1 oina). Expected komak bertsiora aldatuta
- [ ] **`src/core/rules/` EBE oinarritutako arauak — HELBURU NAGUSIA (idazle orokorra)** — batch 3+, iturria: `docs/ebe-reference/` eta `RESEARCH.md` §7.7, §7.11. Arau hauek ASR artefaktuak ez dira; edozein euskaldun idazlek egiten dituen akatsak dira (gaztelania/frantsesetik eratorriak). Txukun-ek Grammarly-moduko tresna orokor gisa duen posizioa sendotzen dute:
- [x] *Zalantza-hitzak* (`ebe-zal.txt`) — **batch 1 EGINDA (2026-08-26)**: 628 hitz bakuneko ordezkapen determinista (`abots→ahots`, `aborto→abortu`, `amapola→mitxoleta`). EBE PDFetik erauzita kolore-analisiz (RED=zaharkitua, BOLD=estandarra); ikus `RESEARCH.md` §7.12. **Ez 30-50, 628 sarrera** (hitz bakuneko garbiak; multi-hitza batch 2a-ra atzeratuta). Fitxategiak: `src/core/data/zalantza.js` (datuak, orain 739 sarrera batch 2a-rekin), `src/core/rules/zalantza-words.js` (araua, kasua mantentzen du), `tests/core/zalantza.test.mjs` (49 test). Egiaztapenak: 0 idempotentzia-overlap, 0 konposatu-fragamentu-leak, `gara` aditza baztertuta
    - [ ] *Zalantza multi-hitza* — **batch 2a (ikerketa EGINDA, inplementazio partziala)**: ikus `RESEARCH.md` §7.13. Batch 1-eko `final_extract.py`-ren komak-botatze bug-ak **~116 sarrera galdu** zituen (adib. `jatsi→jaitsi`, `eskubi→eskuin`, `rugby→errugbi`). v6 extraktoreak (pdfplumber kolore-analisia + EBE sarreren egitura-gramatika) birrobagarria da (`docs/ebe-reference/extract-zalantza.py`). Datu-fitxategiak `docs/ebe-reference/`-n:
      - [x] `zalantza-new-singles.tsv` (93 bikote → `zalantza.js`-ra gehituta, kode-aldaketarik gabe). `gara` baztertuta (polisemikoa: geltokia vs 'gara'; 92 gehituta)
      - [x] `zalantza-type-c.tsv` (19 bikote: hitza→esapidea, adib. `abioneta→hegazkin txiki` → `zalantza.js`-ra, `matchCase()`-k jada maneiatzen ditu multi-word helburuak)
      - [x] `zalantza-phrases.tsv` (33 multi-token RED bikote → **EGINDA**: `zalantza-phrases.js` + sliding-window token matching, priority 46). 2 bikotek helburu trunkatua dute (eskuz zuzenduta). Phase 2 EGINDA
      - [ ] `zalantza-proper.tsv` (35 izen berezi → F5 gazetteer)
      - [ ] `zalantza-ambiguous.tsv` (6 anbiguo → batch 3+)
      - **Idempotentzia**: 0 kate-arrisku (X→Y→Z), 0 cross-chain batch 1-ekin, 0 aditzi-kolisio berri ✓ (validazio-scripta: `/tmp/validate_batch2a.mjs`)
      - **Inplementazio-plana**: (1) ~~fasea: 112 sarrera `zalantza.js`-ra~~ **EGINDA** — 111 gehituta (`gara` baztertuta), gero 19 marratxodun birkalifikatuta → 720 final; (2) ~~fasea: `zalantza-phrases.js` arau berria~~ **EGINDA** — priority 46, 52 sarrera (33 TSV + 19 birkalifikatuta), 39 test; (3) fasea: 35 izen berezi F5-era, 6 anbiguo atzeratu
    - [x] *Kalko lexiko-semantikoak* (`ebe-kal.txt` §1) — **batch 2b EGINDA (2026-01-29)**: EBE §1-k 34 sarrera ditu; 8 garbiak (hitza/esapide ordezkapena). Horietatik 4 (`belgiar`, `europear`, `egipziar`, `erabakior`) jada `zalantza.js`-n daude (bi EBE ataletan agertzen dira — helburu berdinak). **4 sarrera berri gehituta**: 2 hitz (`balore→balio`, `erasokor→erasotzaile`) + 2 esapide (`pena merezi→merezi`, `zentzu bakarreko→noranzko bakarreko`). 26 sarrera atzeratuta (9 esaldi-maila, 6 testuinguru-mendeko, 5 multi-helburu, 3 morfologiko, 1 izen berezi, 1 zalantzazkoa, 1 erabilera-oharra). Fitxategiak: `src/core/data/calque.js`, `src/core/rules/calque.js` (priority 47/48, `LintKind.Calque`, hitz + esapide matcher konbinatua), `tests/core/calque.test.mjs` (41 test). Egiaztapenak: 0 overlap zalantzarekin, 0 kate-arrisku, 0 no-op, 0 regressio. Ikus `RESEARCH.md` §7.15
    - [ ] *Kalko morfosintaktikoak* (`ebe-kal.txt`) — **batch 3 (zailena)**: `*Nekatuta naiz→Nekatuta nago`, `*Aspertu naiz, joaten gara?→Joango gara?`, pasibo okerrak (`*Poliziagatik atxilotua izan zen→Poliziak atxilotu zuen`), `ere` lokailuaren posizioa (`*Ere daude→...ere badaude`). Hauek testuingurua/morfologia behar dute — baliteke POS tokenizer atzeratuagoa behar izatea
    - [ ] *Maiuskulak semantikoak* (F5) — erakundeak (`Euskal Herriko Unibertsitatea`), astro leku-izenak (`Lurra`, `Eguzkia`). **Gazetteer-a behar du** (`src/core/dictionary.js`-en izen-zerrenda). c091, c095 konpontzen ditu; c096 (ereduak gehiegi maiuskulatzen du) des-maiuskulatze arriskutsua da — atzeratu
- [x] **`src/core/data/zalantza.js`** — 720 sarrerako (single-token) zalantza-hiztegia EGINDA (P1 batch 1: 628 + batch 2a Phase 1: 92). 19 gako marratxodun birkalifikatuta `zalantza-phrases.js`-ra (Phase 2). Izen berezien gazetteer-a (F5) oraindik atzeratuta dago — `src/core/dictionary.js` izen berezietarako sortu F5-rekin batera
- [x] **`src/core/data/zalantza-phrases.js`** — 52 sarrerako (multi-token) zalantza-esapide-hiztegia EGINDA (P1 batch 2a Phase 2: 33 TSV + 19 birkalifikatuta). Araua: `src/core/rules/zalantza-phrases.js` (priority 46, sliding-window token matching)
- [x] **`src/core/data/calque.js`** — 4 sarrerako (2 hitz + 2 esapide) kalko lexiko-semantiko hiztegia EGINDA (P1 batch 2b). EBE §1-eko 34 sarreretatik 8 garbiak; 4 jada zalantza.js-n (belgiar/europear/egipziar/erabakior). Araua: `src/core/rules/calque.js` (priority 47/48, `LintKind.Calque`)
- [ ] **EBE arauen eval-estrategia** (ikus §7.11 ikerketa): Elhuyar GEC benchmark-ak (R1-R4 akats motak: aditz-denbora, kasu-kidetasuna, determinatzailea, lokailua) **ez ditu kalko/zalantza akatsik** — hauek morfologia sintetikoa dira, ez aukeraketa lexikala. Beraz: (1) zalantza/kalko lexikoak unit-testen bidez ebaluatu ebe-zal.txt/ebe-kal.txt bikoteen kontra (EBE bera da golden set-a); (2) kalko morfosintaktikoak esaldi-testuingurua behar dute → sortu `tests/ebe-rules/cases.json` 10-15 esaldiko suite txikia (EBEren adibideetatik erauzita)
- [ ] Edit-distance fuzzy iradokizunak spell-checkerarako
- [ ] **(Atzeratuta) `src/core/expr.js`** — Pattern combinator liburutegia (`seq`, `word`, `anyOf`, `optional`). **EZ egin ≥50 arau daudenera arte** — §7.8-ko erabakia. Oraingoz arau bakoitza funtzio inperatibo bat da
- [ ] **(Atzeratuta) `src/core/tokenizer.js` POS-rekin** — Harper-ren Brill POS tagger ez da beharrezkoa EBE zalantza/kalko lexikoetarako. **Beharrezkoa izango da kalko morfosintaktikoetarako** (batch 3: `*Nekatuta naiz` detektatzeko POS/izena behar da). Gehitu orduan

### ASR modua (atzeratuta, aukerakoa) — F3 normalizazioa

> **Ez da errepide-nagusia.** F3 akatsak (`e i te be→EiTB`, `ehuneko berrogeita bikoa→%42`, `hitz puntu e hatxe u→hitz.ehu.eus`) **ASR irteeran soilik** agertzen dira — inork ez ditu eskuz idazten. Hauek txukun-en nukleo-pipelinean txertatzeak tresna ASR-garbitzaile batera itzuliko luke, v2.0.0-k duen Grammarly-moduko posizio orokorrari kontra eginez.

> Aukeran, etorkizunean ASR modua izan liteke (toggle bat, `?asr=1` URL parametroa, spell togglearen antzera) — erabiltzaileak ASR irteera itsasten duenean aktibatzen du. Baina ez da lehentasuna.

- [ ] **(Atzeratuta) F3 ASR normalizazioa** — `constrainCapPunct`-en politika: baimendu legetimak diren ASR normalizazioak (akronimo hedapena `EiTB`, ehuneko sinboloa `%42`, URL berreraiketa). c081, c082, c083 konpontzen ditu. Helmuga: all-case 81.8%→90.9%. **Arriskua**: ASR-niche bihurtzen du; orokorreko idazlearentzat ez du baliorik. ASR toggle baten atzean gorde

---

## 🟡 P2 — Neural fallback geruza

> Eredua berriro integratu, baina arau-motorrak aintzat hartzen ez dituen span-etara mugatuta.

- [ ] MarianMT restorezailea flagged span-etara mugatu (arauak nahiko denean, modelorik ez exekutatu)
- [ ] Validatzailea: hiztegitik kanpoko hitzak sortzen dituzten eredu-zuzenketa baztertu
- [ ] Konfiantza-bideraketa: arauak = zuzenketa isila; neural = iradokizun-txartela
- [ ] Konfiantza-mailatan banatutako iradokizun-txartelak: "akatsa" vs "hobe izan liteke" (Grammarly-ren correctness/clarity bereizketa)
- [ ] **Berria estilo-iradokizunak** (ikus `RESEARCH.md` §7.14): etorkizuneko "style suggestions" geruzarako materiala. **Murrizketa gogorrak** — Berriaren Estilo Liburua all-rights-reserved da (CC-rik ez), eta bere zalantza `*` markak editorialak dira ez normatiboak ("estilo-liburua, ez gramatika-liburua"). Beraz: (1) **ezin da Berrian oinarritutako datu-base eratorria masiboki banatu**; (2) baliozkoa da soilik **eskuzko curazio txikia** (20-30 sarrera handi, atribuituta `source: "Berria (consulted)"`, `LintKind.Style` etiketarekin, baztergarriak); (3) Berria **garapen-erreferentzia** gisa beti baliozkoa da (EBEtik eratorritako arauak gurutzatzeko). F5 gazetteer-erako iturriak EBE/Euskaltzaindiara bideratu, ez Berriara

---

## 🟢 P3 — Trust & banaketa ezaugarriak

- [ ] Iradokizunak azaldu: zuzenketa bakoitzaren arrazoi laburra (XGEC ideia) — konfiantza + ikasteko balioa
- [ ] ASR pipeline integrazioa: Parakeet-eu/Whisper → Txukun API/bookmarklet (Grammarly-k ukitu ezin duen nichoa)
- [ ] Nabigatzaile-luzapen prototipoa (Harper-ren eredua jarraituz)
- [ ] Live/debounced analysis P1-ko arau-geruza azkarra dagoenean (orain `Beste aukerak` atalean)
- [ ] Aukeran: LSP zerbitzua

---

## 🔵 P4 — Eredu-hobekuntza (ahalmena/datuak daudenean soilik)

- [ ] Datu sintetikoekin fine-tuning errezeta (BEA 2026 irabazle-errezetak): errore-sintesi kontrolatua + eredu txikiagoak. **Erroreak EBEren *kalkoetan* oinarritu** (`docs/ebe-reference/ebe-kal.txt`), ez egiaztatu gabeko espekulazioetan (adib. `gector-eus/TODO.md`-eko `onek→honek`/`hau→au` ez daude EBEk baieztatuta — ikus `RESEARCH.md` §7.7).
- [ ] M2M100 klaseko multilingual backbone-a ebaluatutu MarianMT platoegiten badu (LoResLM 2026: MT-based GEC da onena baliabide gutxiko hizkuntzetan)
- [ ] N-gram naturalness geruza: euskarako publiko-corpusetatik sortutako trigram/4-gram egiaztatzaile arina, arauen eta eredu neuronalaren artean (LanguageTool-en n-gram rules ereduan)
- [ ] Arau-autoreentzako web UI sinplea (LanguageTool eredua), komunitateari arauak gehitzen uzteko kode idatzi gabe

### P4 — Aditu-kontsulta (2026-08): arkitektura neuronalaren berrantolaketa

> Kanpoko aditu baten kontsulta batek 8 gomendio eman zituen 3-ereduko pipelinearen
> emaitzetan oinarrituta: **220 kasuko ebaluazioan %45.5 orokorra**; ortografia
> gain-zuzenketak gain-zuzenketa guztien **%75** dira (Hunspell da erro-kausa:
> ezezagun guztia markatzen du); errore errealak **%10** (Elhuyar datuek zero
> errore-erreal adibide); missing/extra hitzak **%0**; esaldi multi-akats **%20**.
> Jatorrizko kontsulta-dokumentua ez da repoan gordetzen; ideiak hemen laburbiltzen
> dira. **Neural-training lanak dira (ML jakinduria behar dute), P1 arau-geruzarekiko ortogonalak.**

**Argipen kritikoa — "GECToR bateratua" (unified GECToR) bi esanahi:**

1. ✅ **EGINDA** — GECToR barruko *detect + correct* buruak bateratuta (eredu batek
   biak: label head + detect head). `gector-eus-onnx` (cache tag `gector-unified-v3`)
   jada hau da. `GEC_RESEARCH_TIER3.md`-k dokumentatzen du.
2. ❌ **EZ EGINDA** — GECToR bat *hiru atazatarako* (gramatika + ortografia +
   maiuskulak/puntuazioa), MarianMT + Hunspell deuseztatuz. Egungo GECToR-ren
   entrenamendu-datuak **gramatika-soilak** dira (Elhuyar R1-R4 morfologia
   sintetikoa; zero ortografia/puntuazio bikote). Beraz egungo ereduek ezin
   dituzte ataza hauek egin — hau da 3-ereduko arkitektura existitzen den arrazoia.

**Gomendioak (training vs ingeniaritza):**

| # | Gomendioa | Mota | Oharrak |
|---|---|---|---|
| 1 | GECToR bakarra hiru atazatarako; deuseztatu MarianMT+Hunspell; ezabatu merge logika | Training | Goiko 2. esanahia; datu-augmentazioa behar du (#4) |
| 2 | Ordeztu Hunspell detektorea GECToR detect buruarekin | Training | #1-en aurrebaldintza; gain-zuzenketen %75 konpontzen du |
| 3 | Fine-tune 125M encoder errore errealak detektatzeko (7B LLM gabe) | Training | 125M-ak raw-ean %33 huts egiten du OOD delako, ez arkitekturagatik |
| 4 | Datu-augmentazioa Latxa v2-tik (missing/extra, proper-noun `$KEEP`, typo fonetikoak) | Training | #1/#2/#3-ren aurrebaldintza |
| 5 | Iterative correction (2-3 GECToR pass) esaldi multi-akatsetarako | Ingeniaritza | `gector.js`-k jada `MAX_ITERATIONS=5` du; partzialki eginda, balidatu/tune |
| 6 | GECToR mantendu (ez seq2seq) — Grammarly-moduko UX-rako seguruagoa | Erabakia | `GEC_RESEARCH_TIER3.md`-k baieztatuta |
| 7 | Zabaldu ebaluazioa 1.500-2.000 kasura | Ingeniaritza | P0.2-ra lotuta; LLM lokalak errore sintetikoak sor ditzake |
| 8 | Lehentasun-ordena: Datuak → Entrenatu GECToR bateratua → Deuseztatu mergeak → Iterative | Estrategia | — |

**Egungo pisu banaketa:** erabilgarria ML baliabideak daudenean. Bitartean, P1
arau-geruza (EBE oinarritua, determinista) ez du horren menpekotasunik — aurrera
jarraitzen du bere kabuz. Ikus `RESEARCH.md` §7.11 ASR-niche arrisku-analisia.

### P4 atzeratua — Hitz-ordenaren detekzioa (estilo-iradokizuna, ez akatsa)

> Niche baina baliotsua. Mantendu aparkatuta P0–P3 amaitu arte.

**Helburua:** Detektatu ez-neutroa den hitz-ordena (aditza ez dago esaldi-amaieran) eta iradoki ordena neutroa (SOV).

**Zergatia iradokizuna, ez akatsa:** Euskarak hitz-ordena librea du. **SOV da orden neutroa** (Euskaltzaindiaren Gramatika, 41. kap.: informazio-egitura eta galdegaia), baina OVS, VSO etab. baliozkoak dira galdegaia/fokua markatzeko. Beraz, ez da akats gramatikala, baizik eta estilo-hobekuntza — bereziki erabilgarria euskara ikasten dutenentzat (gaztelania/frantsesetik SVO transferitzen dutelako).

**Adibidea:**
```
Sarrera:  Gaur nire semeak puskatu du bere jostailua
                                          ^^^^^^^^^^^^^
                                          objektua AUX-en ondoren = orden ez-neutroa
                                          ^
                                          AUX (du) ez dago esaldi-amaieran

Iradokizuna: Gaur nire semeak bere jostailua puskatu du
                                                 ^^^
                                                 AUX esaldi-amaieran = SOV neutroa
```

**Ikuspegi teknikoa:**

Ez da seq2seq eredurik behar. POS tagger + mendekotasun-aztertzaile batek (dependency parser) aski du:

- **Eredua:** `KoichiYasuoka/roberta-base-basque-ud-goeswith`
  - RoBERTa-eus (BERnaT_base) oinarritua, UD_Basque-BDT-rekin fine-tuneatua
  - POS tagging + dependency parsing (CoNLL-U formatua)
  - 89% UPOS zeiharpena, 85% LAS
  - ~125 MB (int4 ONNX ≈ 85 MB)
- **Araua (heuristikoa, mingarria):** AUX tokena OBJ tokenaren aurretik badago (token ID bidez), hitz-ordena ez-neutroa *izan liteke*. Iradoki aditz-esaldiaren amaierara lekuz aldatzea. **Kontuz:** galdegaia perpausaren hasieran dagoenean (mintzagaia = galdegaia) ordena ez-neutroa da baina ez okerra. Konfiantza-atalase baxuarekin soilik, `style` kategoriako iradokizun gisa (ez `grammar`).

**Balidatutako probak (GPU zerbitzarian):**

| Esaldia | AUX pos | OBJ pos | Emaitza |
|---|---|---|---|
| `...puskatu du bere jostailua` | id=5 | id=7 | ⚠️ ez-neutroa |
| `...bere jostailua puskatu du` | id=8 | id=5 | ✅ neutroa (SOV) |

**Inplementazio-pausoak:**
1. Esportatu eredua ONNX-era (int4 quantization, BERTeus/GECToR ereduaren patro bera)
2. Integratu Transformers.js bidez nabigatzailean
3. Analisi-fasean: exekutatu dependency parser → detektatu ez-neutroak → sortu iradokizun-kartak `category: 'style'` etiketarekin (ez `grammar`/`spelling`)
4. Kartak "Estiloa" izeneko fitxa berri batean erakutsi (Dena / Gramatika / Ortografia / Maiuskulak / Estiloa)

**Mugak:**
- "Ama egin du bazkaria" bezalako kasuak zalantzazkoak dira (AUX objektuaren aurretik dago, baina "Ama" ere objektu gisa etiketatzen da). Beharrezkoa da arau finagoa edo konfiantza-atalasea.
- Mendekotasun-aztertzaileak akatsak egiten ditu hitz konposatuekin (adib. "jostailua" → "jostail" + "ua" `goeswith` etiketarekin). Hitz-mugak jarraitu behar dira.

---

## ⚪ Atzeratuta (zorrozki)

- LSP zerbitzua — luzapenak eskaera frogatzen duenean arte
- Komunitateko arau-autoreentzako web UI — laguntzaileak egon arte artezgabeki
