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
- [ ] **`src/core/rules/` EBE oinarritutako arauak** — batch 3+, iturria: `docs/ebe-reference/` eta `RESEARCH.md` §7.7 (ez egiaztatu gabeko espekulazioak):
    - [ ] *Kalko lexiko-semantikoak* (`ebe-kal.txt`): `balore→balio`, `froga/proba` bereizketa, `*pena merezi→merezi`, `*ospatu bilera→bilera egin`
    - [ ] *Kalko morfosintaktikoak*: `*Nekatuta naiz→Nekatuta nago`, `*Aspertu naiz, joaten gara?→Joango gara?`, pasibo okerrak (`*Poliziagatik atxilotua izan zen→Poliziak atxilotu zuen`), `ere` lokailuaren posizioa (`*Ere daude→...ere badaude`)
    - [ ] *Zalantza-hitzak* (`ebe-zal.txt`): `abots→ahots`, `aborto→abortu`, `ahalderatu→ahalbidetu` — Hiztegiak gomendatutako formak
    - [ ] *Maiuskulak*: izen bereziak soilik (EBE *Maiuskulak*, id=1023). EZ ingeles/gaztelania bezala: egunak (`astelehena`) eta hilabeteak (`urtarrila`) minuskulaz; nazionalitate/hizkuntza-izenlagunak minuskulaz (`euskal`); erakundeak partzialki (`Donostiako Udala` baina `udaletan`); astroak leku-izen (`Lurra`, `Eguzkia`)
- [ ] Hunspell-eu/Xuxen hitz-zerrendatik sortutako hiztegia (`src/core/dictionary.js`) — P0.1-ko lanarekin bateragarria
- [ ] Edit-distance fuzzy iradokizunak spell-checkerako
- [ ] **(Atzeratuta) `src/core/expr.js`** — Pattern combinator liburutegia (`seq`, `word`, `anyOf`, `optional`). **EZ egin ≥50 arau daudenera arte** — §7.8-ko erabakia. Oraingoz arau bakoitza funtzio inperatibo bat da
- [ ] **(Atzeratuta) `src/core/tokenizer.js` POS-rekin** — Harper-ren Brill POS tagger ez da beharrezkoa EBE calque mailako arauetarako. Gehitu morfologia bat benetan eskatzen duen arau bat agertzean

---

## 🟡 P2 — Neural fallback geruza

> Eredua berriro integratu, baina arau-motorrak aintzat hartzen ez dituen span-etara mugatuta.

- [ ] MarianMT restorezailea flagged span-etara mugatu (arauak nahiko denean, modelorik ez exekutatu)
- [ ] Validatzailea: hiztegitik kanpoko hitzak sortzen dituzten eredu-zuzenketa baztertu
- [ ] Konfiantza-bideraketa: arauak = zuzenketa isila; neural = iradokizun-txartela
- [ ] Konfiantza-mailatan banatutako iradokizun-txartelak: "akatsa" vs "hobe izan liteke" (Grammarly-ren correctness/clarity bereizketa)

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
