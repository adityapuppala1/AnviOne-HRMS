import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import type { Config } from "./config";
export function previewKey(config: Config) {
  if (
    config.NODE_ENV !== "development" ||
    config.AUTH_MODE !== "demo" ||
    config.API_HOST !== "127.0.0.1" ||
    config.CANDIDATE_ORIGIN !== "http://127.0.0.2:5174" ||
    !config.ONBOARDING_PREVIEW_KEY
  )
    throw new ServiceUnavailableException(
      "Candidate onboarding is available only in the configured synthetic preview.",
    );
  return Buffer.from(config.ONBOARDING_PREVIEW_KEY, "hex");
}
export function seal(key: Buffer, value: unknown) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString(
    "base64url",
  );
}
export function unseal(key: Buffer, value: string): unknown {
  const bytes = Buffer.from(value, "base64url"),
    decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export const otpHash = (key: Buffer, id: string, code: string) =>
  createHmac("sha256", key).update(`candidate-otp:${id}:${code}`).digest("hex");
