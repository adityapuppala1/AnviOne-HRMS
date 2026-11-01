import type { ColumnType } from "./report.catalog";

type Cell = string | number | null;

// Integer paise to a plain rupee figure ("1234.50"): no symbol or grouping, so
// spreadsheets read it as a number. Integer arithmetic avoids float rounding.
export function rupees(minor: number) {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// Text that a spreadsheet could treat as a formula gets a leading apostrophe
// (OWASP CSV injection guidance). Numbers we produce ourselves are left as numbers.
// Spreadsheets may skip leading blanks and invisible characters, and some map the
// fullwidth signs (＝ ＋ － ＠) and the minus sign (U+2212) to their ASCII forms, so the
// check looks past spaces, NBSP, ideographic space and zero-width characters.
const CONTROL_START = /^[\t\r\n]/;
const LEADING_BLANKS = /^[\s\u00a0\u3000\u200b-\u200d\u2060\ufeff]+/u;
const FORMULA_START = /^[=+\-@\uff1d\uff0b\uff0d\uff20\u2212]/u;
export function neutralize(text: string) {
  const dangerous =
    CONTROL_START.test(text) ||
    FORMULA_START.test(text.replace(LEADING_BLANKS, ""));
  return dangerous ? `'${text}` : text;
}

// RFC 4180: quote a field holding a comma, quote, CR or LF; double inner quotes.
export function quote(text: string) {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cell(value: Cell, type: ColumnType) {
  if (value === null) return "";
  if (typeof value === "number")
    return type === "money" ? rupees(value) : String(value);
  return quote(neutralize(value));
}

const BOM = String.fromCharCode(0xfeff);
// UTF-8 with a byte-order mark so Excel detects the encoding; CRLF line endings.
export function toCsv(
  columns: readonly { label: string; type: ColumnType }[],
  rows: readonly Cell[][],
) {
  const lines = [columns.map((c) => quote(neutralize(c.label))).join(",")];
  for (const row of rows)
    lines.push(row.map((value, i) => cell(value, columns[i]!.type)).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

// Only [a-z0-9-] reaches the header, so the filename can never break out of it.
export function csvFileName(base: string, today: string) {
  const slug =
    base
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "report";
  return `${slug}-${today.replace(/-/g, "")}.csv`;
}
