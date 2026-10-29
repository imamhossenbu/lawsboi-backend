# Gaps found wiring the reader site's catalogue and assistant

Found by the reader site (`../lawsboi`) while moving laws, judgments, search and the assistant onto the API. Each
one works around something on the site today; fixing it here lets the site drop the workaround.

| # | Where | What | The site's workaround |
| --- | --- | --- | --- |
| 1 | `GET /catalogue/laws/search` | Ranking depends on `limit`: with `limit=5`, "section 144" returns the Constitution, then the Merchant Shipping Ordinance, the Air Force Act…; CrPC s.144 and Penal Code s.144 only appear (at 1–2) with `limit=300`. The cut seems to happen before the final sort. | Always asks with `limit=300`. |
| 2 | `POST /assistant/ask`, `GET /assistant/history` | No conversations: `conversationId` in the body is stripped and history rows carry none, so a follow-up shows as its own chat after a reload. | Sends `conversationId` anyway; groups history by `conversationId` when present, else one chat per question. |
| 3 | Assistant history | No way to delete one chat, clear all, or mark one saved (the site's Library and Danger zone offer these). | Changes stay in the browser until reload. Wanted: `DELETE /assistant/history/:id`, `DELETE /assistant/history`, `POST /assistant/history/:id/save`. |
| 4 | `GET /catalogue/totals` | No section, Rule or judgment counts for the About page. | Sums `sections` over `GET /catalogue/laws?perPage=all` and `ruleCount` over the CPC's Orders. Wanted: `{ sections, rules, judgments }` in totals. |
| 5 | `GET /catalogue/laws?perPage=all` | 2.7 MB: every row carries `longTitle`, `preamble`, `date`, `updatedAt` the browse pages don't use. | Strips them on the server before sending the page; still slow to fetch cold (the result is cached for hours). Wanted: `fields=summary`. |
| 6 | `GET /catalogue/cases` | `perPage=all` isn't accepted (laws accepts it). | Pages through at `perPage=200`. |
| 7 | Data files | `scripts/import-catalogue.ts` reads `READER_DIR/src/lib/laws/data` and `src/lib/cases/data`, which the reader site no longer has (deleted with the move; still in its git history at `be0acf4`). | None. The source data and the importer belong together here, e.g. `lawsboi-api/data/`, restored from `git show be0acf4:src/lib/laws/data/...`. The reader's `scripts/*.py` (bdlaws/SCOB parsers) should move with it. |
| 8 | Assistant retrieval | "What are the inherent powers of a civil court?" retrieves customs, succession and inquiries Acts, not CPC s.151, and the written answer says the sources don't cover it. Bangla questions about temporary injunctions find Orders of corporations, not CPC O.39. Plain search (`/catalogue/laws/search?q=inherent powers`) finds s.151 first. | None; the site shows what the API returns. |
| 9 | `POST /catalogue/reads` | Counts every view, including repeated reloads; the home page's "week" figures move with refreshes. | Sends one read per page view (`keepalive`). |

## Status (agent F)

| # | Now |
| --- | --- |
| 1 | Fixed: the numbered provisions were cut to `limit` before being ranked. The search now ranks at least 200 candidates; "section 144" gives the CPC, Penal Code and CrPC first at any `limit`. |
| 2 | `POST /assistant/ask` takes `conversationId` and returns it; history rows carry it; `GET /assistant/conversations` lists chats. A follow-up's answer sees the chat's last three turns. |
| 3 | `DELETE /assistant/history/:id`, `DELETE /assistant/history`, `POST /assistant/history/:id/save`, and `saved` on history rows. Deleting erases the text but keeps the row, so the allowance still counts it. |
| 4 | `GET /catalogue/totals` has `sections`, `rules`, `judgments`. |
| 5 | `fields=summary` on `GET /catalogue/laws` (2.7 MB → 1.6 MB for `perPage=all`). |
| 6 | `perPage=all` on `GET /catalogue/cases` (up to 1,000). |
| 7 | Done in commit 430d02d: the data and parsers live in `data/catalogue` and `scripts/sources`. |
| 8 | The assistant now uses the dashboard's law search and ranking; when no provision holds every word of a question it searches leaving one word out at a time, then any word. "Inherent powers of a civil court" finds CPC s.151; "temporary injunction" finds CPC O.39. Bangla questions get both the Bangla search and the model's English terms, taking turns. |
| 9 | `POST /catalogue/reads` counts a page once per reader (or address) every 30 minutes; the reply says `counted`. |
