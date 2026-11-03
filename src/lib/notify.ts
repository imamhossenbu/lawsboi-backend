import { db } from "./supabase.js";

// A row in a reader's bell beside the announcements (ticket replies, payments, news). Never throws: a missing bell
// row can't undo what caused it.

export interface ReaderNotice {
  kind: "ticket_reply" | "payment_verified" | "payment_rejected" | "news";
  title: { en: string; bn: string };
  body?: { en: string; bn: string };
  /** A language-neutral site path ("/dashboard/plan"). */
  link?: string;
}

export async function notifyReader(userIds: string | string[], n: ReaderNotice) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return;
  const rows = ids.map((user_id) => ({
    user_id,
    kind: n.kind,
    title: n.title.en.slice(0, 200),
    title_bn: n.title.bn.slice(0, 200),
    body: n.body?.en.slice(0, 500) ?? "",
    body_bn: n.body?.bn.slice(0, 500) ?? "",
    link: n.link ?? null,
  }));
  for (let i = 0; i < rows.length; i += 500) await db.from("reader_notifications").insert(rows.slice(i, i + 500)).then(() => undefined, () => undefined);
}

const methods = { bkash: { en: "bKash", bn: "বিকাশ" }, nagad: { en: "Nagad", bn: "নগদ" } } as const;

/** The reader's bell after the team (or an SMS) settled their payment. */
export function notifyPaymentOutcome(p: { user_id: string; amount: number; method: "bkash" | "nagad"; trx_id: string }, outcome: "verified" | "rejected", plan: { en: string; bn: string }) {
  const m = methods[p.method];
  return notifyReader(p.user_id, {
    kind: outcome === "verified" ? "payment_verified" : "payment_rejected",
    title: outcome === "verified" ? { en: `Your ${plan.en} plan is active`, bn: `আপনার ${plan.bn} প্ল্যান চালু হয়েছে` } : { en: "We couldn't confirm your payment", bn: "আপনার পেমেন্ট নিশ্চিত করা যায়নি" },
    body:
      outcome === "verified"
        ? { en: `${m.en} payment of ৳${p.amount} (${p.trx_id}) confirmed. Your invoice is on My plan.`, bn: `${m.bn} পেমেন্ট ৳${p.amount} (${p.trx_id}) নিশ্চিত হয়েছে। ইনভয়েস "আমার প্ল্যান"-এ।` }
        : { en: `${m.en} payment ${p.trx_id} couldn't be confirmed. See My plan for the reason.`, bn: `${m.bn} পেমেন্ট ${p.trx_id} নিশ্চিত করা যায়নি। কারণ "আমার প্ল্যান"-এ দেখুন।` },
    link: "/dashboard/plan",
  });
}
