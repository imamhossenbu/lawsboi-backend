# Dashboard

`GET /admin/dashboard?months=12` (dashboard.view; 3–24 months). Every number is counted from the database.

```ts
{
  months: ["2025-11", …, "2026-10"],              // oldest first, Bangladesh time, ending this month
  series: {
    revenue: number[] | null,                     // verified taka per month (null without dashboard.revenue)
    newSubscriptions: number[],
    totalUsers: number[],                         // readers joined by the end of each month
    activeUsers: number[],                        // readers seen during the month
  },
  kpis: {
    users: { current, previous },                 // end of this month vs end of last
    subscriptions: { current, previous },         // active paid subscriptions now vs end of last month
    revenue: { current, previous } | null,
    tickets: { current, previous, attention, previousAttention },  // open now vs end of last month; high/urgent
  },
  recent: { users: AdminUser[5], payments: (Payment & { user })[5], tickets: [{ id, subject, lang, category, priority, status, assignee, user, createdAt, updatedAt, resolvedAt }][5] },
}
```
