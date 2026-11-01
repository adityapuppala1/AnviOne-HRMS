import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, transaction } from "../packages/database/src/index";
import type { Role, Updates } from "../packages/contracts/src/index";

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

await test("Updates show only decisions on the caller's own requests", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4487" });
  const { app, store } = await createApp(config);
  await app.listen(4487, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const created: { leave: string[]; correction: string[]; document: string[] } =
    { leave: [], correction: [], document: [] };
  const get = (path: string) =>
    fetch(`http://127.0.0.1:4487/api/v1${path}`, {
      headers: { Cookie: `anvi_dev_session=${token}` },
    });
  async function changeRole(role: Role) {
    const response = await fetch(
      "http://127.0.0.1:4487/api/v1/session/role-context",
      {
        method: "POST",
        headers: {
          Cookie: `anvi_dev_session=${token}`,
          Origin: config.APP_ORIGIN,
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      },
    );
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  const feed = async () => {
    const response = await get("/updates");
    assert.equal(response.status, 200);
    return (await response.json()) as Updates;
  };

  try {
    // Plant decided records for the caller and for a colleague, plus ones that
    // must not appear (old, still pending, cancelled by the owner).
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const other = (
        await client.query<{ id: string }>(
          "SELECT id FROM employee WHERE entity_id=$1 AND id<>$2 LIMIT 1",
          [actor.entityId, actor.employeeId],
        )
      ).rows[0]!.id;
      const type = (
        await client.query<{ id: string }>(
          "SELECT id FROM leave_type WHERE entity_id=$1 AND code='CL'",
          [actor.entityId],
        )
      ).rows[0]!.id;
      const leave = async (
        employee: string,
        state: string,
        decidedAgo: string | null,
        note: string | null,
      ) => {
        const id = randomUUID();
        created.leave.push(id);
        await client.query(
          `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,days,
             reason,state,approver,manager_id,version,requested_by_actor,decided_at,decided_by_label,decision_note)
           VALUES ($1,$2,$3,$4,$5,'2031-03-03','2031-03-04',2,'Synthetic update probe',$6,'hr',NULL,2,$7,
             CASE WHEN $8::text IS NULL THEN NULL ELSE now() - $8::interval END,
             CASE WHEN $8::text IS NULL THEN NULL ELSE 'Synthetic Reviewer' END,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            employee,
            type,
            state,
            actor.actorId,
            decidedAgo,
            note,
          ],
        );
        return id;
      };
      await leave(actor.employeeId, "approved", "1 hour", null);
      await leave(
        actor.employeeId,
        "rejected",
        "2 hours",
        "Team is short that week",
      );
      await leave(actor.employeeId, "approved", "45 days", null);
      await leave(actor.employeeId, "pending", null, null);
      await leave(actor.employeeId, "cancelled", "3 hours", null);
      await leave(other, "approved", "1 hour", null);

      const correction = randomUUID();
      created.correction.push(correction);
      await client.query(
        `INSERT INTO attendance_correction(id,tenant_id,entity_id,employee_id,work_date,check_in,check_out,reason,
           state,approver,manager_id,version,requested_by_actor,decided_at,decided_by_label,decision_note)
         VALUES ($1,$2,$3,$4,'2031-03-05','09:00','17:00','Synthetic update probe','rejected','hr',NULL,2,$5,
           now() - interval '30 minutes','Synthetic Reviewer','Please attach evidence')`,
        [
          correction,
          actor.tenantId,
          actor.entityId,
          actor.employeeId,
          actor.actorId,
        ],
      );
      const document = randomUUID();
      created.document.push(document);
      await client.query(
        `INSERT INTO employee_document(id,tenant_id,entity_id,employee_id,category,title,file_name,content_type,
           size_bytes,sha256,status,version,uploaded_by_actor,reviewed_by_employee,reviewer_label,reviewed_at)
         VALUES ($1,$2,$3,$4,'other','Synthetic probe document','probe.pdf','application/pdf',10,$5,'verified',2,$6,
           $7,'Synthetic Reviewer',now() - interval '10 minutes')`,
        [
          document,
          actor.tenantId,
          actor.entityId,
          actor.employeeId,
          randomBytes(32).toString("hex"),
          actor.actorId,
          other,
        ],
      );
    });
    const planted = (id: string) =>
      created.leave.includes(id) ||
      created.correction.includes(id) ||
      created.document.includes(id);

    await t.test("anonymous callers are refused", async () => {
      const response = await fetch("http://127.0.0.1:4487/api/v1/updates");
      assert.equal(response.status, 401);
    });

    await t.test(
      "an employee sees their own decisions, newest first",
      async () => {
        await changeRole("employee");
        const { items } = await feed();
        const mine = items.filter((i) => planted(i.id));
        assert.deepEqual(
          mine.map((i) => `${i.kind}:${i.outcome}`),
          [
            "document:verified",
            "attendance:declined",
            "leave:approved",
            "leave:declined",
          ],
        );
        const declined = mine.find(
          (i) => i.kind === "leave" && i.outcome === "declined",
        )!;
        assert.equal(declined.note, "Team is short that week");
        assert.equal(declined.decidedBy, "Synthetic Reviewer");
        assert.equal(declined.title, "Casual leave, 2 days");
        assert.equal(declined.from, "2031-03-03");
        assert.equal(declined.to, "2031-03-04");
        const times = items.map((i) => i.at);
        assert.deepEqual(times, [...times].sort().reverse());
      },
    );

    await t.test(
      "old, pending, cancelled and other people's requests never appear",
      async () => {
        await changeRole("employee");
        const { items } = await feed();
        for (const hidden of [2, 3, 4, 5])
          assert.ok(
            !items.some((i) => i.id === created.leave[hidden]),
            `leave[${hidden}]`,
          );
      },
    );

    await t.test(
      "a manager's wider visibility does not widen the feed",
      async () => {
        await changeRole("manager");
        const { items } = await feed();
        assert.ok(!items.some((i) => i.id === created.leave[5]));
      },
    );

    await t.test(
      "roles without personal requests get an empty feed",
      async () => {
        for (const role of ["auditor", "platform_admin"] as const) {
          await changeRole(role);
          assert.deepEqual((await feed()).items, [], role);
        }
      },
    );
  } finally {
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM leave_request WHERE id=ANY($1::uuid[])", [
        created.leave,
      ]);
      await client.query(
        "DELETE FROM attendance_correction WHERE id=ANY($1::uuid[])",
        [created.correction],
      );
      await client.query(
        "DELETE FROM employee_document WHERE id=ANY($1::uuid[])",
        [created.document],
      );
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
