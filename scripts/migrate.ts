import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Applies every file in supabase/migrations that isn't recorded in public.schema_migrations yet, in name order,
// each in its own transaction, with psql (DATABASE_URL). Then runs seed.sql, which is written to be re-runnable.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL in .env (Project Settings → Database).");
const dir = new URL("../supabase/migrations/", import.meta.url).pathname;
const psql = (args: string[], input?: string) => execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t", url, ...args], { input, stdio: ["pipe", "pipe", "inherit"] }).toString().trim();

psql(["-c", "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())"]);
const done = new Set(psql(["-c", "select name from public.schema_migrations"]).split("\n").filter(Boolean));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  if (done.has(file)) continue;
  process.stdout.write(`applying ${file}… `);
  psql(["--single-transaction", "-f", join(dir, file)]);
  psql(["-c", `insert into public.schema_migrations (name) values ('${file}')`]);
  console.log("ok");
}
process.stdout.write("seed.sql… ");
psql(["--single-transaction", "-f", new URL("../supabase/seed.sql", import.meta.url).pathname]);
console.log("ok");
console.log(`${files.length} migrations, ${files.length - done.size} newly applied.`);
