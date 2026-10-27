import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  AUTH_MODE: z.enum(["demo", "oidc"]).default("oidc"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(4000),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  CANDIDATE_DATABASE_URL: z.string().optional(),
  ONBOARDING_PREVIEW_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  // Seals employees' personal contact details at rest (AES-256-GCM). Required in production.
  PROFILE_DATA_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  CANDIDATE_ORIGIN: z.url().default("http://127.0.0.2:5174"),
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.url().optional(),
  OIDC_REQUIRED_ACR: z.string().optional(),
  // Proxies allowed to set X-Forwarded-For: a hop count, or proxy IPs/CIDRs.
  // "Trust everything" is refused because any client could then spoof its IP.
  TRUST_PROXY: z
    .union([
      z.coerce.number().int().min(1).max(5),
      z
        .string()
        .regex(
          /^[0-9A-Fa-f:.]+(\/\d{1,3})?(\s*,\s*[0-9A-Fa-f:.]+(\/\d{1,3})?)*$/,
        )
        .transform((value) => value.split(",").map((part) => part.trim()))
        // Each entry must be an address, so out-of-range hop counts never slip through.
        .refine((parts) => parts.every((part) => /[.:]/.test(part))),
    ])
    .optional(),
  // Shared rate-limit counters (Valkey/Redis). Required in production so replicas
  // cannot each grant a full budget.
  RATE_LIMIT_URL: z
    .string()
    .regex(/^rediss?:\/\/\S+$/)
    .optional(),
});
export function readConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")),
  );
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const config = parsed.data;
  const origin = new URL(config.APP_ORIGIN);
  if (origin.origin !== config.APP_ORIGIN)
    throw new Error("APP_ORIGIN must be an origin without a path");
  if (
    config.AUTH_MODE === "demo" &&
    (config.NODE_ENV !== "development" ||
      config.API_HOST !== "127.0.0.1" ||
      origin.hostname !== "127.0.0.1")
  )
    throw new Error(
      "Demo authentication requires development and loopback-only hosts",
    );
  if (config.AUTH_MODE === "demo" && config.TRUST_PROXY !== undefined)
    throw new Error("Demo authentication cannot run behind a trusted proxy");
  if (config.AUTH_MODE === "oidc") {
    if (
      !config.OIDC_ISSUER ||
      !config.OIDC_CLIENT_ID ||
      !config.OIDC_CLIENT_SECRET ||
      !config.OIDC_REDIRECT_URI
    )
      throw new Error("OIDC configuration is incomplete");
    if (
      !config.OIDC_ISSUER.startsWith("https://") ||
      /\/(common|organizations|consumers)\//.test(config.OIDC_ISSUER)
    )
      throw new Error("A tenant-specific HTTPS issuer is required");
    if (
      new URL(config.OIDC_REDIRECT_URI).origin !== origin.origin ||
      new URL(config.OIDC_REDIRECT_URI).pathname !== "/api/v1/auth/callback"
    )
      throw new Error(
        "OIDC callback must match the application origin and registered path",
      );
  }
  if (config.NODE_ENV === "production") {
    if (origin.protocol !== "https:" || !config.OIDC_REQUIRED_ACR)
      throw new Error(
        "Production requires HTTPS and an enforced identity-provider authentication context",
      );
    if (
      !["verify-full", "verify-ca"].includes(
        new URL(config.DATABASE_URL).searchParams.get("sslmode") ?? "",
      )
    )
      throw new Error(
        "Production database connection must validate TLS certificates",
      );
    if (!config.PROFILE_DATA_KEY)
      throw new Error(
        "Production requires PROFILE_DATA_KEY to protect personal contact details",
      );
    if (!config.RATE_LIMIT_URL?.startsWith("rediss://"))
      throw new Error(
        "Production requires a shared rate-limit store over TLS (rediss://)",
      );
  }
  return config;
}
export type Config = ReturnType<typeof readConfig>;
