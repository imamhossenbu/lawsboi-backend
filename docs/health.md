# System health

`GET /admin/health` (health.view) runs every check right now; nothing is sampled, what can't be known is `null`.

```ts
{
  checkedAt, overall: "up"|"degraded"|"down",
  api: { version, node, uptimeSeconds, production },
  database: { status, ms, error, sizeBytes, connections: { used, max } | null },
  storage: { status, ms, error, buckets: string[] },
  mail: { status, configured, ms, error },           // SMTP verify; "degraded" in development without SMTP, "down" in production
  site: { url, status, ms, code, error },            // the reader site answering (READER_URL)
  data: { laws, judgments, readers, openTickets, articles, faqs, lawsUpdated, judgmentsUpdated },
  config: [{ key, env, required, state: "set"|"missing"|"default" }],   // never values
}
```
Slow thresholds: database 500 ms, storage 1.5 s, site 1.5 s → "degraded".
