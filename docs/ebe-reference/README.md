# EBE erreferentzia — Euskara Batuaren Eskuliburua

Hiru EBE eranskin-atalen testu-ateraketak, `pdftotext -layout` bidez lortuak
EBE eranskinaren PDFetik. Arau-motorraren (P1) eta golden case-en (P0.2)
**iturri autoritatiboak** dira. Ikus `RESEARCH.md` §7.7 xehetasunetarako.

## Jatorria

- **PDF osoa**: https://www.euskaltzaindia.eus/components/com_ebe/pdf/EBE-eranskinak.pdf (106 or.)
- **Maiuskulak sarrera** (HTML, id=1023): https://www.euskaltzaindia.eus/component/ebe?view=bilaketa&Itemid=1161&task=bilaketa&id=1023

## Fitxategiak

| Fitxategia | EBE atala | PDF orriak | Edukia |
|---|---|---|---|
| `ebe-punt.txt` | Puntuazio-markak | 15–26 (467–477) | 12 puntuazio-ikurren arauak: puntua, koma, puntu eta koma, bi puntuak, etenpuntuak, galdera/harridura-markak, marra luzeak, parentesiak, elkarrizketa-marra, komatxoak, marratxoa, apostrofoa, zehar-marra. Komarik EZ jartzeko kasuak barne. |
| `ebe-zal.txt` | Zalantza eragiten duten zenbait hitz | 27–48 (479–490) | Euskaltzaindiaren Hiztegiaren gomendioak: forma okerrak (gorriz) forma egokien kontra. XUXEN estiloko ordezkapen-zerrenda kanonikoa. |
| `ebe-kal.txt` | Kalko desegoki nabarmen batzuk | 49–80 (501–510) | Erderatik ekarritako akats lexiko-semantikoak + morfosintaktikoak (izen-sintagma, aditza, perpausa). `*okerra → zuzena` formatuan. **Arau deterministen iturri nagusia.** |

## Zalantza erauzketa — `extract-zalantza.py`

`extract-zalantza.py` EBE PDFetik zalantza-bikoteak erauzten ditu
pdfplumber kolore-analisiaz (RED=desgogokoa, BOLD=estandarra). Ikus
`RESEARCH.md` §7.12 (batch 1) eta §7.13 (batch 2a, multi-hitza).

**Gako-aurkikuntza (§7.13)**: testu soileko `ebe-zal.txt` ezin da erabili
erauzketarako — kolorea da norabide-seinale bakarra. Gainera, `pdftotext -layout`-k
komak eta puntuazioa galtzen ditu maiz, eta sarreren egitura (aldaerak, marratxo-
konposatuak, lerro-anitzeko sarrerak) ezin da testu soiletik berreskuratu.

### EBE sarreren egitura

| Elementua | Esanahia | Adibidea |
|---|---|---|
| `/` | RED/BOLD bereizlea | `<R>abots / <B>ahots` |
| `,` / `;` | aldaerak alde berean | `<R>jatsi, <R>jeitsi / <B>jaitsi` |
| `(letra)` | artikulu-atizkia, kendu | `ikurriñ(a) → ikurrin` |
| `(esapidea)` | alternatiba-taldea | `(haize girotu) aire girotu` |
| `(-)` | marratxo-konposatua | `aire(-)garraio → aire-garraio` |

### Erauzketako datu-fitxategiak (batch 2a)

| Fitxategia | Edukia | Kopurua |
|---|---|---|
| `zalantza-new-singles.tsv` | Hitz bakuneko bikote berriak (batch 1-eko hutsunea) | 93 |
| `zalantza-type-c.tsv` | Hitz bakuna → esapidea (multi-word helburua) | 19 |
| `zalantza-phrases.tsv` | Multi-token RED esapideak (A+B+D motak) | 33 |
| `zalantza-proper.tsv` | Izen bereziak (exonoimoak) → **EGINDA** `zalantza-proper.js`-n | 35 (27 bakar, 24 seguru) |
| `zalantza-ambiguous.tsv` | Anbiguoak (→ batch 3+, testuingurua behar) | 6 |

Batch 1-eko 628 bikoteak `src/core/data/zalantza.js`-n daude.

## Oharrak

- Testu-ateraketa `pdftotext -layout` bidezkoa da; taulen lerrokadura apur bat
  desitxura daiteke. Ziurtatzeko, kontsultatu PDF jatorrizkoa.
- `ebe-zal.txt`-n gorria/beltz-lodia/beltz-mehea bereiztea (erabili/erabili ez /
  bigarren mailakoa) ez da testu soilean ikusten; **ezin da erabili erauzketarako** —
  erabili `extract-zalantza.py` (pdfplumber kolore-analisia).
- Egiaztapen-egoera: 2026-08-27 — hiru atalak osorik jaitsi eta berrikusiak;
  zalantza erauzketa v6 bidez birprobagarria.
