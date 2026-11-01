import { createHmac, hkdfSync } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import type { ProfileKeys } from "./profile.crypto";

// Recruitment email hashes: a keyed HMAC of the normalised email, made with a pinned key from
// the profile key ring (RECRUIT_HASH_KEY_ID, default the oldest key). Each row records the key
// id it used; `pnpm recruit:rehash` moves rows to the pinned key.
export function recruitHashKeyId(
  ring: ProfileKeys,
  configured: number | undefined,
) {
  const id = configured ?? Math.min(...ring.keys.keys());
  if (!ring.keys.has(id))
    throw new ServiceUnavailableException(
      `Candidate duplicate checks are unavailable: key ${id} is not in the profile key ring.`,
    );
  return id;
}

export function recruitEmailHash(
  ring: ProfileKeys,
  keyId: number,
  email: string,
) {
  const base = ring.keys.get(keyId);
  if (!base)
    throw new ServiceUnavailableException(
      `Candidate duplicate checks are unavailable: key ${keyId} is not in the profile key ring.`,
    );
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      base,
      Buffer.alloc(0),
      "anvione-recruit-email-hash-v1",
      32,
    ),
  );
  return createHmac("sha256", key)
    .update(email.trim().toLowerCase())
    .digest("hex");
}

// a***@d***.com and ******3210: enough to recognise, not enough to contact.
export function maskEmail(email: string | null) {
  if (!email) return null;
  const [local = "", domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}
export function maskPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return `******${digits.slice(-4)}`;
}
