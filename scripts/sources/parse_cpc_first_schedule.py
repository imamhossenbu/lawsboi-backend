"""Parse the CPC First Schedule PDF (bdlaws.minlaw.gov.bd) into Orders → Rules → text blocks.

Usage: pip install pdfplumber pdfminer.six && python scripts/parse_cpc_first_schedule.py First-Schedule.pdf out.json
Source PDF: http://bdlaws.minlaw.gov.bd/act-86.html → "THE FIRST SCHEDULE".
The app reads src/lib/laws/data/cpc-first-schedule.json (compact form of out.json)."""
import sys, re, json, collections
import pdfplumber

SRC, OUT = sys.argv[1], sys.argv[2]
INDEX_PAGES = range(0, 31)
BODY_START = 31

ROMANS = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX",
          "XXI","XXII","XXIII","XXIV","XXV","XXVI","XXVII","XXVIIA","XXVIII","XXIX","XXX","XXXI","XXXII","XXXIII","XXXIV",
          "XXXV","XXXVI","XXXVII","XXXVIII","XXXIX","XL","XLI","XLII","XLIII","XLIV","XLV","XLVI","XLVII","XLVIII","XLIX","L","LI"]
RULE_RE = re.compile(r"^(\d+[A-Z]{0,2})\.$")

def lines_of(page, keep=lambda w: True):
    words = [w for w in page.extract_words(extra_attrs=["size", "fontname"], keep_blank_chars=False) if keep(w)]
    words.sort(key=lambda w: (w["top"], w["x0"]))
    lines = []
    for w in words:
        if lines and abs(lines[-1]["top"] - w["top"]) < 3:
            lines[-1]["words"].append(w)
        else:
            lines.append({"top": w["top"], "words": [w]})
    for l in lines:
        l["words"].sort(key=lambda w: w["x0"])
        l["text"] = re.sub(r"\s+", " ", " ".join(w["text"] for w in l["words"])).strip()
        l["x0"] = l["words"][0]["x0"]
    return lines

def clean(t):
    t = t.replace("", "—").replace("", "—")
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    t = re.sub(r"(\w)- (\w)", r"\1\2", t)
    return re.sub(r"\s+", " ", t).strip()

pdf = pdfplumber.open(SRC)

# ---- 1. Index: rule titles per order -------------------------------------------------------
titles = collections.OrderedDict()   # roman -> {"title": str, "rules": {n: title}}
cur = None; cur_rule = None; expect = 0
for i in INDEX_PAGES:
    for l in lines_of(pdf.pages[i]):
        t = l["text"]
        if expect < len(ROMANS) and re.match(rf"^ORDER\s*{ROMANS[expect]}\b(?!I|V|X|L|A)", t):
            cur = ROMANS[expect]; expect += 1
            titles[cur] = {"title": "", "rules": collections.OrderedDict()}; cur_rule = None
            rest = re.sub(rf"^ORDER\s*{cur}\.?\s*", "", t)
            if rest: titles[cur]["title"] = rest
            continue
        if cur is None or t in ("RULES",) or not t:
            continue
        m = re.match(r"^(\d+[A-Z]{0,2})\.\s+(.*)$", t)
        if m:
            cur_rule = m.group(1); titles[cur]["rules"][cur_rule] = m.group(2)
        elif cur_rule is None:
            titles[cur]["title"] = (titles[cur]["title"] + " " + t).strip()
        elif not t.isupper():
            titles[cur]["rules"][cur_rule] += " " + t

# ---- 2. Body: rule text ----------------------------------------------------------------------
orders = collections.OrderedDict((r, []) for r in ROMANS)
cur = None; expect = 0; rule = None; para = None

def flush():
    global para
    if rule is not None and para:
        rule["paras"].append(clean(" ".join(para)))
    para = None

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar, LTLine, LTRect, LTTextBoxHorizontal, LTTextLineHorizontal

MARK_RE = re.compile(r"^\(?\w{1,5}\)$")

def body_lines(layout):
    """Body text lines of one page: margin-note boxes (narrow, in the outer columns) and
    everything below the footnote rule are dropped. Returns lines sorted top-down."""
    h = layout.height
    rules_ = [o for o in layout if isinstance(o, (LTLine, LTRect)) and 60 < o.width < 260 and o.height < 2 and (h - o.y1) > h * 0.4]
    cut = min((h - o.y1 for o in rules_), default=h)
    raw = []
    for box in layout:
        if not isinstance(box, LTTextBoxHorizontal):
            continue
        text = box.get_text().strip()
        top = h - box.y1
        if top >= cut - 1:
            continue
        is_mark = bool(MARK_RE.match(text))
        if not is_mark and box.width < 95 and (box.x0 >= 405 or box.x1 <= 205):
            continue  # marginal note
        for line in box:
            if not isinstance(line, LTTextLineHorizontal):
                continue
            chars = [c for c in line if isinstance(c, LTChar) and c.get_text().strip()]
            if not chars:
                continue
            big = [c for c in chars if c.size >= 8.8]
            if not big:
                continue  # superscript-only line
            # LTAnno items are the spaces pdfminer infers; superscript footnote markers are dropped
            txt = "".join(c.get_text() for c in line if not isinstance(c, LTChar) or c.size >= 8.8)
            raw.append({"top": h - line.y1, "x0": line.x0, "text": re.sub(r"\s+", " ", txt).strip(),
                        "bold": "Bold" in big[0].fontname})
    raw.sort(key=lambda l: (round(l["top"]), l["x0"]))
    merged = []
    for l in raw:  # a clause marker box and its text sit on the same baseline
        if merged and abs(merged[-1]["top"] - l["top"]) < 3:
            merged[-1]["text"] += " " + l["text"]
        else:
            merged.append(dict(l))
    return merged

LA = LAParams(line_margin=0.3, char_margin=2.0, boxes_flow=None)
for i, layout in enumerate(extract_pages(SRC, laparams=LA)):
    if i < BODY_START:
        continue
    lines = body_lines(layout)
    if not lines:
        continue
    left = collections.Counter(round(l["x0"]) for l in lines).most_common(1)[0][0]
    for l in lines:
        t = l["text"]
        compact = re.sub(r"[\s\d\[]", "", t)
        if expect < len(ROMANS) and re.match(rf"^ORDER{ROMANS[expect]}(?![IVXLA])", compact):
            flush(); rule = None
            cur = ROMANS[expect]; expect += 1
            continue
        if cur is None: continue
        if l["bold"] and t.isupper() and not re.match(r"^\d", t):
            continue  # the order's title line
        num = re.match(r"^(\d+[A-Z]{0,2})\s*\.\s*(.*)$", t)
        if l["bold"] and num:
            flush()
            rule = {"n": num.group(1), "paras": []}
            orders[cur].append(rule)
            para = [num.group(2)]
            continue
        ins = re.match(r"^\[?\s*(\d+[A-Z]{1,2}|\d+)\.\s*(.*)$", t)
        if ins and cur in titles:
            ids = list(titles[cur]["rules"].keys())
            done = {r["n"] for r in orders[cur]}
            nxt = next((x for x in ids if x not in done), None)
            if ins.group(1) == nxt and ins.group(2)[:1] in ("[", "(") + tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
                flush()
                rule = {"n": nxt, "paras": []}
                orders[cur].append(rule)
                para = [("[" if t.startswith("[") else "") + ins.group(2)]
                continue
        if rule is None: continue
        starts_block = re.match(r"^\[?(\((\d+[A-Z]?|[a-z]{1,2}|[ivx]{1,5})\)\s|Provided|Explanation|Illustration|Note\b)", t)
        prev_ended = bool(para) and para[-1].rstrip()[-1:] in ".:;]—-"
        if para is None or (starts_block and (l["x0"] > left + 6 or prev_ended)):
            flush(); para = [t]
        else:
            para.append(t)
flush()

# ---- 3. Merge + blocks -----------------------------------------------------------------------
def blocks(paras):
    out = []
    for p in paras:
        if not p: continue
        # a leading "[" marks an amendment; keep it on the text, not the marker
        lead = "[" if p.startswith("[") else ""
        body = p[1:] if lead else p
        m = re.match(r"^\((\d+[A-Z]?)\)\s+(.*)$", body)
        c = re.match(r"^\(([a-z]{1,2}|[ivx]{1,5})\)\s+(.*)$", body)
        if m: out.append({"kind": "para", "mark": f"({m.group(1)})", "text": lead + m.group(2)})
        elif c: out.append({"kind": "clause", "mark": f"({c.group(1)})", "text": lead + c.group(2)})
        else: out.append({"kind": "para", "text": p})
    return out

result = []
for n, roman in enumerate(ROMANS, start=1):
    idx = titles.get(roman, {"title": "", "rules": {}})
    if roman == "LI":
        idx = {"title": "", "rules": {}}; orders[roman] = []
    seen = {}
    for r in orders[roman]:
        if r["n"] in seen: seen[r["n"]]["paras"] += r["paras"]
        else: seen[r["n"]] = r
    rule_ids = list(dict.fromkeys(list(idx["rules"].keys()) + list(seen.keys())))
    result.append({
        "roman": roman,
        "title": clean(idx["title"]).title() if idx["title"].isupper() else clean(idx["title"]),
        "rules": [{"n": rid, "title": clean(idx["rules"].get(rid, "")).rstrip("."), "body": blocks(seen[rid]["paras"]) if rid in seen else []} for rid in rule_ids],
    })

json.dump(result, open(OUT, "w"), ensure_ascii=False, indent=0)
tot = sum(len(o["rules"]) for o in result)
withbody = sum(1 for o in result for r in o["rules"] if r["body"])
print("orders", len(result), "rules", tot, "with text", withbody)
for o in result:
    print(o["roman"], len(o["rules"]), sum(1 for r in o["rules"] if r["body"]), "|", o["title"][:60])
