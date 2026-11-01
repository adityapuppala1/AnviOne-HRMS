import { readFile, stat } from "node:fs/promises";
import {
  bindIdentity,
  IdentityOperationError,
  operationConfig,
  parseArguments,
  parseBindingInput,
  safeOperationError,
} from "./identity-operations";

// Approval references attest to an external HR/identity verification process.
// This command does not verify email ownership or contact the identity provider.
// Private input belongs on stdin or in an ignored, access-controlled JSON file.
const maxBytes = 16384;
if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(
    JSON.stringify(
      {
        command: "pnpm identity:bind",
        usage:
          "pnpm identity:bind [--file PRIVATE_JSON_PATH] [--dry-run | --apply]",
        defaultMode: "dry-run",
        input: "JSON on stdin or a private file, at most 16 KiB",
        fields: [
          "tenantId",
          "entityId",
          "employmentId",
          "issuer",
          "subject",
          "verifiedOfficialEmail",
          "hrApprovalReference",
          "identityVerificationReference",
          "operatorIdentifier",
          "reason",
          "requestId (optional)",
        ],
        requiredEnvironment: ["OIDC_ISSUER", "IDENTITY_OPERATOR_DATABASE_URL"],
        scope:
          "Existing approved active/notice employment; Employee role only; no identity reassignment",
        runbook: "docs/runbooks/identity-operations.md",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
try {
  const { apply, file } = parseArguments(process.argv.slice(2));
  let raw: string;
  if (file) {
    if ((await stat(file)).size > maxBytes) {
      throw new IdentityOperationError(
        "invalid_input",
        "Input exceeds 16 KiB.",
      );
    }
    raw = await readFile(file, "utf8");
    if (Buffer.byteLength(raw) > maxBytes) {
      throw new IdentityOperationError(
        "invalid_input",
        "Input exceeds 16 KiB.",
      );
    }
  } else {
    if (process.stdin.isTTY) {
      throw new IdentityOperationError(
        "invalid_input",
        "Provide JSON on stdin or use --file with a private input file.",
      );
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        throw new IdentityOperationError(
          "invalid_input",
          "Input exceeds 16 KiB.",
        );
      }
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  const input = parseBindingInput(raw);
  const result = await bindIdentity(
    input,
    apply,
    operationConfig(process.env, input),
  );
  console.log(JSON.stringify({ event: "identity.binding.result", ...result }));
} catch (error) {
  // Do not print raw database errors: detail/query fields may contain identity
  // subjects, official addresses, evidence or a connection string.
  console.error(
    JSON.stringify({
      event: "identity.binding.failed",
      ...safeOperationError(error),
    }),
  );
  process.exitCode = 1;
}
