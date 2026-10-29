# API gaps found while wiring the admin panel's content-side pages (agent G)

Ordered by how much the panel needs them. The panel already calls the routes below as written; until they exist it
falls back as noted.

1. **`GET /admin/catalogue/stats`** (laws.view) → `{ laws, bangla, sections, translated, drafts, cases, casesDraft, linkedCases, links }`
   — the Laws page's four cards cover the whole catalogue (1,298 laws). Today only the counts a `perPage=1` list call
   can give are shown; sections and translated sections show "—".
2. **`translation=none|partial|full` on `GET /admin/catalogue/laws`** — the Laws list's "Translation" filter (share of
   sections with a translation: none, some, all). The panel sends it; the API ignores it today.
3. **`GET /admin/assistant/stats` coverage and limits figures** — `thisMonth.coverage: { both, laws, cases, none }`,
   `thisMonth.banglaNoCases`, `thisMonth.withCases`, `thisMonth.paidReaders`, `lastMonthToDate` (same days of last
   month), `weeks: [{ start, byPlan }]` (last 8, Monday start, Dhaka time) and `atLimit: [{ user, used, last }]`.
   The panel computes these today by paging through the last three months of `/questions` (≤ 3,000 rows a month).
4. **`GET /admin/assistant/questions` → `scope` filter and `top` grouping with answers** — the "Most asked" tab can't
   open an answer, because `topQuestions` carries no question id; adding `latestId` to each top question would do.
5. **Plan reader counts without `plans.view`** — the flags and announcements pages show "{n} readers" per plan. The
   panel uses `/admin/announcements/reach?channels=banner&plans=<plan>` for it (announcements.view) and
   `/admin/billing/plans` (plans.view) on the flags page, falling back to "—". A `GET /admin/users/by-plan`
   (any team member) would remove both workarounds.


## Status (agent F)

All five are in the API now:

1. `GET /admin/catalogue/stats` → `{ laws, bangla, drafts, sections, translated, cases, casesDraft }`.
2. `translation=none|partial|full` on `GET /admin/catalogue/laws` (kept on `laws.translation_state` by a trigger).
3. `GET /admin/assistant/stats` carries `weeks`, `thisMonth.{coverage, withCases, banglaNoCases, paidReaders}`,
   `lastMonthToDate` and `atLimit` (see docs/assistant.md).
4. `scope` filter on `GET /admin/assistant/questions`, `latestId` on each top question, and
   `GET /admin/assistant/questions/:id` to open one.
5. `GET /admin/users/by-plan` for any team member.
6. **Reading a SCOB judgment PDF** (`POST /admin/ai/cases/read`, laws.cases) — the "Add judgment" form had a
   "Fill from a PDF" box that only ever filled sample text; it's gone until such a route exists.
7. **`/admin/ai/laws/read` options** — the import page also sends `language` (`en|bn`, when not "auto") and
   `onlyStatute` (`true|false`) with the files; the route ignores both today.

6. `POST /admin/ai/cases/read` (laws.cases): one judgment PDF in, the "Add judgment" form's fields out, with cited
   provisions matched to the catalogue (see docs/ai.md).
7. `/admin/ai/laws/read` reads `language` and `onlyStatute` from the multipart fields now.
