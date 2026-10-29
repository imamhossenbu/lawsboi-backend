import { button, escape, layout, paragraphs, row, type Lang } from "../../../lib/mail/templates/layout.js";

// An announcement as an email, in the reader's language, with the "Open" button when it links somewhere.

const copy = {
  en: { open: "Open in Lawsboi", why: "You get this because your notification settings allow this kind of update by email. Change them under Settings → Notifications." },
  bn: { open: "Lawsboi-তে খুলুন", why: "আপনার নোটিফিকেশন সেটিংসে এই ধরনের আপডেট ইমেইলে পাওয়া চালু আছে বলে এটি পেলেন। সেটিংস → নোটিফিকেশনে বদলাতে পারেন।" },
} as const;

export function announcementMail(a: { title: string; body: string; link: string | null }, lang: Lang, readerUrl: string) {
  const m = copy[lang];
  const href = a.link ? `${readerUrl}${lang === "bn" ? "/bn" : ""}${a.link}` : null;
  const text = `${a.title}\n\n${a.body}${href ? `\n\n${href}` : ""}\n\n${m.why}\n\n— Lawsboi`;
  const html = layout(
    lang,
    row(`<strong style="font-size:18px;color:#1b3a2c">${escape(a.title)}</strong>`) + row(paragraphs(a.body)) + (href ? button(href, m.open) : "") + row(escape(m.why), "padding-top:24px;font-size:13px;line-height:1.6;color:#868a84"),
  );
  return { subject: a.title, text, html };
}
