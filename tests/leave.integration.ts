import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, transaction } from "../packages/database/src/index";
import type {
  LeaveApprovals,
  LeaveOverview,
  LeaveRequest,
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
  ) {
    throw new Error("Integration tests require the local Compose database");
  }
}

const tenant = "10000000-0000-4000-8000-000000000001";
const entity = "20000000-0000-4000-8000-000000000001";
const arjun = "30000000-0000-4000-8000-000000000002";
const rohan = "30000000-0000-4000-8000-000000000006";

// A Monday well ahead of today, in a week that stays inside one calendar year.
function week(offsetWeeks: number) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 60 + offsetWeeks * 7);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7));
  if (day.getUTCMonth() === 11 && day.getUTCDate() > 24)
    day.setUTCDate(day.getUTCDate() + 14);
  const plus = (n: number) => {
    const d = new Date(day);
    d.setUTCDate(day.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return {
    monday: plus(0),
    friday: plus(4),
    saturday: plus(5),
    sunday: plus(6),
  };
}

await test("Leave ledger and approval workflow", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4403" });
  const { app, store } = await createApp(config);
  await app.listen(4403, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const created: string[] = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4403/api/v1${path}`, {
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
  async function overview() {
    const response = await request("/leave");
    assert.equal(response.status, 200);
    return (await response.json()) as LeaveOverview;
  }
  async function approvals() {
    const response = await request("/leave/approvals");
    assert.equal(response.status, 200);
    return (await response.json()) as LeaveApprovals;
  }
  // Simulates another employee's session at the database boundary.
  async function asEmployee<T>(
    employeeId: string,
    scope: "self" | "team" | "entity",
    work: (client: PoolClient) => Promise<T>,
  ) {
    return transaction(admin, async (client) => {
      await client.query(
        `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
          set_config('app.employee_id',$3,true), set_config('app.leave_scope',$4,true),
          set_config('app.actor_id',$5,true), set_config('app.actor_label','Synthetic actor',true)`,
        [tenant, entity, employeeId, scope, randomUUID()],
      );
      return work(client);
    });
  }
  const types = new Map<string, string>();
  let mine: LeaveRequest | undefined;
  let reportRequest = "";
  try {
    await changeRole("employee");
    const start = await overview();
    for (const b of start.balances) types.set(b.code, b.id);
    const w1 = week(0);

    await t.test(
      "balances list every active type with derived availability",
      () => {
        assert.deepEqual(
          start.balances.map((b) => b.code),
          ["EL", "CL", "SL", "LOP"],
        );
        for (const b of start.balances) {
          if (b.annualDays === null) assert.equal(b.available, null);
          else assert.equal(b.available, b.annualDays - b.used - b.pending);
        }
      },
    );

    await t.test(
      "a request counts working days and routes to HR without a manager",
      async () => {
        const response = await post("/leave/requests", {
          leaveTypeId: types.get("LOP"),
          startDate: w1.monday,
          endDate: w1.sunday,
          reason: "Family visit",
        });
        assert.equal(response.status, 201);
        mine = (await response.json()) as LeaveRequest;
        created.push(mine.id);
        assert.equal(mine.days, 5);
        assert.equal(mine.state, "pending");
        assert.equal(mine.approver, "hr");
        assert.equal(mine.canCancel, true);
        assert.equal(mine.canDecide, false);
        // Balances describe the current leave year; next-year requests reserve next year.
        const after = await overview();
        const sameYear = Number(mine.startDate.slice(0, 4)) === start.year;
        assert.equal(
          after.balances.find((b) => b.code === "LOP")!.pending,
          start.balances.find((b) => b.code === "LOP")!.pending +
            (sameYear ? 5 : 0),
        );
      },
    );

    await t.test(
      "overlap, weekend-only, mass assignment and over-balance requests are rejected",
      async () => {
        const overlap = await post("/leave/requests", {
          leaveTypeId: types.get("LOP"),
          startDate: w1.friday,
          endDate: w1.friday,
          reason: "Overlap probe",
        });
        assert.equal(overlap.status, 409);
        const weekend = await post("/leave/requests", {
          leaveTypeId: types.get("LOP"),
          startDate: w1.saturday,
          endDate: w1.sunday,
          reason: "Weekend probe",
        });
        assert.equal(weekend.status, 400);
        const extra = await post("/leave/requests", {
          leaveTypeId: types.get("LOP"),
          startDate: week(1).monday,
          endDate: week(1).monday,
          reason: "Mass assignment probe",
          employeeId: arjun,
        });
        assert.equal(extra.status, 400);
        const tooLong = await post("/leave/requests", {
          leaveTypeId: types.get("LOP"),
          startDate: week(14).monday,
          endDate: week(19).friday,
          reason: "Span probe",
        });
        assert.equal(tooLong.status, 400);
        // Two fortnights of earned leave always exceed the 15-day entitlement.
        const first = await post("/leave/requests", {
          leaveTypeId: types.get("EL"),
          startDate: week(10).monday,
          endDate: week(11).friday,
          reason: "Balance probe",
        });
        assert.equal(first.status, 201);
        created.push(((await first.json()) as LeaveRequest).id);
        const second = await post("/leave/requests", {
          leaveTypeId: types.get("EL"),
          startDate: week(12).monday,
          endDate: week(13).friday,
          reason: "Balance probe",
        });
        assert.equal(second.status, 409);
        assert.match(
          ((await second.json()) as { title: string }).title,
          /Not enough leave balance/,
        );
      },
    );

    await t.test(
      "concurrent submissions for the same day commit once",
      async () => {
        const day = week(3).monday;
        const body = {
          leaveTypeId: types.get("LOP"),
          startDate: day,
          endDate: day,
          reason: "Concurrency probe",
        };
        const results = await Promise.all([
          post("/leave/requests", body),
          post("/leave/requests", body),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        for (const r of results)
          if (r.status === 201)
            created.push(((await r.json()) as LeaveRequest).id);
      },
    );

    await t.test("nobody decides their own leave, even as HR", async () => {
      await changeRole("hr_admin");
      const queue = await approvals();
      assert.ok(!queue.pending.some((r) => r.id === mine!.id));
      const own = await post(`/leave/requests/${mine!.id}/decision`, {
        version: mine!.version,
        decision: "approve",
        note: null,
      });
      assert.equal(own.status, 403);
      assert.equal((await request("/leave")).status, 403);
    });

    await t.test(
      "a direct report's request reaches the manager, not HR",
      async () => {
        const w = week(7);
        reportRequest = await asEmployee(arjun, "self", async (client) => {
          const id = randomUUID();
          await client.query(
            `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,reason,days,state,approver,version,requested_by_actor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'Conference travel',1,'pending','hr',1,$8)`,
            [
              id,
              tenant,
              entity,
              arjun,
              types.get("LOP"),
              w.monday,
              w.friday,
              randomUUID(),
            ],
          );
          return id;
        });
        created.push(reportRequest);
        const seenByHr = (await approvals()).pending.find(
          (r) => r.id === reportRequest,
        )!;
        assert.equal(seenByHr.approver, "manager");
        assert.equal(seenByHr.canDecide, false);
        const hrDecision = await post(
          `/leave/requests/${reportRequest}/decision`,
          { version: 1, decision: "approve", note: null },
        );
        assert.equal(hrDecision.status, 403);

        await changeRole("manager");
        const item = (await approvals()).pending.find(
          (r) => r.id === reportRequest,
        )!;
        assert.equal(item.canDecide, true);
        assert.equal(item.employeeName, "Arjun Mehta");
        const declineWithoutNote = await post(
          `/leave/requests/${reportRequest}/decision`,
          { version: 1, decision: "reject", note: null },
        );
        assert.equal(declineWithoutNote.status, 400);
        const results = await Promise.all([
          post(`/leave/requests/${reportRequest}/decision`, {
            version: 1,
            decision: "approve",
            note: null,
          }),
          post(`/leave/requests/${reportRequest}/decision`, {
            version: 1,
            decision: "approve",
            note: null,
          }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        const decided = (await results
          .find((r) => r.status === 201)!
          .json()) as LeaveRequest;
        assert.equal(decided.state, "approved");
        assert.equal(decided.decidedBy, "Maya Iyer");
      },
    );

    await t.test(
      "a former manager cannot decide after the reporting line changes",
      async () => {
        const w = week(8);
        const id = await asEmployee(arjun, "self", async (client) => {
          const requestId = randomUUID();
          await client.query(
            `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,reason,days,state,approver,version,requested_by_actor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'Reporting line probe',1,'pending','hr',1,$8)`,
            [
              requestId,
              tenant,
              entity,
              arjun,
              types.get("LOP"),
              w.monday,
              w.monday,
              randomUUID(),
            ],
          );
          return requestId;
        });
        created.push(id);
        await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
          arjun,
          rohan,
        ]);
        try {
          const stale = await post(`/leave/requests/${id}/decision`, {
            version: 1,
            decision: "approve",
            note: null,
          });
          // Directory scope hides the former report (404); the guard denies (403) otherwise.
          assert.ok([403, 404].includes(stale.status), String(stale.status));
          await assert.rejects(
            asEmployee(
              "30000000-0000-4000-8000-000000000001",
              "team",
              (client) =>
                client.query(
                  "UPDATE leave_request SET state='approved', version=version+1 WHERE id=$1",
                  [id],
                ),
            ),
            /routed to another approver/,
          );
          // With the reporting line changed, the request falls to HR.
          await asEmployee(rohan, "entity", (client) =>
            client.query(
              "UPDATE leave_request SET state='approved', version=version+1 WHERE id=$1",
              [id],
            ),
          );
          const row = await admin.query(
            "SELECT state FROM leave_request WHERE id=$1",
            [id],
          );
          assert.equal(row.rows[0].state, "approved");
          // The runtime role cannot rewrite protected columns directly either.
          await assert.rejects(
            transaction(store.pool, async (client) => {
              await client.query(
                `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
                  set_config('app.employee_id',$3,true), set_config('app.leave_scope','self',true)`,
                [tenant, entity, arjun],
              );
              await client.query(
                "UPDATE leave_request SET employee_id=$2 WHERE id=$1",
                [id, rohan],
              );
            }),
            /permission denied/,
          );
        } finally {
          await admin.query(
            "UPDATE employee SET manager_id='30000000-0000-4000-8000-000000000001' WHERE id=$1",
            [arjun],
          );
        }
      },
    );

    await t.test(
      "approval debits the ledger and cancelling future leave reverses it",
      async () => {
        const ledger = await admin.query(
          "SELECT kind, days::float8 AS days FROM leave_ledger WHERE request_id=$1",
          [reportRequest],
        );
        assert.deepEqual(ledger.rows, [{ kind: "debit", days: 5 }]);
        await asEmployee(arjun, "self", (client) =>
          client.query(
            "UPDATE leave_request SET state='cancelled', version=version+1 WHERE id=$1",
            [reportRequest],
          ),
        );
        const after = await admin.query(
          "SELECT kind FROM leave_ledger WHERE request_id=$1 ORDER BY created_at, kind",
          [reportRequest],
        );
        assert.deepEqual(
          after.rows.map((r: { kind: string }) => r.kind),
          ["debit", "reversal"],
        );
        await assert.rejects(
          admin.query("UPDATE leave_ledger SET days=1 WHERE request_id=$1", [
            reportRequest,
          ]),
          /append-only/,
        );
      },
    );

    await t.test(
      "an HR-routed request is decided by another HR person",
      async () => {
        await asEmployee(rohan, "entity", (client) =>
          client.query(
            "UPDATE leave_request SET state='rejected', version=version+1, decision_note='Overlaps payroll close' WHERE id=$1",
            [mine!.id],
          ),
        );
        const row = await admin.query(
          "SELECT state, decided_by_employee FROM leave_request WHERE id=$1",
          [mine!.id],
        );
        assert.equal(row.rows[0].state, "rejected");
        assert.equal(row.rows[0].decided_by_employee, rohan);
      },
    );

    await t.test(
      "requesters see only their own requests and cancel with versions",
      async () => {
        await changeRole("employee");
        const view = await overview();
        assert.ok(!view.requests.some((r) => r.id === reportRequest));
        const rejected = view.requests.find((r) => r.id === mine!.id)!;
        assert.equal(rejected.state, "rejected");
        assert.equal(rejected.canCancel, false);
        const final = await post(`/leave/requests/${mine!.id}/cancel`, {
          version: rejected.version,
        });
        assert.equal(final.status, 409);
        const pending = view.requests.find(
          (r) => r.state === "pending" && created.includes(r.id),
        )!;
        const stale = await post(`/leave/requests/${pending.id}/cancel`, {
          version: pending.version + 1,
        });
        assert.equal(stale.status, 409);
        const cancelled = await post(`/leave/requests/${pending.id}/cancel`, {
          version: pending.version,
        });
        assert.equal(cancelled.status, 201);
        assert.equal(
          ((await cancelled.json()) as LeaveRequest).state,
          "cancelled",
        );
      },
    );

    await t.test("transitions write audit and outbox records", async () => {
      const auditRows = await admin.query(
        "SELECT action FROM audit_event WHERE target LIKE $1 ORDER BY occurred_at",
        [`leave:${reportRequest}:%`],
      );
      assert.deepEqual(
        auditRows.rows.map((r: { action: string }) => r.action),
        ["leave.approved"],
      );
      const events = await admin.query(
        "SELECT event_type FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [created],
      );
      const kinds = new Set(
        events.rows.map((r: { event_type: string }) => r.event_type),
      );
      for (const kind of [
        "leave.requested.v1",
        "leave.approved.v1",
        "leave.cancelled.v1",
      ])
        assert.ok(kinds.has(kind), kind);
    });
  } finally {
    // Synthetic cleanup only: leave history is append-only for runtime roles.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM leave_ledger WHERE request_id=ANY($1::uuid[])",
        [created],
      );
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [created],
      );
      await client.query("DELETE FROM leave_request WHERE id=ANY($1::uuid[])", [
        created,
      ]);
    });
    await admin.end();
    await app.close();
  }
});
