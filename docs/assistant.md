# Assistant API

An answer is the provisions and judgments that best match the question (Postgres full-text search over the whole
catalogue: `search_provisions`, `search_judgments`) plus a text the language model writes from them and only from
them, citing them as [1], [2]… (see [ai.md](ai.md)). When the first search finds little, or the question is in
Bangla, the model turns the question into English search terms and the search runs again (most of the catalogue,
and every SCOB judgment, is English). The text is in the question's language: Bangla script means Bangla.

If the model is missing, slow or refuses, the reader still gets the sources, with `text: null` and a `reason`;
the question still counts. Questions readers ask are logged with the whole answer and counted against their plan's
monthly allowance; months run on Bangladesh time.

## Readers

| Route | Auth | Body / query | Returns |
| --- | --- | --- | --- |
| `POST /assistant/preview` | none (20 an hour per address) | `{ question, scope?: all\|laws\|cases, lang? }` | `{ answer: Answer }` — for the landing page; not logged |
| `POST /assistant/ask` | reader | same, plus `conversationId?` (a follow-up in that chat) | `201 { id, conversationId, at, answer: Answer, usage }`; `403 { details: { allowance: "exhausted" } }` when the month's questions are used up; `404` for someone else's chat. A follow-up's model input carries the chat's last three questions and answers, and a short follow-up that finds little is searched together with the previous question |
| `GET /assistant/usage` | reader | | `{ usage: { used, limit: number \| null, resetsAt } }` |
| `GET /assistant/history` | reader | `page`, `perPage`, `conversationId?`, `saved=true\|false` | `{ questions: [{ id, conversationId, question, lang, scope, answer, saved, at }], total, … }` |
| `GET /assistant/conversations` | reader | `page`, `perPage` | `{ conversations: [{ id, title /* the first question */, lang, count, saved, startedAt, lastAt }], total, … }`, latest activity first |
| `POST /assistant/history/:id/save` | reader | `{ saved?: boolean }` (default true); `id` is a chat (or a question) | `{ conversationId, saved }` |
| `DELETE /assistant/history/:id` | reader | | `204` — erases the chat's questions and answers. The rows stay, emptied, because the month's allowance counts every question asked |
| `DELETE /assistant/history` | reader | | `204` — the same for every chat (the Danger zone's "clear history") |

```ts
Answer = { query, scope, laws: SourceHit[], cases: SourceHit[],
  text: string | null /* plain paragraphs, "- " list lines allowed, [n] markers in Latin digits */,
  citations: { index /* the n in [n] */, kind, id, title: Text, label: Text, href }[] /* only the sources the text cites */,
  lang: "en" | "bn", model: string | null,
  reason?: "no_sources" | "not_configured" | "unavailable" | "invalid" | "blocked" }
// [n] numbers the sources in order: laws first, then cases (citations[].index points into that list)
SourceHit = { kind: "law"|"case", id, title: Text, label: Text /* "Section 151" / "Order XXXIX, Rule 1" / "19 SCOB [2024] AD 1" */,
  context: Text /* the law's title / the court */, snippet: Text, href /* /bd/laws/cpc-1908/section-151, /bd/cases/<slug> */ }
```

Limits come from `site_settings` key `assistant_limits` (`{ free: 5, researcher: 30, professional: null }`; `null` is
unlimited).

## Team (`/admin/assistant`, permission `assistant.view`; writes need `assistant.manage`)

| Route | Query / body | Returns |
| --- | --- | --- |
| `GET /questions` | `q`, `plan`, `lang`, `coverage=both\|laws\|cases\|none`, `flagged=true\|false`, `month=YYYY-MM`, `user=USR-…`, `scope=all\|laws\|cases`, `page`, `perPage` | `{ questions: [{ id, question, lang, scope, coverage, laws, cases, text, citations, model, reason, flagged, at, user: { id, name: Text, email, plan } }], total, … }` |
| `GET /questions/:id` | | `{ question }` — one question with its whole answer |
| `GET /stats` | | `{ months: [{ month, total, byPlan }] (12), weeks: [{ start, byPlan }] (8, Monday start), thisMonth: { month, questions, readers, paidReaders, coverage: { both, laws, cases, none }, withCases, withLaws, bangla, banglaNoCases }, lastMonthToDate, topQuestions: [{ question, lang, count, latestId }], atLimit: [{ user, used, last }], limits }` |
| `GET /limits` | | `{ limits }` |
| `PUT /limits` | `{ free, researcher, professional }` (numbers or null) | `{ limits }` + audit `assistant.limits` |
| `POST /questions/:id/flag` | `{ flagged }` | `{ question }` + audit `assistant.flag` / `assistant.unflag` |
