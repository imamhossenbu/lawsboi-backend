// CSV the way the admin panel's export buttons made it: quoted cells, a UTF-8 BOM so Excel reads Bangla.

export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

export const csvHeaders = (filename: string) => ({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` });
