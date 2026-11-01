import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, unseal, otpHash, previewKey } from "./onboarding.crypto";
import type { Config } from "./config";
describe("candidate preview credential protection", () => {
  it("encrypts with random nonces and rejects tampering and other keys", () => {
    const key = randomBytes(32),
      value = { code: "123456" };
    const encoded = seal(key, value);
    expect(unseal(key, encoded)).toEqual(value);
    expect(seal(key, value)).not.toBe(encoded);
    const bytes = Buffer.from(encoded, "base64url");
    bytes[30] = bytes[30]! ^ 1;
    expect(() => unseal(key, bytes.toString("base64url"))).toThrow();
    expect(() => unseal(randomBytes(32), encoded)).toThrow();
  });
  it("binds OTP hashes to the challenge and secret", () => {
    const key = randomBytes(32);
    expect(otpHash(key, "one", "123456")).not.toBe(
      otpHash(key, "two", "123456"),
    );
    expect(otpHash(key, "one", "123456")).not.toBe(
      otpHash(randomBytes(32), "one", "123456"),
    );
  });
  it("refuses production and shared employee hostnames", () => {
    const config = {
      NODE_ENV: "development",
      AUTH_MODE: "demo",
      API_HOST: "127.0.0.1",
      CANDIDATE_ORIGIN: "http://127.0.0.2:5174",
      ONBOARDING_PREVIEW_KEY: "a".repeat(64),
    } as Config;
    expect(previewKey(config)).toHaveLength(32);
    expect(() => previewKey({ ...config, NODE_ENV: "production" })).toThrow();
    expect(() =>
      previewKey({ ...config, CANDIDATE_ORIGIN: "http://127.0.0.1:5174" }),
    ).toThrow();
    expect(() =>
      previewKey({ ...config, AUTH_MODE: "oidc" } as Config),
    ).toThrow();
  });
});
