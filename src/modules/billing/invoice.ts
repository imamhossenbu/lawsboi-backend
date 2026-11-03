import { conflict, unwrap } from "../../lib/errors.js";
import { invoicePdf, type InvoiceData } from "../../lib/pdf/invoice.js";
import type { Lang } from "../../lib/pdf/document.js";
import { db } from "../../lib/supabase.js";
import type { PaymentRow } from "./shared.js";

// The invoice of a verified (or later refunded) payment. It is made from the payment's own rows whenever it is
// asked for, so it always matches what was paid; its number follows the payment's ("PAY-000042" → "INV-000042").

export const invoiceNumber = (p: Pick<PaymentRow, "public_id">) => p.public_id.replace(/^PAY-/, "INV-");

export async function invoiceFor(payment: PaymentRow, lang: Lang) {
  if (payment.status !== "verified" && payment.status !== "refunded") throw conflict("An invoice is made once the payment is verified.");
  const [reader, plan, subscription, wallet, contact] = await Promise.all([
    db.from("profiles").select("*").eq("id", payment.user_id).single(),
    db.from("plans").select("name,name_bn").eq("id", payment.plan_id).maybeSingle(),
    payment.subscription_id ? db.from("subscriptions").select("started_at,renews_at").eq("id", payment.subscription_id).maybeSingle() : null,
    db.from("wallet_accounts").select("number,name").eq("method", payment.method).maybeSingle(),
    db.from("site_settings").select("value").eq("key", "contact").maybeSingle(),
  ]);
  const r = unwrap(reader);
  const c = (contact.data?.value ?? {}) as { email?: string; phone?: string; office?: { en: string; bn: string } };
  const issued = payment.reviewed_at ?? payment.submitted_at;
  const data: InvoiceData = {
    number: invoiceNumber(payment),
    issued,
    status: payment.status,
    reader: { name: (lang === "bn" && r.name_bn) || r.name, email: r.email, id: r.public_id, ...(r.phone ? { phone: r.phone } : {}) },
    plan: { en: plan.data?.name ?? payment.plan_id, bn: plan.data?.name_bn || plan.data?.name || payment.plan_id },
    cycle: payment.cycle,
    period: { from: subscription?.data?.started_at ?? issued, to: subscription?.data?.renews_at ?? null },
    amount: payment.amount,
    method: payment.method,
    trxId: payment.trx_id,
    submitted: payment.submitted_at,
    wallet: wallet.data ? `${wallet.data.number}${wallet.data.name ? ` (${wallet.data.name})` : ""}` : null,
    seller: { email: c.email ?? "", phone: c.phone ?? "", address: c.office?.[lang] ?? "Dhaka, Bangladesh" },
  };
  return invoicePdf(data, lang);
}
