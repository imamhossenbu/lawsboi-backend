// The frame every Lawsboi email shares: the wordmark, a cream card, and the site's green and gold. Inline styles
// only, because that is all email clients honour.

export type Lang = "en" | "bn";

export const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Paragraph text with line breaks kept. */
export const paragraphs = (text: string) => escape(text).replace(/\n/g, "<br>");

export function layout(lang: Lang, body: string) {
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f1eee8;font-family:Arial,Helvetica,sans-serif;color:#17201b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fffdf9;border:1px solid #e6dfd2;border-radius:16px;padding:32px">
<tr><td style="font-size:22px;font-weight:bold;color:#1b3a2c">laws<span style="color:#b5853a">boi</span></td></tr>
${body}
</table></td></tr></table></body></html>`;
}

export const row = (html: string, style = "padding-top:20px;font-size:15px;line-height:1.6;color:#545b56") => `<tr><td style="${style}">${html}</td></tr>`;

export const codeBox = (code: string) =>
  row(`<div style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#1b3a2c;background:#eef3ef;border-radius:12px;padding:16px;text-align:center">${escape(code)}</div>`, "padding:24px 0");

export const button = (href: string, label: string) =>
  `<tr><td style="padding:24px 0" align="center"><a href="${escape(href)}" style="display:inline-block;background:#1b3a2c;color:#fffdf9;text-decoration:none;font-weight:bold;border-radius:999px;padding:12px 28px">${escape(label)}</a></td></tr>`;

export const footnote = (text: string) => row(paragraphs(text), "font-size:13px;line-height:1.6;color:#868a84");

/** Fills "{name}" placeholders. */
export const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
