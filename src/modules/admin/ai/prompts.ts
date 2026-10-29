// The instructions the panel's AI help runs with. Kept apart from the routes so they read as one document and can
// be tested: every prompt keeps legal terms, section numbering and the reader site's own button names intact.

export type Lang = "en" | "bn";
export const langName = (l: Lang) => (l === "bn" ? "Bangla (Bengali script)" : "English");

const SITE = [
  "Lawsboi is a Bangladeshi legal research site: readers search laws and court judgments, ask an AI assistant, save items to a library and pay for plans with bKash or Nagad.",
  "Plans: Free (5 AI questions a month, 5 saved items), Researcher ৳100 a month or ৳960 a year (30 AI questions, 50 saved items, PDF downloads, advanced search, related cases), Professional ৳300 a month or ৳2,880 a year (unlimited AI and saved items, case analysis and comparison, citation export, priority support).",
  "Always write the name Lawsboi in Latin letters, in Bangla text too, and bKash and Nagad as written here.",
  "Dashboard pages: Laws (/dashboard/laws), Acts (/dashboard/acts), Case law (/dashboard/cases), AI assistant (/dashboard/assistant), Library (/dashboard/library), Research history (/dashboard/history), My plan (/dashboard/plan), Settings (/dashboard/settings), Change password (/dashboard/settings/password), Help (/dashboard/help).",
].join("\n");

/** Translation in the register a lawyer would expect, marks and numbers untouched. */
export function translateInstruction(from: Lang, to: Lang, kind: "legal" | "content" | "ui" = "content") {
  return [
    `Translate from ${langName(from)} to ${langName(to)}.`,
    kind === "legal"
      ? "This is the text of a statute or a judgment of Bangladesh: use the formal legal register of the official Bangla/English versions of Bangladeshi laws, translate faithfully clause by clause, and add nothing."
      : kind === "ui"
        ? "This is a short interface label or message: keep it short and natural."
        : "This is help-centre or announcement text for readers of a legal research site: plain, friendly and precise.",
    "Keep section and article numbers, clause marks like (1), (a), (i), case citations, names of acts, amounts in taka and URLs exactly as they are (Bangla numerals are fine in Bangla text).",
    "Keep line breaks. Translate every item; never merge or drop items. Return only the translation.",
  ].join("\n");
}

export function tidyInstruction(lang: Lang) {
  return [
    `Improve the wording of this ${langName(lang)} text for a legal research site's readers: fix grammar, spelling and awkward phrasing, keep it concise.`,
    "Keep the meaning, every fact, number, legal term, section number and link exactly. Keep line breaks and list structure. Write in the same language. Return only the improved text.",
  ].join("\n");
}

export function articleInstruction() {
  return [
    SITE,
    "Write a help-centre article for Lawsboi readers, in both English and Bangla (each written naturally, not word-for-word).",
    "A title (short, task-shaped), a one or two sentence summary, and 3 to 7 numbered steps a reader follows on the site, naming the site's real pages and buttons.",
    "Pick tryHref: the dashboard page the article's \"Try it\" button opens, from the list of dashboard pages. Pick icon from: search, sparkles, bookmark, card, crown, download, key, file.",
    "Never invent features or prices that aren't listed above.",
  ].join("\n");
}

export function pageInstruction(slug: string) {
  const what =
    slug === "privacy"
      ? "the site's privacy policy"
      : slug === "disclaimer"
        ? "the site's legal disclaimer (legal information, not legal advice; no lawyer-client relationship; check official gazettes)"
        : "the site's About page";
  return [
    SITE,
    `Write ${what} as page sections, each with every text in both English and Bangla.`,
    "Each section has an id (short, lowercase, hyphenated), a title and body paragraphs; use list for bullet points when the content is a list. Keep existing section ids when rewriting a section that already exists.",
    "Be accurate and careful: never promise things the site doesn't do. Write as Lawsboi (\"we\").",
  ].join("\n");
}

export function announcementInstruction(topic: string) {
  return [
    SITE,
    `Write a short announcement for readers about this ${topic} news, in both English and Bangla: a title of at most 8 words and a body of one to three sentences.`,
    "Friendly and clear; no exclamation marks in every sentence, no emoji, no invented dates or prices.",
  ].join("\n");
}

export function lawReadInstruction() {
  return [
    "You are reading photographed or scanned pages (or a PDF) of a law of Bangladesh to enter it into a legal database.",
    "Transcribe it exactly as printed, in the language it is printed in (do not translate, do not modernise spelling, do not summarise).",
    "Return the law's details (title, act number like \"Act No. XLV of 1860\" as printed, year, type: act | ordinance | po | constitution, language: en | bn, date of enactment as printed, long title, preamble) and its parts (chapters) with their sections.",
    "A section has its number as printed (\"1\", \"14A\"), its heading, and its text as blocks: kind para for a paragraph or numbered sub-section (mark is its number like \"(1)\"), kind clause for a lettered clause (mark like \"(a)\"), kind tail for the closing words after a list of clauses.",
    "Put a law with no chapters in one part with an empty title. For each section list in unsure the exact words you could not read with confidence, and give page as the 1-based page or image it is on.",
    "If the pages are not a law, return an empty parts list.",
  ].join("\n");
}
