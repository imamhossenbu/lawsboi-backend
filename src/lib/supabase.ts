import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { Database } from "../types/database.js";

export type Db = SupabaseClient<Database>;

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** The API's own connection: the secret key, which bypasses row level security. Server only, never in a response. */
export const db: Db = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, options);

/** A throwaway client with the publishable key, for signing someone in on their behalf. */
export const authClient = (): Db => createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, options);

/** A client that acts as the signed-in person, so row level security applies to what they read. */
export const asUser = (accessToken: string): Db =>
  createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
