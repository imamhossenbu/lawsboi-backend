"""Print CPC sections with numbered blocks and footnotes, for translating: python scripts/dump_sections.py part-1 [part-2 …]"""
import json, os, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "laws", "data")
groups = json.load(open(f"{ROOT}/cpc-sections.json", encoding="utf-8"))
for want in sys.argv[1:]:
    for g in groups:
        if re.sub(r"^(part-\d+).*$", r"\1", g["id"]) != want:
            continue
        print(f"=== {g['id']} | {g['title']}")
        for s in g["sections"]:
            print(f"## {s['n']} | {s['title']}")
            for i, b in enumerate(s.get("body", [])):
                print(f"  [{i}] {b.get('mark', '')} {b['text']}")
            for i, f in enumerate(s.get("notes", []), 1):
                print(f"  fn{i}: {f}")
