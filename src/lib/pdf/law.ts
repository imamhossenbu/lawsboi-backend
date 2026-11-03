import type { ActText } from "../../modules/catalogue/laws.service.js";
import type { Block, LawRecord } from "../../modules/catalogue/shared.js";
import { colors, digits, Pdf, type Lang } from "./document.js";

// A law as a printable book: the title page block, then each part and its sections. In Bangla the unofficial
// translation comes first with the enacted English under it, as on the reader site.

const words = {
  en: {
    tagline: "Bare Act · Case Laws · Bangladesh",
    enacted: "Enacted",
    inForce: "In force",
    repealed: "Repealed",
    section: "Section",
    article: "Article",
    original: "Original text · English",
    translation: "Unofficial translation",
    footer: "Lawsboi · An unofficial reading copy. Check the Bangladesh Gazette for the authoritative text.",
    extract: "Extract",
  },
  bn: {
    tagline: "বেয়ার অ্যাক্ট · মামলার রায় · বাংলাদেশ",
    enacted: "প্রণীত",
    inForce: "বলবৎ",
    repealed: "রহিত",
    section: "ধারা",
    article: "অনুচ্ছেদ",
    original: "মূল পাঠ · ইংরেজি",
    translation: "অনানুষ্ঠানিক অনুবাদ",
    footer: "Lawsboi · পড়ার জন্য অনানুষ্ঠানিক কপি। প্রামাণ্য পাঠের জন্য বাংলাদেশ গেজেট দেখুন।",
    extract: "অংশবিশেষ",
  },
} as const;

type Section = ActText["parts"][number]["sections"][number];

function blocks(pdf: Pdf, body: Block[], tr: string[] | null, o: { size: number; color: string }) {
  body.forEach((b, i) => {
    const text = tr?.[i] ?? b.text;
    if (!text.trim()) return;
    pdf.ensure(20);
    if (b.mark && b.kind === "clause") pdf.marked(b.mark, text, { ...o, x: pdf.left + 14, after: 3 });
    else pdf.write(b.mark ? `${b.mark} ${text}` : text, { ...o, align: "justify", after: 4 });
  });
}

function section(pdf: Pdf, s: Section, law: LawRecord, lang: Lang) {
  const w = words[lang];
  const unit = law.unit === "articles" ? w.article : w.section;
  const translated = lang === "bn" && !!s.translation && law.language !== "bn";
  const title = lang === "bn" ? s.title.bn : s.title.en;
  pdf.ensure(60);
  pdf.write(`${unit} ${digits(s.n, lang)}. ${title}`, { size: 11.5, bold: true, color: colors.primary, after: 4 });
  if (translated) {
    blocks(pdf, s.body, s.translation!.body, { size: 10.5, color: colors.ink });
    pdf.ensure(30);
    pdf.write(w.original, { size: 7.5, bold: true, color: colors.gold, after: 2 });
    blocks(pdf, s.body, null, { size: 9, color: colors.muted });
  } else {
    blocks(pdf, s.body, null, { size: 10.5, color: colors.ink });
  }
  if (s.footnotes.length) {
    pdf.space(2);
    for (const f of s.footnotes) pdf.marked(digits(f.mark, lang), lang === "bn" ? f.text.bn : f.text.en, { size: 8, color: colors.muted, indent: 14 });
  }
  pdf.space(10);
}

/** The law, whole or only the sections in `only` (one section, or one page of the bare-act book). */
export async function lawPdf(law: LawRecord, text: ActText, lang: Lang, only?: Set<string>): Promise<{ bytes: Buffer; name: string }> {
  const w = words[lang];
  const title = law.title[lang];
  const pdf = new Pdf({ lang, title, head: title });
  pdf.brand(w.tagline);

  pdf.write(title, { size: 21, bold: true, color: colors.primary, after: 4 });
  const status = law.status === "repealed" ? w.repealed : w.inForce;
  pdf.write(`${law.actNo[lang]}   ·   ${w.enacted} ${digits(law.year, lang)}   ·   ${status}${only ? `   ·   ${w.extract}` : ""}`, {
    size: 9.5,
    color: colors.muted,
    after: 8,
  });
  if (!only || only.size > 3) {
    if (text.longTitle) pdf.write(text.longTitle, { size: 10, color: colors.muted, align: "justify", after: 6 });
    if (text.preamble) pdf.write(text.preamble, { size: 10, color: colors.muted, align: "justify", after: 6 });
  }
  pdf.rule(colors.gold, 14);

  for (const part of text.parts) {
    const sections = only ? part.sections.filter((s) => only.has(s.n)) : part.sections;
    if (!sections.length) continue;
    const partTitle = part.title[lang];
    if (partTitle && text.parts.length > 1) {
      pdf.ensure(80);
      pdf.space(4);
      if (part.banner) pdf.write(part.banner, { size: 8.5, bold: true, color: colors.gold, align: "center", after: 1 });
      pdf.write(partTitle, { size: 12.5, bold: true, color: colors.primary, align: "center", after: part.sub ? 1 : 10 });
      if (part.sub) pdf.write(part.sub, { size: 9, color: colors.muted, align: "center", after: 10 });
    }
    for (const s of sections) section(pdf, s, law, lang);
  }

  const bytes = await pdf.finish(w.footer);
  const suffix = only && only.size === 1 ? `-${[...only][0]}` : only ? "-extract" : "";
  return { bytes, name: `${law.title.en}${suffix}` };
}
