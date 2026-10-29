# Library: saved items, collections, research history

All routes need a reader token. Items are identified by their language-neutral dashboard path (`/dashboard/…`).

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/library/saved` | | `{ items: [{ id, href, kind: "law"|"section"|"order"|"case", title, subtitle, at }], allowance: number|null }` |
| POST | `/library/saved/toggle` | `{ href, kind, title, subtitle? }` | 201 `{ saved: true, item }` or 200 `{ saved: false }` when it was saved before. 400 `details.saved: "allowance"` past the plan's cap (free 5, researcher 50, professional unlimited — or the `savedItems` feature flag's allowance when the team set one) |
| DELETE | `/library/saved/:id` | | 204 |
| DELETE | `/library/saved` | | 204 (everything) |
| GET | `/library/collections` | | `{ collections: [{ id, name, description, icon, color, createdAt, items: string[] }] }` — `items` are saved hrefs or `chat:<id>` |
| POST | `/library/collections` | `{ name, description?, icon?, color? }` | 201 `{ collection }` |
| PATCH | `/library/collections/:id` | any of those | `{ collection }` |
| DELETE | `/library/collections/:id` | | 204 |
| POST | `/library/collections/:id/toggle` | `{ key }` | `{ inCollection }` |
| DELETE | `/library/collections/items` | | 204 (empties every collection, keeps them) |
| GET | `/library/history` | `kind?: "search"|"reads"`, `limit?` | `{ history: [{ id, kind: "law"|"section"|"case"|"search", title: {en,bn}, context?: {en,bn}, scope?: "laws"|"cases", href, at }] }` newest first, up to 300 |
| POST | `/library/history` | `{ kind, title:{en,bn}, context?, scope?, href }` | 201 `{ recorded: true, entry }`; 200 with the same entry when it repeats within 30 minutes; `{ recorded: false }` when the reader's `preferences.recordSearches` / `recordReads` is off |
| DELETE | `/library/history/:id` | | 204 |
| DELETE | `/library/history` | query string `?only=search\|reads` (optional) | 204 |

Icons: folder, scale, book, file, bookmark, tag. Colors: green, blue, violet, pink, orange, gold, teal, gray.

Paths: `href` on saved items and history is a dashboard path. The public pages' paths are accepted too and stored
as the dashboard's (`/bd/laws/…` → `/dashboard/laws/…`, `/bd/cases/…` → `/dashboard/cases/…`), so a page can send
the path it is on.
