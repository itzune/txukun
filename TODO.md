# TODO — txukun

## Etorkizuneko ezaugarriak / Future features

### Hitz-ordenaren detekzioa ( estilo-iradokizuna, ez akatsa )

**Helburua:** Detektatu ez-neutroa den hitz-ordena (aditza ez dago esaldi-amaieran) eta iradoki ordena neutroa (SOV).

**Zergatia iradokizuna, ez akatsa:** Euskarak hitz-ordena librea du. SOV da orden neutroa, baina OVS, VSO etab. baliozkoak dira fokua/pragma markatzeko. Beraz, ez da akats gramatikala, baizik eta estilo-hobekuntza — bereziki erabilgarria euskara ikasten dutenentzat (gaztelania/frantsesetik SVO transferitzen dutelako).

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
- **Araua:** AUX tokena OBJ tokenaren aurretik badago (token ID bidez), hitz-ordena ez-neutroa da. Iradoki aditz-esaldiaren amaierara lekuz aldatzea.

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

## Beste aukerak / Other ideas

- **Zuzenketa zuzena teklatzean (live/debounced analysis):** GECToR nahikoa azkarra da (~100 ms) teklatu-mailako detekziorako debounced. Hunspell berehalakoa da. MarianMT bakarrik da motelegia (~1 s) live-rako.
- **Datu-augmentation GECToR-erako:** Sintetiko sortu demonstratibo-erroreak (onek→honek, hau→au, etab.) adibide negatiboekin, detekzio-burua testuinguruko hitz-ordezkapena ikastera irakasteko. Ikus `gector-eus/TODO.md`.
