import { colors, digits, Pdf, type Lang } from "./document.js";

// The receipt for a verified payment: who paid, for which plan and period, through which wallet, and the total.

export interface InvoiceData {
  number: string;
  issued: string;
  status: "verified" | "refunded";
  reader: { name: string; email: string; id: string; phone?: string };
  plan: { en: string; bn: string };
  cycle: "monthly" | "yearly";
  period: { from: string; to: string | null };
  amount: number;
  method: "bkash" | "nagad";
  trxId: string;
  submitted: string;
  wallet: string | null;
  seller: { email: string; phone: string; address: string };
}

const words = {
  en: {
    tagline: "Bare Act · Case Laws · Bangladesh",
    invoice: "INVOICE",
    number: "Invoice no.",
    issued: "Issued",
    billedTo: "Billed to",
    from: "From",
    readerId: "Reader ID",
    description: "Description",
    period: "Period",
    amount: "Amount",
    plan: (name: string, cycle: string) => `Lawsboi ${name} plan — ${cycle} subscription`,
    cycles: { monthly: "monthly", yearly: "yearly" },
    subtotal: "Subtotal",
    total: "Total paid",
    payment: "Payment",
    methodLabel: "Method",
    method: { bkash: "bKash", nagad: "Nagad" },
    trx: "Transaction ID",
    paidOn: "Paid on",
    to: "To wallet",
    paid: "PAID",
    refunded: "REFUNDED",
    open: "until cancelled",
    thanks: "Thank you for reading with Lawsboi.",
    note: "This invoice was generated when the payment was verified. Prices are in Bangladeshi Taka (BDT).",
    footer: "Lawsboi · Invoice",
  },
  bn: {
    tagline: "বেয়ার অ্যাক্ট · মামলার রায় · বাংলাদেশ",
    invoice: "ইনভয়েস",
    number: "ইনভয়েস নং",
    issued: "ইস্যুর তারিখ",
    billedTo: "বিল প্রাপক",
    from: "প্রদানকারী",
    readerId: "পাঠক আইডি",
    description: "বিবরণ",
    period: "মেয়াদ",
    amount: "পরিমাণ",
    plan: (name: string, cycle: string) => `Lawsboi ${name} প্ল্যান — ${cycle} সাবস্ক্রিপশন`,
    cycles: { monthly: "মাসিক", yearly: "বার্ষিক" },
    subtotal: "উপমোট",
    total: "মোট পরিশোধিত",
    payment: "পেমেন্ট",
    methodLabel: "মাধ্যম",
    method: { bkash: "বিকাশ", nagad: "নগদ" },
    trx: "ট্রানজেকশন আইডি",
    paidOn: "পরিশোধের তারিখ",
    to: "যে ওয়ালেটে",
    paid: "পরিশোধিত",
    refunded: "ফেরত দেওয়া হয়েছে",
    open: "বাতিল না করা পর্যন্ত",
    thanks: "Lawsboi-এর সাথে থাকার জন্য ধন্যবাদ।",
    note: "পেমেন্ট যাচাইয়ের সময় এই ইনভয়েস তৈরি হয়েছে। মূল্য বাংলাদেশি টাকায় (BDT)।",
    footer: "Lawsboi · ইনভয়েস",
  },
} as const;

const date = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" }).format(new Date(iso));
const money = (n: number, lang: Lang) =>
  `${lang === "bn" ? "৳" : "BDT "}${digits(n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }), lang)}`;

export async function invoicePdf(inv: InvoiceData, lang: Lang): Promise<{ bytes: Buffer; name: string }> {
  const w = words[lang];
  const pdf = new Pdf({ lang, title: `${w.invoice} ${inv.number}` });
  const doc = pdf.doc;
  pdf.brand(w.tagline);

  // Title and the stamp
  const top = doc.y;
  pdf.write(w.invoice, { y: top, size: 24, bold: true, color: colors.primary, after: 2 });
  pdf.write(`${w.number}  ${inv.number}`, { size: 9.5, color: colors.muted });
  pdf.write(`${w.issued}  ${date(inv.issued, lang)}`, { size: 9.5, color: colors.muted });
  const headEnd = doc.y;
  const stamp = inv.status === "refunded" ? w.refunded : w.paid;
  const tone = inv.status === "refunded" ? "#a3412b" : colors.primary;
  const sx = pdf.left + pdf.width - 140;
  doc.roundedRect(sx, top + 4, 140, 34, 8).lineWidth(1.4).strokeColor(tone).stroke();
  pdf.write(stamp, { x: sx, y: top + 13, width: 140, size: 12, bold: true, color: tone, align: "center" });
  doc.y = Math.max(headEnd, top + 50) + 14;

  // From / billed to
  const col = (pdf.width - 20) / 2;
  const y0 = doc.y;
  doc.roundedRect(pdf.left, y0, col, 112, 10).fill(colors.primarySoft);
  doc.roundedRect(pdf.left + col + 20, y0, col, 112, 10).fill(colors.goldSoft);
  const block = (x: number, label: string, lines: string[]) => {
    pdf.write(label.toUpperCase(), { x: x + 14, y: y0 + 12, width: col - 28, size: 7.5, bold: true, color: colors.gold, after: 3 });
    lines.forEach((l, i) => pdf.write(l, { x: x + 14, width: col - 28, size: i === 0 ? 11 : 9, bold: i === 0, color: i === 0 ? colors.primary : colors.muted, after: 1 }));
  };
  block(pdf.left, w.from, ["Lawsboi", inv.seller.address, inv.seller.email, inv.seller.phone].filter(Boolean));
  block(pdf.left + col + 20, w.billedTo, [inv.reader.name, inv.reader.email, `${w.readerId}: ${inv.reader.id}`, inv.reader.phone ?? ""].filter(Boolean));
  doc.y = y0 + 130;

  // The line
  const cols = [pdf.left, pdf.left + pdf.width * 0.5, pdf.left + pdf.width * 0.78];
  const th = doc.y;
  doc.rect(pdf.left, th, pdf.width, 24).fill(colors.primary);
  pdf.write(w.description, { x: cols[0]! + 12, y: th + 7, width: 200, size: 8.5, bold: true, color: "#ffffff" });
  pdf.write(w.period, { x: cols[1], y: th + 7, width: 140, size: 8.5, bold: true, color: "#ffffff" });
  pdf.write(w.amount, { x: cols[2], y: th + 7, width: pdf.left + pdf.width - cols[2]! - 12, size: 8.5, bold: true, color: "#ffffff", align: "right" });
  const tr = th + 34;
  pdf.write(w.plan(inv.plan[lang], w.cycles[inv.cycle]), { x: cols[0]! + 12, y: tr, width: cols[1]! - cols[0]! - 24, size: 10 });
  const rowEnd = doc.y;
  pdf.write(`${date(inv.period.from, lang)} – ${inv.period.to ? date(inv.period.to, lang) : w.open}`, { x: cols[1], y: tr, width: cols[2]! - cols[1]! - 10, size: 9.5, color: colors.muted });
  pdf.write(money(inv.amount, lang), { x: cols[2], y: tr, width: pdf.left + pdf.width - cols[2]! - 12, size: 10, align: "right" });
  doc.y = Math.max(doc.y, rowEnd) + 10;
  pdf.rule(colors.line, 6);

  // Totals
  const total = (label: string, value: string, strong = false) => {
    const y = doc.y;
    pdf.write(label, { x: cols[1], y, width: 160, size: strong ? 11 : 9.5, bold: strong, color: strong ? colors.primary : colors.muted });
    pdf.write(value, { x: cols[2], y, width: pdf.left + pdf.width - cols[2]! - 12, size: strong ? 12 : 9.5, bold: strong, color: strong ? colors.primary : colors.ink, align: "right", after: 6 });
  };
  total(w.subtotal, money(inv.amount, lang));
  total(w.total, money(inv.amount, lang), true);
  doc.y += 14;

  // Payment details
  pdf.write(w.payment.toUpperCase(), { size: 7.5, bold: true, color: colors.gold, after: 4 });
  const detail = (label: string, value: string) => {
    const y = doc.y;
    pdf.write(label, { y, width: 140, size: 9, color: colors.muted });
    pdf.write(value, { x: pdf.left + 150, y, width: pdf.width - 150, size: 9.5, after: 3 });
  };
  detail(w.methodLabel, w.method[inv.method]);
  detail(w.trx, inv.trxId);
  detail(w.paidOn, date(inv.submitted, lang));
  if (inv.wallet) detail(w.to, inv.wallet);

  doc.y += 24;
  pdf.write(w.thanks, { size: 11, bold: true, color: colors.primary, after: 3 });
  pdf.write(w.note, { size: 8.5, color: colors.muted });

  return { bytes: await pdf.finish(`${w.footer} ${inv.number}`), name: `Lawsboi-invoice-${inv.number}` };
}
