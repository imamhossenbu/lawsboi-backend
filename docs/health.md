# System health

`GET /admin/health` (health.view) runs every check right now; nothing is sampled, what can't be known is `null`.

Every run is also stored in `health_runs`: one every five minutes from `/cron/tick` (cron-job.org), and the page's own (at most
one a minute), kept 30 days. `GET /admin/health/history?hours=24` (up to 720) returns
`{ since, runs: [{ at, overall, checks: { database|storage|mail|site: { status, ms } }, source }] (oldest first), incidents: [{ from, to, worst, checks: string[], runs }] (newest first) }` —
an incident is a stretch of consecutive runs that weren't all up.

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
