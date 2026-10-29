# API gaps found while wiring the admin panel's money and system pages

Found by the admin panel's wave-2 work on the dashboard, users, plans, payments, audit log, system health,
settings and support stats. None blocks a page; each is worked around in the panel as noted.

| # | Route | Gap | Panel today |
| --- | --- | --- | --- |
| 1 | `GET /admin/billing/plans` | `recurringRevenue` has no previous-month value, so the "Recurring revenue" card can't show a trend. | Card shows the figure without a trend. |
| 2 | `GET /admin/billing/payments` | Only a single `month` filter; no `from`/`to` range. The page's 3/6/12-month menu therefore scopes the chart only, not the list. | Period menu affects the revenue chart. |
| 3 | `GET /admin/health` | Every call is a fresh check; there is no stored history of runs or incidents. | The response chart plots only the runs made from the open page. |
| 4 | `GET /admin/audit` | `q` matches target id/label/action but not the actor's name. | Filter by member uses `actor=AGT-xx` instead. |
| 5 | `GET /admin/dashboard` | `recent.tickets` rows have no `lang` or `resolvedAt` (the list route has both). | Not needed by the dashboard table. |
| 6 | `site_settings.contact` seed | `hours`, `office`, `officeNote` are empty in both languages, and the panel requires both languages before saving. | The first save asks the team to fill them in. |
| 7 | Server-action testing | Not an API gap: the admin's server actions are thin wrappers over the routes above; their flows (payment verify → refund, settings PUTs, plan commands) were exercised against the API directly. | — |

## Status (agent F)

| # | Now |
| --- | --- |
| 1 | `previousRecurringRevenue` on `GET /admin/billing/plans`. |
| 2 | `from` / `to` ("YYYY-MM", both included) on `GET /admin/billing/payments` (and its export, which shares the query). |
| 3 | Runs are stored every five minutes (and when the page checks); `GET /admin/health/history?hours=` returns runs and incidents. |
| 4 | `q` on `GET /admin/audit` also matches the team member's name (either language) or email. |
| 5 | `lang` and `resolvedAt` on the dashboard's recent tickets. |
| 6 | The contact seed carries the contact page's hours and office text in both languages; the live row was filled where empty. |
| 7 | Nothing to do. |
