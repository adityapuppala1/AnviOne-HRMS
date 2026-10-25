import { randomUUID } from "node:crypto";
import { z } from "zod";
import pg from "pg";

const hasControlCharacters = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
const evidence = (max: number) =>
  z
    .string()
    .min(3)
    .max(max)
    .refine((value) => value === value.trim() && !hasControlCharacters(value));
export const bindingInputSchema = z.strictObject({
  tenantId: z.uuid(),
  entityId: z.uuid(),
  employmentId: z.uuid(),
  issuer: z.url().max(500),
  subject: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !hasControlCharacters(value)),
  verifiedOfficialEmail: z.email().max(254),
  hrApprovalReference: evidence(200),
  identityVerificationReference: evidence(200),
  operatorIdentifier: evidence(120),
  reason: evidence(300),
  requestId: z.uuid().optional(),
});
export type BindingInput = z.infer<typeof bindingInputSchema>;
const resultSchema = z.strictObject({
  status: z.enum(["ready", "created", "unchanged"]),
  bindingId: z.uuid().nullable(),
  employmentId: z.uuid(),
  employeeCode: z.string(),
  role: z.literal("employee"),
});
export class IdentityOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function parseBindingInput(raw: string): BindingInput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new IdentityOperationError(
      "invalid_input",
      "Input must be a JSON object.",
    );
  }
  const parsed = bindingInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new IdentityOperationError(
      "invalid_input",
      `Check binding fields: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "input"))].join(", ")}.`,
    );
  }
  return parsed.data;
}
export function parseArguments(args: string[]) {
  let apply = false;
  let modeSpecified = false;
  let file: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply" || arg === "--dry-run") {
      if (modeSpecified) {
        throw new IdentityOperationError(
          "invalid_arguments",
          "Specify only one execution mode.",
        );
      }
      modeSpecified = true;
      apply = arg === "--apply";
    } else if (arg === "--file") {
      const next = args[++index];
      if (file || !next || next.startsWith("--")) {
        throw new IdentityOperationError(
          "invalid_arguments",
          "Provide exactly one JSON input file.",
        );
      }
      file = next;
    } else {
      throw new IdentityOperationError(
        "invalid_arguments",
        "Use --file PATH or JSON on stdin, and optionally --apply or --dry-run.",
      );
    }
  }
  return { apply, file };
}
export function operationConfig(
  env: Record<string, string | undefined>,
  input: BindingInput,
) {
  const issuer = env.OIDC_ISSUER;
  let configured: URL;
  let database: URL;
  try {
    configured = new URL(issuer ?? "");
    database = new URL(env.IDENTITY_OPERATOR_DATABASE_URL ?? "");
  } catch {
    throw new IdentityOperationError(
      "invalid_configuration",
      "Configure OIDC_ISSUER and a dedicated IDENTITY_OPERATOR_DATABASE_URL.",
    );
  }
  if (
    configured.protocol !== "https:" ||
    configured.username ||
    configured.password ||
    configured.search ||
    configured.hash ||
    /\/(common|organizations|consumers)(\/|$)/i.test(configured.pathname) ||
    input.issuer !== issuer
  ) {
    throw new IdentityOperationError(
      "invalid_issuer",
      "Input issuer must match the configured tenant-specific HTTPS OIDC_ISSUER exactly.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    database.username !== "anvione_identity_operator" ||
    !database.password ||
    (database.hostname !== "127.0.0.1" &&
      database.searchParams.get("sslmode") !== "verify-full")
  ) {
    throw new IdentityOperationError(
      "invalid_configuration",
      "Use the dedicated identity operator credential; non-loopback databases require verify-full TLS.",
    );
  }
  return { connectionString: env.IDENTITY_OPERATOR_DATABASE_URL! };
}
export function safeOperationError(error: unknown) {
  if (error instanceof IdentityOperationError)
    return { code: error.code, message: error.message };
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const known: Record<string, { code: string; message: string }> = {
    "22023": {
      code: "ineligible",
      message:
        "Employment eligibility, verified email or approval evidence does not match.",
    },
    "23505": {
      code: "conflict",
      message:
        "Identity, employment or request identifier is already in use; no reassignment was performed.",
    },
    "42501": {
      code: "forbidden",
      message:
        "The dedicated operations credential or required database permissions are unavailable.",
    },
    P0002: {
      code: "unavailable",
      message: "The approved employment is unavailable in the specified scope.",
    },
  };
  return (
    known[code] ?? {
      code: "operation_failed",
      message:
        "Identity binding did not complete. Check the operations database and approval records.",
    }
  );
}
export async function bindIdentity(
  input: BindingInput,
  apply: boolean,
  config: { connectionString: string },
) {
  const requestId = input.requestId ?? randomUUID();
  const client = new pg.Client({
    connectionString: config.connectionString,
    application_name: "anvione-identity-operations",
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{ result: unknown }>(
      "SELECT public.bind_identity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result",
      [
        input.tenantId,
        input.entityId,
        input.employmentId,
        input.issuer,
        input.subject,
        input.verifiedOfficialEmail,
        input.hrApprovalReference,
        input.identityVerificationReference,
        input.operatorIdentifier,
        input.reason,
        requestId,
        apply,
      ],
    );
    return {
      mode: apply ? "apply" : "dry-run",
      requestId,
      ...resultSchema.parse(rows[0]?.result),
    };
  } finally {
    await client.end();
  }
}
