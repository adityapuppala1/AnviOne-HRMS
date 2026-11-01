# Bind an approved corporate identity

This command binds an **already approved, effective active/notice employment**. It does not create an employee, approve onboarding, verify email ownership, contact Entra, send invitations or grant privileged roles. The preview and its examples are synthetic only.

## Required evidence and access

An authorized identity operator must first verify the HR approval, official email and exact issuer/subject for the configured application through the organization's approved process. Record references to that evidence, not documents, passwords or tokens. Microsoft `sub` is application-specific; do not substitute a Graph object ID or an email address. The target employment must already exist in the expected tenant/entity and have no existing binding. Reassignment is deliberately unavailable.

Use `IDENTITY_OPERATOR_DATABASE_URL` with the dedicated `anvione_identity_operator` login and tenant-specific HTTPS `OIDC_ISSUER`. The command rejects runtime/migration credentials, issuer mismatches and remote database connections without `sslmode=verify-full`. Supply the appropriate trusted CA in deployment configuration. The operator role cannot directly read people, employment, bindings or audit tables, create employment, allocate codes or grant HR/admin roles. The authenticated database principal and the separately declared human operator identifier are both recorded; the latter is an attestation, not independent authentication.

`pnpm setup:local` generates the new credential only for the verified loopback synthetic environment and preserves existing settings. `pnpm db:migrate` configures that role's password. Real environments require controlled credential provisioning through the secret manager. Keep migration and operator credentials out of API/worker runtime environments. The single local `.env` is a development convenience, not a production secret distribution scheme.

## Prepare private input

Use JSON on stdin or a restricted file outside version control. `.scratch/` is ignored locally. Keep subject/email values out of shell arguments and command history. The file must contain only the following fields; `requestId` is optional but useful for retry correlation:

```json
{
  "tenantId": "10000000-0000-4000-8000-000000000001",
  "entityId": "20000000-0000-4000-8000-000000000001",
  "employmentId": "30000000-0000-4000-8000-000000000002",
  "issuer": "https://identity.example.test/approved-tenant/v2.0",
  "subject": "synthetic-application-specific-subject",
  "verifiedOfficialEmail": "demo2@anvi.example",
  "hrApprovalReference": "HR-APPROVAL-42",
  "identityVerificationReference": "IAM-VERIFICATION-42",
  "operatorIdentifier": "approved-operator-reference",
  "reason": "Bind an independently verified identity to approved employment",
  "requestId": "50000000-0000-4000-8000-000000000042"
}
```

This example is not a valid real-provider binding. Use the exact configured issuer and verified subject; do not change production issuer settings to make a sample pass.

## Preview, apply and verify

```sh
pnpm identity:bind --file .scratch/binding.json
pnpm identity:bind --file .scratch/binding.json --apply
```

The first command is dry-run by default and creates no binding, attestation or audit entry. Review its safe `ready` result against the approved employment/code before choosing `--apply`. Apply creates one Employee-only binding, an attestation and its audit event in one database transaction. JSON output omits subject, email, credential and proof contents. Exact replay returns `unchanged`; conflicting evidence, occupied employment or subject produces a safe conflict without overwriting anything.

An Auditor can inspect the `identity.bound` event and its reason. The record identifies the database principal; proof references remain in restricted database metadata. A successful command does not demonstrate working corporate SSO. Exercise the approved Entra login and negative protocol cases in the identity runbook before enabling real access.

If execution fails, use its safe error code and request ID. Do not paste raw input, database diagnostics or `.env` into logs or tickets. Investigate a conflict through controlled operations; do not delete an existing binding or its history to force the command through. Lost credentials, disputed approval evidence, revocation and same-person rehire transfer require the separate access-management process.
