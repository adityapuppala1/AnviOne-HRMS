import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makePool } from "../packages/database/src/index";
import {
  bindIdentity,
  type BindingInput,
} from "../scripts/identity-operations";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.AUTH_MODE !== "demo"
) {
  throw new Error(
    "Identity operations tests require the synthetic development/demo database",
  );
}
for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "WORKER_DATABASE_URL",
  "IDENTITY_OPERATOR_DATABASE_URL",
]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  ) {
    throw new Error(
      "Identity operations tests require the local Compose database",
    );
  }
}

await test("dedicated identity operations boundary", async (t) => {
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const runtime = makePool(process.env.DATABASE_URL!);
  const worker = makePool(process.env.WORKER_DATABASE_URL!);
  const operator = makePool(process.env.IDENTITY_OPERATOR_DATABASE_URL!);
  const config = {
    connectionString: process.env.IDENTITY_OPERATOR_DATABASE_URL!,
  };
  const input: BindingInput = {
    tenantId: "10000000-0000-4000-8000-000000000001",
    entityId: "20000000-0000-4000-8000-000000000001",
    employmentId: "30000000-0000-4000-8000-000000000002",
    issuer: `https://identity.example.test/${randomUUID()}/v2.0`,
    subject: `approved-${randomUUID()}`,
    verifiedOfficialEmail: "demo2@anvi.example",
    hrApprovalReference: `HR-${randomUUID()}`,
    identityVerificationReference: `IAM-${randomUUID()}`,
    operatorIdentifier: "synthetic-identity-operator",
    reason: "Synthetic integration proof of external approval attestation",
  };
  const sql =
    "SELECT public.bind_identity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)";
  const args = (value: BindingInput, apply: boolean) => [
    value.tenantId,
    value.entityId,
    value.employmentId,
    value.issuer,
    value.subject,
    value.verifiedOfficialEmail,
    value.hrApprovalReference,
    value.identityVerificationReference,
    value.operatorIdentifier,
    value.reason,
    value.requestId ?? randomUUID(),
    apply,
  ];
  const rejectsCode = async (action: Promise<unknown>, code: string) =>
    assert.rejects(action, (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === code,
      ),
    );
  let createdId: string | null = null;
  try {
    await t.test(
      "operator is not an owner, cannot bypass RLS or read source tables",
      async () => {
        const { rows } = await operator.query<{ unsafe: boolean }>(
          "SELECT r.rolsuper OR r.rolbypassrls OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS unsafe FROM pg_roles r WHERE rolname=current_user",
        );
        assert.equal(rows[0]?.unsafe, false);
        for (const table of [
          "employee",
          "person",
          "identity_binding",
          "identity_binding_attestation",
          "audit_event",
        ]) {
          await rejectsCode(operator.query(`SELECT * FROM ${table}`), "42501");
        }
        await rejectsCode(runtime.query(sql, args(input, false)), "42501");
        await rejectsCode(worker.query(sql, args(input, false)), "42501");
        // A broadly privileged migration connection is not an operations identity.
        await rejectsCode(admin.query(sql, args(input, false)), "42501");
      },
    );
    await t.test(
      "dry-run validates without creating binding, attestation or audit",
      async () => {
        const result = await bindIdentity(input, false, config);
        assert.equal(result.mode, "dry-run");
        assert.equal(result.status, "ready");
        assert.equal(result.bindingId, null);
        assert.equal(
          (
            await admin.query(
              "SELECT 1 FROM identity_binding WHERE issuer=$1",
              [input.issuer],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await admin.query("SELECT 1 FROM audit_event WHERE request_id=$1", [
              result.requestId,
            ])
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "scope, verified email, readiness and occupied employment are enforced",
      async () => {
        await rejectsCode(
          bindIdentity(
            { ...input, entityId: "20000000-0000-4000-8000-000000000002" },
            true,
            config,
          ),
          "P0002",
        );
        await rejectsCode(
          bindIdentity(
            { ...input, verifiedOfficialEmail: "other@anvi.example" },
            true,
            config,
          ),
          "22023",
        );
        await rejectsCode(
          bindIdentity({ ...input, hrApprovalReference: "" }, true, config),
          "22023",
        );
        await rejectsCode(
          bindIdentity(
            {
              ...input,
              employmentId: "30000000-0000-4000-8000-000000000001",
              verifiedOfficialEmail: "demo1@anvi.example",
            },
            true,
            config,
          ),
          "23505",
        );
        const original = (
          await admin.query<{ joined_on: string; status: string }>(
            "SELECT joined_on::text, status FROM employee WHERE id=$1",
            [input.employmentId],
          )
        ).rows[0]!;
        try {
          await admin.query(
            "UPDATE employee SET status='inactive' WHERE id=$1",
            [input.employmentId],
          );
          await rejectsCode(bindIdentity(input, true, config), "22023");
          await admin.query(
            "UPDATE employee SET status=$2, joined_on=CURRENT_DATE + 2 WHERE id=$1",
            [input.employmentId, original.status],
          );
          await rejectsCode(bindIdentity(input, true, config), "22023");
        } finally {
          await admin.query(
            "UPDATE employee SET status=$2, joined_on=$3 WHERE id=$1",
            [input.employmentId, original.status, original.joined_on],
          );
        }
        const duplicateId = "30000000-0000-4000-8000-000000000003";
        const originalEmail = (
          await admin.query<{ email: string }>(
            "SELECT email FROM employee WHERE id=$1",
            [duplicateId],
          )
        ).rows[0]!.email;
        try {
          await admin.query("UPDATE employee SET email=$2 WHERE id=$1", [
            duplicateId,
            input.verifiedOfficialEmail,
          ]);
          await rejectsCode(bindIdentity(input, true, config), "22023");
        } finally {
          await admin.query("UPDATE employee SET email=$2 WHERE id=$1", [
            duplicateId,
            originalEmail,
          ]);
        }
      },
    );
    await t.test(
      "mandatory audit failure rolls back binding and attestation",
      async () => {
        await admin.query(
          "REVOKE INSERT ON audit_event FROM anvione_identity_writer",
        );
        try {
          await rejectsCode(bindIdentity(input, true, config), "42501");
          assert.equal(
            (
              await admin.query(
                "SELECT 1 FROM identity_binding WHERE issuer=$1",
                [input.issuer],
              )
            ).rowCount,
            0,
          );
        } finally {
          await admin.query(
            "GRANT INSERT ON audit_event TO anvione_identity_writer",
          );
        }
      },
    );
    await t.test(
      "concurrent exact replay creates one employee-only binding and one audit event",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 5 }, () => bindIdentity(input, true, config)),
        );
        assert.equal(
          results.filter((result) => result.status === "created").length,
          1,
        );
        assert.equal(
          results.filter((result) => result.status === "unchanged").length,
          4,
        );
        assert.equal(
          new Set(results.map((result) => result.bindingId)).size,
          1,
        );
        createdId = results[0]!.bindingId;
        const binding = (
          await admin.query<{ roles: string[]; active: boolean }>(
            "SELECT roles, active FROM identity_binding WHERE id=$1",
            [createdId],
          )
        ).rows[0]!;
        assert.deepEqual(binding.roles, ["employee"]);
        assert.equal(binding.active, true);
        assert.equal(
          (
            await admin.query(
              "SELECT 1 FROM identity_binding_attestation WHERE binding_id=$1",
              [createdId],
            )
          ).rowCount,
          1,
        );
        const audit = (
          await admin.query<{
            actor_label: string;
            reason: string;
            details: Record<string, unknown>;
          }>(
            "SELECT actor_label, reason, details FROM audit_event WHERE action='identity.bound' AND target=$1",
            [createdId],
          )
        ).rows;
        assert.equal(audit.length, 1);
        assert.equal(audit[0]!.actor_label, "anvione_identity_operator");
        assert.equal(audit[0]!.reason, input.reason);
        assert.equal(
          audit[0]!.details.hrApprovalReference,
          input.hrApprovalReference,
        );
        assert.ok(!JSON.stringify(audit).includes(input.subject));
        assert.ok(!JSON.stringify(audit).includes(input.verifiedOfficialEmail));
        const resolved = (
          await runtime.query<{
            actor: { roles: string[]; employeeId: string };
          }>("SELECT resolve_identity($1,$2) AS actor", [
            input.issuer,
            input.subject,
          ])
        ).rows[0]!.actor;
        assert.equal(resolved.employeeId, input.employmentId);
        assert.deepEqual(resolved.roles, ["employee"]);
      },
    );
    await t.test(
      "conflicting evidence, identity and employment cannot rebind or rewrite history",
      async () => {
        await rejectsCode(
          bindIdentity(
            { ...input, reason: "A different approval claim" },
            true,
            config,
          ),
          "23505",
        );
        await rejectsCode(
          bindIdentity(
            { ...input, subject: `different-${randomUUID()}` },
            true,
            config,
          ),
          "23505",
        );
        await rejectsCode(
          bindIdentity(
            {
              ...input,
              employmentId: "30000000-0000-4000-8000-000000000003",
              verifiedOfficialEmail: "demo3@anvi.example",
            },
            true,
            config,
          ),
          "23505",
        );
        await rejectsCode(
          operator.query("DELETE FROM identity_binding WHERE id=$1", [
            createdId,
          ]),
          "42501",
        );
        await rejectsCode(
          operator.query(
            "UPDATE identity_binding_attestation SET reason='modified' WHERE binding_id=$1",
            [createdId],
          ),
          "42501",
        );
        await rejectsCode(
          runtime.query(
            "DELETE FROM identity_binding_attestation WHERE binding_id=$1",
            [createdId],
          ),
          "42501",
        );
      },
    );
  } finally {
    // Remove only identities created under this run's unique synthetic issuer.
    const bindings = await admin.query<{ id: string }>(
      "SELECT id FROM identity_binding WHERE issuer=$1",
      [input.issuer],
    );
    for (const { id } of bindings.rows) {
      await admin.query("DELETE FROM app_session WHERE actor_id=$1", [id]);
      await admin.query(
        "DELETE FROM identity_binding_attestation WHERE binding_id=$1",
        [id],
      );
      await admin.query(
        "DELETE FROM audit_event WHERE action='identity.bound' AND target=$1",
        [id],
      );
      await admin.query("DELETE FROM identity_binding WHERE id=$1", [id]);
    }
    await Promise.all([
      admin.end(),
      runtime.end(),
      worker.end(),
      operator.end(),
    ]);
  }
});
