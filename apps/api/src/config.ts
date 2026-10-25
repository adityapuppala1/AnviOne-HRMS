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
  CANDIDATE_ORIGIN: z.url().default("http://127.0.0.2:5174"),
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.url().optional(),
  OIDC_REQUIRED_ACR: z.string().optional(),
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
  }
  return config;
}
export type Config = ReturnType<typeof readConfig>;
