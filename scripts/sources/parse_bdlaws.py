"""Parse whole-Act pages from bdlaws.minlaw.gov.bd (/act-details-<id>.html) into the app's law data.

Usage: python scripts/parse_bdlaws.py acts.json raw_dir/ out_dir/
  acts.json — the alphabetical index: {"<id>": {"title", "no", "year"}} (Acts with English titles are parsed)
  raw_dir   — the saved pages as UTF-8, named <id>.html
  out_dir   — writes <slug>.json per Act and index.json (the catalogue rows)

Each law keeps the language it was enacted in — English, or Bangla exactly as published (nothing is
translated); `language` in the index says which. Footnotes (amendment notes) come from `<span class='footnote' title=…>`
and are kept per section; blocks reference them by number. Structure: Part / Chapter banners and the
sub-headings under them, then sections in order. CPC is skipped: its sections and Orders come from
parse_cpc_sections.py / parse_cpc_first_schedule.py and carry a Bangla translation."""
import sys, re, json, html, os, collections

INDEX, RAW, OUT = sys.argv[1], sys.argv[2].rstrip("/"), sys.argv[3].rstrip("/")
os.makedirs(OUT, exist_ok=True)
SKIP = {"86"}  # Code of Civil Procedure — imported separately
# Laws already in the hand-written catalogue keep their slug (and their Bangla titles there)
ALIAS = {
    "367": "constitution-1972",
    "11": "penal-code-1860",
    "75": "crpc-1898",
    "24": "evidence-act-1872",
    "26": "contract-act-1872",
    "36": "specific-relief-act-1877",
    "48": "transfer-of-property-act-1882",
    "88": "limitation-act-1908",
    "90": "registration-act-1908",
    "305": "muslim-family-laws-ordinance-1961",
    "415": "bangladesh-bank-order-1972",
    "952": "labour-act-2006",
}
# Laws not in the hand-written catalogue whose Bangla title would otherwise give a numbered slug
NAMED = {"957": "constitution-1972-bangla"}
MARK_RE = re.compile(r"^(\[?)\(([0-9০-৯]+(?:-?[A-Zক-হ])?|[a-z]{1,2}|[ivx]{1,5}|[ক-হঅ-ঔ][\u09BE-\u09CC]?)\)\s*")
# "9. The Courts…" / "১। এই আইন…"
NUM_RE = re.compile(r"^(\[?)\s*([0-9০-৯]+[A-Zক-হ]{0,2}(?:\s*[-–]\s*[0-9০-৯]+[A-Zক-হ]?)?)\s*[.।৷]\s*")
BN_DIGITS = "০১২৩৪৫৬৭৮৯"
BN_SUFFIX = "কখগঘঙচছজঝঞ"  # as lib/format.ts writes "148A" → "১৪৮ক"


def ascii_number(n):
    """'১০ক' → '10A' for URLs; the reader writes it back in Bangla."""
    n = "".join(str(BN_DIGITS.index(c)) if c in BN_DIGITS else c for c in n)
    return "".join(chr(65 + BN_SUFFIX.index(c)) if c in BN_SUFFIX else c for c in n if c.isascii() or c in BN_SUFFIX)


def latin_digits(text):
    return "".join(str(BN_DIGITS.index(c)) if c in BN_DIGITS else c for c in text)


def text_of(fragment):
    t = html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.;:\]\)])", r"\1", t)
    t = re.sub(r"([\[\(])\s+", r"\1", t)
    # "Explanation.-A suit" / "namely:-" → em dash, as printed
    t = re.sub(r"([,:.])\s?-(?=[\sA-Z(\[“\"]|$)", r"\1—", t)
    # "shall apply to-" / "namely-" at the end of a line introduces the clauses below
    return re.sub(r"(\w)\s?-$", r"\1—", t)


FOOTNOTE_RE = re.compile(r"<span class='footnote'.*?</sup></span></span>", re.S)


def label_of(fragment):
    """Heading text without its footnote markers (the notes belong to the section text)."""
    return text_of(FOOTNOTE_RE.sub("", fragment))


def tidy(label):
    """'PRELIMINARY' → 'Preliminary'; mixed-case text is kept."""
    if label.isupper():
        small = {"of", "and", "the", "to", "in", "for", "on", "or", "by", "with", "as", "at", "from"}
        words = label.lower().split()
        return " ".join(w if i and w in small else w[:1].upper() + w[1:] for i, w in enumerate(words))
    return label


def slugify(title, year):
    t = re.sub(r"^the\s+", "", title.strip(), flags=re.I)
    # "(President's Order No. 48 of 1972)", "(East Bengal Act)", "(A.P.O.)": the designation, not the name
    t = re.sub(r"\((?:[^()]*\b(?:order|ordinance|act|p\.?\s?o|a\.?\s?p\.?\s?o)\b[^()]*|\d{4})\)\.?\s*$", " ", t, flags=re.I)
    words = re.sub(r"[^a-z0-9]+", " ", t.lower()).split()
    while len("-".join(words)) > 72 and len(words) > 4:  # very long names: drop words before the year
        words.pop(-2)
    s = "-".join(words)
    return s if s.endswith(year) or not year else f"{s}-{year}" if not re.search(r"\d{4}$", s) else s


def law_type(title, number=""):
    t = f"{title} {number}".lower()
    if "রাষ্ট্রপতির আদেশ" in t:
        return "po"
    if "অধ্যাদেশ" in t:
        return "ordinance"
    if "সংবিধান" in t:
        return "constitution"
    if "constitution" in t and "people" in t:
        return "constitution"
    if "president" in t and "order" in t:
        return "po"
    if "ordinance" in t:
        return "ordinance"
    return "act"


SUBJECTS = [
    ("criminal", r"penal|criminal|crime|offence|police|prison|arms|narcotic|explosive|corruption|money laundering|terror|evidence"),
    ("evidence", r"evidence|oaths"),
    ("civil-procedure", r"civil procedure|civil courts|court fees|suits valuation|arbitration|specific relief|limitation"),
    ("contract", r"contract|sale of goods|partnership|negotiable|arbitration|insurance"),
    ("property", r"property|land|tenancy|rent|estate|registration|stamp|acquisition|mortgage|easement|trust|succession|waqf|wakf"),
    ("family", r"marriage|divorce|dower|family|guardian|child|minor|maintenance|inheritance|dissolution of muslim"),
    ("labour", r"labour|labor|worker|employment|factories|wages|trade union"),
    ("banking", r"bank|currency|finance|loan|money|insurance|securities|exchange|company|companies|tax|customs|excise|revenue|income"),
    ("constitutional", r"constitution|election|parliament|president|judges|supreme court|public service|ombudsman|citizenship|emergency"),
    ("cyber", r"digital|cyber|information technology|telecommunication|telegraph|wireless"),
    ("registration", r"registration|births|deaths|census|passport|identity"),
]


# The same subjects for titles in Bangla
SUBJECTS_BN = [
    ("criminal", r"দণ্ড|অপরাধ|পুলিশ|কারা|অস্ত্র|মাদক|দুর্নীতি|সন্ত্রাস|মানিলন্ডারিং|নির্যাতন|পাচার|সাক্ষী"),
    ("civil-procedure", r"দেওয়ানী|দেওয়ানি|আদালত|সালিশ|মধ্যস্থতা|বিচার"),
    ("contract", r"চুক্তি|বীমা|অংশীদারি|বাণিজ্য"),
    ("property", r"ভূমি|জমি|সম্পত্তি|প্রজাস্বত্ব|ওয়াক্ফ|ওয়াকফ|দেবোত্তর|নিবন্ধন|রেজিস্ট্রেশন|অধিগ্রহণ|ইমারত|ভাড়া"),
    ("family", r"বিবাহ|তালাক|পারিবারিক|শিশু|নারী|অভিভাবক|যৌতুক|ভরণপোষণ"),
    ("labour", r"শ্রম|শ্রমিক|কর্মচারী|চাকরি"),
    ("banking", r"ব্যাংক|অর্থ|কর|শুল্ক|মুদ্রা|বিনিয়োগ|সিকিউরিটিজ|কোম্পানি|আয়কর|মূল্য সংযোজন|রাজস্ব|ঋণ"),
    ("constitutional", r"সংবিধান|নির্বাচন|সংসদ|রাষ্ট্রপতি|নাগরিক|পাবলিক সার্ভিস|ন্যায়পাল|মানবাধিকার"),
    ("cyber", r"ডিজিটাল|সাইবার|তথ্য ও যোগাযোগ|টেলিযোগাযোগ|ইলেকট্রনিক"),
    ("registration", r"জন্ম|মৃত্যু|জাতীয় পরিচয়|পাসপোর্ট|শুমারি"),
]


def subject(title):
    t = title.lower()
    for key, pattern in SUBJECTS_BN:
        if re.search(pattern, title):
            return key
    for key, pattern in SUBJECTS:
        if re.search(pattern, t):
            return key
    return "general"


ROMAN_RE = re.compile(r"^[IVXLCDM]+$")


def act_no(raw, title):
    """'( ACT NO. V OF 1908 )' → 'Act No. V of 1908'."""
    m = re.search(r"<h4[^>]*>(.*?)</h4>", raw, re.S)
    t = text_of(m.group(1)).strip("() ") if m else ""
    t = re.sub(r"\s+", " ", t)
    if not t:
        return ""
    if re.search(r"[\u0980-\u09FF]", t):  # "২০০৬ সনের ৪২ নং আইন" — kept as printed
        return t
    t = t.title()
    t = re.sub(r"\b(No|Of)\b", lambda x: {"No": "No.", "Of": "of"}[x.group(1)], t).replace("No..", "No.")
    t = re.sub(r"\b([IVXLCDM]+)\b", lambda x: x.group(1).upper(), t, flags=re.I)
    t = re.sub(r"\bP\.?o\.?\b", "P.O.", t)
    return t.replace("'S ", "'s ")


def parse(raw):
    main = raw[raw.find('class="bg-act-section'):]
    long_title = re.search(r'act-role-style">\s*(?:<strong>)?\s*<p>(.*?)</p>', main, re.S)
    long_title = label_of(long_title.group(1)).lstrip("♣* ").strip() if long_title else ""
    pre = re.search(r'act-role-style.*?<div class="col-md-12 pad-right">(.*?)</div>\s*</div>\s*</div>', main, re.S)
    preamble = " ".join(p for p in (text_of(x) for x in re.split(r'<div class="clbr">', pre.group(1))) if p) if pre else ""
    date = re.search(r'publish-date">\s*\[(.*?)\]', main, re.S)
    date = re.sub(r"\s+", " ", date.group(1)).strip() if date else ""

    # Footnote texts are on the spans themselves; the list at the bottom repeats them
    body = main[main.find('bg-striped'):]
    body = body[: body.find('footnoteListAll')] if "footnoteListAll" in body else body

    groups, banner, sub, sections = [], None, None, []
    rows = re.split(r'<div class="row lineremoves\s*">', body)[1:]
    pending_no = None
    for row in rows:
        for m in re.finditer(r'<p class="(act-(?:part|chapter)-(?:no|name))[^"]*"[^>]*>(.*?)</p>', row, re.S):
            label = label_of(m.group(2))
            if m.group(1).endswith("-no"):
                pending_no = tidy(label)
            else:
                banner = " — ".join(x for x in [pending_no, tidy(label)] if x)
                pending_no, sub = None, None
        h = re.search(r'<p class="act-section-head[^"]*"[^>]*>(.*?)</p>', row, re.S)
        if h:
            sub = tidy(label_of(h.group(1)).strip("[] .")) or None
        head = re.search(r'class="col-sm-3 txt-head"[^>]*>(.*?)</div>', row, re.S)
        det = re.search(r'id="sec-dec"[^>]*>(.*?)</div>\s*</div>\s*$', row, re.S) or re.search(r'id="sec-dec"[^>]*>(.*)', row, re.S)
        if not det:
            continue
        notes = []

        def note(m):
            notes.append(text_of(m.group(1)))
            return f" ⟦{len(notes)}⟧ "

        raw_text = re.sub(r"<span class='footnote'\s+title='(.*?)'>.*?</sup></span></span>", note, det.group(1), flags=re.S)
        pieces = []
        for x in re.split(r'<div class="clbr">|</p>', raw_text):
            p = text_of(x)
            refs = [int(r) for r in re.findall(r"⟦(\d+)⟧", p)]
            p = re.sub(r"\s*⟦\d+⟧\s*", " ", p)
            p = re.sub(r"\s+([,.;:\]])", r"\1", re.sub(r"\s+", " ", p)).strip()
            if p:
                pieces.append((p, refs))
        if not pieces:
            continue
        num = NUM_RE.match(pieces[0][0])
        title = label_of(head.group(1)).strip() if head else ""
        title = title.rstrip(".").strip()
        if title.startswith("[") and title.endswith("]") and title.count("[") == 1:
            title = title[1:-1].strip().rstrip(".")
        if num:
            pieces[0] = (num.group(1) + pieces[0][0][num.end():], pieces[0][1])
        blocks = []
        for p, refs in pieces:
            block = {"kind": "para"}
            mk = MARK_RE.match(p)
            if mk:
                mark = mk.group(2)
                block = {"kind": "para" if mark[0].isdigit() else "clause", "mark": f"({mark})"}
                p = mk.group(1) + p[mk.end():]
            if not p:
                continue
            block["text"] = p
            if refs:
                block["notes"] = refs
            blocks.append(block)

        if not num:
            if sections:  # an unnumbered row continues the previous section
                prev = sections[-1]
                offset = len(prev.get("notes", []))
                for b in blocks:
                    if "notes" in b:
                        b["notes"] = [x + offset for x in b["notes"]]
                prev.setdefault("body", []).extend(blocks)
                if notes:
                    prev.setdefault("notes", []).extend(notes)
            continue
        n = ascii_number(re.sub(r"\s*[-–]\s*", "-", num.group(2)))
        same = next((s for s in sections if s["n"] == n), None)
        plain = lambda bs: [(b.get("mark"), b["text"]) for b in bs]
        if same and plain(same.get("body", [])) == plain(blocks):  # the site sometimes repeats a row word for word
            continue
        if same:  # a genuinely different section with a repeated number (a typo on the site) gets a suffix
            n = f"{n}-{sum(1 for s in sections if s['n'].startswith(n))}"
        rec = {"n": n, "title": title or ""}
        if blocks:
            rec["body"] = blocks
        if notes:
            rec["notes"] = notes
        key = (banner, sub)
        if not groups or (groups[-1]["banner"], groups[-1]["sub"]) != key:
            groups.append({"banner": banner, "sub": sub, "sections": []})
        groups[-1]["sections"].append(rec)
        sections.append(rec)

    parts = []
    for i, g in enumerate(groups):
        ns = [s["n"] for s in g["sections"]]
        title = " — ".join(x for x in [g["banner"], g["sub"]] if x) or "Provisions"
        part = {"id": f"g{i + 1}", "title": title, "range": ns[0] if len(ns) == 1 else f"{ns[0].split('-')[0]}–{ns[-1].split('-')[-1]}"}
        if g["banner"]:
            part["banner"] = g["banner"]
        if g["sub"]:
            part["sub"] = g["sub"]
        part["sections"] = g["sections"]
        parts.append(part)
    return {"longTitle": long_title, "preamble": preamble, "date": date, "parts": parts}


def bangla_share(raw):
    text = re.sub(r"<[^>]+>", " ", raw[raw.find("bg-striped"):raw.find("footnoteListAll")])
    bangla, latin = len(re.findall(r"[\u0980-\u09FF]", text)), len(re.findall(r"[A-Za-z]", text))
    return bangla / max(1, bangla + latin)


acts = json.load(open(INDEX))
rows, slugs, stats = [], collections.Counter(), collections.Counter()
for aid, meta in sorted(acts.items(), key=lambda kv: int(kv[0])):
    if aid in SKIP:
        continue
    path = f"{RAW}/{aid}.html"
    if not os.path.exists(path):
        stats["missing"] += 1
        continue
    raw = open(path, encoding="utf-8").read()
    # Enacted in Bangla (also some recent amending Acts with English titles): kept in Bangla, as published
    language = "bn" if bangla_share(raw) > 0.2 else "en"
    try:
        data = parse(raw)
    except Exception as e:  # keep going; report at the end
        print(f"  ! {aid} {meta['title']}: {e}")
        stats["failed"] += 1
        continue
    title = re.sub(r"\s+", " ", re.sub(r"[\u200b-\u200d\ufeff]", "", meta["title"])).strip()
    year = re.sub(r"\D", "", latin_digits(meta["year"]))[:4]
    repealed = bool(re.search(r"repealed", title, re.I)) or (
        sum(len(p["sections"]) for p in data["parts"]) <= 1
        and re.search(r"\brepealed\b", " ".join(b["text"] for p in data["parts"] for s in p["sections"] for b in s.get("body", [])), re.I)
    )
    title = re.sub(r"\s*\[?\(?repealed\)?\]?\s*$", "", title, flags=re.I).strip()
    # A Bangla title has no Latin words for a slug; the year and bdlaws id keep it short and stable
    slug = ALIAS.get(aid) or NAMED.get(aid) or (slugify(title, year) if re.search(r"[A-Za-z]", title) else f"law-{year}-{aid}")
    slugs[slug] += 1
    if slugs[slug] > 1:
        slug = f"{slug}-{slugs[slug]}"
    count = sum(len(p["sections"]) for p in data["parts"])
    if count == 0:
        stats["empty"] += 1
        continue
    stats["sections"] += count
    stats[f"acts ({language})"] += 1
    number = act_no(raw, title) or (f"{meta['no']} of {year}" if meta["no"] else "")
    kind = law_type(title, number)
    unit = "articles" if kind in ("constitution", "po") else "sections"
    description = data["longTitle"] or data["preamble"]
    if len(description) > 220:
        description = description[:220].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    record = {
        "slug": slug,
        "bdlawsId": int(aid),
        "curated": aid in ALIAS,
        "language": language,
        "title": title,
        "actNo": number,
        "year": int(year) if year else 0,
        "type": kind,
        "status": "repealed" if repealed else "in-force",
        "subject": subject(title),
        "description": description,
        "sections": count,
        "unit": unit,
    }
    rows.append(record)
    json.dump({"slug": slug, **data}, open(f"{OUT}/{slug}.json", "w"), ensure_ascii=False, separators=(",", ":"))

json.dump(rows, open(f"{OUT}/index.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(dict(stats))
