import { db } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";

// Who may read what. Free readers get a monthly allowance of sections and judgments; signed-out visitors a smaller
// one; the whole-act text is for paid plans. Reads are counted per account, per device and (signed out) per
// address, and a device's count holds whoever is signed in on it — so rotating free accounts on one phone, or
// signing out, doesn't open more. Paid plans have a daily ceiling no person reads to, which stops a paid account
// being used to copy the catalogue. Opening something already read this period never counts again.

export type AccessKind = "section" | "order" | "judgment" | "text";
export type Viewer = "visitor" | "free" | "paid";
export type Denied = "signin" | "upgrade" | "paid_only" | "daily";

export const ALLOWANCE = {
  visitor: { section: 10, judgment: 2 },
  free: { section: 30, judgment: 5 },
} as const;
/** A shared address (an office, a mobile network) counts many people, so it gets several visitors' allowance. */
export const ADDRESS_FACTOR = 4;
/** Distinct sections and judgments a paid account opens in a day before it is stopped until tomorrow. */
export const DAILY_CEILING = 400;

export interface AccessCheck {
  kind: AccessKind;
  slug: string;
  n?: string;
  user: string | null;
  device: string | null;
  ip: string | null;
}

export interface Access {
  allowed: boolean;
  reason?: Denied;
  viewer: Viewer;
  /** Counted kinds only: what this period's allowance is and how much of it is used, this read included. */
  used?: number;
  limit?: number;
}

async function viewerOf(user: string | null): Promise<Viewer> {
  if (!user) return "visitor";
  const { data } = await db.from("profiles").select("plan_id, plans(price_monthly)").eq("id", user).maybeSingle();
  const price = (data?.plans as { price_monthly: number } | null)?.price_monthly ?? 0;
  return price > 0 ? "paid" : "free";
}

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const dayStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

let warned = false;

export async function checkAccess(c: AccessCheck): Promise<Access> {
  const viewer = await viewerOf(c.user);
  if (c.kind === "text") return viewer === "paid" ? { allowed: true, viewer } : { allowed: false, reason: "paid_only", viewer };

  const kind = c.kind === "judgment" ? "judgment" : "section";
  const item = c.kind === "judgment" ? c.slug : `${c.slug}#${c.kind === "order" ? "O" : ""}${c.n ?? ""}`;

  // Paid: only the daily ceiling, on the account
  // Free and visitors: the month's reads by this account, this device and (signed out) this address
  const who = viewer === "paid" ? [c.user && `user_id.eq.${c.user}`] : [c.user && `user_id.eq.${c.user}`, c.device && `device.eq.${c.device}`, !c.user && c.ip && `ip.eq.${c.ip}`];
  const filters = who.filter(Boolean) as string[];
  if (!filters.length) return { allowed: true, viewer };

  const { data, error } = await db
    .from("reading_access")
    .select("item,user_id,device,ip")
    .eq("kind", kind)
    .gte("at", viewer === "paid" ? dayStart() : monthStart())
    .or(filters.join(","))
    .limit(20_000);
  if (error) {
    // Before the migration is applied (or if the database hiccups) reading stays open rather than locking everyone out
    if (!warned) logger.warn({ err: error.message }, "reading_access unavailable; reading allowance not enforced");
    warned = true;
    return { allowed: true, viewer };
  }

  const rows = data ?? [];
  const distinct = (pick: (r: (typeof rows)[number]) => boolean) => new Set(rows.filter(pick).map((r) => r.item));
  const mine = [
    c.user ? distinct((r) => r.user_id === c.user) : null,
    c.device && viewer !== "paid" ? distinct((r) => r.device === c.device) : null,
    !c.user && c.ip ? distinct((r) => r.ip === c.ip) : null,
  ];
  const limit = viewer === "paid" ? DAILY_CEILING : ALLOWANCE[viewer][kind];
  const limits = [limit, limit, limit * ADDRESS_FACTOR];
  const seen = mine.some((s) => s?.has(item));
  // What the reader sees as used: their account's or device's count (an address's is shared, so only when alone)
  const used = Math.max(mine[0]?.size ?? 0, mine[1]?.size ?? 0) || (mine[2]?.size ?? 0);

  if (!seen && mine.some((s, i) => s && s.size >= limits[i]!)) {
    const reason: Denied = viewer === "paid" ? "daily" : viewer === "free" ? "upgrade" : "signin";
    return { allowed: false, reason, viewer, used, limit };
  }
  // Recorded even when seen, so a device read signed out is tied to the account that signs in on it
  const tied = seen && rows.some((r) => r.item === item && r.user_id === c.user && r.device === c.device);
  if (!tied) await db.from("reading_access").insert({ kind, item, user_id: c.user, device: c.device, ip: c.ip });
  return { allowed: true, viewer, used: seen ? used : used + 1, limit };
}
