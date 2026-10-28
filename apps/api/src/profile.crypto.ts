import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

// Personal contact details are sealed in the API before they reach the database, the same
// AES-256-GCM construction as onboarding (onboarding.crypto.ts), plus associated data that
// binds each value to its employee and field so a sealed value cannot be moved elsewhere.
//
// Keys form a ring. PROFILE_DATA_KEYS lists `id:hex` keys (ids 1-255), newest first; the newest
// seals. PROFILE_DATA_KEY is the legacy key, id 0, which opens values sealed before rotation
// existed (and seals only when no numbered key is configured). The local synthetic preview
// derives id 0 from ONBOARDING_PREVIEW_KEY so the demo works without another secret.
// Retired keys must stay in the ring while any value (including immutable history) uses them;
// `pnpm profile:rekey` reports which key ids are still in use.
export type ProfileKeys = {
  current: { id: number; key: Buffer };
  keys: ReadonlyMap<number, Buffer>;
};

type KeySource = {
  NODE_ENV: string;
  PROFILE_DATA_KEY?: string;
  PROFILE_DATA_KEYS?: { id: number; hex: string }[];
  ONBOARDING_PREVIEW_KEY?: string;
};

export function profileKeys(config: KeySource): ProfileKeys {
  const keys = new Map<number, Buffer>();
  for (const { id, hex } of config.PROFILE_DATA_KEYS ?? [])
    keys.set(id, Buffer.from(hex, "hex"));
  if (config.PROFILE_DATA_KEY)
    keys.set(0, Buffer.from(config.PROFILE_DATA_KEY, "hex"));
  else if (config.NODE_ENV === "development" && config.ONBOARDING_PREVIEW_KEY)
    keys.set(
      0,
      Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(config.ONBOARDING_PREVIEW_KEY, "hex"),
          Buffer.alloc(0),
          "anvione-profile-data-v1",
          32,
        ),
      ),
    );
  const newest = config.PROFILE_DATA_KEYS?.[0]?.id ?? 0;
  const key = keys.get(newest);
  if (!key)
    throw new ServiceUnavailableException(
      "Profile details are unavailable until a profile data key is configured.",
    );
  return { current: { id: newest, key }, keys };
}

// Formats:
//   v2: [0x02][key id][nonce 12][tag 16][data], AAD "anvione-profile:v2:<id>:<employee>:<field>"
//   v1: [0x01][nonce 12][tag 16][data], AAD "anvione-profile:v1:<employee>:<field>", legacy key
//   unversioned: [nonce 12][tag 16][data], AAD "anvione-profile:<employee>:<field>", legacy key
const V1 = 1,
  V2 = 2;
const binding = (prefix: string, employeeId: string, column: string) =>
  Buffer.from(`anvione-profile:${prefix}${employeeId}:${column}`, "utf8");

export function sealValue(
  ring: ProfileKeys,
  employeeId: string,
  column: string,
  value: string,
) {
  const { id, key } = ring.current;
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(binding(`v2:${id}:`, employeeId, column));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.of(V2, id),
    nonce,
    cipher.getAuthTag(),
    data,
  ]).toString("base64url");
}

function open(key: Buffer | undefined, bytes: Buffer, aad: Buffer) {
  if (!key) throw new Error("profile key unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(bytes.subarray(12, 28));
  const text = Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  return String(JSON.parse(text));
}

// Which key a sealed value needs: the v2 key id, or 0 (legacy) for v1 and unversioned values.
export function sealedKeyId(sealed: string): number {
  const bytes = Buffer.from(sealed, "base64url");
  return bytes[0] === V2 && bytes.length > 2 ? bytes[1]! : 0;
}

// Throws when the value cannot be opened (missing or wrong key, tampering); callers mark it
// unavailable rather than failing the request.
export function openValue(
  ring: ProfileKeys,
  employeeId: string,
  column: string,
  sealed: string | null,
): string | null {
  if (sealed === null) return null;
  const bytes = Buffer.from(sealed, "base64url");
  const legacy = ring.keys.get(0);
  if (bytes[0] === V2 && bytes.length > 2) {
    const id = bytes[1]!;
    try {
      return open(
        ring.keys.get(id),
        bytes.subarray(2),
        binding(`v2:${id}:`, employeeId, column),
      );
    } catch (error) {
      // An unversioned value whose random nonce starts with 0x02 falls through below.
      if (!legacy) throw error;
    }
  }
  if (bytes[0] === V1) {
    try {
      return open(
        legacy,
        bytes.subarray(1),
        binding("v1:", employeeId, column),
      );
    } catch {
      // An unversioned value whose random nonce happens to start with 0x01: fall through.
    }
  }
  return open(legacy, bytes, binding("", employeeId, column));
}
