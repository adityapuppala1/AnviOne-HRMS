import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import {
  directoryQuerySchema,
  type OrganizationUnit,
  type Role,
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
  ) {
    throw new Error("Integration tests require the local Compose database");
  }
}

await test("Organization and people lifecycle foundations", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4476" });
  const { app, store } = await createApp(config);
  await app.listen(4476, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const ids: string[] = [];
  const fixturePeople: string[] = [];
  const fixtureEmployments: string[] = [];
  const prefix = `QA-${randomUUID().slice(0, 8).toUpperCase()}`;
  const reason = "Synthetic organization acceptance check";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4476/api/v1${path}`, {
      ...init,
      headers: {
        Cookie: `anvi_dev_session=${token}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  async function changeRole(role: Role) {
    const response = await request("/session/role-context", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  async function createUnit(suffix: string, kind = "department") {
    const response = await request("/organization", {
      method: "POST",
      body: JSON.stringify({
        kind,
        code: `${prefix}-${suffix}`,
        name: `${prefix} ${suffix}`,
        reason,
      }),
    });
    assert.equal(response.status, 201);
    const item = (await response.json()) as OrganizationUnit;
    ids.push(item.id);
    return item;
  }
  let item: OrganizationUnit;
  try {
    await t.test(
      "migration preserves directory identity and moves person/master fields to canonical tables",
      async () => {
        const directory = await store.directory(
          actor,
          directoryQuerySchema.parse({ limit: 50 }),
        );
        assert.equal(directory.total, 12);
        const maya = directory.items.find((e) => e.id === actor.employeeId)!;
        assert.equal(maya.name, "Maya Iyer");
        assert.equal(maya.code, "ANV-000001");
        const linked = await admin.query(
          `SELECT e.person_id,p.name,a.code FROM employee e JOIN person p ON p.id=e.person_id
         JOIN employee_code_allocation a ON a.employee_id=e.id AND a.tenant_id=e.tenant_id WHERE e.id=$1`,
          [actor.employeeId],
        );
        assert.equal(linked.rows[0].name, maya.name);
        assert.equal(linked.rows[0].code, maya.code);
        const obsolete = await admin.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='employee' AND column_name IN ('name','initials','department','location')",
        );
        assert.equal(obsolete.rowCount, 0);
        const view = await admin.query(
          "SELECT reloptions FROM pg_class WHERE oid='employee_directory'::regclass",
        );
        assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));
        for (const [role, count] of [
          ["employee", 1],
          ["manager", 4],
          ["hr_admin", 12],
        ] as const) {
          const visible = await scoped(store.pool, { ...actor, role }, (c) =>
            c.query("SELECT id FROM person"),
          );
          assert.equal(visible.rowCount, count);
        }
        assert.equal(
          (await store.pool.query("SELECT * FROM person")).rowCount,
          0,
        );
      },
    );

    await t.test(
      "organization lists and search are scoped, paginated and validated",
      async () => {
        const response = await request("/organization");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const data = await response.json();
        for (const name of [
          "HR",
          "IT",
          "Management",
          "Marketing",
          "Hardware",
          "Administration",
        ]) {
          assert.ok(data.items.some((u: OrganizationUnit) => u.name === name));
        }
        assert.ok(
          !data.items.some((u: OrganizationUnit) => u.name === "Testing"),
        );
        const found = await (
          await request(
            "/organization?kind=department&q=Engineering&limit=1&page=999",
          )
        ).json();
        assert.equal(found.total, 1);
        assert.equal(found.page, 1);
        assert.equal(found.items[0].employeeCount, 4);
        assert.equal((await request("/organization?kind=tenant")).status, 400);
        assert.equal(
          (await request("/organization?tenantId=other")).status,
          400,
        );
        assert.equal(
          (await request(`/organization?q=${"x".repeat(81)}`)).status,
          400,
        );
      },
    );

    await t.test(
      "all non-HR roles and an ungranted HR context cannot maintain masters",
      async () => {
        for (const role of [
          "employee",
          "manager",
          "platform_admin",
          "auditor",
        ] as const) {
          await changeRole(role);
          assert.equal((await request("/organization")).status, 403);
          assert.equal(
            (
              await request("/organization", {
                method: "POST",
                body: JSON.stringify({
                  kind: "department",
                  code: "DENIED",
                  name: "Denied record",
                  reason,
                }),
              })
            ).status,
            403,
          );
          await assert.rejects(
            scoped(store.pool, { ...actor, role }, (c) =>
              c.query(
                "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name) VALUES($1,$2,$3,'department',$4,$5)",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  `${prefix}-NO`,
                  `${prefix} denied`,
                ],
              ),
            ),
          );
        }
        await changeRole("hr_admin");
        await assert.rejects(
          scoped(store.pool, { ...actor, roles: ["employee"] }, (c) =>
            c.query(
              "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name) VALUES($1,$2,$3,'department',$4,$5)",
              [
                randomUUID(),
                actor.tenantId,
                actor.entityId,
                `${prefix}-NO`,
                `${prefix} ungranted`,
              ],
            ),
          ),
        );
      },
    );

    await t.test(
      "mutations reject bad origins, CSRF, mass assignment and foreign entities",
      async () => {
        const body = {
          kind: "department",
          code: `${prefix}-NEW`,
          name: `${prefix} new`,
          reason,
        };
        assert.equal(
          (
            await request("/organization", {
              method: "POST",
              body: JSON.stringify(body),
              headers: { Origin: "https://outside.example" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("/organization", {
              method: "POST",
              body: JSON.stringify(body),
              headers: { "X-CSRF-Token": "bad" },
            })
          ).status,
          403,
        );
        for (const extra of [
          { tenantId: actor.tenantId },
          { active: false },
          { version: 99 },
          { code: "invalid space" },
          { reason: "short" },
        ]) {
          assert.equal(
            (
              await request("/organization", {
                method: "POST",
                body: JSON.stringify({ ...body, ...extra }),
              })
            ).status,
            400,
          );
        }
        const foreign = await admin.query(
          "SELECT id FROM org_unit WHERE entity_id<>$1 LIMIT 1",
          [actor.entityId],
        );
        assert.equal(
          (
            await request(`/organization/${foreign.rows[0].id}`, {
              method: "PUT",
              body: JSON.stringify({
                name: "Must not change",
                active: false,
                version: 1,
                reason,
              }),
            })
          ).status,
          404,
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query(
              "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name) VALUES($1,$2,$3,'department',$4,$5)",
              [
                randomUUID(),
                actor.tenantId,
                "20000000-0000-4000-8000-000000000002",
                `${prefix}-NO`,
                `${prefix} cross entity`,
              ],
            ),
          ),
        );
      },
    );

    await t.test(
      "creation records its reason and one aggregate event, with scoped uniqueness",
      async () => {
        item = await createUnit("CREATE");
        assert.equal(item.version, 1);
        assert.equal(item.active, true);
        assert.equal(item.employeeCount, 0);
        for (const body of [
          {
            kind: "department",
            code: item.code,
            name: `${prefix} another`,
            reason,
          },
          {
            kind: "department",
            code: `${prefix}-DUP`,
            name: item.name.toLowerCase(),
            reason,
          },
        ]) {
          assert.equal(
            (
              await request("/organization", {
                method: "POST",
                body: JSON.stringify(body),
              })
            ).status,
            409,
          );
        }
        const audit = await admin.query(
          "SELECT reason,details FROM audit_event WHERE action='organization.created' AND target=$1",
          [`organization:${item.id}:v1`],
        );
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0].reason, reason);
        assert.equal(audit.rows[0].details.after.code, item.code);
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1",
              [item.id],
            )
          ).rowCount,
          1,
        );
      },
    );

    await t.test(
      "simultaneous edits commit once; version conflicts cannot overwrite state",
      async () => {
        const responses = await Promise.all(
          ["Alpha", "Beta"].map((suffix) =>
            request(`/organization/${item.id}`, {
              method: "PUT",
              body: JSON.stringify({
                name: `${prefix} ${suffix}`,
                active: false,
                version: item.version,
                reason,
              }),
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        item = (await responses
          .find((r) => r.status === 200)!
          .json()) as OrganizationUnit;
        assert.equal(item.version, 2);
        assert.equal(item.active, false);
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1",
              [item.id],
            )
          ).rowCount,
          2,
        );
        assert.equal(
          (
            await request(`/organization/${item.id}`, {
              method: "PUT",
              body: JSON.stringify({
                name: item.name,
                active: item.active,
                version: item.version,
                reason,
              }),
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1",
              [item.id],
            )
          ).rowCount,
          2,
        );
        const changed = await request(`/organization/${item.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: item.name,
            active: true,
            version: item.version,
            reason,
          }),
        });
        item = (await changed.json()) as OrganizationUnit;
        assert.equal(item.active, true);
        assert.equal(item.version, 3);
      },
    );

    await t.test(
      "audit or outbox failure rolls back the entire master mutation",
      async () => {
        for (const table of ["audit_event", "outbox_event"]) {
          await admin.query(`REVOKE INSERT ON ${table} FROM anvione_app`);
          try {
            const response = await request(`/organization/${item.id}`, {
              method: "PUT",
              body: JSON.stringify({
                name: `${prefix} rollback`,
                active: false,
                version: item.version,
                reason,
              }),
            });
            assert.equal(response.status, 500);
            const current = await admin.query(
              "SELECT name,active,version FROM org_unit WHERE id=$1",
              [item.id],
            );
            assert.deepEqual(current.rows[0], {
              name: item.name,
              active: item.active,
              version: item.version,
            });
          } finally {
            await admin.query(`GRANT INSERT ON ${table} TO anvione_app`);
          }
        }
      },
    );

    await t.test(
      "referenced masters cannot be deleted and immutable codes cannot be edited",
      async () => {
        const referenced = await admin.query(
          "SELECT department_id FROM employee WHERE id=$1",
          [actor.employeeId],
        );
        await assert.rejects(
          admin.query("DELETE FROM org_unit WHERE id=$1", [
            referenced.rows[0].department_id,
          ]),
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query("DELETE FROM org_unit WHERE id=$1", [item.id]),
          ),
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query(
              "UPDATE org_unit SET code='OTHER',version=version+1 WHERE id=$1",
              [item.id],
            ),
          ),
        );
        await assert.rejects(
          admin.query(
            "UPDATE org_unit SET code='OTHER',version=version+1 WHERE id=$1",
            [item.id],
          ),
        );
        await assert.rejects(
          admin.query("UPDATE org_unit SET name='No version' WHERE id=$1", [
            item.id,
          ]),
        );
      },
    );

    await t.test(
      "allocator is concurrent and idempotent; app cannot issue or alter codes",
      async () => {
        const employmentId = randomUUID();
        const same = await Promise.all(
          Array.from({ length: 8 }, () =>
            admin.query("SELECT issue_employee_code($1,$2,$3) AS code", [
              actor.tenantId,
              actor.entityId,
              employmentId,
            ]),
          ),
        );
        assert.equal(new Set(same.map((r) => r.rows[0].code)).size, 1);
        const distinct = await Promise.all(
          Array.from({ length: 8 }, () =>
            admin.query("SELECT issue_employee_code($1,$2,$3) AS code", [
              actor.tenantId,
              actor.entityId,
              randomUUID(),
            ]),
          ),
        );
        assert.equal(new Set(distinct.map((r) => r.rows[0].code)).size, 8);
        await assert.rejects(
          store.pool.query("SELECT issue_employee_code($1,$2,$3)", [
            actor.tenantId,
            actor.entityId,
            randomUUID(),
          ]),
        );
        await assert.rejects(
          store.pool.query("SELECT nextval('employee_code_sequence')"),
        );
        await assert.rejects(
          store.pool.query("SELECT setval('employee_code_sequence',1)"),
        );
        await assert.rejects(
          admin.query(
            "UPDATE employee_code_allocation SET code='REUSED' WHERE employee_id=$1",
            [employmentId],
          ),
        );
        await assert.rejects(
          admin.query(
            "DELETE FROM employee_code_allocation WHERE employee_id=$1",
            [employmentId],
          ),
        );
        await assert.rejects(
          admin.query("UPDATE employee SET code='REUSED' WHERE id=$1", [
            actor.employeeId,
          ]),
        );
        await assert.rejects(
          admin.query("UPDATE employee SET person_id=$1 WHERE id=$2", [
            randomUUID(),
            actor.employeeId,
          ]),
        );
      },
    );

    await t.test(
      "rolled-back code reservations consume a gap and cannot be recycled",
      async () => {
        let abandoned = "";
        await assert.rejects(
          transaction(admin, async (client) => {
            const result = await client.query(
              "SELECT issue_employee_code($1,$2,$3) AS code",
              [actor.tenantId, actor.entityId, randomUUID()],
            );
            abandoned = result.rows[0].code;
            throw new Error(
              "Synthetic rollback before a code can be returned to a caller",
            );
          }),
        );
        const next = await admin.query(
          "SELECT issue_employee_code($1,$2,$3) AS code",
          [actor.tenantId, actor.entityId, randomUUID()],
        );
        assert.ok(
          Number(next.rows[0].code.slice(4)) > Number(abandoned.slice(4)),
        );
      },
    );

    await t.test(
      "rehire shares the person while preserving separate employment and code tombstones",
      async () => {
        const personId = randomUUID();
        fixturePeople.push(personId);
        await admin.query(
          "INSERT INTO person(id,tenant_id,name,initials) VALUES($1,$2,$3,'QA')",
          [personId, actor.tenantId, `${prefix} person`],
        );
        const existing = (
          await admin.query(
            "SELECT department_id,location_id FROM employee WHERE id=$1",
            [actor.employeeId],
          )
        ).rows[0];
        const addEmployment = async (
          id: string,
          code: string,
          departmentId = existing.department_id,
          locationId = existing.location_id,
        ) =>
          admin.query(
            `INSERT INTO employee(id,tenant_id,entity_id,person_id,code,title,department_id,location_id,email,joined_on,status)
         VALUES($1,$2,$3,$4,$5,'Synthetic role',$6,$7,$8,'2026-01-01','inactive')`,
            [
              id,
              actor.tenantId,
              actor.entityId,
              personId,
              code,
              departmentId,
              locationId,
              `${id}@anvi.example`,
            ],
          );
        const codes: string[] = [];
        for (let i = 0; i < 2; i++) {
          const id = randomUUID();
          const code = (
            await admin.query("SELECT issue_employee_code($1,$2,$3) AS code", [
              actor.tenantId,
              actor.entityId,
              id,
            ])
          ).rows[0].code;
          await addEmployment(id, code);
          fixtureEmployments.push(id);
          codes.push(code);
        }
        assert.notEqual(codes[0], codes[1]);
        const rows = await admin.query(
          "SELECT id FROM employee WHERE person_id=$1",
          [personId],
        );
        assert.equal(rows.rowCount, 2);
        const removedId = fixtureEmployments.pop()!;
        await admin.query("DELETE FROM employee WHERE id=$1", [removedId]);
        assert.equal(
          (
            await admin.query(
              "SELECT code FROM employee_code_allocation WHERE employee_id=$1",
              [removedId],
            )
          ).rows[0].code,
          codes[1],
        );
        await assert.rejects(addEmployment(randomUUID(), codes[1]!));
        await assert.rejects(addEmployment(randomUUID(), `${prefix}-UNISSUED`));
        const foreign = (
          await admin.query(
            "SELECT id FROM org_unit WHERE entity_id<>$1 AND kind='department' LIMIT 1",
            [actor.entityId],
          )
        ).rows[0].id;
        const futureId = randomUUID();
        const futureCode = (
          await admin.query("SELECT issue_employee_code($1,$2,$3) AS code", [
            actor.tenantId,
            actor.entityId,
            futureId,
          ])
        ).rows[0].code;
        await assert.rejects(addEmployment(futureId, futureCode, foreign));
        await assert.rejects(
          addEmployment(futureId, futureCode, existing.location_id),
        );
        await admin.query(
          "UPDATE org_unit SET active=false,version=version+1 WHERE id=$1",
          [item.id],
        );
        await assert.rejects(addEmployment(futureId, futureCode, item.id));
        // Existing inactive master references are historical facts, not silently removed.
        await admin.query("UPDATE employee SET department_id=$1 WHERE id=$2", [
          existing.department_id,
          fixtureEmployments[0],
        ]);
      },
    );
  } finally {
    // Only disposable fixtures are removed. Permanent issuance/audit records remain.
    await admin.query("DELETE FROM employee WHERE id = ANY($1::uuid[])", [
      fixtureEmployments,
    ]);
    await admin.query("DELETE FROM person WHERE id = ANY($1::uuid[])", [
      fixturePeople,
    ]);
    await admin.query("DELETE FROM org_unit WHERE id = ANY($1::uuid[])", [ids]);
    await store.pool.end();
    await admin.end();
    await app.close();
  }
});
