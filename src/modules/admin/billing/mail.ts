import { env } from "../../../config/env.js";
import { sendMail } from "../../../lib/mail/send.js";
import { button, escape, fill, footnote, layout, row, type Lang } from "../../../lib/mail/templates/layout.js";
import type { Tables } from "../../../types/database.js";

// Tells the reader what happened to the payment they submitted. Billing email can't be turned off (the reader's
// notification settings don't apply), as the checkout's confirmation page promises.

const copy = {
  en: {
    verifiedSubject: "Your {plan} plan is active",
    verified: "We've confirmed your {method} payment of ৳{amount} (transaction {trx}). Your {plan} plan is active now.",
    verifiedButton: "Open your dashboard",
    rejectedSubject: "We couldn't confirm your payment",
    rejected: "We couldn't confirm your {method} payment of ৳{amount} (transaction {trx}): {reason}",
    reasons: {
      not_found: "we couldn't find this transaction in our account.",
      amount: "the amount doesn't match the plan's price.",
      duplicate: "this transaction id was already used for another payment.",
    },
    rejectedButton: "Try again",
    help: "Questions? Reply through Help → Support tickets on the site.",
    methods: { bkash: "bKash", nagad: "Nagad" },
  },
  bn: {
    verifiedSubject: "আপনার {plan} প্ল্যান চালু হয়েছে",
    verified: "আপনার {method} পেমেন্ট ৳{amount} (ট্রানজেকশন {trx}) নিশ্চিত হয়েছে। আপনার {plan} প্ল্যান এখন চালু।",
    verifiedButton: "ড্যাশবোর্ড খুলুন",
    rejectedSubject: "আপনার পেমেন্ট নিশ্চিত করা যায়নি",
    rejected: "আপনার {method} পেমেন্ট ৳{amount} (ট্রানজেকশন {trx}) নিশ্চিত করা যায়নি: {reason}",
    reasons: {
      not_found: "আমাদের অ্যাকাউন্টে এই ট্রানজেকশন পাওয়া যায়নি।",
      amount: "টাকার পরিমাণ প্ল্যানের মূল্যের সঙ্গে মেলেনি।",
      duplicate: "এই ট্রানজেকশন আইডি আগেই আরেকটি পেমেন্টে ব্যবহার হয়েছে।",
    },
    rejectedButton: "আবার চেষ্টা করুন",
    help: "প্রশ্ন থাকলে সাইটের সাহায্য → সাপোর্ট টিকেট থেকে জানান।",
    methods: { bkash: "বিকাশ", nagad: "নগদ" },
  },
} as const;

const site = (lang: Lang, path: string) => `${env.READER_URL}${lang === "bn" ? "/bn" : ""}${path}`;

export function paymentMail(payment: Tables<"payments">, planName: { en: string; bn: string }, outcome: "verified" | "rejected", lang: Lang) {
  const m = copy[lang];
  const values = {
    plan: planName[lang],
    method: m.methods[payment.method],
    amount: payment.amount.toLocaleString(lang === "bn" ? "bn-BD" : "en-US"),
    trx: payment.trx_id,
    reason: payment.reason ? m.reasons[payment.reason] : "",
  };
  const subject = fill(outcome === "verified" ? m.verifiedSubject : m.rejectedSubject, values);
  const body = fill(outcome === "verified" ? m.verified : m.rejected, values);
  const href = site(lang, outcome === "verified" ? "/dashboard/plan" : "/pricing");
  const label = outcome === "verified" ? m.verifiedButton : m.rejectedButton;
  return {
    subject,
    text: `${body}\n\n${href}\n\n${m.help}\n\n— Lawsboi`,
    html: layout(lang, row(escape(body)) + button(href, label) + footnote(m.help)),
  };
}

/** Sends it without holding up the team's click; a failure is logged by sendMail. */
export function notifyPayment(payment: Tables<"payments">, reader: Tables<"profiles">, plan: Tables<"plans"> | null, outcome: "verified" | "rejected") {
  const name = { en: plan?.name ?? payment.plan_id, bn: plan?.name_bn ?? plan?.name ?? payment.plan_id };
  void sendMail({ to: reader.email, ...paymentMail(payment, name, outcome, reader.lang) });
}
