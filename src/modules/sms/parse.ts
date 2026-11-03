// Reads a bKash or Nagad "money received" SMS: the transaction id, the amount, who sent it and which wallet. The
// wording changes now and then (English or Bangla, "Cash In", "payment", "Money Received"), so this looks for the
// parts rather than whole sentences. Anything without a transaction id isn't a payment SMS.

export interface ParsedSms {
  method: "bkash" | "nagad" | null;
  trxId: string | null;
  amount: number | null;
  /** The payer's number as 01XXXXXXXXX. */
  from: string | null;
  /** A received payment, not an outgoing one or an OTP. */
  incoming: boolean;
}

const BN_DIGITS: Record<string, string> = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };
const latin = (s: string) => s.replace(/[০-৯]/g, (d) => BN_DIGITS[d]!);

const TRX = /(?:Trx\s*ID|TrxID|TxnID|Txn\s*ID|Transaction\s*ID|TxID|ট্রানজেকশন\s*আইডি|লেনদেন\s*নং)\s*[:：#.]?\s*([A-Z0-9]{8,12})\b/i;
const AMOUNT = /(?:Tk\.?|BDT|৳|টাকা)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:Tk|টাকা)/i;
const AMOUNT_LABEL = /Amount\s*[:：]\s*(?:Tk\.?|BDT|৳)?\s*([\d,]+(?:\.\d{1,2})?)/i;
const FROM = /(?:from|Sender|প্রেরক|থেকে)\s*[:：]?\s*(\+?88)?(01[3-9]\d{8})/i;
const NUMBER = /(?:\+?88)?(01[3-9]\d{8})/;
const INCOMING = /received|cash\s*in|money\s*received|payment\s*received|পেয়েছেন|গ্রহণ|জমা/i;
const OUTGOING = /send\s*money\s*to|sent\s*to|payment\s*to|cash\s*out|you\s*have\s*paid|পাঠিয়েছেন|ক্যাশ\s*আউট/i;

const amountOf = (raw: string | undefined) => {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseSms(body: string, sender = ""): ParsedSms {
  const text = latin(body).replace(/\s+/g, " ").trim();
  const who = `${sender} ${text}`.toLowerCase();
  const trx = TRX.exec(text)?.[1]?.toUpperCase() ?? null;
  // "Amount: Tk 500.00" (Nagad) wins over the first taka figure, which could be a fee or the balance
  const labelled = AMOUNT_LABEL.exec(text)?.[1];
  const first = AMOUNT.exec(text);
  const amount = amountOf(labelled ?? first?.[1] ?? first?.[2]);
  const from = FROM.exec(text)?.[2] ?? NUMBER.exec(text.replace(TRX, ""))?.[1] ?? null;
  let method: ParsedSms["method"] = who.includes("nagad") || /TxnID/i.test(text) ? "nagad" : who.includes("bkash") || /TrxID/i.test(text) ? "bkash" : null;
  if (!method && trx) method = trx.length === 10 ? "bkash" : trx.length === 8 ? "nagad" : null;
  return { method, trxId: trx, amount, from, incoming: INCOMING.test(text) && !OUTGOING.test(text) };
}
