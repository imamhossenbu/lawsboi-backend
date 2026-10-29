import { z, type ZodType } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";

// One way into Google Gemini for the whole API. The main model is called through the Interactions API (the
// only door this key's current models answer at); when it is slow or down, one retry, then the lighter fallback
// model through the classic generateContent endpoint. A whole call never takes longer than its budget (45 s by
// default), and the key travels in a header, never in a URL or a log line.

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type AiErrorCode = "not_configured" | "unavailable" | "invalid" | "blocked";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Text, or a file the model reads (a photo of a page, a PDF). `data` is base64. */
export type AiPart = { type: "text"; text: string } | { type: "image" | "document"; data: string; mimeType: string };

export interface AiRequest {
  /** What the call is for, for the log and the usage table: "assistant.answer", "admin.translate"… */
  purpose: string;
  system?: string;
  input: string | AiPart[];
  /** A JSON schema the reply must follow; the reply is then JSON text. */
  schema?: Record<string, unknown>;
  maxOutputTokens?: number;
  /** How hard the model thinks before answering; low keeps answers quick. Thinking tokens count against
   * maxOutputTokens, so leave room for them. */
  thinking?: "minimal" | "low" | "medium" | "high";
  /** The whole call, retries and fallback included. */
  budgetMs?: number;
}

export interface AiUsage {
  input: number;
  output: number;
  total: number;
}

export interface AiResult {
  text: string;
  model: string;
  usage: AiUsage;
  ms: number;
}

/** Whether the model can be called. Under test it stays off unless AI_LIVE=1: the free tier allows only a few
 * requests a day, and route tests run against the real .env. */
export const aiConfigured = () => !!env.GEMINI_API_KEY && (env.NODE_ENV !== "test" || process.env.AI_LIVE === "1");

/** Thrown inside one attempt; `retry` says whether another attempt could help. */
class AttemptError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    readonly blocked = false,
  ) {
    super(message);
  }
}

async function post(url: string, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    const json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (!res.ok) {
      const message = ((json.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`).slice(0, 300);
      // Server trouble may pass; a bad request, an unknown model or a used-up quota (429: the free tier counts
      // requests per day) won't, so those go straight to the next model
      throw new AttemptError(message, res.status >= 500);
    }
    return json;
  } catch (err) {
    if (err instanceof AttemptError) throw err;
    if ((err as Error).name === "AbortError") throw new AttemptError(`timed out after ${timeoutMs} ms`, true);
    if (err instanceof SyntaxError) throw new AttemptError("the reply wasn't JSON", true);
    throw new AttemptError((err as Error).message, true);
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------- the two doors */

type Attempt = (req: AiRequest, model: string, timeoutMs: number) => Promise<{ text: string; usage: AiUsage; model: string }>;

const interactionParts = (input: AiRequest["input"]) =>
  typeof input === "string"
    ? input
    : [{ role: "user", content: input.map((p) => (p.type === "text" ? p : { type: p.type, data: p.data, mime_type: p.mimeType })) }];

/** The Interactions API: the main model's door. */
const viaInteractions: Attempt = async (req, model, timeoutMs) => {
  const json = await post(
    `${BASE}/interactions`,
    {
      model,
      store: false,
      input: interactionParts(req.input),
      ...(req.system && { system_instruction: req.system }),
      ...(req.schema && { response_format: req.schema }),
      generation_config: { thinking_level: req.thinking ?? "low", ...(req.maxOutputTokens && { max_output_tokens: req.maxOutputTokens }) },
    },
    timeoutMs,
  );
  const steps = (json.steps as { type?: string; content?: { type?: string; text?: string }[] }[] | undefined) ?? [];
  const text = steps
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
  // "incomplete" means it ran out of output tokens (thinking counts against them): the same call would again
  if (json.status && json.status !== "completed") throw new AttemptError(`interaction ${String(json.status)}`, json.status !== "incomplete");
  if (!text) throw new AttemptError("the model returned no text", true);
  const u = (json.usage ?? {}) as { total_input_tokens?: number; total_output_tokens?: number; total_tokens?: number };
  return { text, model: String(json.model ?? model), usage: { input: u.total_input_tokens ?? 0, output: u.total_output_tokens ?? 0, total: u.total_tokens ?? 0 } };
};

/** The classic generateContent endpoint: the fallback model's door. */
const viaGenerateContent: Attempt = async (req, model, timeoutMs) => {
  const parts =
    typeof req.input === "string" ? [{ text: req.input }] : req.input.map((p) => (p.type === "text" ? { text: p.text } : { inline_data: { mime_type: p.mimeType, data: p.data } }));
  const json = await post(
    `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
    {
      contents: [{ role: "user", parts }],
      ...(req.system && { systemInstruction: { parts: [{ text: req.system }] } }),
      generationConfig: {
        ...(req.schema && { responseMimeType: "application/json", responseJsonSchema: req.schema }),
        ...(req.maxOutputTokens && { maxOutputTokens: req.maxOutputTokens }),
      },
    },
    timeoutMs,
  );
  const candidate = (json.candidates as { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] | undefined)?.[0];
  if (!candidate) {
    const blocked = (json.promptFeedback as { blockReason?: string } | undefined)?.blockReason;
    throw new AttemptError(blocked ? `blocked: ${blocked}` : "no candidates", !blocked, !!blocked);
  }
  if (candidate.finishReason === "SAFETY") throw new AttemptError("blocked: safety", false, true);
  const text = (candidate.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  if (!text) throw new AttemptError("the model returned no text", true);
  const u = (json.usageMetadata ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  return { text, model, usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, total: u.totalTokenCount ?? 0 } };
};

/* -------------------------------------------------------------- calling */

const DEFAULT_BUDGET = 45_000;

/** Runs one request: main model, a retry when the failure looked passing, then the fallback model. */
export async function generate(req: AiRequest): Promise<AiResult> {
  if (!aiConfigured()) throw new AiError("not_configured", "No AI model is connected (GEMINI_API_KEY).");
  const started = Date.now();
  const deadline = started + (req.budgetMs ?? DEFAULT_BUDGET);
  const plan: { door: Attempt; model: string; share: number }[] = [
    { door: viaInteractions, model: env.GEMINI_MODEL, share: 0.45 },
    { door: viaInteractions, model: env.GEMINI_MODEL, share: 0.5 },
    { door: viaGenerateContent, model: env.GEMINI_FALLBACK_MODEL, share: 1 },
  ];
  let last = "";
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i]!;
    const left = deadline - Date.now();
    if (left < 2_000) break;
    try {
      const out = await step.door(req, step.model, Math.round(i === plan.length - 1 ? left : left * step.share));
      const ms = Date.now() - started;
      logger.info({ purpose: req.purpose, model: out.model, ms, attempt: i + 1, usage: out.usage }, "ai call");
      return { ...out, ms };
    } catch (err) {
      const e = err as AttemptError;
      last = e.message;
      logger.warn({ purpose: req.purpose, model: step.model, attempt: i + 1, reason: e.message }, "ai attempt failed");
      if (e.blocked) throw new AiError("blocked", "The model declined to answer that.");
      // A failure that would happen again skips the main model's retry and goes straight to the fallback
      if (!e.retry && i === 0) i = 1;
    }
  }
  throw new AiError("unavailable", `The AI model couldn't answer just now (${last || "out of time"}).`);
}

// Gemini refuses a schema carrying many length and count limits ("invalid argument"), so the model gets the
// shape only; zod still enforces every limit on the reply.
const LIMITS = new Set(["$schema", "maxLength", "minLength", "maxItems", "minItems", "pattern", "format"]);

function withoutLimits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLimits);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !LIMITS.has(k)).map(([k, v]) => [k, withoutLimits(v)]));
  return value;
}

/** The JSON schema the model is held to, from the zod schema the reply is validated with. */
export function schemaOf(schema: ZodType): Record<string, unknown> {
  return withoutLimits(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

/** Reads JSON out of a reply, tolerating a ```json fence the model sometimes adds. */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new AiError("invalid", "The model's reply wasn't valid JSON.");
  }
}

/** A request whose reply must match `schema`; the parsed, validated value comes back with the usage. */
export async function generateJson<T>(req: Omit<AiRequest, "schema">, schema: ZodType<T>): Promise<AiResult & { value: T }> {
  const out = await generate({ ...req, schema: schemaOf(schema) });
  let raw: unknown;
  try {
    raw = parseJsonReply(out.text);
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError("invalid", "The model's reply wasn't valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ purpose: req.purpose, issues: parsed.error.issues.slice(0, 5) }, "ai reply didn't match its schema");
    throw new AiError("invalid", "The model's reply didn't have the expected shape.");
  }
  return { ...out, value: parsed.data };
}
