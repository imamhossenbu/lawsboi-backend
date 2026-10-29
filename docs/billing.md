# Billing: plans, checkout, subscriptions, payments

Money in taka integers; dates ISO; ids `PAY-000001`, `SUB-000001`. Enums are camelCase in JSON (`pastDue`, `notFound`).

## Shapes

```ts
Plan = { id, name: {en,bn}, description: {en,bn}, price: { monthly, yearly: number|null }, cycles: ("monthly"|"yearly")[],
         features: {en,bn}[], active, isDefault, icon: "gift"|"cap"|"crown"|"layers", subscribers, yearlySubscribers, created }
Subscription = { id, plan, cycle, amount, status: "active"|"pastDue"|"canceled", started, renews: string|null, autoRenew, canceledAt }
Payment = { id, subscriptionId, plan, cycle, amount, method: "bkash"|"nagad", trxId, status: "verified"|"awaiting"|"rejected"|"refunded",
            reason: "notFound"|"amount"|"duplicate"|null, submitted, reviewed, refunded }
Wallet = { method, number, type: "personal"|"merchant", name, enabled }
AdminUser = { id: "USR-10047", name: {en,bn}, email, plan, cycle, role: "reader", active, joined, lastActive }
```

## Reader / public

| Method | Path | Auth | Body / query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/billing/plans` | none | | `{ plans: Plan[] (active, without subscriber counts), matrix: [{ key, free, researcher, professional }] }` — matrix cells are `true/false`, `"limited"`, `"unlimited"` or a number, one row per pricing-page feature in order |
| GET | `/billing/accounts` | none | | `{ accounts: Wallet[] }` (enabled only) |
| POST | `/billing/checkout` | reader | `{ plan, cycle, method, trxId }` | 201 `{ payment: Payment }` (status `awaiting`). 400 `details.trxId: "shape"` (bKash 10 chars, Nagad 8), `details.plan/cycle/method: "unavailable"`; 409 `details.trxId: "duplicate"` or `"pending"` (one awaiting payment at a time) |
| GET | `/billing/subscription` | reader | | `{ plan, cycle, subscription: Subscription|null, payments: Payment[] }` newest first |
| POST | `/billing/subscription/auto-renew` | reader | `{ autoRenew }` | `{ subscription }`; 404 without an active one |

## Team

| Method | Path | Permission | Body / query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/admin/billing/plans` | plans.view | | `{ plans: Plan[] (all, with counts), recurringRevenue, stats: { paidSubscribers, previousActive, renewals: { current, previous } } }` |
| POST | `/admin/billing/plans` | plans.create | `{ id?, name:{en,bn}, description:{en,bn}, price:{monthly, yearly|null}, features:[{en,bn}], icon?, active? }` | 201 `{ plan }`; 409 id taken |
| PATCH | `/admin/billing/plans/:id` | plans.edit | any of the above | `{ plan }` |
| POST | `/admin/billing/plans/:id/activate` `…/deactivate` `…/default` `…/duplicate` | plans.activate | | `{ plan }` (duplicate: 201, inactive copy). 400 when deactivating the default or making an inactive plan default |
| DELETE | `/admin/billing/plans/:id` | plans.delete | | 204; 400 when it has subscribers or is the default |
| GET | `/admin/billing/subscriptions` | plans.view | `q, plan, status, cycle, page, perPage` | `{ subscriptions: (Subscription & { user: AdminUser })[], page, perPage, total }` |
| GET | `/admin/billing/subscriptions/:id` | plans.view | | `{ subscription: Subscription & { user, payments: Payment[] } }` |
| PATCH | `/admin/billing/subscriptions/:id` | plans.renewals | `{ autoRenew }` | `{ subscription }` (audits `subscription.renewOn/Off`) |
| GET | `/admin/billing/payments` | payments.view | `q` (name, email, id, trx), `plan, method, status, month: "YYYY-MM", page, perPage` | `{ payments: (Payment & { user })[], page, perPage, total }` |
| GET | `/admin/billing/payments/figures` | payments.view | `month?` | `{ month, status: { verified|awaiting|rejected|refunded: { count, amount } }, byMethod: { bkash: { [plan]: {count, amount} }, nagad: {...} }, lastMonth: { verified (count), refunds (amount) }, chart: { months[12], byPlan: { [plan]: number[12] }, refunds: number[12] } }` |
| GET | `/admin/billing/payments/export` | payments.export | same filters | CSV download (audits `payment.export`) |
| GET | `/admin/billing/payments/:id` | payments.view | | `{ payment: Payment & { user } }` |
| POST | `/admin/billing/payments/:id/verify` | payments.verify | | `{ payment }`. Starts the subscription (or extends one on the same plan+cycle from its renewal date), sets the reader's plan. 409 if already reviewed |
| POST | `/admin/billing/payments/:id/reject` | payments.reject | `{ reason: "notFound"|"amount"|"duplicate" }` | `{ payment }` |
| POST | `/admin/billing/payments/:id/refund` | payments.refund | | `{ payment }`. Cancels its subscription; a reader with no other active one goes back to the default plan. 409 unless verified |

Renewals: `renews` steps a calendar month or year from verification (31 Jan → 28 Feb). Nothing charges automatically — bKash/Nagad are manual — so a lapsed subscription is a product decision for later (a cron that marks `past_due` after `renews` passes).
