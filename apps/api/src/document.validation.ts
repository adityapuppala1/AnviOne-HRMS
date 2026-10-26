// Upload validation for employee documents. Types come from the bytes, never
// from the file name or the client's declared type. This is structural
// checking only; it is not malware scanning.
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export type DocumentType = "application/pdf" | "image/png" | "image/jpeg";

const signatures: Array<[DocumentType, number[]]> = [
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
];

export function detectType(bytes: Uint8Array): DocumentType | null {
  for (const [type, signature] of signatures)
    if (
      bytes.length > signature.length &&
      signature.every((byte, i) => bytes[i] === byte)
    )
      return type;
  return null;
}

// PDF features that run code or carry other files when opened.
const activePdfMarkers = [
  "/JavaScript",
  "/JS",
  "/OpenAction",
  "/AA",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
  "/XFA",
  "/SubmitForm",
  "/GoToR",
  "/GoToE",
  "/ImportData",
  "/Sound",
  "/Movie",
];

export function hasActivePdfContent(bytes: Uint8Array): boolean {
  // latin1 keeps a 1:1 byte mapping; PDF name escapes (/J#61vaScript) are decoded
  // so obfuscated names still match.
  const text = Buffer.from(bytes)
    .toString("latin1")
    .replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  return activePdfMarkers.some((marker) =>
    new RegExp(`${marker.replace("/", "\\/")}(?![A-Za-z])`).test(text),
  );
}

// A display name only: paths, control characters and risky characters are removed.
export function sanitizeFileName(name: string, type: DocumentType): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const extension = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
  }[type];
  const stem = cleaned.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "document";
  return `${stem}${extension}`;
}
