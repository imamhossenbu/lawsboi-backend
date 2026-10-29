import { codeBox, fill, footnote, layout, row, type Lang } from "./layout.js";

// The same wording as the reader site's own auth.mail dictionary.
const copy = {
  en: {
    signupSubject: "{code} is your Lawsboi verification code",
    resetSubject: "{code} is your Lawsboi password reset code",
    signupIntro: "Use this code to verify your email and finish creating your Lawsboi account.",
    resetIntro: "Use this code to reset your Lawsboi password.",
    expiry: "The code expires in 10 minutes.",
    ignore: "If you didn't ask for it, you can ignore this email.",
  },
  bn: {
    signupSubject: "{code} — আপনার Lawsboi যাচাই কোড",
    resetSubject: "{code} — আপনার Lawsboi পাসওয়ার্ড রিসেট কোড",
    signupIntro: "আপনার ইমেইল যাচাই করে Lawsboi অ্যাকাউন্ট খোলা শেষ করতে এই কোডটি ব্যবহার করুন।",
    resetIntro: "আপনার Lawsboi পাসওয়ার্ড রিসেট করতে এই কোডটি ব্যবহার করুন।",
    expiry: "কোডটির মেয়াদ ১০ মিনিট।",
    ignore: "আপনি না চেয়ে থাকলে এই ইমেইলটি উপেক্ষা করুন।",
  },
} satisfies Record<Lang, Record<string, string>>;

export function otpMail(code: string, purpose: "signup" | "reset", lang: Lang) {
  const m = copy[lang];
  const intro = purpose === "signup" ? m.signupIntro : m.resetIntro;
  const subject = fill(purpose === "signup" ? m.signupSubject : m.resetSubject, { code });
  const text = `${intro}\n\n${code}\n\n${m.expiry}\n${m.ignore}\n\n— Lawsboi`;
  const html = layout(lang, row(intro) + codeBox(code) + footnote(`${m.expiry}\n${m.ignore}`));
  return { subject, text, html };
}
