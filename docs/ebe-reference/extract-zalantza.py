#!/usr/bin/env python3
"""
v6 extractor — clean multi-word zalantza extraction.

Fixes over v5:
  - parens → comma (variant separator), NOT space. Fixes "amorrai amorrain".
  - hyphen-joiner: remove following tag so "aire(<R>-)<R>garraio" → "aire-garraio"
    (one hyphenated word, not two).
  - ';' → comma (separates bold targets).
  - re-apply verb-collision filter (gara = "we are").
  - categorize pairs by type (A: phrase→compound, B: phrase→phrase,
    C: single→phrase, D: hyphenated→...).

Outputs clean categorized TSVs + report.
"""
import pdfplumber, re, sys, json, subprocess

PDF = "/tmp/EBE-eranskinak.pdf"
RED = (0, 1, 1, 0)
VERB_COLLISION = {"gara"}  # gara = "we are" (auxiliary) AND "geltoki" (loanword)

def char_class(c):
    col = c.get("non_stroking_color"); font = c.get("fontname", "")
    if col == RED: return "R"
    if "Bold" in font: return "B"
    return "k"

WORD_CHAR = re.compile(r"[A-Za-zÁÉÍÓÚáéíóúÑñÜü]")

def build_annotated_lines():
    raw = []
    with pdfplumber.open(PDF) as pdf:
        for pno in range(27, 48):
            pg = pdf.pages[pno]; mid = pg.width / 2
            for colname, colchars in [("L", [c for c in pg.chars if c["x0"] < mid]),
                                       ("R", [c for c in pg.chars if c["x0"] >= mid])]:
                lns = {}
                for c in colchars: lns.setdefault(round(c["top"]), []).append(c)
                for top in sorted(lns):
                    cs = sorted(lns[top], key=lambda c: c["x0"])
                    out = []; cur = []; lastcl = None
                    def flush():
                        nonlocal cur, lastcl
                        if cur:
                            w = "".join(ch for ch, _ in cur)
                            tag = {"R": "<R>", "B": "<B>", "k": ""}[lastcl]
                            out.append(f"{tag}{w}"); cur = []
                    for c in cs:
                        t = c["text"]
                        if WORD_CHAR.match(t) or t in "-.?":
                            cl = char_class(c)
                            if lastcl is not None and cl != lastcl: flush()
                            cur.append((t, cl)); lastcl = cl
                        else:
                            flush(); lastcl = None; out.append(t)
                    flush()
                    line = "".join(out)
                    if "<R>" in line or "<B>" in line:
                        raw.append((pno + 1, colname, line))
    # join multi-line: if a line has unclosed '(', join exactly 1 next line (cap).
    # (Uncapped joining caused mega-lines when a note like '(edo Sin.' lost its ')'.)
    joined = []
    i = 0
    while i < len(raw):
        pg, col, line = raw[i]
        bal = line.count("(") - line.count(")")
        if bal > 0 and i + 1 < len(raw):
            npg, ncol, nline = raw[i + 1]
            joined.append((pg, col, line + " " + nline))
            i += 2
        else:
            joined.append((pg, col, line))
            i += 1
    return joined

WORD_UNIT = re.compile(r'(?:<([RB])>)?([A-Za-zÁÉÍÓÚáéíóúÑñÜü\-]+)')

def parse_line(line):
    # 1: hyphen joiners — remove (<tag>-) AND the following tag, insert '-'
    line = re.sub(r'\(<[RB]>-\)<([RB])>', '-', line)
    line = re.sub(r'\(-\)<([RB])>', '-', line)
    line = re.sub(r'\(<[RB]>-\)', '-', line)  # standalone (no following tag)
    line = re.sub(r'\(-\)', '-', line)
    # 2: article suffixes (single-letter parenthesized): (a), (o), (<R>a), (<R>-a)...
    line = re.sub(r'\(<[RB]?>-?[aeouAEOU]\)', '', line)
    # 3: remaining parens → comma (variant separator)
    line = line.replace("(", ",").replace(")", ",")
    # 4: '/' and ';' → comma
    line = line.replace("/", ",").replace(";", ",")
    # 5: split on commas
    segments = [s.strip() for s in line.split(",")]
    segments = [s for s in segments if s and s != "."]
    reds = []; bolds = []
    for seg in segments:
        units = [(m.group(1) or "k", m.group(2)) for m in WORD_UNIT.finditer(seg)]
        if not units: continue
        phrases = []; cur_tag = units[0][0]; cur_words = [units[0][1]]
        for tag, word in units[1:]:
            if tag == cur_tag: cur_words.append(word)
            else: phrases.append((cur_tag, " ".join(cur_words))); cur_tag = tag; cur_words = [word]
        phrases.append((cur_tag, " ".join(cur_words)))
        for tag, phrase in phrases:
            if tag == "R": reds.append(phrase)
            elif tag == "B": bolds.append(phrase)
    return reds, bolds

def is_proper(raw_line, word_lower):
    """Check if word appears capitalized in the raw source line."""
    for m in re.finditer(r'<[RB]>([A-Za-zÁÉÍÓÚáéíóúÑñÜü\-]+)', raw_line):
        if m.group(1).lower() == word_lower and m.group(1)[0].isupper():
            return True
    return False

def main():
    lines = build_annotated_lines()
    pairs = {}; raw_source = {}; ambiguous = []
    for (pg, col, line) in lines:
        reds, bolds = parse_line(line)
        if not reds or not bolds: continue
        if len(bolds) == 1:
            tgt = bolds[0]
            for r in reds:
                if r.lower() == tgt.lower() or len(r) < 2 or r == "-": continue
                if r.lower() in VERB_COLLISION: continue
                rl = r.lower()
                pairs.setdefault(rl, set()).add(tgt.lower())
                raw_source[rl] = f"p{pg}{col}|{line}"
        elif len(reds) == len(bolds) == 1:
            pairs.setdefault(reds[0].lower(), set()).add(bolds[0].lower())
            raw_source[reds[0].lower()] = f"p{pg}{col}|{line}"
        else:
            ambiguous.append((reds, bolds, f"p{pg}{col}|{line}"))

    single = {}; multi = {}; ambig_target = {}
    for r, ts in pairs.items():
        if len(ts) > 1: ambig_target[r] = sorted(ts); continue
        t = next(iter(ts))
        # "multi-word" = red has a space OR bold has a space (spans multiple tokens)
        if " " in r or " " in t: multi[r] = t
        else: single[r] = t

    # cross-ref batch 1
    b1_out = subprocess.run(["node", "-e",
        "import('./src/core/data/zalantza.js').then(m=>console.log(JSON.stringify(m.ZALANTZA)))"],
        cwd="/home/xezpeleta/Dev/itzune/txukun", capture_output=True, text=True).stdout
    b1 = json.loads(b1_out)
    new_single = {r: t for r, t in single.items() if r not in b1}
    dup_single = {r: t for r, t in single.items() if r in b1}

    # categorize multi-word by type
    # A: multi-red → single-bold (phrase→compound)
    # B: multi-red → multi-bold (phrase→phrase)
    # C: single-red → multi-bold (compound/word→phrase)
    # D: hyphenated-red (contains -) → anything
    types = {"A": {}, "B": {}, "C": {}, "D": {}}
    proper_multi = set()
    for r, t in multi.items():
        src = raw_source.get(r, "")
        if is_proper(src, r) or is_proper(src, t): proper_multi.add(r)
        red_multi = " " in r; bold_multi = " " in t; hyph = "-" in r
        if hyph: types["D"][r] = t
        elif red_multi and not bold_multi: types["A"][r] = t
        elif red_multi and bold_multi: types["B"][r] = t
        elif not red_multi and bold_multi: types["C"][r] = t
        else: types["D"][r] = t  # fallback

    proper_single = {r for r in new_single if is_proper(raw_source.get(r, ""), r)}

    print(f"# parsed lines: {len(lines)}", file=sys.stderr)
    print(f"# single-word pairs: {len(single)} (in batch1: {len(dup_single)}, NEW: {len(new_single)})", file=sys.stderr)
    print(f"# multi-word pairs: {len(multi)}", file=sys.stderr)
    print(f"#   A (phrase→compound): {len(types['A'])}", file=sys.stderr)
    print(f"#   B (phrase→phrase):   {len(types['B'])}", file=sys.stderr)
    print(f"#   C (word→phrase):     {len(types['C'])}", file=sys.stderr)
    print(f"#   D (hyphenated→...):  {len(types['D'])}", file=sys.stderr)
    print(f"# ambiguous-target: {len(ambig_target)}", file=sys.stderr)
    print(f"# ambiguous-structure: {len(ambiguous)}", file=sys.stderr)
    print(f"# proper-noun (single): {len(proper_single)} | (multi): {len(proper_multi)}", file=sys.stderr)

    # idempotency check on multi
    reds_set = set(multi.keys()); bolds_set = set(multi.values())
    overlap = reds_set & bolds_set
    print(f"# multi idempotency overlap: {len(overlap)} {sorted(overlap) if overlap else ''}", file=sys.stderr)

    print("# === TYPE A: phrase → compound (multi-red → single-bold) ===")
    for r in sorted(types["A"]):
        m = " [PROPER]" if r in proper_multi else ""
        print(f"{r}\t{types['A'][r]}\t{raw_source.get(r,'')}{m}")
    print("\n# === TYPE B: phrase → phrase (multi-red → multi-bold) ===")
    for r in sorted(types["B"]):
        m = " [PROPER]" if r in proper_multi else ""
        print(f"{r}\t{types['B'][r]}\t{raw_source.get(r,'')}{m}")
    print("\n# === TYPE C: word → phrase (single-red → multi-bold) ===")
    for r in sorted(types["C"]):
        m = " [PROPER]" if r in proper_multi else ""
        print(f"{r}\t{types['C'][r]}\t{raw_source.get(r,'')}{m}")
    print("\n# === TYPE D: hyphenated → ... ===")
    for r in sorted(types["D"]):
        m = " [PROPER]" if r in proper_multi else ""
        print(f"{r}\t{types['D'][r]}\t{raw_source.get(r,'')}{m}")
    print("\n# === NEW SINGLE-WORD (batch 1 gap) ===")
    for r in sorted(new_single):
        m = " [PROPER]" if r in proper_single else ""
        print(f"{r}\t{new_single[r]}\t{raw_source.get(r,'')}{m}")

if __name__ == "__main__":
    main()
