# Lawsboi API

The server behind the reader site (`../lawsboi`) and the admin panel (`../lawsboi-admin`). Express 5 and TypeScript
on Node 22+. Supabase is only the database (Postgres); everything else is the API's own or a third party:

| What | Where |
| --- | --- |
| Database | Supabase Postgres, through `@supabase/supabase-js` with the secret key |
| Sign-ins | The API itself: bcrypt passwords in `accounts`, JWT access tokens, rotating refresh tokens in `sessions` |
| Ticket attachments | Backblaze B2 through its S3 API (private bucket, 10-minute signed links) |
| Email | Gmail SMTP through nodemailer |
| AI | Google Gemini |
| Hosting | Render (free web service, `render.yaml`) |
| Scheduled work | cron-job.org calling `/cron/tick` |

What it does:

- **Readers' accounts** — sign-up with an emailed 6-digit code, sign-in, refresh, password reset, profile and settings.
- **Support tickets** — readers open tickets with attachments and follow the conversation; the team replies (emailed
  to the reader), writes internal notes, assigns and moves tickets through open → in progress → waiting → resolved →
  closed. New tickets are copied to the support inbox.
- **The team** — admin sign-in, invitations with a temporary password, roles and per-action permissions, and an
  audit log of every team action.
- **The library** — 1,298 laws (36,588 sections, Orders and Rules) and 352 SCOB judgments with their citations,
  searched with Postgres full-text search; the team edits, translates and publishes them.
- **The assistant** — answers written by the model from the matching sections and judgments only, with citations,
  in Bangla or English, within each plan's monthly allowance.
- **Billing** — plans, bKash/Nagad checkout by transaction id, the team's verification, subscriptions and refunds.
- **Content** — help articles, FAQs, site pages, announcements (bell, banner, email) and feature flags.
- **The panel's figures** — dashboard, audit log, health, readers' saved items and research history.

## Setting up

1. `cp .env.example .env` and fill it in (Supabase URL and secret key, `JWT_SECRET`, `S3_*`, the mailbox, the first admin).
2. `npm run db:migrate` — applies the files in `supabase/migrations/` that `schema_migrations` hasn't recorded, then
   `supabase/seed.sql` (needs `psql` and `DATABASE_URL`). `npm run db:types` regenerates `src/types/database.ts`.
3. `npm run seed:admin` — makes the first administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Import the data: `npx tsx --env-file=.env scripts/import-catalogue.ts` (laws and judgments from `../lawsboi`) and
   `npx tsx --env-file=.env scripts/import-content.ts` (help centre, pages, flags). Both are safe to run again.
5. `npm run dev` — the API listens on `PORT` (4000) and checks the mailbox sign-in at start-up. Without
   `CRON_SECRET` it runs the scheduled tick itself every minute.

`npm test` runs the unit tests and the route tests (against the database in `.env`, with their own fixtures),
`npm run typecheck` the compiler, `npm run build` then `npm start` for production. The model stays off under test;
`AI_LIVE=1` runs the AI tests for real (see [docs/ai.md](docs/ai.md)).

## Every route

The tables below this one cover accounts, support and the team. Each other area has its own page with every
route, its permission, body and response shape.

| Area | Base path | Who | Docs |
| --- | --- | --- | --- |
| Readers' accounts | `/auth`, `/me` | public, reader | below |
| Support | `/support`, `/admin/tickets` | reader, team (support.*) | below |
| Team, sign-in, profile | `/admin/auth`, `/admin/team` | team (settings.*) | below |
| Readers, for the team | `/admin/users` | team (users.*) | [users.md](docs/users.md) |
| Laws, judgments, search | `/catalogue`, `/admin/catalogue` | public, team (laws.*) | [catalogue.md](docs/catalogue.md) |
| Assistant | `/assistant`, `/admin/assistant` | reader, team (assistant.*) | [assistant.md](docs/assistant.md) |
| AI help for the panel | `/admin/ai` | team (content.*, laws.*, announcements.*) | [ai.md](docs/ai.md) |
| Plans, checkout, subscriptions, payments | `/billing`, `/admin/billing` | reader, team (plans.*, payments.*) | [billing.md](docs/billing.md) |
| Saved items, collections, history | `/library` | reader | [library.md](docs/library.md) |
| Help centre, FAQs, pages, bell, banner, flags | `/content`, `/admin/content` | public, reader, team (content.*) | [content.md](docs/content.md) |
| Announcements | `/admin/announcements` | team (announcements.*) | [announcements.md](docs/announcements.md) |
| Feature flags | `/admin/flags` | team (flags.*) | [flags.md](docs/flags.md) |
| Dashboard figures | `/admin/dashboard` | team (dashboard.*) | [dashboard.md](docs/dashboard.md) |
| Audit log | `/admin/audit` | team (audit.*) | [audit.md](docs/audit.md) |
| Wallets, contact details | `/admin/settings` | team (settings.*) | [settings.md](docs/settings.md) |
| System health | `/admin/health` | team (health.*) | [health.md](docs/health.md) |
| Liveness | `GET /health` | public | `{ ok, time }` |
| Scheduled work | `GET`/`POST /cron/tick` | `Authorization: Bearer <CRON_SECRET>` | see Hosting below |

## How requests work

- Everything is JSON except file uploads (`multipart/form-data`, field `files`, up to 3 × 2 MB PNG/JPEG/PDF).
- Signed-in calls send `Authorization: Bearer <accessToken>`; `/auth/login` and `/admin/auth/login` return
  `{ tokens: { accessToken, refreshToken, expiresAt } }`, and `/auth/refresh` trades the refresh token for new ones.
- Errors are `{ error: { code, message, details? } }` with the matching status; `details` names the fields a form
  should highlight (`{ email: "taken" }`, `{ email: "unverified" }`, `{ password: "wrong" }`, `{ code: "expired" }`).
- Ids people see are the ids in URLs: readers `USR-10047`, tickets `TKT-000001`, team members `AGT-01`.

### Readers

| Route | What |
| --- | --- |
| `POST /auth/signup` `{ name, email, password, lang }` | Creates the account and emails a code. |
| `POST /auth/verify` `{ email, code, purpose: "signup" }` | Confirms the email; sign in next. |
| `POST /auth/resend` `{ email, purpose, lang }` | Another code (one a minute). |
| `POST /auth/login` `{ email, password }` | Tokens and the profile. |
| `POST /auth/google` `{ code, redirectUri, lang }` | "Continue with Google": the code Google returned to the reader site. Signs the reader in, or makes the account (201, `created: true`). Team emails get 403. Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, else 503. |
| `POST /auth/refresh` `{ refreshToken }` | New tokens. |
| `POST /auth/logout` | Ends the session everywhere. |
| `POST /auth/forgot` `{ email, lang }` → `POST /auth/reset` `{ email, code, password }` | Password reset. |
| `GET /me`, `PATCH /me`, `POST /me/password`, `DELETE /me` `{ password }` | The profile, its settings, the password; deleting the account. |
| `GET /support/tickets?status=open\|closed&page=`, `GET /support/tickets/count`, `POST /support/tickets` (multipart) | The reader's tickets, their counts; a new one. |
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
  lib/                      supabase (the database), accounts (sign-ins and sessions), storage (S3/B2), errors,
                            logger, one-time codes, mail (transport + templates), ai/ (Gemini and usage)
  middleware/               auth guards, zod validation, the error handler
  modules/
    auth/, me/              readers' accounts
    support/                tickets: the shared service, uploads and the reader's routes
    catalogue/, assistant/  laws, judgments, search; the assistant (answer.ts writes the answer)
    billing/, library/, content/
    admin/                  auth, team, users, tickets, catalogue, assistant, ai, billing, dashboard, audit,
                            settings, health, content, announcements, flags
    audit/                  logAudit()
    cron/                   /cron/tick: the scheduled work
  types/database.ts         generated from the live schema (npm run db:types); rows.ts names the rows
supabase/migrations/        the schema, in order; seed.sql holds the reference rows
scripts/                    migrate, gen-types, seed-admin, import-catalogue, import-content, move-files-to-storage
docs/                       every area's routes and shapes
tests/                      vitest: unit tests and route tests against the live database
```

## Email

Readers' codes, invitations and ticket replies go through SMTP (`SMTP_*` in `.env`). With Gmail, `SMTP_PASS` is an
app password from Google Account → Security → 2-Step Verification → App passwords, not the account password. Gmail
allows about 500 messages a day per account; for more, point `SMTP_*` at a transactional service (Resend, Postmark,
Brevo all offer SMTP). Without SMTP, development writes each email to the console.

## Sign-ins

`src/lib/accounts.ts`. Readers and the team both have a row in `accounts` (email, bcrypt hash, confirmed,
disabled); `profiles` or `team_members` hangs off it by id. Signing in opens a row in `sessions` and returns:

- `accessToken` — a JWT (HS256, `JWT_SECRET`) with the account id and the session id, valid `ACCESS_TOKEN_MINUTES`.
  Every request checks that the session still exists, so signing out or deactivating someone takes effect at once.
- `refreshToken` — a random secret; only its SHA-256 is stored. Each `/refresh` replaces it, and a used one stops
  working. A session unused for `REFRESH_TOKEN_DAYS` ends.

Logging out ends every session of the account; a password reset does too; changing the password ends the others.
Migration `20261031_700_own_auth.sql` copied everyone from Supabase's `auth.users` with their bcrypt hash, so old
passwords still work. Supabase Realtime isn't used any more: the reader site and the panel only talk to this API.

## Files

`src/lib/storage.ts`: ticket attachments go to the bucket `S3_BUCKET` under `<ticket>/<message>/<uuid>-<name>`
(the `storage_path` in `ticket_files`), and are served by 10-minute signed links. Any S3-compatible storage works;
today it is Backblaze B2 (10 GB free, no card): make a **private** bucket, copy its Endpoint into `S3_ENDPOINT`
(with `https://`) and the region inside it (`us-east-005`) into `S3_REGION`, then add an application key with Read
and Write on that bucket (`keyID` → `S3_ACCESS_KEY_ID`, `applicationKey` → `S3_SECRET_ACCESS_KEY`). Moving to
Cloudflare R2 later is only new `S3_*` values. Files uploaded while attachments were in Supabase Storage are
copied over once with `npx tsx --env-file=.env scripts/move-files-to-storage.ts`.

## Hosting and the scheduler

The API runs on Render's free plan (`render.yaml`: New → Blueprint). A free instance sleeps after 15 minutes
without requests, and a free Supabase project is paused after a week without activity, so an outside scheduler
calls the API all the time:

- **cron-job.org** (free): a job for `https://<your-app>.onrender.com/cron/tick`, every **5 minutes**, method GET,
  with the header `Authorization: Bearer <CRON_SECRET>` (Advanced → Headers). Render generates `CRON_SECRET`;
  copy it from the service's Environment page.

Each tick (`src/modules/cron/service.ts`) queries the database (Supabase stays active), sends announcements whose
time has come, records a health run (at most one per five minutes), and deletes expired sessions and old one-time
codes. It answers `{ at, ms, database, announcements, health, sessionsDeleted, codesDeleted, errors }`, with 500
when a step failed, so cron-job.org's failure emails tell you. Calls without the secret get 401.

Render's 750 free hours a month cover one instance awake all month. The first call after a sleep takes ~30–60 s;
the scheduler is what keeps readers from ever seeing that.
