# Assistant API

No language model yet: an answer is the provisions and judgments that best match the question, quoted, found by
Postgres full-text search over the whole catalogue (`search_provisions`, `search_judgments`). Questions readers
ask are logged and counted against their plan's monthly allowance; months run on Bangladesh time.

## Readers

| Route | Auth | Body / query | Returns |
| --- | --- | --- | --- |
| `POST /assistant/preview` | none (20 an hour per address) | `{ question, scope?: all\|laws\|cases, lang? }` | `{ answer: Answer }` — for the landing page; not logged |
| `POST /assistant/ask` | reader | same | `201 { id, at, answer: Answer, usage }`; `403 { details: { allowance: "exhausted" } }` when the month's questions are used up |
| `GET /assistant/usage` | reader | | `{ usage: { used, limit: number \| null, resetsAt } }` |
| `GET /assistant/history` | reader | `page`, `perPage` | `{ questions: [{ id, question, lang, scope, answer, at }], total, … }` |

```ts
Answer = { query, scope, laws: SourceHit[], cases: SourceHit[] }
SourceHit = { kind: "law"|"case", id, title: Text, label: Text /* "Section 151" / "Order XXXIX, Rule 1" / "19 SCOB [2024] AD 1" */,
  context: Text /* the law's title / the court */, snippet: Text, href /* /bd/laws/cpc-1908/section-151, /bd/cases/<slug> */ }
```

Limits come from `site_settings` key `assistant_limits` (`{ free: 5, researcher: 30, professional: null }`; `null` is
unlimited).

## Team (`/admin/assistant`, permission `assistant.view`; writes need `assistant.manage`)

| Route | Query / body | Returns |
| --- | --- | --- |
| `GET /questions` | `q`, `plan`, `lang`, `coverage=both\|laws\|cases\|none`, `flagged=true\|false`, `month=YYYY-MM`, `user=USR-…`, `page`, `perPage` | `{ questions: [{ id, question, lang, scope, coverage, laws, cases, flagged, at, user: { id, name: Text, email, plan } }], total, … }` |
| `GET /stats` | | `{ months: [{ month, total, byPlan }] (12), thisMonth: { month, questions, readers }, topQuestions: [{ question, lang, count }], limits }` |
| `GET /limits` | | `{ limits }` |
| `PUT /limits` | `{ free, researcher, professional }` (numbers or null) | `{ limits }` + audit `assistant.limits` |
| `POST /questions/:id/flag` | `{ flagged }` | `{ question }` + audit `assistant.flag` / `assistant.unflag` |
