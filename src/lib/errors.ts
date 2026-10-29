// Errors the API answers with on purpose. Anything else is a 500 and is logged with its stack.

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_many_requests"
  | "unavailable";

const statuses: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_many_requests: 429,
  unavailable: 503,
};

export class HttpError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Field-level problems for forms: { email: "taken" } */
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.status = statuses[code];
  }
}

export const badRequest = (message: string, details?: Record<string, string>) => new HttpError("bad_request", message, details);
export const unauthorized = (message = "Sign in to continue.") => new HttpError("unauthorized", message);
export const forbidden = (message = "You can't do that.") => new HttpError("forbidden", message);
export const notFound = (what = "That") => new HttpError("not_found", `${what} wasn't found.`);
export const conflict = (message: string, details?: Record<string, string>) => new HttpError("conflict", message, details);

/** Turns a Supabase error into a thrown HttpError or returns the data, so services read as straight lines. */
export function unwrap<T>(result: { data: T; error: { message: string; code?: string } | null }, what = "The record"): NonNullable<T> {
  if (result.error) {
    if (result.error.code === "PGRST116") throw notFound(what);
    if (result.error.code === "23505") throw conflict(`${what} already exists.`);
    throw new Error(`Database: ${result.error.message}`);
  }
  if (result.data === null || result.data === undefined) throw notFound(what);
  return result.data;
}
