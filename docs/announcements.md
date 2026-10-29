# Announcements

A note in the reader's bell (`inApp`), an email, and/or a banner across the reader's dashboard (`banner`). Each
belongs to a notification topic (`legal | cases | saved | ai | billing | product`); readers whose settings turn that
topic off for a channel don't get it there (billing email can't be turned off). Plans: `[]` means every reader.

Ids are `ANN-0001`. Channels in JSON use the reader's names (`inApp`); the database stores `in_app`.

```ts
Announcement = { id, title: Text, body: Text, topic, plans: string[], channels: ("inApp"|"email"|"banner")[], link: string|null,
                 status: "draft"|"scheduled"|"sent", at /* sent, due, or last saved */, sentAt, bannerUntil, bannerEnded,
                 banner: "live"|"ended"|"waiting"|null, delivery?: { reached: { inApp?, email?, banner? }, opened: {...} } /* sent only */ }
```

`reached`/`opened` are real counts from `announcement_deliveries`: bell rows are written when sending, an email
row when each email goes out, a banner row when a reader's dashboard shows it; `opened` is the bell item opened,
or the banner clicked (email opens aren't tracked).

## Readers (`/content`)

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/content/announcements` | reader | `{ announcements: { id, title, body, topic, link, at, read }[], unread }` newest first (the bell) |
| POST | `/content/announcements/:id/read` | reader | 204 |
| POST | `/content/announcements/read-all` | reader | 204 |
| GET | `/content/banner` | reader | `{ banner: { id, title, body, link, until } \| null }` — newest live banner for the reader's plan; counts as reached |
| POST | `/content/announcements/:id/banner-click` | reader | 204 — counts as opened |

Readers can also follow `announcement_deliveries` (their own rows) over Supabase Realtime with their token.

## Team (`/admin/announcements`) — `announcements.view` to read

| Method | Path | Permission | Body / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/admin/announcements` | view | | `{ announcements, topics, channels, plans, linkPages }` newest first; sends anything due first |
| GET | `/admin/announcements/reach` | view | `?plans=free,researcher&topic=product&channels=inApp,email,banner` | `{ reach: { inApp?, email?, banner? } }` from readers' real settings |
| POST | `/admin/announcements` | write (+send for `mode: "send"`) | `{ title, body, topic, plans?, channels, link?, bannerUntil?, mode: "draft"\|"schedule"\|"send", at? }` | 201 `{ announcement }`; scheduling needs a future `at`; sending needs both languages |
| GET | `/admin/announcements/:id` | view | | `{ announcement }` |
| PATCH | `/admin/announcements/:id` | write (+send) | same as POST | `{ announcement }` — 400 once sent |
| POST | `/admin/announcements/:id/send` | send | | `{ announcement }` |
| POST | `/admin/announcements/:id/unschedule` | write | | `{ announcement }` back to draft |
| POST | `/admin/announcements/:id/end-banner` | endBanner | | `{ announcement }` |
| POST | `/admin/announcements/:id/duplicate` | write | `{ suffix?: Text }` default " (copy)" | 201 `{ announcement }` draft |
| DELETE | `/admin/announcements/:id` | delete | | 204 |
| POST | `/admin/announcements/send-due` | send | | `{ sent: n }` |

Scheduled announcements go out from a one-minute timer inside the API, and also whenever a reader's bell or
banner is loaded or the admin list is opened, so nothing waits for the panel. Emails go out in the background
after the response, three at a time, in each reader's language.

Audit actions: `announcement.draft/schedule/send/unschedule/endBanner/duplicate/delete`.
