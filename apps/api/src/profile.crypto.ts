import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import type { Config } from "./config";

// Personal contact details are sealed in the API before they reach the database, the same
// AES-256-GCM construction as onboarding (onboarding.crypto.ts), plus associated data that
// binds each value to its employee and field so a sealed value cannot be moved elsewhere.
// Production must set PROFILE_DATA_KEY; the local synthetic preview derives a separate key
// from ONBOARDING_PREVIEW_KEY so the demo works without another secret.
export function profileKey(config: Config): Buffer {
  if (config.PROFILE_DATA_KEY)
    return Buffer.from(config.PROFILE_DATA_KEY, "hex");
  if (config.NODE_ENV === "development" && config.ONBOARDING_PREVIEW_KEY)
    return Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(config.ONBOARDING_PREVIEW_KEY, "hex"),
        Buffer.alloc(0),
        "anvione-profile-data-v1",
        32,
      ),
    );
  throw new ServiceUnavailableException(
    "Profile details are unavailable until a profile data key is configured.",
  );
}

// Format v1: [0x01][nonce 12][tag 16][data], with "v1" in the associated data so a key or
// format change can be introduced later. Values sealed before versioning (no prefix) still open.
const VERSION = 1;
const binding = (employeeId: string, column: string, versioned: boolean) =>
  Buffer.from(
    `anvione-profile:${versioned ? "v1:" : ""}${employeeId}:${column}`,
    "utf8",
  );

export function sealValue(
  key: Buffer,
  employeeId: string,
  column: string,
  value: string,
) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(binding(employeeId, column, true));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.of(VERSION),
    nonce,
    cipher.getAuthTag(),
    data,
  ]).toString("base64url");
}

function open(
  key: Buffer,
  bytes: Buffer,
  employeeId: string,
  column: string,
  versioned: boolean,
) {
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(binding(employeeId, column, versioned));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const text = Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  return String(JSON.parse(text));
}

// Throws when the value cannot be opened (wrong key, tampering); callers mark it unavailable.
export function openValue(
  key: Buffer,
  employeeId: string,
  column: string,
  sealed: string | null,
): string | null {
  if (sealed === null) return null;
  const bytes = Buffer.from(sealed, "base64url");
  if (bytes[0] === VERSION) {
    try {
      return open(key, bytes.subarray(1), employeeId, column, true);
    } catch {
      // An unversioned value whose random nonce happens to start with 0x01: fall through.
    }
  }
  return open(key, bytes, employeeId, column, false);
}
