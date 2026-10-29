# AI (Google Gemini)

One client for the whole API, `src/lib/ai/gemini.ts`. The main model (`GEMINI_MODEL`, gemini-3.5-flash) is called
through the Interactions API; the fallback (`GEMINI_FALLBACK_MODEL`, gemini-3.5-flash-lite) through generateContent.
A call gets a 45 s budget: the main model, one retry when the failure looked passing (5xx, timeout), then the
fallback. A used-up quota (429) or a reply cut off by its token cap goes straight to the fallback. The key travels
in the `x-goog-api-key` header, never in a URL or a log line.

Replies that must be JSON are held to a JSON schema made from the zod schema that then validates them
(`generateJson`). Length and count limits are left out of what the model sees (Gemini refuses a schema with many
of them) and enforced by zod on the reply.

Every call, worked or not, writes a row to `ai_usage` (purpose, reader or team member, model, tokens, ms, error).

**Quota.** The key in `.env` is on Gemini's free tier: 20 requests a day on the main model; the fallback has its
own allowance. One assistant answer is up to two requests (search terms when needed, then the answer). For
production, enable billing on the Google AI Studio project.

**Tests.** Under `NODE_ENV=test` the model is off unless `AI_LIVE=1`, so `npm test` never spends the quota. The
client's own tests mock fetch. `AI_LIVE=1 npx vitest run tests/ai-live.test.ts` calls the model for real.

## Team (`/admin/ai`)

Errors: `503 { details: { ai: "notConnected" | "unavailable" | "invalid" } }`, `400 { details: { ai: "blocked" | "empty" | "fixed" | "unreadable" } }`.
`Text = { en, bn }`. Nothing is saved: the panel shows the result for the editor to accept.

| Route | Permission (any of) | Body | Returns |
| --- | --- | --- | --- |
| `GET /status` | team | | `{ connected }` |
| `GET /usage` | health.view, assistant.view | | `{ since, connected, purposes: { [purpose]: { calls, failed, tokens, avgMs } } }` (30 days) |
| `POST /translate` | content.edit, laws.translate, announcements.write | `{ text \| texts[], from, to, kind?: legal\|content\|ui }` | `{ text }` or `{ texts }`; marks like (1), (a), numbers, citations kept |
| `POST /tidy` | content.edit, laws.edit, announcements.write | `{ text, lang }` | `{ text }` |
| `POST /assist` | content.edit, announcements.write | `{ task: toBn\|toEn\|polish, text: Text }` | `{ text: Text }` — the one-field AI menu (`aiAssist`) |
| `POST /draft/article` | content.edit | `{ mode: write\|translate\|polish\|add, brief, current?: { title, summary, steps[] } }` | `{ draft: { title, summary, steps: Text[], tryHref?, icon? } }` |
| `POST /draft/page` | content.edit | `{ slug: privacy\|disclaimer\|about, mode, brief, sections: PageSection[] }` | `{ sections }` — the about page keeps its bands (ids and fields); `add` appends one section (not on about) |
| `POST /draft/announcement` | announcements.write | `{ mode, brief, topic, current?: { title, body } }` | `{ draft: { title: Text, body: Text } }` |
| `POST /laws/read` | laws.add | multipart `files`: photos (PNG/JPEG/WebP) or one PDF, 10 MB in all; fields `language=auto\|en\|bn`, `onlyStatute=true\|false` (default true: skip the gazette's cover, notes and tables) | `{ law: { title, actNo, year, type, language, date, longTitle, preamble }, act: { longTitle, preamble, date, parts: [{ id, title, range, sections: [{ n, title, body: Block[], unsure: string[], page }] }] }, model }` |
| `POST /cases/read` | laws.cases | multipart `files`: one judgment PDF (a SCOB report) | `{ case: { title, citation, caseNo, court, date, dateKnown, judges, author, type, keywords, parties, advocates, excerpt, citationsReferred, language, paragraphs }, laws: [{ act, law: slug \| null, kind, n, rule }], model }` — ready for `POST /admin/catalogue/cases`; `law` is null when no catalogue law matched the act's name |
| `POST /laws/translate-section` | laws.translate | `{ slug, n, to? }` | `{ translation: { title, b: string[], f: string[], from, to } }` — ready for `PUT /admin/catalogue/laws/:slug/sections/:n/translation` |

Modes: `write` from the brief (the current draft as context), `translate` fills every empty language side,
`polish` tidies every text in both languages, `add` adds steps (article) or a section (page).
