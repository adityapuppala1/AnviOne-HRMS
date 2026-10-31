import { describe, it, expect } from "vitest";
import {
  detectType,
  hasActivePdfContent,
  sanitizeFileName,
} from "./document.validation";

const bytes = (text: string) => Buffer.from(text, "latin1");

describe("document validation", () => {
  it("detects types from magic bytes, not names", () => {
    expect(detectType(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(
      detectType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe("image/png");
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(detectType(bytes("MZ\x90\x00"))).toBeNull();
    expect(detectType(bytes("<svg onload=alert(1)>"))).toBeNull();
    expect(detectType(bytes("%PDF-"))).toBeNull();
  });
  it("flags PDFs that run code or carry files", () => {
    for (const marker of [
      "/JavaScript",
      "/JS ",
      "/OpenAction",
      "/AA ",
      "/Launch",
      "/EmbeddedFile",
      "/RichMedia",
      "/XFA",
      "/SubmitForm",
      "/GoToR",
      "/ImportData",
    ])
      expect(hasActivePdfContent(bytes(`%PDF-1.4 << ${marker} >>`))).toBe(true);
    expect(hasActivePdfContent(bytes("%PDF-1.4 << /J#61vaScript >>"))).toBe(
      true,
    );
    expect(
      hasActivePdfContent(bytes("%PDF-1.4 << /Type /Catalog /JSTOR >>")),
    ).toBe(false);
    expect(hasActivePdfContent(bytes("%PDF-1.4 << /Type /Page >>"))).toBe(
      false,
    );
  });
  it("keeps only a safe display name with the detected extension", () => {
    expect(sanitizeFileName("../../etc/pass wd.PDF", "application/pdf")).toBe(
      "pass wd.pdf",
    );
    expect(sanitizeFileName('C:\\x\\"<evil>|.exe', "image/png")).toBe(
      "evil.png",
    );
    expect(sanitizeFileName("\u0000\u0007", "image/jpeg")).toBe("document.jpg");
    expect(sanitizeFileName("a".repeat(300), "application/pdf").length).toBe(
      104,
    );
  });
});
