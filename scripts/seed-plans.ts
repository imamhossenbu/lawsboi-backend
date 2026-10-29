import { readFileSync } from "node:fs";
import { db } from "../src/lib/supabase.js";

// Checks the reference rows from supabase/seed.sql are in place. The SQL file is the source of truth (the CLI
// runs it on `supabase db reset`); this only reports what's missing, for setups without the CLI.

const sql = readFileSync(new URL("../supabase/seed.sql", import.meta.url), "utf8");
const planIds = [...sql.matchAll(/^\s*\('([a-z]+)', '/gm)].map((m) => m[1]!);
const { data, error } = await db.from("plans").select("id");
if (error) throw new Error(`plans: ${error.message} — run the migrations first.`);
const have = new Set((data ?? []).map((p) => p.id));
const missing = planIds.filter((id) => !have.has(id));
if (missing.length) {
  console.log(`Missing plans: ${missing.join(", ")}. Run supabase/seed.sql in the SQL editor (or \`supabase db reset\`).`);
  process.exit(1);
}
console.log(`Plans in place: ${[...have].join(", ")}`);
