import json, os, sys
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "laws", "data", "cpc-first-schedule.json")))
for roman in sys.argv[1:]:
    print(f"=== ORDER {roman}")
    for r in d[roman]:
        print(f"## {r['n']} | {r['title']}")
        for i, b in enumerate(r.get("body", [])):
            print(f"  [{i}] {b.get('mark','')} {b['text']}")
