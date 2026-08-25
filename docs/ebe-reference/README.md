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

## Oharrak

- Testu-ateraketa `pdftotext -layout` bidezkoa da; taulen lerrokadura apur bat
  desitxura daiteke. Ziurtatzeko, kontsultatu PDF jatorrizkoa.
- `ebe-zal.txt`-n gorria/beltz-lodia/beltz-mehea bereiztea (erabili/erabili ez /
  bigarren mailakoa) ez da testu soilean ikusten; kontsultatu HTML/PDF jatorrizkoa
  mailaketa zehatzeko.
- Egiaztapen-egoera: 2026-08-25 — hiru atalak osorik jaitsi eta berrikusiak.
