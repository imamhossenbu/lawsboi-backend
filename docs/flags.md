# Feature flags

The features the reader site sells by plan: a master switch, who gets it per plan (`full | limited | none`), an
allowance for counted features (AI questions a month, saved items in all; `null` = unlimited), and a rollout share
for features still being built. Every change is an event in the flag's history.

```ts
Flag = { id, group, on, access: { free, researcher, professional }, allowance?: { free, researcher, professional }, per?: "month"|"total",
         rollout?: number, pages: string[], reader: "enforced"|"shown"|"open"|"notBuilt", updated,
         history: { at, by: "AGT-01" | null, change: { kind: "created" } | { kind: "on" } | { kind: "off" } | { kind: "plans", access } | { kind: "allowance", allowance } | { kind: "rollout", percent } }[] }
```

| Method | Path | Auth / permission | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/content/flags` | none | | `{ flags }` without history — what the reader site gates on |
| GET | `/admin/flags` | flags.view | | `{ flags }` with history |
| PATCH | `/admin/flags/:id` | flags.manage | `{ on?, access?, allowance?, rollout? }` (any mix) | `{ flag }` — each changed part becomes one history event; allowance only on counted features |

Audit: `flag.on`, `flag.off`, `flag.edit` (one line per save). The eleven flags are created by
`scripts/import-content.ts`; `reader` (what the reader site does today) comes from that script, not the panel.
