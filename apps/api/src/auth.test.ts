import { describe, expect, it } from "vitest";
import { csrfMatches } from "./auth";
describe("CSRF verification", () => {
  it("accepts only equal tokens", () => {
    expect(csrfMatches("secret", "secret")).toBe(true);
    expect(csrfMatches("secret", "secrex")).toBe(false);
    expect(csrfMatches("secret", undefined)).toBe(false);
  });
  it("handles unicode byte length differences without throwing", () => {
    expect(csrfMatches("a", "é")).toBe(false);
    expect(csrfMatches("secret", ["secret"])).toBe(false);
  });
});
