import type { CaseDetail } from "../../modules/catalogue/cases.service.js";
import { colors, digits, Pdf, type Lang } from "./document.js";

// A reported judgment: the case's particulars as a small table, then the numbered paragraphs (the translation in
// Bangla where one exists).

const words = {
  en: {
    tagline: "Bare Act · Case Laws · Bangladesh",
    court: { AD: "Appellate Division", HCD: "High Court Division" },
    supreme: "Supreme Court of Bangladesh",
    caseNo: "Case",
    date: "Judgment",
    judges: "Bench",
    author: "Delivered by",
    parties: "Parties",
    versus: "versus",
    advocates: "Advocates",
    laws: "Provisions cited",
    keywords: "Keywords",
    judgment: "Judgment",
    footer: "Lawsboi · Reported in the Supreme Court Online Bulletin (SCOB). Check the official report before citing.",
  },
  bn: {
    tagline: "বেয়ার অ্যাক্ট · মামলার রায় · বাংলাদেশ",
    court: { AD: "আপিল বিভাগ", HCD: "হাইকোর্ট বিভাগ" },
    supreme: "বাংলাদেশ সুপ্রিম কোর্ট",
    caseNo: "মামলা",
    date: "রায়ের তারিখ",
    judges: "বেঞ্চ",
    author: "রায় প্রদানকারী",
    parties: "পক্ষগণ",
    versus: "বনাম",
    advocates: "আইনজীবী",
    laws: "উদ্ধৃত বিধান",
    keywords: "মূলশব্দ",
    judgment: "রায়",
    footer: "Lawsboi · সুপ্রিম কোর্ট অনলাইন বুলেটিনে (SCOB) প্রকাশিত। উদ্ধৃত করার আগে মূল প্রতিবেদন দেখুন।",
  },
} as const;

const dateOf = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka" }).format(new Date(iso));

export async function judgmentPdf(c: CaseDetail, lang: Lang): Promise<{ bytes: Buffer; name: string }> {
  const w = words[lang];
  const title = lang === "bn" && c.titleTr ? c.titleTr : c.title;
  const pdf = new Pdf({ lang, title, head: `${title} · ${c.citation}` });
  pdf.brand(w.tagline);

  pdf.write(c.citation, { size: 9, bold: true, color: colors.gold, after: 2 });
  pdf.write(title, { size: 19, bold: true, color: colors.primary, after: 4 });
  pdf.write(`${w.supreme} · ${w.court[c.court]}`, { size: 9.5, color: colors.muted, after: 10 });

  const rows: [string, string][] = [];
  if (c.caseNo) rows.push([w.caseNo, c.caseNo]);
  if (c.date) rows.push([w.date, c.dateKnown ? dateOf(c.date, lang) : digits(c.year ?? "", lang)]);
  if (c.judges.length) rows.push([w.judges, c.judges.join("; ")]);
  if (c.author) rows.push([w.author, c.author]);
  if (c.parties) rows.push([w.parties, `${c.parties.appellant} ${w.versus} ${c.parties.respondent}`]);
  for (const a of c.advocates) rows.push([`${w.advocates} (${a.side})`, a.names]);
  if (c.laws.length) rows.push([w.laws, c.laws.map((l) => `${l.lawTitle[lang]}${l.kind === "law" ? "" : `, ${l.n}`}`).join("; ")]);
  if (c.keywords.length) rows.push([w.keywords, c.keywords.join(", ")]);

  for (const [label, value] of rows) {
    pdf.ensure(24);
    const y = pdf.doc.y;
    pdf.write(label, { y, size: 8.5, bold: true, color: colors.muted, width: 120 });
    const after = pdf.doc.y;
    pdf.doc.y = y;
    pdf.write(value, { x: pdf.left + 128, y, size: 9.5, width: pdf.width - 128 });
    pdf.doc.y = Math.max(pdf.doc.y, after) + 4;
  }
  pdf.rule(colors.gold, 16);
  pdf.write(w.judgment, { size: 12.5, bold: true, color: colors.primary, after: 8 });

  const paragraphs = lang === "bn" && c.textTr?.length ? c.textTr : c.text;
  paragraphs.forEach((p) => {
    if (!p.trim()) return;
    // Most reports number their own paragraphs ("12. …"); hang that number instead of adding another
    const own = /^\s*(\d{1,4}[A-Za-z]?\.)\s+/.exec(p);
    if (own) pdf.marked(digits(own[1]!, lang), p.slice(own[0].length), { size: 10.5, align: "justify", indent: 28, after: 6 });
    else pdf.write(p, { size: 10.5, align: "justify", x: pdf.left + 28, after: 6 });
  });

  return { bytes: await pdf.finish(w.footer), name: `${c.title} ${c.citation}` };
}
