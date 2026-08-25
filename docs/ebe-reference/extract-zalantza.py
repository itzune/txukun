import pdfplumber, sys, re
PDF = "/tmp/EBE-eranskinak.pdf"
RED = (0, 1, 1, 0)
def char_class(c):
    col=c.get("non_stroking_color"); font=c.get("fontname","")
    if col==RED: return "R"
    if "Bold" in font: return "B"
    return "k"
WORD=re.compile(r"[A-Za-zÁÉÍÓÚáéíóúÑñÜü\-\.\?]+")

# Collect per-line token lists WITH delimiter info, and detect (-) join
lines=[]
with pdfplumber.open(PDF) as pdf:
    for pno in range(27,48):
        pg=pdf.pages[pno]; mid=pg.width/2
        for colname, colchars in [("L",[c for c in pg.chars if c["x0"]<mid]),
                                   ("R",[c for c in pg.chars if c["x0"]>=mid])]:
            lns={}
            for c in colchars: lns.setdefault(round(c["top"]),[]).append(c)
            for top in sorted(lns):
                cs=sorted(lns[top],key=lambda c:c["x0"])
                s="".join(c["text"] for c in cs); classes=[char_class(c) for c in cs]
                # tokenize with delimiter tracking; treat (-) as JOINER (hyphen)
                # First, mark which chars are part of a (-) or (<x>-) sequence -> replace with '-'
                # Build a cleaned char stream: collapse '(', optional color, '-', ')' to '-'
                # Work on the raw char list: find subsequences matching ( - ) possibly with color tags
                # Simpler: build string, then regex-replace r'\(<[^>]*>-\)|\(-\)' with '-' on the STRING,
                # but classes list must stay aligned. Since replacement is shorter, re-derive classes after.
                # Easiest: rebuild tokens directly from chars, treating ( ) as delimiters UNLESS they form (-)
                tokens=[]; cur=[]; curcl=None; i=0; n=len(cs)
                while i<n:
                    c=cs[i]; t=c["text"]; cl=char_class(c)
                    # detect '(', optional '<color>', '-', ')'
                    if t=="(":
                        # look ahead for optional <..> then '-' then ')'
                        j=i+1; ok=False
                        # skip a color-tag-like sequence? chars are individual: '<','R','>'
                        # check: next chars form '<X>' then '-' then ')'
                        if j+2<n and cs[j]["text"]=="<" and cs[j+2]["text"]==">":
                            j+=3
                        if j<n and cs[j]["text"]=="-" and j+1<n and cs[j+1]["text"]==")":
                            # this is a (-) or (<R>-) hyphen joiner -> append '-' to current word if same class
                            if cur and curcl is not None:
                                cur.append(("-",curcl))  # join
                            else:
                                # start new with hyphen
                                if cur: tokens.append(("".join(x for x,_ in cur),curcl)); cur=[]
                                cur=[("-")]; curcl=cl
                            i=j+2; continue
                    if re.match(r"[A-Za-zÁÉÍÓÚáéíóúÑñÜü\-\.\?]", t):
                        if curcl is not None and cl!=curcl and cur:
                            tokens.append(("".join(x for x,_ in cur),curcl)); cur=[]
                        cur.append((t,cl)); curcl=cl
                    else:
                        if cur: tokens.append(("".join(x for x,_ in cur),curcl)); cur=[]
                        curcl=None
                    i+=1
                if cur: tokens.append(("".join(x for x,_ in cur),curcl))
                if any(t[1] in ("B","R") for t in tokens):
                    lines.append((pno+1,colname,tokens))

# Now phrase-group: same class, space-delimited only
def phrases(tokens):
    out=[]; cur=[]; curcl=None
    for (w,cl,delim) in [(t[0],t[1]," ") for t in tokens]:
        pass
    # rebuild with delim tracking — but we lost delim. Use simpler: join same-class adjacent
    out=[]; cur=[]; curcl=None
    for (w,cl) in tokens:
        if cl==curcl and cur and re.fullmatch(r"[A-Za-zÁÉÍÓÚáéíóúÑñÜü\-]+", w):
            cur.append(w)
        else:
            if cur: out.append((curcl," ".join(cur)))
            cur=[w]; curcl=cl
    if cur: out.append((curcl," ".join(cur)))
    return out

# Extract single-word pairs (no line-joining; single-line entries only)
clean={}; multi=[]; ambig=[]
verb_collision={"gara"}  # gara=we-are verb; context-dependent
for (pg,col,tokens) in lines:
    phs=phrases(tokens)
    reds=[p for cl,p in phs if cl=="R"]
    bolds=[p for cl,p in phs if cl=="B"]
    if not reds or not bolds: continue
    bold_single=[p for p in bolds if " " not in p]
    red_single=[p for p in reds if " " not in p]
    red_multi=[p for p in reds if " " in p]
    btarget = bolds[0] if len(bolds)==1 else " ".join(bolds)
    for rm in red_multi: multi.append((rm,btarget))
    if len(bold_single)==1 and red_single:
        tgt=bold_single[0]
        for rs in red_single:
            if rs.lower()==tgt.lower(): continue
            if rs=="-" or len(rs)<2: continue
            if not re.match(r"^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\-]+$", rs): continue
            if rs[0].isupper() or tgt[0].isupper(): continue
            if rs.lower() in verb_collision: continue
            clean.setdefault(rs.lower(),set()).add(tgt.lower())
    elif len(bold_single)>1 and red_single:
        for rs in red_single: ambig.append((rs,bold_single))

final={}; ambig2=[]
for r,ts in clean.items():
    if len(ts)>1: ambig2.append((r,sorted(ts)))
    else: final[r]=next(iter(ts))

# idempotency check
reds=set(final); bolds=set(final.values())
overlap=reds & bolds
print(f"# final single-word pairs: {len(final)}", file=sys.stderr)
print(f"# multi-word (batch 2): {len(multi)}", file=sys.stderr)
print(f"# ambiguous (skipped): {len(ambig2)}", file=sys.stderr)
print(f"# entries w/ >1 bold target: {len(ambig)}", file=sys.stderr)
print(f"# idempotency overlap (RED also BOLD): {len(overlap)}", file=sys.stderr)
for w in sorted(overlap): print(f"   OVERLAP: {w}", file=sys.stderr)
# verify fragments gone
for bad in ["izar","hezur","bizkar","leiho","mahai","orratz","kanpaina","denda","saski","baloi","paper","gara","bertso","ipar","buru"]:
    if bad in final: print(f"   STILL LEAKED: {bad} -> {final[bad]}", file=sys.stderr)

# categories for documentation
import collections
cats=collections.Counter()
for r,t in final.items():
    if r.startswith("x") and t.startswith(("tx","s")): cats["x-dialectal"]+=1
    elif any(r.startswith(pr) for pr in ["a","e","i","o","u"]) and t!=r: cats["loanword/variant"]+=1
    else: cats["other"]+=1
print(f"\n# categories (rough): {dict(cats)}", file=sys.stderr)

for r in sorted(final): print(f"{r}\t{final[r]}")
