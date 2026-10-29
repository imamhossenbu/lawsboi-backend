import json, sys
d = json.load(open(sys.argv[1]))
out = {o["roman"]: [{"n": r["n"], "title": r["title"], **({"body": r["body"]} if r["body"] else {})} for r in o["rules"]] for o in d}
# Part sub-headings (e.g. "Service of Summons") print between rules and get glued onto the previous
# rule's title and last sentence. When the title's last segment repeats after the final full stop, drop it.
for rules in out.values():
    for r in rules:
        if not r.get("body") or ". " not in r["title"]:
            continue
        head, tail = r["title"].rsplit(". ", 1)
        last = r["body"][-1]["text"]
        if last.endswith(" " + tail) and last[: -len(tail) - 1].rstrip()[-1:] in ".]:;":
            r["title"] = head
            r["body"][-1]["text"] = last[: -len(tail) - 1].rstrip()
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
