"""Download every law from bdlaws.minlaw.gov.bd for parse_bdlaws.py.

Usage: python scripts/fetch_bdlaws.py work_dir/ [--english-only]
  Writes work_dir/acts.json (the alphabetical index: id → title, number, year) and work_dir/raw/<id>.html (each
  law's whole-text page, /act-details-<id>.html, as UTF-8). Every law is fetched (with --english-only, only
  those with English titles); pages
  already saved are skipped, so an interrupted run can simply be started again. Four requests at a time.
Then: python scripts/parse_bdlaws.py work_dir/acts.json work_dir/raw src/lib/laws/data/bdlaws"""
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

WORK = sys.argv[1].rstrip("/")
SITE = "http://bdlaws.minlaw.gov.bd"
os.makedirs(f"{WORK}/raw", exist_ok=True)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (lawsboi research import)"})
    data = urllib.request.urlopen(req, timeout=150).read()
    # The site serves UTF-16 with a byte-order mark
    return data.decode("utf-16") if data[:2] in (b"\xfe\xff", b"\xff\xfe") else data.decode("utf-8", "replace")


index_path = f"{WORK}/acts.json"
if not os.path.exists(index_path):
    page = get(f"{SITE}/laws-of-bangladesh-alphabetical-index.html")
    acts = {}
    for row in page.split("<tr>")[1:]:
        links = re.findall(r'<a href="/act-(\d+)\.html">\s*([^<]*?)\s*</a>', row.split("</tr>")[0])
        if len(links) >= 3 and links[0][0] == links[1][0] == links[2][0]:
            acts.setdefault(links[0][0], {"title": links[0][1], "no": links[1][1], "year": links[2][1]})
    json.dump(acts, open(index_path, "w"), ensure_ascii=False)
acts = json.load(open(index_path))
ids = [k for k, v in acts.items() if "--english-only" not in sys.argv or re.search(r"[A-Za-z]", v["title"])]


def fetch(i):
    out = f"{WORK}/raw/{i}.html"
    if os.path.exists(out) and os.path.getsize(out) > 2000:
        return "skip"
    for attempt in range(4):
        try:
            open(out, "w", encoding="utf-8").write(get(f"{SITE}/act-details-{i}.html"))
            return "ok"
        except Exception:
            time.sleep(5 * (attempt + 1))
    return "fail"


with ThreadPoolExecutor(4) as ex:
    for done, (i, r) in enumerate(zip(ids, ex.map(fetch, ids)), 1):
        if r == "fail" or done % 25 == 0:
            print(f"{done}/{len(ids)} {i} {r}", flush=True)
print("finished")
