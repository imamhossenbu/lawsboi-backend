import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTeam } from "../../../middleware/auth.js";
import { validate } from "../../../middleware/validate.js";
import { badRequest, unwrap } from "../../../lib/errors.js";
import { db } from "../../../lib/supabase.js";
import { logAudit } from "../../audit/service.js";
import { methods, walletOf } from "../../billing/shared.js";

// Site-wide settings the reader site reads: the wallets readers pay into and how they reach support.

export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireTeam, requirePermission("settings.view"));

const digits = (n: string) => n.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace(/\D/g, "").replace(/^88/, "");

/** A Bangladeshi mobile number in any common spelling, written the way the checkout shows it: "01712 345 678". */
export function normalizeMobile(input: string) {
  if (/[^\d০-৯\s()+-]/.test(input)) return null;
  const d = digits(input);
  return /^01[3-9]\d{8}$/.test(d) ? `${d.slice(0, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : null;
}

const text = z.object({ en: z.string().trim().max(300), bn: z.string().trim().max(300) });
const contactSchema = z.object({
  email: z.email(),
  phone: z.string().trim().max(30),
  whatsapp: z.string().trim().max(30),
  replyTime: text,
  hours: text,
  office: text,
  officeNote: text,
});
const walletSchema = z.object({ number: z.string().trim().min(1), type: z.enum(["personal", "merchant"]), name: z.string().trim().min(1).max(80), enabled: z.boolean() });
const accountsSchema = z.object({ bkash: walletSchema, nagad: walletSchema });

async function contact() {
  const { data } = await db.from("site_settings").select("value").eq("key", "contact").maybeSingle();
  return (data?.value ?? {}) as Record<string, unknown>;
}

adminSettingsRouter.get("/", async (_req, res) => {
  const wallets = unwrap(await db.from("wallet_accounts").select("*").order("method"));
  res.json({ accounts: Object.fromEntries(wallets.map((w) => [w.method, walletOf(w)])), contact: await contact() });
});

adminSettingsRouter.put("/accounts", requirePermission("settings.payments"), validate("body", accountsSchema), async (req, res) => {
  const b = req.body as z.infer<typeof accountsSchema>;
  const before = new Map(unwrap(await db.from("wallet_accounts").select("*")).map((w) => [w.method, w]));
  const changes: { field: string; of: string; from: unknown; to: unknown }[] = [];
  for (const method of methods) {
    const w = b[method];
    const number = normalizeMobile(w.number);
    if (!number) throw badRequest("Enter a Bangladeshi mobile number.", { [`${method}.number`]: "shape" });
    const was = before.get(method);
    if (was?.number !== number) changes.push({ field: "number", of: method, from: was?.number ?? null, to: number });
    if (was?.enabled !== w.enabled) changes.push({ field: "enabled", of: method, from: was?.enabled ?? null, to: w.enabled });
    if (was?.name !== w.name) changes.push({ field: "name", of: method, from: was?.name ?? null, to: w.name });
    await db.from("wallet_accounts").upsert({ method, number, type: w.type, name: w.name, enabled: w.enabled });
  }
  await logAudit(req, { action: "settings.accounts", target: { type: "settings", id: "payments", label: { en: "Payment accounts", bn: "পেমেন্ট অ্যাকাউন্ট" } }, changes });
  const wallets = unwrap(await db.from("wallet_accounts").select("*").order("method"));
  res.json({ accounts: Object.fromEntries(wallets.map((w) => [w.method, walletOf(w)])) });
});

adminSettingsRouter.put("/contact", requirePermission("settings.contact"), validate("body", contactSchema), async (req, res) => {
  const b = req.body as z.infer<typeof contactSchema>;
  const before = await contact();
  const changes = (Object.keys(b) as (keyof typeof b)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ field: "contact", of: k, from: before[k] ?? null, to: b[k] }));
  await db.from("site_settings").upsert({ key: "contact", value: b, updated_by: req.member!.id });
  await logAudit(req, { action: "settings.contact", target: { type: "settings", id: "contact", label: { en: "Contact details", bn: "যোগাযোগের তথ্য" } }, changes });
  res.json({ contact: b });
});
