# Settings: wallets and contact details

| Method | Path | Permission | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/admin/settings` | settings.view | | `{ accounts: { bkash: Wallet, nagad: Wallet }, contact: Contact }` |
| PUT | `/admin/settings/accounts` | settings.payments | `{ bkash: { number, type, name, enabled }, nagad: {…} }` | `{ accounts }`. Numbers are normalised to "01712 345 678"; 400 `details["bkash.number"]: "shape"` otherwise |
| PUT | `/admin/settings/contact` | settings.contact | `Contact` | `{ contact }` |

`Contact = { email, phone, whatsapp, facebook, linkedin, youtube (http(s) links or ""), replyTime: {en,bn}, hours: {en,bn}, office: {en,bn}, officeNote: {en,bn} }`.
The reader site reads the same values publicly: wallets at `GET /billing/accounts`; contact details are the
`site_settings` row `contact` (public under RLS, or through the content module's public routes).

## SMS verification and the SMS log (`/admin/settings/sms`)

| Method | Route | Permission | Body / query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/` | settings.view | | `{ settings }` — forwarder address, auto-verify, allowed senders, the Telegram bot (token masked) |
| PUT | `/` | settings.sms | the settings | `{ settings }` |
| POST | `/rotate`, `/telegram/test` | settings.sms | | new forwarder secret; a test message to the team's chat |
| POST | `/test` | settings.view | `{ text, sender? }` | what the parser reads and the payment it would match (nothing stored) |
| GET | `/inbox` | payments.view | `view=review\|waiting\|verified\|other\|all`, `page`, `perPage` | `{ sms: [{ …, outcome, details }], total, counts: { review, waiting, verified, other, all, matched, unmatched } }` — `outcome` is what the team's Telegram chat was told: `auto_verified`, `verified` (by a member), `needs_review` (matched, payment still awaiting: short amount, other wallet, auto-verify off), `waiting` (no payment with its transaction id yet), `rejected`, `ignored`, `duplicate`; `details` is the matched payment with its reader, plan and who verified it |
| GET | `/:id/candidates` | payments.verify | | `{ payments }` — awaiting payments the SMS could belong to, same wallet and amount first, then nearest in time |
| POST | `/:id/match` | payments.verify | `{ paymentId }` | links the SMS to the payment and verifies it when the money is enough |

A matched payment held for a look is approved with `POST /admin/billing/payments/:id/verify` (it emails the reader and
writes the audit entry).
