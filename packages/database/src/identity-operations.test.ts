import { describe, expect, it } from "vitest";
import {
  operationConfig,
  parseArguments,
  parseBindingInput,
  safeOperationError,
} from "../../../scripts/identity-operations";

const fixture = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  entityId: "20000000-0000-4000-8000-000000000001",
  employmentId: "30000000-0000-4000-8000-000000000002",
  issuer: "https://identity.example.test/tenant/v2.0",
  subject: "opaque-approved-subject",
  verifiedOfficialEmail: "demo2@anvi.example",
  hrApprovalReference: "HR-APPROVAL-42",
  identityVerificationReference: "IAM-VERIFY-42",
  operatorIdentifier: "approved-operator",
  reason: "Bind preapproved employment after independent verification",
};
const env = {
  OIDC_ISSUER: fixture.issuer,
  IDENTITY_OPERATOR_DATABASE_URL:
    "postgresql://anvione_identity_operator:synthetic-only@127.0.0.1:55432/anvione",
};

describe("identity operations input boundary", () => {
  it("defaults to a read-only dry-run and takes private data only through a file or stdin", () => {
    expect(parseArguments([])).toEqual({ apply: false, file: undefined });
    expect(
      parseArguments(["--file", ".scratch/binding.json", "--apply"]),
    ).toEqual({ apply: true, file: ".scratch/binding.json" });
    expect(() => parseArguments(["--subject", fixture.subject])).toThrow();
    expect(() => parseArguments(["--apply", "--dry-run"])).toThrow();
    expect(() => parseArguments(["--file"])).toThrow();
  });
  it("requires explicit evidence, strict fields and bounded control-free values", () => {
    expect(parseBindingInput(JSON.stringify(fixture))).toEqual(fixture);
    for (const extra of [
      { roles: ["platform_admin"] },
      { hrApprovalReference: undefined },
      { reason: "line\nbreak" },
      { operatorIdentifier: " operator " },
      { subject: "subject\u0085suffix" },
      { identityVerificationReference: "x".repeat(201) },
    ]) {
      expect(() =>
        parseBindingInput(JSON.stringify({ ...fixture, ...extra })),
      ).toThrow();
    }
  });
  it("requires the exact configured issuer without treating an email as identity", () => {
    expect(operationConfig(env, fixture)).toEqual({
      connectionString: env.IDENTITY_OPERATOR_DATABASE_URL,
    });
    expect(() =>
      operationConfig(env, {
        ...fixture,
        issuer: "https://unapproved.example.test",
      }),
    ).toThrow();
    expect(() =>
      operationConfig(
        {
          ...env,
          OIDC_ISSUER: "https://login.microsoftonline.com/common/v2.0",
        },
        {
          ...fixture,
          issuer: "https://login.microsoftonline.com/common/v2.0",
        },
      ),
    ).toThrow();
  });
  it("rejects migration/runtime credentials and unverified remote TLS", () => {
    for (const connection of [
      "postgresql://anvione_migrator:synthetic@127.0.0.1:55432/anvione",
      "postgresql://anvione_app:synthetic@127.0.0.1:55432/anvione",
      "postgresql://anvione_identity_operator:synthetic@database.example.test/anvione?sslmode=require",
    ]) {
      expect(() =>
        operationConfig(
          { ...env, IDENTITY_OPERATOR_DATABASE_URL: connection },
          fixture,
        ),
      ).toThrow();
    }
    expect(
      operationConfig(
        {
          ...env,
          IDENTITY_OPERATOR_DATABASE_URL:
            "postgresql://anvione_identity_operator:synthetic@database.example.test/anvione?sslmode=verify-full",
        },
        fixture,
      ),
    ).toBeDefined();
  });
  it("does not echo identity data, SQL detail or connection secrets in errors", () => {
    const result = safeOperationError({
      code: "23505",
      message: fixture.subject,
      detail: fixture.verifiedOfficialEmail,
      query: env.IDENTITY_OPERATOR_DATABASE_URL,
    });
    expect(result.code).toBe("conflict");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(fixture.subject);
    expect(serialized).not.toContain(fixture.verifiedOfficialEmail);
    expect(serialized).not.toContain("synthetic-only");
    const malformed = () => parseBindingInput(`{"secret":"${fixture.subject}"`);
    expect(malformed).toThrow("Input must be a JSON object.");
  });
});
