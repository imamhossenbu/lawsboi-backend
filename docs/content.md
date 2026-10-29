# Content routes

Help articles, FAQs, the legal and about pages, the contact details and the feature flags. Text travels as
`{ en, bn }`. Dates are ISO strings. Errors follow the API's `{ error: { code, message, details? } }` shape;
`details.languages` names the language(s) still empty when publishing is refused.

## Public (`/content`)

| Method | Path | Auth | Query / body | Response |
| --- | --- | --- | --- | --- |
| GET | `/content/articles` | none | | `{ articles: Article[] }` published, in order |
| GET | `/content/articles/:slug` | none (a reader token adds `myVote`) | | `{ article: Article, myVote: boolean \| null }` (404 unless published); `myVote` is the signed-in reader's earlier "Was this helpful?" answer |
| POST | `/content/articles/:slug/read` | none | | 204 — counts an open (the article page calls it once) |
| POST | `/content/articles/:slug/helpful` | reader | `{ helpful: boolean }` | `{ vote, helpful }` — the reader's vote (changeable) and the article's new % |
| GET | `/content/faqs` | none | `?place=help\|pricing\|contact` | `{ faqs: Faq[] }` published, in order |
| GET | `/content/pages/:slug` | none | slug: `privacy\|disclaimer\|about` | `{ page: Page }` |
| GET | `/content/contact` | none | | `{ contact: ContactInfo \| null }` (Settings → Contact) |
| GET | `/content/flags` | none | | `{ flags: Flag[] }` |

```ts
Article = { slug, title: Text, summary: Text, steps: Text[], tryHref, icon, status: "draft"|"published", updated, reads, helpful /* % yes */, votes }
Faq     = { id: uuid, place: "help"|"pricing"|"contact", topic?: "account"|"billing"|"content"|"ai"|"saved", q: Text, a: Text, status, updated }
Page    = { slug, path, fixed, sections: Section[], updated }
Section = { id, eyebrow?, title, accent?, body: Text[], list?: Text[], after?: Text[], items?: { title, text }[], quote? }
Flag    = { id, group: "research"|"ai"|"library"|"account", on, access: { free, researcher, professional }: "full"|"limited"|"none",
            allowance?: { free, researcher, professional }: number|null, per?: "month"|"total", rollout?: 0..100, pages: string[], reader: "enforced"|"shown"|"open"|"notBuilt", updated }
```

## Team (`/admin/content`) — `content.view` to read

| Method | Path | Permission | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/admin/content/articles` | content.view | | `{ articles, icons, tryPages }` — every article, `reads` = opens in the last 30 days |
| POST | `/admin/content/articles` | content.edit (+publish if `status: "published"`) | `{ slug?, title, summary, steps[], tryHref, icon, status }` | 201 `{ article }`; slug made from the English title when omitted |
| PATCH | `/admin/content/articles/:slug` | content.edit (+publish when status changes) | same as POST | `{ article }` |
| POST | `/admin/content/articles/:slug/publish` / `/unpublish` | content.publish | | `{ article }` — publishing needs both languages |
| POST | `/admin/content/articles/:slug/move` | content.edit | `{ dir: -1 \| 1 }` | `{ articles }` in the new order |
| DELETE | `/admin/content/articles/:slug` | content.delete | | 204 |
| GET | `/admin/content/faqs` | content.view | | `{ faqs, places, topics }` |
| POST | `/admin/content/faqs` | content.edit (+publish) | `{ place, topic?, q, a, status }` — help needs a topic | 201 `{ faq }` |
| PATCH | `/admin/content/faqs/:id` | content.edit (+publish) | same | `{ faq }`; moving to another place/topic puts it last there |
| POST | `/admin/content/faqs/:id/publish` / `/unpublish` | content.publish | | `{ faq }` |
| POST | `/admin/content/faqs/:id/move` | content.edit | `{ dir }` | `{ faqs }` — moves within its own list |
| DELETE | `/admin/content/faqs/:id` | content.delete | | 204 |
| GET | `/admin/content/pages`, `/admin/content/pages/:slug` | content.view | | `{ pages }` / `{ page }` |
| PUT | `/admin/content/pages/:slug` | content.edit | `{ sections: Section[] }` | `{ page }` — live page, so every text needs both languages; the about page's section ids can't change |

Audit actions written: `article.create/edit/publish/unpublish/move/delete`, `faq.*` likewise, `page.edit`.

## Import

`npx tsx --env-file=.env scripts/import-content.ts [content.json]` upserts the articles, FAQs, pages, flags and
contact details from the admin panel's `data/content.json`. Existing flags keep what the team set.
