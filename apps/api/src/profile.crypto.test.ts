import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  openValue,
  profileKeys,
  sealValue,
  sealedKeyId,
} from "./profile.crypto";

const legacyHex = "11".repeat(32),
  oneHex = "22".repeat(32),
  twoHex = "33".repeat(32);
const employee = "7f1c2a4e-0000-4000-8000-000000000001";

// The pre-rotation formats, sealed with the legacy key exactly as the old code did.
function legacySeal(version: boolean, value: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(legacyHex, "hex"),
      nonce,
    );
  cipher.setAAD(
    Buffer.from(
      `anvione-profile:${version ? "v1:" : ""}${employee}:personal_email`,
    ),
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    ...(version ? [Buffer.of(1)] : []),
    nonce,
    cipher.getAuthTag(),
    data,
  ]).toString("base64url");
}

describe("profile key ring", () => {
  const ring = profileKeys({
    NODE_ENV: "production",
    PROFILE_DATA_KEY: legacyHex,
    PROFILE_DATA_KEYS: [
      { id: 2, hex: twoHex },
      { id: 1, hex: oneHex },
    ],
  });

  it("seals with the newest key and opens values sealed by any key in the ring", () => {
    const sealed = sealValue(ring, employee, "personal_email", "a@b.example");
    expect(sealedKeyId(sealed)).toBe(2);
    expect(openValue(ring, employee, "personal_email", sealed)).toBe(
      "a@b.example",
    );
    const older = profileKeys({
      NODE_ENV: "production",
      PROFILE_DATA_KEYS: [{ id: 1, hex: oneHex }],
    });
    const byOne = sealValue(older, employee, "personal_email", "old");
    expect(sealedKeyId(byOne)).toBe(1);
    expect(openValue(ring, employee, "personal_email", byOne)).toBe("old");
  });

  it("opens legacy v1 and unversioned values with the legacy key", () => {
    for (const versioned of [true, false])
      for (let i = 0; i < 20; i += 1) {
        const sealed = legacySeal(versioned, `v${i}`);
        expect(sealedKeyId(sealed) === 0 || !versioned).toBe(true);
        expect(openValue(ring, employee, "personal_email", sealed)).toBe(
          `v${i}`,
        );
      }
  });

  it("seals with the legacy key as id 0 when no numbered key exists", () => {
    const legacyOnly = profileKeys({
      NODE_ENV: "production",
      PROFILE_DATA_KEY: legacyHex,
    });
    const sealed = sealValue(legacyOnly, employee, "personal_email", "x");
    expect(sealedKeyId(sealed)).toBe(0);
    expect(openValue(ring, employee, "personal_email", sealed)).toBe("x");
  });

  it("refuses values whose key is missing, wrong, or bound elsewhere", () => {
    const sealed = sealValue(ring, employee, "personal_email", "secret");
    const withoutTwo = profileKeys({
      NODE_ENV: "production",
      PROFILE_DATA_KEYS: [{ id: 1, hex: oneHex }],
    });
    expect(() =>
      openValue(withoutTwo, employee, "personal_email", sealed),
    ).toThrow();
    const wrong = profileKeys({
      NODE_ENV: "production",
      PROFILE_DATA_KEYS: [{ id: 2, hex: oneHex }],
    });
    expect(() =>
      openValue(wrong, employee, "personal_email", sealed),
    ).toThrow();
    // A forged key id is bound into the associated data, so it cannot be swapped.
    const bytes = Buffer.from(sealed, "base64url");
    bytes[1] = 1;
    expect(() =>
      openValue(ring, employee, "personal_email", bytes.toString("base64url")),
    ).toThrow();
    expect(() => openValue(ring, employee, "personal_phone", sealed)).toThrow();
    expect(() =>
      openValue(withoutTwo, employee, "personal_email", legacySeal(true, "y")),
    ).toThrow();
  });

  it("is unavailable without any key", () => {
    expect(() => profileKeys({ NODE_ENV: "production" })).toThrow(
      "unavailable",
    );
  });
});
