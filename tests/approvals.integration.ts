import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, transaction } from "../packages/database/src/index";
import type { ApprovalInbox, Role } from "../packages/contracts/src/index";

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

const tenant = "10000000-0000-4000-8000-000000000001";
const entity = "20000000-0000-4000-8000-000000000001";
const maya = "30000000-0000-4000-8000-000000000001";
const arjun = "30000000-0000-4000-8000-000000000002";

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

await test("Shared approval routing and inbox", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4479" });
  const { app, store } = await createApp(config);
  await app.listen(4479, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const leaveIds: string[] = [];
  const correctionIds: string[] = [];
  const candidateIds: string[] = [];
  const reviewIds: string[] = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4479/api/v1${path}`, {
      ...init,
      headers: {
        Cookie: `anvi_dev_session=${token}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  const post = (path: string, body: unknown) =>
    request(path, { method: "POST", body: JSON.stringify(body) });
  async function changeRole(role: Role) {
    const response = await post("/session/role-context", { role });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  async function inbox() {
    const response = await request("/approvals");
    assert.equal(response.status, 200);
    return (await response.json()) as ApprovalInbox;
  }
  // Simulates Arjun's own session at the database boundary.
  async function asArjun<T>(work: (client: PoolClient) => Promise<T>) {
    return transaction(admin, async (client) => {
      await client.query(
        `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
          set_config('app.employee_id',$3,true), set_config('app.leave_scope','self',true),
          set_config('app.attendance_scope','self',true),
          set_config('app.actor_id',$4,true), set_config('app.actor_label','Arjun Mehta',true)`,
        [tenant, entity, arjun, randomUUID()],
      );
      return work(client);
    });
  }
  try {
    const today = (
      await admin.query<{ today: string }>(
        `SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') AS today`,
      )
    ).rows[0]!.today;
    // A far-future weekday keeps the probe clear of seeded leave.
    let leaveDay = shift(today, 200);
    while ([0, 6].includes(new Date(`${leaveDay}T00:00:00Z`).getUTCDay()))
      leaveDay = shift(leaveDay, 1);
    const lop = (
      await admin.query<{ id: string }>(
        "SELECT id FROM leave_type WHERE entity_id=$1 AND code='LOP'",
        [entity],
      )
    ).rows[0]!.id;
    const pendingDays = new Set(
      (
        await admin.query<{ d: string }>(
          "SELECT to_char(work_date,'YYYY-MM-DD') AS d FROM attendance_correction WHERE employee_id=$1 AND state='pending'",
          [arjun],
        )
      ).rows.map((r) => r.d),
    );
    let correctionDay = shift(today, -2);
    while (pendingDays.has(correctionDay))
      correctionDay = shift(correctionDay, -1);

    await t.test(
      "routing and decision rules live in shared functions",
      async () => {
        const route = await admin.query(
          "SELECT * FROM workflow_route($1,$2,$3) UNION ALL SELECT * FROM workflow_route($1,$2,$4)",
          [tenant, entity, maya, arjun],
        );
        assert.deepEqual(route.rows, [
          { approver: "hr", manager: null },
          { approver: "manager", manager: maya },
        ]);
        const verdict = (
          decider: string | null,
          approver: string,
          scope: string,
        ) =>
          admin
            .query<{ v: string | null }>(
              "SELECT workflow_decision_error($1,$2,$3,$4,$5,$6,$7) AS v",
              [tenant, entity, arjun, approver, maya, decider, scope],
            )
            .then((r) => r.rows[0]!.v);
        assert.equal(await verdict(arjun, "manager", "team"), "self");
        assert.equal(await verdict(maya, "manager", "team"), null);
        assert.equal(await verdict(maya, "manager", "entity"), "routed");
        assert.equal(await verdict(maya, "hr", "entity"), null);
        await assert.rejects(
          transaction(store.pool, (client) =>
            client.query("SELECT * FROM workflow_route($1,$2,$3)", [
              tenant,
              entity,
              arjun,
            ]),
          ),
          /permission denied/,
        );
      },
    );

    await t.test("only approvers open the inbox", async () => {
      await changeRole("employee");
      assert.equal((await request("/approvals")).status, 403);
    });

    await t.test(
      "a manager sees leave and corrections from reports in one list",
      async () => {
        await asArjun(async (client) => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,reason,days,state,approver,version,requested_by_actor)
             VALUES ($1,$2,$3,$4,$5,$6,$6,'Inbox probe',1,'pending','hr',1,$7)`,
            [id, tenant, entity, arjun, lop, leaveDay, randomUUID()],
          );
          leaveIds.push(id);
          const correction = randomUUID();
          await client.query(
            `INSERT INTO attendance_correction(id,tenant_id,entity_id,employee_id,work_date,check_in,check_out,reason,state,approver,version,requested_by_actor)
             VALUES ($1,$2,$3,$4,$5,'09:00','18:00','Inbox probe','pending','hr',1,$6)`,
            [correction, tenant, entity, arjun, correctionDay, randomUUID()],
          );
          correctionIds.push(correction);
        });
        await changeRole("manager");
        const view = await inbox();
        const leave = view.items.find((i) => i.id === leaveIds[0])!;
        const correction = view.items.find((i) => i.id === correctionIds[0])!;
        assert.equal(leave.kind, "leave");
        assert.equal(correction.kind, "attendance_correction");
        assert.equal(leave.canDecide && correction.canDecide, true);
        assert.equal(
          view.waiting,
          view.items.filter((i) => i.canDecide).length,
        );
        const firstOther = view.items.findIndex((i) => !i.canDecide);
        if (firstOther >= 0)
          assert.ok(view.items.slice(firstOther).every((i) => !i.canDecide));
        assert.ok(
          view.items.every(
            (i) => i.kind === "readiness_review" || i.employeeId !== maya,
          ),
        );
      },
    );

    await t.test(
      "readiness reviews reach HR, but never their own maker",
      async () => {
        await changeRole("hr_admin");
        const options = await (await request("/candidates/options")).json();
        const cases: string[] = [];
        for (const name of ["Inbox Maker Case", "Inbox Checker Case"]) {
          const created = await post("/candidates", {
            name,
            email: `inbox-${randomUUID()}@anvi.example`,
            title: "Synthetic analyst",
            joinedOn: shift(today, 60),
            departmentId: options.departments[0].id,
            locationId: options.locations[0].id,
            managerId: options.managers[0].id,
          });
          assert.equal(created.status, 201);
          cases.push(((await created.json()) as { id: string }).id);
        }
        candidateIds.push(...cases);
        // One proposal by Maya (the maker), one by another HR identity.
        for (const [caseId, maker] of [
          [cases[0]!, actor.actorId],
          [cases[1]!, randomUUID()],
        ] as const) {
          const reviewId = randomUUID();
          await transaction(admin, async (client) => {
            await client.query(
              "SELECT set_config('app.actor_id',$1,true), set_config('app.actor_label','Synthetic HR',true)",
              [maker],
            );
            await client.query(
              `INSERT INTO candidate_local_review(id,candidate_id,proposed_by,proposer_label,proposal_note)
               VALUES ($1,$2,$3,'Synthetic HR','Synthetic readiness proposal for inbox')`,
              [reviewId, caseId, maker],
            );
          });
          reviewIds.push(reviewId);
        }
        const view = await inbox();
        const own = view.items.find((i) => i.id === reviewIds[0])!;
        const other = view.items.find((i) => i.id === reviewIds[1])!;
        assert.equal(own.kind, "readiness_review");
        assert.equal(own.canDecide, false);
        assert.equal(other.canDecide, true);
        if (other.kind === "readiness_review") {
          assert.equal(other.evidenceReady, false);
          assert.equal(other.candidateName, "Inbox Checker Case");
        }
        await changeRole("manager");
        assert.ok(
          !(await inbox()).items.some((i) => i.kind === "readiness_review"),
        );
      },
    );

    await t.test(
      "HR sees manager-routed work but cannot decide it; decisions clear the inbox",
      async () => {
        await changeRole("hr_admin");
        const hr = await inbox();
        assert.equal(
          hr.items.find((i) => i.id === leaveIds[0])!.canDecide,
          false,
        );
        // Once the reporting line moves, the same item becomes HR's to decide.
        await admin.query("UPDATE employee SET manager_id=NULL WHERE id=$1", [
          arjun,
        ]);
        try {
          const moved = await inbox();
          const item = moved.items.find((i) => i.id === leaveIds[0])!;
          assert.equal(item.canDecide, true);
          assert.ok(moved.waiting >= 1);
        } finally {
          await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
            arjun,
            maya,
          ]);
        }
        await changeRole("manager");
        const before = await inbox();
        const approve = await post(
          `/attendance/corrections/${correctionIds[0]}/decision`,
          { version: 1, decision: "approve", note: null },
        );
        assert.equal(approve.status, 201);
        const after = await inbox();
        assert.equal(after.waiting, before.waiting - 1);
        assert.ok(!after.items.some((i) => i.id === correctionIds[0]));
      },
    );
  } finally {
    // Synthetic cleanup only: workflow history is append-only at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM candidate_local_review WHERE id=ANY($1::uuid[])",
        [reviewIds],
      );
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [candidateIds],
      );
      await client.query(
        "DELETE FROM candidate_case WHERE id=ANY($1::uuid[])",
        [candidateIds],
      );
      await client.query(
        "DELETE FROM attendance_record WHERE correction_id=ANY($1::uuid[])",
        [correctionIds],
      );
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...leaveIds, ...correctionIds]],
      );
      await client.query(
        "DELETE FROM attendance_correction WHERE id=ANY($1::uuid[])",
        [correctionIds],
      );
      await client.query("DELETE FROM leave_request WHERE id=ANY($1::uuid[])", [
        leaveIds,
      ]);
    });
    await admin.end();
    await app.close();
  }
});
