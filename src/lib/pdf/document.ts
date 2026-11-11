import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";

// One look for every PDF the API makes (laws, judgments, invoices): A4, Noto Serif for Latin text and Noto Serif
// Bengali for Bangla (shaped by fontkit, so conjuncts join), the brand's green and gold, a running head and
// "page n of N" on every page. Text mixing scripts is split into runs so each run gets a font that has its glyphs.

export type Lang = "en" | "bn";

const fontFile = (name: string) => readFileSync(new URL(`../../../assets/fonts/${name}.ttf`, import.meta.url));
/** The site's logo mark (the same image the reader site's header shows), 610 × 782. */
const logoMark = readFileSync(new URL("../../../assets/logo-mark.png", import.meta.url));
let fonts: Record<string, Buffer> | null = null;
const loadFonts = () =>
  (fonts ??= {
    latin: fontFile("NotoSerif-Regular"),
    latinBold: fontFile("NotoSerif-Bold"),
    bangla: fontFile("NotoSerifBengali-Regular"),
    banglaBold: fontFile("NotoSerifBengali-Bold"),
  });

export const colors = {
  primary: "#1b3a2c",
  primarySoft: "#eef3ef",
  gold: "#b5853a",
  goldSoft: "#fbf6ec",
  ink: "#1f2a24",
  muted: "#5f6b64",
  subtle: "#8a958e",
  line: "#dfe3df",
};

const BANGLA = /[ঀ-৿।॥‌‍]/;
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Western digits as Bangla ones, for Bangla documents. */
export const digits = (value: string | number, lang: Lang) =>
  lang === "bn" ? String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!) : String(value);

/** Splits text into runs of one script; spaces go with the run they sit in. */
export function scriptRuns(text: string): { bangla: boolean; text: string }[] {
  const runs: { bangla: boolean; text: string }[] = [];
  for (const ch of text) {
    const last = runs[runs.length - 1];
    const bangla = /\s/.test(ch) && last ? last.bangla : BANGLA.test(ch);
    if (last && last.bangla === bangla) last.text += ch;
    else runs.push({ bangla, text: ch });
  }
  return runs;
}

export interface WriteOptions {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right" | "justify";
  /** Left edge; the page margin by default. */
  x?: number;
  y?: number;
  width?: number;
  lineGap?: number;
  /** Space after the block, in points. */
  after?: number;
}

export class Pdf {
  readonly doc: PDFKit.PDFDocument;
  readonly lang: Lang;
  private head: string;

  constructor(opts: { lang: Lang; title: string; head?: string; subject?: string }) {
    this.lang = opts.lang;
    this.head = opts.head ?? opts.title;
    this.doc = new PDFDocument({
      size: "A4",
      margins: { top: 68, bottom: 64, left: 62, right: 62 },
      bufferPages: true,
      info: { Title: opts.title, Author: "Lawsboi", Subject: opts.subject ?? opts.title, Creator: "Lawsboi" },
    });
    const f = loadFonts();
    for (const [name, data] of Object.entries(f)) this.doc.registerFont(name, data);
    this.doc.font("latin");
  }

  get left() {
    return this.doc.page.margins.left;
  }
  get width() {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }
  get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  private fontOf(bangla: boolean, bold?: boolean) {
    return bangla ? (bold ? "banglaBold" : "bangla") : bold ? "latinBold" : "latin";
  }

  /** Writes a paragraph of mixed English and Bangla. */
  write(text: string, o: WriteOptions = {}): this {
    const doc = this.doc;
    const runs = scriptRuns(text.replace(/\s+/g, " ").trim() || " ");
    const size = o.size ?? 10.5;
    const width = o.width ?? this.width - ((o.x ?? this.left) - this.left);
    // pdfkit aligns only the first of several continued runs: a short mixed line placed right or centre is
    // measured here and written left-aligned from the right spot instead
    if (runs.length > 1 && (o.align === "right" || o.align === "center")) {
      const measured = runs.reduce((sum, run) => sum + doc.font(this.fontOf(run.bangla, o.bold)).fontSize(size).widthOfString(run.text), 0);
      if (measured <= width) {
        const shift = o.align === "right" ? width - measured : (width - measured) / 2;
        return this.write(text, { ...o, align: "left", x: (o.x ?? this.left) + shift, width: measured + 1 });
      }
    }
    runs.forEach((run, i) => {
      doc
        .font(this.fontOf(run.bangla, o.bold))
        .fontSize(size)
        .fillColor(o.color ?? colors.ink);
      const layout = { width, align: o.align ?? "left", lineGap: o.lineGap ?? 3, continued: i < runs.length - 1 };
      if (i === 0) doc.text(run.text, o.x ?? this.left, o.y ?? doc.y, layout);
      else doc.text(run.text, layout);
    });
    if (o.after) doc.y += o.after;
    doc.x = this.left;
    return this;
  }

  /** A marked block with a hanging indent: "(a)  text that wraps under itself". */
  marked(mark: string, text: string, o: WriteOptions & { indent?: number } = {}) {
    const indent = o.indent ?? 26;
    const x = o.x ?? this.left;
    this.ensure(28);
    const y = this.doc.y;
    this.write(mark, { ...o, x, y, width: indent - 4, after: 0 });
    this.doc.y = y;
    return this.write(text, { ...o, x: x + indent, y, width: (o.width ?? this.width - (x - this.left)) - indent });
  }

  /** Starts a new page unless `points` still fit on this one. */
  ensure(points: number) {
    if (this.doc.y + points > this.bottom) this.doc.addPage();
    return this;
  }

  rule(color = colors.line, gap = 10) {
    const y = this.doc.y + gap / 2;
    this.doc.moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.6).strokeColor(color).stroke();
    this.doc.y = y + gap / 2;
    return this;
  }

  space(points: number) {
    this.doc.y += points;
    return this;
  }

  /** The Lawsboi logo at the top of the first page: the site's mark, then the name in green and gold. */
  brand(tagline: string) {
    const doc = this.doc;
    const y = doc.page.margins.top - 32;
    // 610 × 782: 22 points wide is about 28 tall
    doc.image(logoMark, this.left, y - 2, { width: 22 });
    doc.font("latinBold").fontSize(15).fillColor(colors.primary).text("laws", this.left + 30, y + 1, { continued: true }).fillColor(colors.gold).text("boi");
    this.write(tagline, { x: this.left + 30, y: y + 19, size: 7, color: colors.subtle });
    doc.y = doc.page.margins.top + 4;
    return this;
  }

  /** Running head and "page n of N" on every page; call once, just before `end()`. */
  private paginate(footer: string) {
    const doc = this.doc;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const margins = { ...doc.page.margins };
      doc.page.margins.top = 0;
      doc.page.margins.bottom = 0;
      if (i > range.start) {
        this.write(this.head, { x: this.left, y: 34, size: 8, color: colors.subtle, width: this.width - 90 });
        doc.moveTo(this.left, 50).lineTo(this.left + this.width, 50).lineWidth(0.5).strokeColor(colors.line).stroke();
      }
      const y = doc.page.height - 42;
      doc.moveTo(this.left, y - 8).lineTo(this.left + this.width, y - 8).lineWidth(0.5).strokeColor(colors.line).stroke();
      this.write(footer, { x: this.left, y, size: 7.5, color: colors.subtle, width: this.width - 110 });
      const page = this.lang === "bn" ? `পৃষ্ঠা ${digits(i + 1, "bn")} / ${digits(range.count, "bn")}` : `Page ${i + 1} of ${range.count}`;
      this.write(page, { x: this.left + this.width - 110, y, size: 7.5, color: colors.subtle, width: 110, align: "right" });
      doc.page.margins.top = margins.top;
      doc.page.margins.bottom = margins.bottom;
    }
  }

  /** Finishes the document and answers its bytes. */
  async finish(footer: string): Promise<Buffer> {
    this.paginate(footer);
    const chunks: Buffer[] = [];
    this.doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
    });
    this.doc.end();
    return done;
  }
}

/** A file name safe for Content-Disposition, from a title. */
export const fileName = (title: string, ext = "pdf") =>
  `${
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "lawsboi"
  }.${ext}`;

/** Sends a PDF as a download (or inline with `inline`). */
export function sendPdf(res: import("express").Response, bytes: Buffer, name: string, inline = false) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${fileName(name)}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.end(bytes);
}
