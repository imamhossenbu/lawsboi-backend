import { button, escape, fill, footnote, layout, row, type Lang } from "./layout.js";

// The same wording as the admin panel's settingsPage.team.mail dictionary.
const copy = {
  en: {
    subject: "{inviter} invited you to the Lawsboi admin panel",
    greeting: "Hello {name},",
    intro: "{inviter} has added you to the Lawsboi admin panel as {role}. Sign in with this email address and the temporary password below.",
    email: "Sign in at",
    password: "Temporary password",
    button: "Sign in to Lawsboi admin",
    change: "Change this password after you sign in for the first time.",
    ignore: "If you weren't expecting this, you can ignore this email.",
    roles: { admin: "Administrator", editor: "Content editor", support: "Support agent" },
  },
  bn: {
    subject: "{inviter} আপনাকে Lawsboi অ্যাডমিন প্যানেলে আমন্ত্রণ জানিয়েছেন",
    greeting: "প্রিয় {name},",
    intro: "{inviter} আপনাকে Lawsboi অ্যাডমিন প্যানেলে {role} হিসেবে যোগ করেছেন। এই ইমেইল ঠিকানা আর নিচের অস্থায়ী পাসওয়ার্ড দিয়ে লগইন করুন।",
    email: "লগইনের ঠিকানা",
    password: "অস্থায়ী পাসওয়ার্ড",
    button: "Lawsboi অ্যাডমিনে লগইন করুন",
    change: "প্রথমবার লগইনের পর পাসওয়ার্ডটি বদলে নিন।",
    ignore: "আপনি এটা আশা না করলে ইমেইলটি এড়িয়ে যেতে পারেন।",
    roles: { admin: "অ্যাডমিনিস্ট্রেটর", editor: "কনটেন্ট এডিটর", support: "সাপোর্ট এজেন্ট" },
  },
} as const;

export interface Invite {
  name: string;
  role: "admin" | "editor" | "support";
  inviter: string;
  password: string;
  signInUrl: string;
}

export function inviteMail(i: Invite, lang: Lang) {
  const m = copy[lang];
  const role = m.roles[i.role];
  const subject = fill(m.subject, { inviter: i.inviter });
  const greeting = fill(m.greeting, { name: i.name });
  const intro = fill(m.intro, { inviter: i.inviter, role });
  const text = `${greeting}\n\n${intro}\n\n${m.email}: ${i.signInUrl}\n${m.password}: ${i.password}\n\n${m.change}\n${m.ignore}\n\n— Lawsboi`;
  const html = layout(
    lang,
    row(`${escape(greeting)}<br><br>${escape(intro)}`) +
      row(escape(m.password), "padding:20px 0 8px;font-size:13px;color:#868a84") +
      row(`<div style="font-size:22px;letter-spacing:2px;font-weight:bold;color:#1b3a2c;background:#eef3ef;border-radius:12px;padding:14px;text-align:center;font-family:Menlo,Consolas,monospace">${escape(i.password)}</div>`, "") +
      button(i.signInUrl, m.button) +
      footnote(`${m.change}\n${m.ignore}`),
  );
  return { subject, text, html };
}
