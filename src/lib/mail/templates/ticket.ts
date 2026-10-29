import { button, escape, fill, footnote, layout, paragraphs, row, type Lang } from "./layout.js";

const copy = {
  en: {
    replySubject: "Re: {subject} [{id}]",
    replyIntro: "{agent} from Lawsboi support replied to your ticket {id}:",
    replyButton: "Open the ticket",
    replyFooter: "Reply on the ticket page, not to this email: replies to this address aren't read.",
    newSubject: "New ticket {id}: {subject}",
    newIntro: "{name} ({email}) opened ticket {id} ({category}, {priority}):",
    newButton: "Open in the admin panel",
    readerMessageSubject: "Reader replied on {id}: {subject}",
    readerMessageIntro: "{name} wrote on ticket {id}:",
  },
  bn: {
    replySubject: "Re: {subject} [{id}]",
    replyIntro: "Lawsboi সাপোর্টের {agent} আপনার টিকেট {id}-এ উত্তর দিয়েছেন:",
    replyButton: "টিকেটটি খুলুন",
    replyFooter: "উত্তর দিতে টিকেটের পাতায় যান; এই ইমেইলে উত্তর দিলে তা পড়া হয় না।",
    newSubject: "নতুন টিকেট {id}: {subject}",
    newIntro: "{name} ({email}) টিকেট {id} খুলেছেন ({category}, {priority}):",
    newButton: "অ্যাডমিন প্যানেলে খুলুন",
    readerMessageSubject: "{id}-এ পাঠকের উত্তর: {subject}",
    readerMessageIntro: "{name} টিকেট {id}-এ লিখেছেন:",
  },
} satisfies Record<Lang, Record<string, string>>;

const quote = (body: string) => row(`<div style="border-left:3px solid #b5853a;padding:4px 0 4px 16px;color:#17201b">${paragraphs(body)}</div>`, "padding-top:16px;font-size:15px;line-height:1.6");

/** To the reader, when the team replies. */
export function ticketReplyMail(i: { id: string; subject: string; agent: string; body: string; ticketUrl: string }, lang: Lang) {
  const m = copy[lang];
  const subject = fill(m.replySubject, { subject: i.subject, id: i.id });
  const intro = fill(m.replyIntro, { agent: i.agent, id: i.id });
  const text = `${intro}\n\n${i.body}\n\n${i.ticketUrl}\n\n${m.replyFooter}\n\n— Lawsboi`;
  const html = layout(lang, row(escape(intro)) + quote(i.body) + button(i.ticketUrl, m.replyButton) + footnote(m.replyFooter));
  return { subject, text, html };
}

/** To the support inbox, when a reader opens a ticket or writes on one. */
export function ticketInboxMail(
  i: { id: string; subject: string; name: string; email: string; category: string; priority: string; body: string; adminUrl: string; first: boolean },
  lang: Lang,
) {
  const m = copy[lang];
  const subject = fill(i.first ? m.newSubject : m.readerMessageSubject, { id: i.id, subject: i.subject });
  const intro = fill(i.first ? m.newIntro : m.readerMessageIntro, { name: i.name, email: i.email, id: i.id, category: i.category, priority: i.priority });
  const text = `${intro}\n\n${i.body}\n\n${i.adminUrl}`;
  const html = layout(lang, row(escape(intro)) + quote(i.body) + button(i.adminUrl, m.newButton));
  return { subject, text, html };
}
