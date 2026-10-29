# Users (readers)

| Method | Path | Permission | Body / query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/admin/users` | users.view | `q` (name, email, id), `plan`, `active: "true"|"false"`, `page`, `perPage` | `{ users: AdminUser[], page, perPage, total }` |
| GET | `/admin/users/stats` | users.view | | `{ total: {current, previous}, active, new, inactive }` — active = seen in the last 30 days; previous = end of last month |
| GET | `/admin/users/export` | users.export | same filters | CSV (audits `user.export`) |
| POST | `/admin/users` | users.add | `{ name, nameBn?, email, plan?, cycle?, lang? }` | 201 `{ user }`; 409 `details.email: "taken"`. No password is set: the reader uses "Forgot password" |
| GET | `/admin/users/:id` | users.view | | `{ user: AdminUser & { lang, profile: { phone, profession, organization, location, photo }, subscriptions: Subscription[], payments: Payment[], tickets: number } }` |
| PATCH | `/admin/users/:id` | users.deactivate | `{ active }` | `{ user }` — deactivating also bans their sign-in |

`AdminUser = { id: "USR-10047", name: {en,bn}, email, plan, cycle, role: "reader", active, joined, lastActive }`
