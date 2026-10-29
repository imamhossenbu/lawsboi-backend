# Lawsboi API

The server behind the reader site (`../lawsboi`) and the admin panel (`../lawsboi-admin`). Express 5 and TypeScript
on Node 22+, with Supabase for Postgres, Auth, Storage and Realtime, and nodemailer for email.

What it does today:

- **Readers' accounts** — sign-up with an emailed 6-digit code, sign-in, refresh, password reset, profile and settings.
- **Support tickets** — readers open tickets with attachments and follow the conversation; the team replies (emailed
  to the reader), writes internal notes, assigns and moves tickets through open → in progress → waiting → resolved →
  closed. New tickets are copied to the support inbox.
- **The team** — admin sign-in, invitations with a temporary password, roles and per-action permissions, and an
  audit log of every team action.
- **The schema for everything else** — plans, subscriptions, payments, announcements, help centre, site pages, feature
  flags, laws, judgments and the assistant's log are created by the migrations with row level security, ready for
  their routes.

## Setting up

1. `cp .env.example .env` and fill it in (Supabase keys, the mailbox, the first admin).
2. Create the tables. Either:
   - **SQL editor** — in the Supabase dashboard, run each file in `supabase/migrations/` in order, then `supabase/seed.sql`; or
   - **CLI** — `npx supabase login`, `npx supabase link --project-ref <ref>`, `npm run db:push`, then run `supabase/seed.sql`.
3. `npm run seed:admin` — makes the first administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. `npm run dev` — the API listens on `PORT` (4000) and checks the mailbox sign-in at start-up.

`npm test` runs the unit tests, `npm run typecheck` the compiler, `npm run build` then `npm start` for production.

## How requests work

- Everything is JSON except file uploads (`multipart/form-data`, field `files`, up to 3 × 2 MB PNG/JPEG/PDF).
- Signed-in calls send `Authorization: Bearer <accessToken>`; `/auth/login` and `/admin/auth/login` return
  `{ tokens: { accessToken, refreshToken, expiresAt } }`, and `/auth/refresh` trades the refresh token for new ones.
- Errors are `{ error: { code, message, details? } }` with the matching status; `details` names the fields a form
  should highlight (`{ email: "taken" }`, `{ code: "expired" }`).
- Ids people see are the ids in URLs: readers `USR-10047`, tickets `TKT-000001`, team members `AGT-01`.

### Readers

| Route | What |
| --- | --- |
| `POST /auth/signup` `{ name, email, password, lang }` | Creates the account and emails a code. |
| `POST /auth/verify` `{ email, code, purpose: "signup" }` | Confirms the email; sign in next. |
| `POST /auth/resend` `{ email, purpose, lang }` | Another code (one a minute). |
| `POST /auth/login` `{ email, password }` | Tokens and the profile. |
| `POST /auth/refresh` `{ refreshToken }` | New tokens. |
| `POST /auth/logout` | Ends the session everywhere. |
| `POST /auth/forgot` `{ email, lang }` → `POST /auth/reset` `{ email, code, password }` | Password reset. |
| `GET /me`, `PATCH /me`, `POST /me/password` | The profile, its settings and the password. |
| `GET /support/tickets`, `POST /support/tickets` (multipart) | The reader's tickets; a new one. |
| `GET /support/tickets/:id`, `POST …/:id/messages`, `POST …/:id/close`, `POST …/:id/reopen` | One ticket. |
| `GET /support/files/:fileId` | Redirects to a 10-minute link to an attachment. |

### The team

| Route | Permission | What |
| --- | --- | --- |
| `POST /admin/auth/login`, `/refresh`, `/logout`, `GET /admin/auth/me`, `POST /admin/auth/password` | | Team sign-in. `mustChangePassword` is set after an invitation. |
| `GET /admin/team` | settings.view | Members and the role presets. |
| `POST /admin/team` `{ name, email, role, permissions?, lang }` | settings.team | Invites by email; returns the temporary password once. |
| `POST /admin/team/:id/reinvite`, `PATCH /admin/team/:id` | settings.team | New invitation; name, role, permissions, active. |
| `PATCH /admin/team/me/profile` | | Own name, phone, photo and reply sign-off. |
| `GET /admin/users?q=&plan=&active=&page=`, `GET /admin/users/:id`, `PATCH /admin/users/:id` | users.view / users.deactivate | Readers. |
| `GET /admin/tickets?q=&status=open,progress&priority=&category=&assignee=me\|none\|AGT-02&page=` | support.view | The list. |
| `GET /admin/tickets/stats` | support.view | Open, waiting, needs-attention and resolved counts. |
| `POST /admin/tickets` (multipart) | support.create | A ticket on a reader's behalf. |
| `GET /admin/tickets/:id` | support.view | Conversation, notes, files and history. |
| `PATCH /admin/tickets/:id` `{ status?, priority?, category?, assignee? }` | support.status / support.assign | `assignee` is `"me"`, a team id or `null`. |
| `POST /admin/tickets/bulk` `{ ids, change }` | as above | The same change on several tickets. |
| `POST /admin/tickets/:id/messages` (multipart) `{ kind: "reply"\|"note", text, then? }` | support.reply / support.note | A reply emails the reader and can move the status (`then`). |
| `GET /admin/tickets/files/:fileId` | support.view | Redirects to a link to an attachment. |

Admins hold every permission; other roles start from `presets` in `src/modules/admin/team/permissions.ts`, which
mirrors the admin panel's `lib/admin/permissions.ts` — change both together.

## Layout

```
src/
  app.ts, index.ts          the Express app, and listening
  config/env.ts             every setting, checked at start-up
  lib/                      supabase clients, errors, logger, one-time codes, mail (transport + templates)
  middleware/               auth guards, zod validation, the error handler
  modules/
    auth/, me/              readers' accounts
    support/                tickets: the shared service, uploads and the reader's routes
    admin/auth, team, users, tickets
    audit/                  logAudit()
  types/database.ts         the tables, as supabase gen types would write them
supabase/migrations/        the schema, in order; seed.sql holds the reference rows
scripts/                    seed-admin, seed-plans
tests/                      vitest unit tests
```

## Email

Readers' codes, invitations and ticket replies go through SMTP (`SMTP_*` in `.env`). With Gmail, `SMTP_PASS` is an
app password from Google Account → Security → 2-Step Verification → App passwords, not the account password. Gmail
allows about 500 messages a day per account; for more, point `SMTP_*` at a transactional service (Resend, Postmark,
Brevo all offer SMTP). Without SMTP, development writes each email to the console.

## Realtime

Readers can follow a ticket live from the browser with the publishable key and their own access token:
`tickets` and `ticket_messages` are in the `supabase_realtime` publication, and row level security keeps internal
notes out. The admin panel talks to this API instead.
