# Audit log

Written by every team action through `logAudit()`; read here. Action names and areas mirror the admin panel's
`lib/admin/audit.ts` (`src/modules/admin/audit/areas.ts` holds the list).

| Method | Path | Permission | Query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/admin/audit` | audit.view | `q` (target id/label/action), `area`, `action` (a name, or `sensitive`), `actor: "AGT-02"`, `sensitive: "true"`, `from`, `to` (ISO), `page`, `perPage` | `{ entries: [{ id, at, actor: "AGT-01"|null, action, area, target: { type, id, label: {en,bn} }, changes: [{ field, of?, from?, to? }], sensitive }], page, perPage, total, actions: string[] }` |
| GET | `/admin/audit/stats` | audit.view | | `{ today, week, month, sensitiveWeek, busiest: { actor, count } | null, byMember: [{ actor, count }] (last 30 days) }` |
| GET | `/admin/audit/export` | audit.export | same filters | CSV (audits `audit.export`) |
