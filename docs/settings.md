# Settings: wallets and contact details

| Method | Path | Permission | Body | Returns |
| --- | --- | --- | --- | --- |
| GET | `/admin/settings` | settings.view | | `{ accounts: { bkash: Wallet, nagad: Wallet }, contact: Contact }` |
| PUT | `/admin/settings/accounts` | settings.payments | `{ bkash: { number, type, name, enabled }, nagad: {…} }` | `{ accounts }`. Numbers are normalised to "01712 345 678"; 400 `details["bkash.number"]: "shape"` otherwise |
| PUT | `/admin/settings/contact` | settings.contact | `Contact` | `{ contact }` |

`Contact = { email, phone, whatsapp, replyTime: {en,bn}, hours: {en,bn}, office: {en,bn}, officeNote: {en,bn} }`.
The reader site reads the same values publicly: wallets at `GET /billing/accounts`; contact details are the
`site_settings` row `contact` (public under RLS, or through the content module's public routes).
