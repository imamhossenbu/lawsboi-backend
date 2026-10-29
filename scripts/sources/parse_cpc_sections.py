"""Parse the CPC sections (bdlaws.minlaw.gov.bd/act-86.html + one page per section) into groups → sections → blocks.

Usage: python scripts/parse_cpc_sections.py act-86.html sections_dir/ out.json
  act-86.html  — the act's index page: Part / sub-heading structure and section order
  sections_dir — the saved section pages, named <id>.html (from /act-86/section-<id>.html)
Pages are UTF-16. Footnotes come from `<span class='footnote' title=…>` and are kept per section;
blocks reference them by number. The app reads src/lib/laws/data/cpc-sections.json."""
import sys, re, json, html

INDEX, DIR, OUT = sys.argv[1], sys.argv[2].rstrip("/"), sys.argv[3]
MARK_RE = re.compile(r"^(\[?)\(?(\d+[A-Z]?|[a-z]{1,2}|[ivx]{1,5})\)\s*")
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11}


def read(path):
    return open(path, encoding="utf-16").read()


def text_of(fragment):
    t = html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([,.;:\]])", r"\1", t)
    return re.sub(r"([,:.])-(?=[\sA-Z(\[“\"]|$)", r"\1—", t)


def slug(s):
    return "-".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split()[:4])


# ---- 1. Structure from the index -------------------------------------------------------------
index = read(INDEX)
index = index[index.find("search-here"):]
groups, part_no, part_name, head = [], None, "Preliminary", None
for m in re.finditer(r'<p class="(act-[a-z-]+)[^"]*"[^>]*>(.*?)</p>', index, re.S):
    kind, inner = m.group(1), m.group(2)
    label = text_of(inner)
    if kind == "act-part-no":
        part_no, head = label.replace("Part ", ""), None
    elif kind == "act-part-name":
        part_name = label.title().replace(" Of ", " of ").replace(" To ", " to ").replace(" In ", " in ")
        part_name = part_name.replace(" Relating ", " relating ").replace(" And ", " and ")
    elif kind == "act-chapter-name":
        part_no, part_name, head = None, label.title(), None
    elif kind == "act-section-head":
        head = label.strip("[] .") or None
        if head and head.isupper():
            head = head.title()
    elif kind == "act-section-name":
        sid = re.search(r"section-(\d+)", inner).group(1)
        title = (f"Part {part_no} — " if part_no else "") + (head or part_name)
        gid = (f"part-{ROMAN[part_no]}" if part_no else "preliminary") + (f"-{slug(head)}" if head else "")
        if not groups or groups[-1]["id"] != gid:
            groups.append({"id": gid, "title": title, "part": part_name, "sections": []})
        groups[-1]["sections"].append({"id": sid, "label": label})

# ---- 2. Section pages --------------------------------------------------------------------------
for g in groups:
    out = []
    for s in g["sections"]:
        page = read(f"{DIR}/{s['id']}.html")
        head = re.search(r'class="col-sm-3 txt-head"[^>]*>(.*?)</div>', page, re.S)
        body = re.search(r'id="sec-dec"[^>]*>(.*?)</div>\s*</div>\s*</section>', page, re.S) or re.search(
            r'id="sec-dec"[^>]*>(.*?)</div>\s*</div>', page, re.S
        )
        notes = []

        def note(m):
            notes.append(text_of(m.group(1)))
            return f" ⟦{len(notes)}⟧ "

        raw = re.sub(r"<span class='footnote'\s+title='(.*?)'>.*?</sup></span></span>", note, body.group(1), flags=re.S)
        pieces = []
        for x in re.split(r'<div class="clbr">', raw):
            p = text_of(x)
            refs = [int(r) for r in re.findall(r"⟦(\d+)⟧", p)]
            p = re.sub(r"\s*⟦\d+⟧\s*", " ", p)
            p = re.sub(r"\s+([,.;:\]])", r"\1", re.sub(r"\s+", " ", p)).strip()
            if p:
                pieces.append((p, refs))

        num = re.match(r"^(\d+[A-Z]?(?:-\d+)?)\.?\s*", s["label"])
        first = re.match(r"^(\[?)(\d+[A-Z]?(?:-\d+)?)\s*\.\s*", pieces[0][0]) if pieces else None
        if first:
            pieces[0] = (first.group(1) + pieces[0][0][first.end():], pieces[0][1])
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
            # an unnumbered page continues the previous section (e.g. section 70(2))
            prev = out[-1]
            offset = len(prev.get("notes", []))
            for b in blocks:
                if "notes" in b:
                    b["notes"] = [x + offset for x in b["notes"]]
            prev["body"] += blocks
            prev.setdefault("notes", []).extend(notes)
            continue
        title = re.sub(r"^\d+[A-Z]?\s+(?=\[)", "", text_of(head.group(1)).rstrip(".")) if head else ""
        if not title:
            title = re.sub(r"^\S+\s*", "", s["label"]).rstrip(".")
        rec = {"n": num.group(1), "title": title.strip("[] ") if title.startswith("[") and title.endswith("]") else title}
        if title.startswith("[") and title.endswith("]"):
            rec["title"] = title
        if blocks:
            rec["body"] = blocks
        if notes:
            rec["notes"] = notes
        out.append(rec)
    g["sections"] = out
    ns = [x["n"] for x in out]
    g["range"] = ns[0] if len(ns) == 1 else f"{ns[0].split('-')[0]}–{ns[-1].split('-')[-1]}"

json.dump(groups, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(f"groups: {len(groups)}; sections: {sum(len(g['sections']) for g in groups)}; "
      f"footnotes: {sum(len(s.get('notes', [])) for g in groups for s in g['sections'])}")
for g in groups:
    print(f"  {g['id']:58} {g['range']:9} {g['title']}")
