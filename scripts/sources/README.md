# Catalogue sources

How `data/catalogue` was made. These Python scripts came from the reader site, which no longer keeps the data.

- `fetch_bdlaws.py` downloads acts from bdlaws.minlaw.gov.bd; `parse_bdlaws.py` turns them into `laws/bdlaws/*.json`.
- `parse_cpc_sections.py`, `parse_cpc_first_schedule.py` build the CPC's sections, Orders and Rules; `sync_bn.py` merges
  the unofficial Bangla translations in `laws/bn`.
- `parse_scob.py` builds `cases/` from the Supreme Court Online Bulletin.
- `dump_*.py`, `export_json.py` are inspection helpers.

After changing the data, load it with `npx tsx --env-file=.env scripts/import-catalogue.ts` (idempotent).
Paths inside the scripts still point at the reader site's old `src/lib/...` folders; adjust them before rerunning.
