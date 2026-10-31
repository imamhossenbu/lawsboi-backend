import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { Database } from "../types/database.js";

// Supabase is only the database here: Postgres through its REST API. Sign-ins are the API's own (lib/accounts.ts)
// and files are on Backblaze B2 through its S3 API (lib/storage.ts).

export type Db = SupabaseClient<Database>;

/** The API's own connection: the secret key, which bypasses row level security. Server only, never in a response. */
export const db: Db = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
