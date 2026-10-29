"""Parse Supreme Court Online Bulletin (SCOB) volumes into judgment records.

Usage: pip install pymupdf && python scripts/parse_scob.py <dir with N_SCOB_YYYY.pdf files> <out dir>
Source: https://supremecourt.gov.bd/resources/bulletin/<N>_SCOB_<YYYY>.pdf (official law report of the
Supreme Court of Bangladesh).

Writes  <out>/scob-index.json        — one metadata record per judgment (no judgment text)
        <out>/judgments/<slug>.json  — the judgment text as paragraphs
Kept: citation, court, bench, author, case no., origin, parties, counsel, dates, key words and the judgment
itself. Not kept: the SCOB editors' notes and key-ratio summaries (editorial content of the bulletin).
Judgments typed in a legacy (non-Unicode) Bangla font are skipped — their text needs a font conversion."""
import sys, os, re, json, glob, collections
import fitz

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(f"{OUT}/judgments", exist_ok=True)

CITE_LINE = re.compile(r"^(\d+)\s*SC\s?OB\s*\[\s*(\d{4})\s*\]\s*(AD|HCD)(?:\s+(\d+))?\s*$")
HEADER = re.compile(r"^\d+\s*\d?\s*SC\s?OB\s*\[\s*\d{4}\s*\]\s*(AD|HCD)\b(.*)$")
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], 1)}
LEGACY_BN = re.compile(r"[¢¡®¥£§]")


def clean(s):
    s = s.replace(" ", " ").replace("…", "...").replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip()


def to_iso(text):
    """'The 6th day of December, 2023' / '06.12.2023' / '6 December 2023' → '2023-12-06'."""
    if not text:
        return None
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?([A-Za-z]+),?\s*(\d{4})", text)
    if m and m.group(2).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", text)
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def title_case_no(s):
    s = clean(s).rstrip(".")
    s = re.sub(r"\bNO\b\.?\s*", "No. ", s, flags=re.I)
    s = re.sub(r"\bNOS\b\.?\s*", "Nos. ", s, flags=re.I)
    words = []
    for w in s.split(" "):
        if w.upper() in {"OF", "AND", "WITH", "IN", "FOR", "TO"}:
            words.append(w.lower())
        elif w in {"No.", "Nos."} or any(ch.isdigit() for ch in w) or re.fullmatch(r"(?:[A-Z]\.){1,3}[A-Z]?\.?:?", w):
            words.append(w)
        else:
            words.append(w.capitalize())
    out = " ".join(words)
    return out[0].upper() + out[1:] if out else out


def case_type(case_no, origin):
    s = f"{case_no} {origin}".lower()
    head = case_no.lower()
    if re.search(r"criminal|jail|death reference|crl", head):
        return "criminal"
    if re.search(r"company|matter", head):
        return "company"
    if re.search(r"income tax|vat|customs|tax|i\.?\s?t\.?\s?ref", s):
        return "tax"
    if re.search(r"labour", s):
        return "labour"
    if re.search(r"family", s):
        return "family"
    if re.search(r"writ", s):
        return "writ"
    if re.search(r"civil|first appeal|second appeal|revision|appeal|suit|review", head):
        return "civil"
    return "others"


# --- laws the judgment relies on -----------------------------------------------------------------------
LAWS = [  # (catalogue slug, pattern matching the Act's name)
    ("cpc-1908", r"Code of Civil Procedure|C\.?\s?P\.?\s?C\.?\b"),
    ("crpc-1898", r"Code of Criminal Procedure|Cr\.?\s?P\.?\s?C\.?\b"),
    ("penal-code-1860", r"Penal Code"),
    ("evidence-act-1872", r"Evidence Act"),
    ("contract-act-1872", r"Contract Act"),
    ("specific-relief-act-1877", r"Specific Relief Act"),
    ("transfer-of-property-act-1882", r"Transfer of Property Act"),
    ("limitation-act-1908", r"Limitation Act"),
    ("registration-act-1908", r"Registration Act"),
    ("labour-act-2006", r"Labour Act"),
    ("digital-security-act-2018", r"Digital Security Act"),
    ("muslim-family-laws-ordinance-1961", r"Muslim Family Laws Ordinance"),
    ("family-courts-ordinance-1985", r"Family Courts Ordinance"),
    ("bangladesh-bank-order-1972", r"Bangladesh Bank Order"),
]
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50}


def roman_to_int(r):
    total = 0
    for i, ch in enumerate(r):
        v = ROMAN[ch]
        total += -v if i + 1 < len(r) and v < ROMAN[r[i + 1]] else v
    return total


def extract_laws(text):
    found = collections.Counter()
    for slug, name in LAWS:
        for m in re.finditer(rf"[Ss]ections?\s+(\d+[A-Z]?)(?:\s*\(\d+\))?(?:\s*\([a-z]\))?\s+of\s+the\s+(?:{name})", text):
            found[(slug, "section", m.group(1), 0)] += 1
        if slug == "cpc-1908":
            for m in re.finditer(r"Order\s+([IVXL]+)\s*,?\s*[Rr]ules?\s+(\d+)[^.]{0,40}?(?:Code of Civil Procedure|CPC|C\.P\.C)", text):
                found[(slug, "order", str(roman_to_int(m.group(1))), int(m.group(2)))] += 1
    for m in re.finditer(r"[Aa]rticles?\s+(\d+[A-Z]?)(?:\s*\(\d+\))?\s+of\s+the\s+Constitution", text):
        found[("constitution-1972", "article", m.group(1), 0)] += 1
    refs = []
    for (slug, kind, n, rule), _ in found.most_common(8):
        ref = {"law": slug, "kind": kind, "n": n}
        if rule:
            ref["rule"] = rule
        refs.append(ref)
    return refs


CITATION = re.compile(
    r"\b(?:\(\d{4}\)\s*)?\d{1,3}\s*(?:DLR|BLD|BLC|MLR|ADC|ALR|BLT|LNJ|CLR|BCR|SCOB)\s*(?:\[\d{4}\]\s*)?"
    r"(?:\((?:AD|HCD|HC|SC)\)\s*)?(?:\(\d{4}\)\s*)?(?:AD|HCD)?\s*\d{1,4}\b"
)


def extract_citations(text, own):
    out, seen = [], set()
    for m in CITATION.finditer(text):
        c = clean(m.group(0))
        key = re.sub(r"\W", "", c)
        if key in seen or key == re.sub(r"\W", "", own):
            continue
        seen.add(key)
        out.append(c)
    return out[:20]


# --- page handling --------------------------------------------------------------------------------------
def page_lines(text):
    """Lines of a page without the running header (citation · title · page number) at the top."""
    lines = [l.rstrip() for l in text.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and HEADER.match(lines[0].strip()) and not CITE_LINE.match(lines[0].strip()):
        lines.pop(0)
        while lines and re.fullmatch(r"\s*\d{1,4}\s*", lines[0]):
            lines.pop(0)
    return lines


def header_title(first_line):
    """'19 SCOB [2024] AD   Aziz Ara Rahman Vs. RAJUK and others   (Obaidul Hassan, CJ)   1' → title, author."""
    m = HEADER.match(first_line.strip())
    rest = m.group(2) if m else first_line
    rest = re.sub(r"\s+\d{1,4}\s*$", "", rest).strip()
    author = None
    am = re.search(r"\(([^()]*(?:J|CJ|JJ)\.?)\)\s*$", rest)
    if am:
        author = clean(am.group(1))
        rest = rest[: am.start()]
    title = clean(rest).rstrip(".")
    title = re.sub(r"\s+V[Ss]\.?\s+", " v. ", title)
    return title, author


def paragraphs(lines):
    """Join wrapped lines; a new paragraph starts after a blank line or at a numbered line."""
    paras, cur = [], []
    for l in lines:
        s = l.strip()
        if not s:
            if cur:
                paras.append(" ".join(cur))
                cur = []
            continue
        if re.match(r"^\d{1,3}\.\s+\S", s) and cur:
            paras.append(" ".join(cur))
            cur = []
        cur.append(s)
    if cur:
        paras.append(" ".join(cur))
    out = []
    for p in paras:
        p = clean(p)
        p = re.sub(r"(\w)- (\w)", r"\1\2", p)
        if not p or re.fullmatch(r"[\d\s.]+", p):
            continue
        # glue a paragraph that continues the previous sentence across a page break
        if out and not re.match(r"^\d{1,3}\.\s", p) and p[0].islower():
            out[-1] = f"{out[-1]} {p}"
        else:
            out.append(p)
    return out


def parse_volume(path):
    vol = os.path.basename(path)[:-4]
    doc = fitz.open(path)
    texts = [p.get_text("text") for p in doc]
    starts = []
    for i, t in enumerate(texts):
        raw = [l.strip() for l in t.split("\n") if l.strip()]
        for j, l in enumerate(raw[:6]):
            m = CITE_LINE.match(l)
            # the citation line is followed by the Division heading (older volumes omit its page number)
            if m and any("DIVISION" in x.upper() for x in raw[j + 1 : j + 3]):
                starts.append((i, m))
                break
    records = []
    for k, (i, m) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(texts)
        first = next((l for l in texts[i].split("\n") if l.strip()), "")
        title, author = header_title(first)
        all_lines = []
        for p in range(i, end):
            all_lines.extend(page_lines(texts[p]))
        body_text = "\n".join(all_lines)
        if len(LEGACY_BN.findall(body_text)) > 200:
            continue
        # header block: from the citation line to "Editors' Note" (or "Key Words" / "JUDGMENT")
        stop = re.search(r"Editors?.?\s*Note|Key\s*Words?\s*:|^\s*J\s*U\s*D\s*G\s*M\s*E\s*N\s*T\s*$", body_text, re.M | re.I)
        head = body_text[: stop.start()] if stop else body_text[:3000]
        head_lines = [clean(l) for l in head.split("\n") if clean(l)]
        flat = " ".join(head_lines)

        judges, in_bench = [], False
        for l in head_lines:
            if re.match(r"^present\s*:?", l, re.I):
                in_bench = True
                l = re.sub(r"^present\s*:?\s*", "", l, flags=re.I)
                if not l:
                    continue
            if not in_bench:
                continue
            if re.fullmatch(r"(?i)-?\s*(and|&|-and-)\s*-?", l):
                continue
            if judges and re.fullmatch(r"(?i)-?\s*(chief\s+)?justice\.?", l):
                judges[-1] = f"{judges[-1].rstrip(' ,')} {l.strip(' -')}".replace("Chief Chief", "Chief")
                continue
            if re.search(r"Justice", l):
                name = re.sub(r"(?i)^(-?and-?|&)\s+", "", l)
                name = re.sub(r"^(Mr\.|Mrs\.|Madam|Ms\.)\s*", "", name).rstrip(" .")
                judges.append(re.sub(r"Justice(?=\S)", "Justice ", name))
                continue
            if judges:
                break
        # case number: the first heading-like line naming a proceeding and its number (may wrap once)
        case_no = ""
        for n, l in enumerate(head_lines):
            if l.startswith("(") or HEADER.match(l) or CITE_LINE.match(l):
                continue
            if re.search(r"(?i)\b(appeal|petition|revision|reference|matter|suit|case|review|rule|application|contempt)\b", l) and re.search(r"(?i)\bnos?\b", " ".join(head_lines[n : n + 2])):
                joined = l if re.search(r"\d{4}", l) else f"{l} {head_lines[n + 1] if n + 1 < len(head_lines) else ''}"
                case_no = title_case_no(re.split(r"(?i)\s+(?:with|and)\s+(?=[a-z]+\s+(?:appeal|petition))", joined)[0])
                case_no = re.sub(r"(?i)(of\s*\d{4}).*$", r"\1", case_no).strip(" .,")
                break
        om = re.search(r"\((From[^)]*)\)", flat)
        origin = clean(om.group(1)) if om else ""

        advocates = []
        side_re = r"[A-Za-z\-]+(?:\s+[a-z][a-z\-]+)?(?:\s+No[s]?\.?\s*[\d\-–, &]*\d(?:\s*and\s*\d+)?)?"
        # Appellate Division style — "For the Appellant : names"
        for am in re.finditer(rf"For\s+(?:the\s+)?({side_re})\s*:\s*(.*?)(?=For\s+(?:the\s+)?{side_re}\s*:|Date of|Editors|Heard|Judgment on|$)", flat):
            side, names = clean(am.group(1)), clean(am.group(2)).rstrip(" .")
            if names and len(names) < 400:
                advocates.append({"side": side[0].upper() + side[1:], "names": names})
        # High Court Division style — "names ……… For the petitioner"
        if not advocates:
            marks = list(re.finditer(rf"[.…]{{2,}}\s*For\s+(?:the\s+)?({side_re})\.?", flat))
            if marks:
                parties_end = [p.end() for p in re.finditer(r"[.…]{2,}\s*(?:Respondents?|Opposite\s+[Pp]art(?:y|ies)|Petitioners?|Appellants?|Accused)\b\.?", flat) if p.end() <= marks[0].start()]
                cursor = parties_end[-1] if parties_end else 0
                for mk in marks:
                    names = clean(flat[cursor:mk.start()]).strip(" .:")
                    side = clean(mk.group(1)).strip(" .")
                    if names and len(names) < 400:
                        advocates.append({"side": side[0].upper() + side[1:], "names": names})
                    cursor = mk.end()

        jm = re.search(r"Date of (?:hearing and )?judgment\s*:?\s*(.{0,60}?\d{4})", flat, re.I) or re.search(
            r"Judgment on\s*:?\s*(.{0,60}?\d{4})", flat, re.I
        )
        hm = re.search(r"Date of hearing\s*:?\s*(.{0,80}?\d{4})", flat, re.I) or re.search(
            r"Heard on\s*:?\s*(.{0,80}?\d{4})", flat, re.I
        )
        date = to_iso(jm.group(1)) if jm else None
        hearing = to_iso(hm.group(1)) if hm and "judgment" not in hm.group(0).lower()[:25] else None
        if not date and hearing:  # many Appellate Division orders give only the hearing date
            date, hearing = hearing, None

        km = re.search(r"Key\s*Words?\s*:\s*(.*?)(?:\n\s*\n|\n\s*\S[^\n]{0,3}\n\s*\n)", body_text, re.S | re.I)
        keywords = []
        if km:
            keywords = [clean(k).strip(" .;") for k in re.split(r"[;\n]", km.group(1)) if clean(k).strip(" .;")]
            keywords = [k for k in keywords if 2 < len(k) < 90][:10]

        # the judgment starts at a "JUDGMENT"/"ORDER" heading after the header block — searched only past the
        # header, where a wrapped "Date of hearing and / judgment" line would otherwise look like the heading
        rest = body_text[len(head):]
        marker = r"^\s*J\s*U\s*D\s*G\s*M\s*E\s*N\s*T\s*:?\s*$|^\s*O\s*R\s*D\s*E\s*R\s*:?\s*$"
        jud = re.search(marker, rest, re.M) or re.search(marker, rest, re.M | re.I)
        if jud:
            text_lines = rest[jud.end():].split("\n")
        else:
            # no heading: skip the key-ratio summaries (each ends "...(Para N)") and start at paragraph 1
            last_ratio = list(re.finditer(r"\.{2,}\s*\(Paras?\s*[\d\-–, &and]+\)", rest))
            after = last_ratio[-1].end() if last_ratio else 0
            fm = re.search(r"^\s*1\.\s+\S", rest[after:], re.M)
            text_lines = rest[after + (fm.start() if fm else 0):].split("\n")
        paras = paragraphs(text_lines)
        # editorial matter that can still slip into the body: key-ratio summaries and editors' notes/footnotes
        ratio_end = re.compile(r"\.{2,}\s*\(Paras?\s*[\d\-–, &and]+\)\s*$")
        cleaned = []
        for para in paras:
            if re.match(r"^\.{2,}\s*\(Paras?\b", para):
                if cleaned:
                    cleaned.pop()  # the summary it closes
                continue
            if ratio_end.search(para) or re.match(r"^(\d+\s*)?Editors?.?\s*Note", para):
                continue
            cleaned.append(para)
        paras = cleaned
        # the author's name heads the judgment ("Obaidul Hassan, C.J.") — it's already in the header
        if paras and len(paras[0]) < 70 and re.search(r"J\.?\s*:?$", paras[0]):
            paras = paras[1:]
        if len(paras) < 3:
            continue

        if not judges and author:
            judges = ["Justice " + re.sub(r",?\s*C?J\.?$", "", author).strip().title()]
        year, court = m.group(2), m.group(3)
        pm = re.search(r"(\d{1,4})\s*$", first)
        page = m.group(4) or (pm.group(1) if pm else str(i + 1))
        citation = f"{m.group(1)} SCOB [{year}] {court} {page}"
        slug = f"{m.group(1)}-scob-{year}-{court.lower()}-{page}"
        full = " ".join(paras)
        petition = bool(re.search(r"petition|revision|reference|matter|rule", case_no, re.I))
        parts = re.split(r"\s+v\.\s+", title, maxsplit=1)
        records.append(
            {
                "slug": slug,
                "title": title,
                "citation": citation,
                "caseNo": case_no,
                "origin": origin,
                "court": court,
                "date": date or f"{year}-01-01",
                "dateKnown": bool(date),
                **({"hearing": hearing} if hearing else {}),
                "judges": judges,
                **({"author": author} if author else {}),
                "type": case_type(case_no, origin),
                "keywords": keywords,
                "parties": {"appellant": parts[0], "respondent": parts[1] if len(parts) > 1 else ""},
                "petition": petition,
                # drop counsel entries the header layout garbled (they swallowed the case heading)
                "advocates": [a | {"names": a["names"].rstrip(" ,;")} for a in advocates if not re.search(r"SCOB \[|DIVISION|\bVs\b", a["names"])][:6],
                "laws": extract_laws(full),
                "citationsReferred": extract_citations(full, citation),
                "excerpt": re.sub(r"^\d{1,3}\.\s*", "", next((p for p in paras if len(p) > 120), paras[0]))[:420],
                "paragraphs": len(paras),
                "source": {"volume": vol, "page": i + 1,
                           "url": f"https://supremecourt.gov.bd/resources/bulletin/{vol}.pdf#page={i + 1}"},
            }
        )
        json.dump(paras, open(f"{OUT}/judgments/{slug}.json", "w"), ensure_ascii=False, separators=(",", ":"))
    return records


records = []
for f in sorted(glob.glob(f"{SRC}/*_SCOB_*.pdf"), key=lambda p: int(os.path.basename(p).split("_")[0])):
    recs = parse_volume(f)
    print(f"{os.path.basename(f)}: {len(recs)} judgments")
    records.extend(recs)

# related: SCOB judgments cited in the text (either direction), then shared key words
by_cite = {re.sub(r"\W", "", r["citation"]): r["slug"] for r in records}
cites = {r["slug"]: [by_cite[k] for k in (re.sub(r"\W", "", c) for c in r["citationsReferred"]) if k in by_cite] for r in records}
for r in records:
    linked = cites[r["slug"]] + [s for s, cs in cites.items() if r["slug"] in cs]
    kw = {k.lower() for k in r["keywords"]}
    scored = sorted(
        ((len(kw & {k.lower() for k in o["keywords"]}), o["slug"]) for o in records if o["slug"] != r["slug"]),
        reverse=True,
    )
    linked += [s for n, s in scored if n > 0][:4]
    r["related"] = list(dict.fromkeys(s for s in linked if s != r["slug"]))[:5]

json.dump(records, open(f"{OUT}/scob-index.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"total: {len(records)}; with date: {sum(r['dateKnown'] for r in records)}; "
      f"with judges: {sum(bool(r['judges']) for r in records)}; with keywords: {sum(bool(r['keywords']) for r in records)}")
