import { db } from "../supabase.js";
import { logger } from "../logger.js";
import { AiError, type AiResult } from "./gemini.js";

// Writes one ai_usage row per model call, worked or not, so the team can see what the AI costs and how often it
// fails. Never waits on the write: a lost usage row mustn't slow or fail the answer.

export interface Caller {
  userId?: string | null;
  memberId?: string | null;
}

export function recordUsage(purpose: string, caller: Caller, outcome: AiResult | AiError | Error) {
  const ok = !(outcome instanceof Error);
  const row = {
    purpose,
    user_id: caller.userId ?? null,
    member_id: caller.memberId ?? null,
    ok,
    model: ok ? outcome.model : null,
    error: ok ? null : outcome instanceof AiError ? outcome.code : "error",
    input_tokens: ok ? outcome.usage.input : 0,
    output_tokens: ok ? outcome.usage.output : 0,
    total_tokens: ok ? outcome.usage.total : 0,
    ms: ok ? outcome.ms : 0,
  };
  void db
    .from("ai_usage")
    .insert(row)
    .then(({ error }) => {
      if (error) logger.warn({ error: error.message, purpose }, "ai usage not recorded");
    });
}

/** Runs a model call and records it either way. */
export async function tracked<T extends AiResult>(purpose: string, caller: Caller, call: () => Promise<T>): Promise<T> {
  try {
    const out = await call();
    recordUsage(purpose, caller, out);
    return out;
  } catch (err) {
    recordUsage(purpose, caller, err as Error);
    throw err;
  }
}
