import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Regenerates src/types/database.ts from the live schema (DATABASE_URL). Stored generated columns (public_id)
// always hold a value, which the generator can't tell, so they are marked non-null here.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL in .env (Project Settings → Database).");
const generated = execFileSync("npx", ["supabase", "gen", "types", "typescript", "--db-url", url, "--schema", "public"], { stdio: ["ignore", "pipe", "inherit"] }).toString();
const header = `// Generated from the live schema by \`npm run db:types\` (supabase gen types). Do not edit by hand: change a
// migration, apply it, and regenerate. Row aliases the code uses live in rows.ts. The script marks the stored
// generated public_id columns as non-null, which gen types can't know.

`;
writeFileSync(new URL("../src/types/database.ts", import.meta.url), header + generated.replace(/"public_id": string \| null/g, '"public_id": string'));
console.log("src/types/database.ts updated");
