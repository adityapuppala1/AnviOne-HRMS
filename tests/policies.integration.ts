import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import type {
  MyPolicies,
  MyPolicyDetail,
  PolicyDetail,
  PolicyList,
  Role,
} from "../packages/contracts/src/index";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.AUTH_MODE !== "demo"
) {
  throw new Error(
    "Integration tests require the synthetic development/demo database",
  );
}
for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  )
    throw new Error("Integration tests require the local Compose database");
}

const WORDING =
  "All staff must lock their screens when away from the desk and report lost devices the same day.";

await test("HR policies: versions, acknowledgement and the guards underneath", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4491" });
  const { app, store } = await createApp(config);
  await app.listen(4491, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const code = (n: number) => `TST-${run}-${n}`;
  const policies: string[] = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4491/api/v1${path}`, {
      ...init,
      headers: {
        Cookie: `anvi_dev_session=${token}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  const send = (path: string, method: string, body: unknown) =>
    request(path, { method, body: JSON.stringify(body) });
  async function changeRole(role: Role) {
    const response = await send("/session/role-context", "POST", { role });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  const content = (n: number, extra: Record<string, unknown> = {}) => ({
    code: code(n),
    category: "it_security",
    title: `Synthetic screen policy ${n}`,
    summary: "Lock your screen and report lost devices promptly.",
    body: WORDING,
    effectiveOn: "2026-11-01",
    requiresAcknowledgement: true,
    ...extra,
  });
  async function create(n: number, extra: Record<string, unknown> = {}) {
    const response = await send("/policies", "POST", content(n, extra));
    assert.equal(response.status, 201, await response.clone().text());
    const detail = (await response.json()) as PolicyDetail;
    policies.push(detail.policy.id);
    return detail;
  }
  const publish = async (detail: PolicyDetail, which = 0) => {
    const draft = detail.versions[which]!;
    const response = await send(
      `/policies/versions/${draft.id}/publish`,
      "POST",
      {
        version: draft.version,
      },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()) as PolicyDetail;
  };
  const detail = async (id: string) =>
    (await (await request(`/policies/${id}`)).json()) as PolicyDetail;
  const mine = async () =>
    (await (await request("/policies/mine")).json()) as MyPolicies;
  const employee = (
    await admin.query<{ department_id: string }>(
      "SELECT department_id FROM employee WHERE id=$1",
      [actor.employeeId],
    )
  ).rows[0]!;
  const otherDepartment = (
    await admin.query<{ id: string }>(
      "SELECT id FROM org_unit WHERE kind='department' AND entity_id=$1 AND id<>$2 LIMIT 1",
      [actor.entityId, employee.department_id],
    )
  ).rows[0]!.id;
  const otherEmployee = (
    await admin.query<{ id: string }>(
      "SELECT id FROM employee WHERE entity_id=$1 AND id<>$2 AND status IN ('active','notice') LIMIT 1",
      [actor.entityId, actor.employeeId],
    )
  ).rows[0]!.id;

  try {
    await t.test(
      "HR drafts a policy; codes and wording are validated",
      async () => {
        await changeRole("hr_admin");
        const first = await create(1);
        assert.equal(first.versions.length, 1);
        assert.equal(first.versions[0]!.status, "draft");
        assert.equal(first.versions[0]!.versionNumber, 1);
        assert.equal(first.compliance, null);
        assert.equal((await send("/policies", "POST", content(1))).status, 409);
        assert.equal(
          (await send("/policies", "POST", content(2, { body: "Too short" })))
            .status,
          400,
        );
        assert.equal(
          (await send("/policies", "POST", content(3, { category: "gossip" })))
            .status,
          400,
        );
        assert.equal(
          (await send("/policies", "POST", content(4, { code: "no spaces!" })))
            .status,
          400,
        );
      },
    );

    await t.test(
      "only HR manages policies, and drafts stay private",
      async () => {
        for (const role of [
          "employee",
          "manager",
          "auditor",
          "platform_admin",
        ] as const) {
          await changeRole(role);
          assert.equal((await request("/policies")).status, 403, role);
          assert.equal(
            (await send("/policies", "POST", content(8))).status,
            403,
            role,
          );
        }
        await changeRole("employee");
        const seen = await mine();
        assert.ok(
          !seen.items.some((i) => i.code === code(1)),
          "a draft is not visible",
        );
      },
    );

    await t.test(
      "publishing shows the policy to employees, who acknowledge it once",
      async () => {
        await changeRole("hr_admin");
        const draft = await detail(policies[0]!);
        const published = await publish(draft);
        assert.equal(published.versions[0]!.status, "published");
        assert.ok(published.versions[0]!.publishedBy);
        assert.ok(published.compliance, "HR sees who still has to acknowledge");
        assert.equal(published.compliance!.stats.acknowledged, 0);
        const listed = (await (
          await request("/policies")
        ).json()) as PolicyList;
        assert.ok(listed.items.find((i) => i.code === code(1))!.current);
        assert.ok(listed.counts.outstanding >= 1);

        await changeRole("employee");
        const before = await mine();
        const item = before.items.find((i) => i.code === code(1))!;
        assert.ok(item, "the employee sees the published policy");
        assert.equal(item.acknowledgedAt, null);
        assert.ok(before.outstanding >= 1);
        const read = (await (
          await request(`/policies/mine/${item.versionId}`)
        ).json()) as MyPolicyDetail;
        assert.equal(read.body, WORDING);
        const ack = await send(
          `/policies/versions/${item.versionId}/acknowledge`,
          "POST",
          {},
        );
        assert.equal(ack.status, 201);
        const after = (await ack.json()) as MyPolicies;
        assert.ok(after.items.find((i) => i.code === code(1))!.acknowledgedAt);
        assert.equal(
          (
            await send(
              `/policies/versions/${item.versionId}/acknowledge`,
              "POST",
              {},
            )
          ).status,
          409,
        );

        await changeRole("hr_admin");
        const view = await detail(policies[0]!);
        const maya = view.compliance!.people.find(
          (p) => p.employeeId === actor.employeeId,
        )!;
        assert.ok(maya.acknowledgedAt, "HR sees the acknowledgement");
        assert.ok(view.compliance!.stats.acknowledged >= 1);
      },
    );

    await t.test(
      "published wording cannot change; a new version replaces it",
      async () => {
        await changeRole("hr_admin");
        const live = await detail(policies[0]!);
        const v1 = live.versions[0]!;
        const edit = await send(`/policies/versions/${v1.id}`, "PUT", {
          title: v1.title,
          summary: v1.summary,
          body: `${WORDING} Extra sentence.`,
          effectiveOn: v1.effectiveOn,
          requiresAcknowledgement: true,
          audienceDepartmentId: null,
          version: v1.version,
        });
        assert.equal(edit.status, 409, "published wording is immutable");
        const started = await send(
          `/policies/${policies[0]}/drafts`,
          "POST",
          {},
        );
        assert.equal(started.status, 201);
        const twoVersions = (await started.json()) as PolicyDetail;
        assert.equal(twoVersions.versions.length, 2);
        const draft = twoVersions.versions[0]!;
        assert.equal(draft.status, "draft");
        assert.equal(draft.versionNumber, 2);
        assert.equal(
          draft.title,
          v1.title,
          "the draft starts from the current wording",
        );
        assert.equal(
          (await send(`/policies/${policies[0]}/drafts`, "POST", {})).status,
          409,
        );
        const changed = await send(`/policies/versions/${draft.id}`, "PUT", {
          title: draft.title,
          summary: draft.summary,
          body: `${WORDING} Report it within one working day.`,
          effectiveOn: "2026-12-01",
          requiresAcknowledgement: true,
          audienceDepartmentId: null,
          version: draft.version,
        });
        assert.equal(changed.status, 200);
        const stale = await send(`/policies/versions/${draft.id}`, "PUT", {
          title: draft.title,
          summary: draft.summary,
          body: WORDING,
          effectiveOn: "2026-12-01",
          requiresAcknowledgement: true,
          audienceDepartmentId: null,
          version: draft.version,
        });
        assert.equal(stale.status, 409, "a stale edit conflicts");
        const edited = ((await changed.json()) as PolicyDetail).versions[0]!;
        const replaced = await publish({ ...twoVersions, versions: [edited] });
        assert.equal(replaced.versions[0]!.status, "published");
        assert.equal(replaced.versions[1]!.status, "superseded");
        assert.equal(
          replaced.compliance!.stats.acknowledged,
          0,
          "the new version needs a fresh acknowledgement",
        );

        await changeRole("employee");
        const seen = (await mine()).items.filter((i) => i.code === code(1));
        assert.equal(seen.length, 1, "only the current version is shown");
        assert.equal(seen[0]!.versionNumber, 2);
        assert.equal(seen[0]!.acknowledgedAt, null);
      },
    );

    await t.test(
      "department targeting reaches only that department",
      async () => {
        await changeRole("hr_admin");
        const elsewhere = await publish(
          await create(5, { audienceDepartmentId: otherDepartment }),
        );
        const here = await publish(
          await create(6, { audienceDepartmentId: employee.department_id }),
        );
        assert.equal(
          elsewhere.versions[0]!.audienceDepartment!.id,
          otherDepartment,
        );
        const missing = await send(
          "/policies",
          "POST",
          content(7, {
            audienceDepartmentId: randomUUID(),
          }),
        );
        assert.equal(missing.status, 400, "the department must exist");
        await changeRole("employee");
        const items = (await mine()).items;
        assert.ok(
          !items.some((i) => i.code === code(5)),
          "another department's policy is hidden",
        );
        assert.ok(
          items.some((i) => i.code === code(6)),
          "their own department's policy is shown",
        );
        const hidden = await send(
          `/policies/versions/${elsewhere.versions[0]!.id}/acknowledge`,
          "POST",
          {},
        );
        assert.equal(hidden.status, 404);
        assert.equal(
          here.versions[0]!.audienceDepartment!.id,
          employee.department_id,
        );
      },
    );

    await t.test("withdrawing removes a policy from employees", async () => {
      await changeRole("hr_admin");
      const live = await detail(policies[2]!);
      const v = live.versions[0]!;
      const noReason = await send(
        `/policies/versions/${v.id}/withdraw`,
        "POST",
        {
          version: v.version,
        },
      );
      assert.equal(noReason.status, 400, "a reason is required");
      const gone = await send(`/policies/versions/${v.id}/withdraw`, "POST", {
        version: v.version,
        note: "Replaced by a company-wide policy",
      });
      assert.equal(gone.status, 201);
      assert.equal(
        ((await gone.json()) as PolicyDetail).versions[0]!.status,
        "withdrawn",
      );
      await changeRole("employee");
      assert.ok(!(await mine()).items.some((i) => i.code === code(6)));
    });

    await t.test(
      "every action leaves an audit record and an outbox event",
      async () => {
        const audit = await admin.query<{ action: string }>(
          "SELECT action FROM audit_event WHERE target LIKE 'policy:%' AND entity_id=$1",
          [actor.entityId],
        );
        const actions = new Set(audit.rows.map((r) => r.action));
        for (const action of [
          "policy.created",
          "policy.draft_updated",
          "policy.published",
          "policy.acknowledged",
          "policy.withdrawn",
        ])
          assert.ok(actions.has(action), action);
        const events = await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM outbox_event WHERE event_type LIKE 'policy.%'
         AND aggregate_id IN (SELECT id FROM policy_version WHERE policy_id=ANY($1::uuid[]))`,
          [policies],
        );
        assert.ok(events.rows[0]!.n >= 8);
      },
    );

    await t.test(
      "the database refuses what the API would never send",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const employeeActor = { ...actor, role: "employee" as const };
          const hr = { ...actor, role: "hr_admin" as const };
          const live = (
            await admin.query<{ id: string; policy_id: string }>(
              "SELECT id, policy_id FROM policy_version WHERE status='published' AND policy_id=ANY($1::uuid[]) LIMIT 1",
              [policies],
            )
          ).rows[0]!;
          // Employees cannot write policies, whatever statement reaches the tables.
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "INSERT INTO policy(id,tenant_id,entity_id,code,category) VALUES ($1,$2,$3,$4,'other')",
                [randomUUID(), actor.tenantId, actor.entityId, code(90)],
              ),
            ),
          );
          const touched = await scoped(pool, employeeActor, (client) =>
            client.query(
              "UPDATE policy_version SET title='Hijacked policy' WHERE id=$1",
              [live.id],
            ),
          );
          assert.equal(touched.rowCount, 0);
          // HR cannot edit published wording or delete anything.
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE policy_version SET body='Quietly changed wording of the published policy', version=version+1 WHERE id=$1",
                [live.id],
              ),
            ),
            /Published wording cannot be changed/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query("DELETE FROM policy_version WHERE id=$1", [live.id]),
            ),
            /permission denied|never deleted/,
          );
          // Acknowledgements are for the person they describe, and permanent.
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "INSERT INTO policy_acknowledgement(id,tenant_id,entity_id,policy_version_id,employee_id) VALUES ($1,$2,$3,$4,$5)",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  live.id,
                  otherEmployee,
                ],
              ),
            ),
          );
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "INSERT INTO policy_acknowledgement(id,tenant_id,entity_id,policy_version_id,employee_id) VALUES ($1,$2,$3,$4,$5)",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  live.id,
                  otherEmployee,
                ],
              ),
            ),
          );
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "UPDATE policy_acknowledgement SET acknowledged_at=now() - interval '1 year'",
              ),
            ),
            /permission denied|permanent/,
          );
        } finally {
          await pool.end();
        }
      },
    );
  } finally {
    // Synthetic cleanup only: policies and acknowledgements are never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const versions = (
        await client.query<{ id: string }>(
          "SELECT id FROM policy_version WHERE policy_id=ANY($1::uuid[])",
          [policies],
        )
      ).rows.map((r) => r.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [versions],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [policies.map((id) => `^policy:${id}`)],
      );
      await client.query(
        "DELETE FROM policy_acknowledgement WHERE policy_version_id=ANY($1::uuid[])",
        [versions],
      );
      await client.query(
        "DELETE FROM policy_version WHERE policy_id=ANY($1::uuid[])",
        [policies],
      );
      await client.query("DELETE FROM policy WHERE id=ANY($1::uuid[])", [
        policies,
      ]);
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
