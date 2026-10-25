import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, transaction } from "../packages/database/src/index";
import type {
  AttendanceCorrection,
  AttendanceOverview,
  AttendanceRecord,
  AttendanceTeam,
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
const maya = "30000000-0000-4000-8000-000000000001";
const arjun = "30000000-0000-4000-8000-000000000002";
const rohan = "30000000-0000-4000-8000-000000000006";

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// The n-th weekday before today, so corrections land on working days.
function pastWeekday(today: string, n: number) {
  let day = today;
  let found = 0;
  while (found < n) {
    day = shift(day, -1);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() % 6 !== 0) found += 1;
  }
  return day;
}

await test("Attendance punches and correction workflow", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4404" });
  const { app, store } = await createApp(config);
  await app.listen(4404, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const corrections: string[] = [];
  const records: string[] = [];
  const touched: Array<[string, string]> = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4404/api/v1${path}`, {
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
    const response = await request("/attendance");
    assert.equal(response.status, 200);
    return (await response.json()) as AttendanceOverview;
  }
  async function team() {
    const response = await request("/attendance/team");
    assert.equal(response.status, 200);
    return (await response.json()) as AttendanceTeam;
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
          set_config('app.employee_id',$3,true), set_config('app.attendance_scope',$4,true),
          set_config('app.actor_id',$5,true), set_config('app.actor_label','Synthetic actor',true)`,
        [tenant, entity, employeeId, scope, randomUUID()],
      );
      return work(client);
    });
  }
  // The n-th past weekday without a pending correction, so seeded requests never collide.
  async function freeDay(employee: string, n: number, today: string) {
    const { rows } = await admin.query<{ day: string }>(
      "SELECT to_char(work_date,'YYYY-MM-DD') AS day FROM attendance_correction WHERE employee_id=$1 AND state='pending'",
      [employee],
    );
    const busy = new Set(rows.map((r) => r.day));
    let found = 0;
    for (let k = 1; k <= 29; k += 1) {
      const day = pastWeekday(today, k);
      if (busy.has(day)) continue;
      found += 1;
      if (found === n) return day;
    }
    throw new Error("No free correction day in the window");
  }
  async function reportCorrection(workDate: string) {
    const id = await asEmployee(arjun, "self", async (client) => {
      const correctionId = randomUUID();
      await client.query(
        `INSERT INTO attendance_correction(id,tenant_id,entity_id,employee_id,work_date,check_in,check_out,reason,state,approver,version,requested_by_actor)
         VALUES ($1,$2,$3,$4,$5,'09:30','18:00','Badge reader was down','pending','hr',1,$6)`,
        [correctionId, tenant, entity, arjun, workDate, randomUUID()],
      );
      return correctionId;
    });
    corrections.push(id);
    touched.push([arjun, workDate]);
    return id;
  }
  // Seeded history on days the test touches is restored afterwards.
  const snapshot = (
    await admin.query(
      "SELECT * FROM attendance_record WHERE employee_id = ANY($1::uuid[])",
      [[maya, arjun]],
    )
  ).rows as Array<
    Record<string, unknown> & { id: string; employee_id: string }
  >;
  const dayOf = (value: unknown) =>
    value instanceof Date
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
      : String(value);
  // Synthetic cleanup only: attendance history is append-only for runtime roles.
  async function cleanup() {
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [employee, day] of touched) {
        const gone = await client.query<{ id: string }>(
          "DELETE FROM attendance_record WHERE employee_id=$1 AND work_date=$2 RETURNING id",
          [employee, day],
        );
        records.push(...gone.rows.map((r) => r.id));
        for (const row of snapshot.filter(
          (r) => r.employee_id === employee && dayOf(r.work_date) === day,
        )) {
          const columns = Object.keys(row);
          await client.query(
            `INSERT INTO attendance_record(${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
            columns.map((c) => row[c]),
          );
        }
      }
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...records, ...corrections]],
      );
      await client.query(
        "DELETE FROM attendance_correction WHERE id=ANY($1::uuid[])",
        [corrections],
      );
    });
  }
  try {
    await changeRole("employee");
    const today = (await overview()).today;
    // Today's punches belong to this run; earlier runs' check-ins are not restored.
    snapshot.splice(
      0,
      snapshot.length,
      ...snapshot.filter((r) => dayOf(r.work_date) !== today),
    );
    touched.push([maya, today]);
    await cleanup();

    await t.test("the 30-day view derives a status for every day", async () => {
      const view = await overview();
      assert.equal(view.days.length, 30);
      assert.equal(view.days[0]!.date, today);
      assert.equal(view.record, null);
      for (const day of view.days) {
        const dow = new Date(`${day.date}T00:00:00Z`).getUTCDay();
        if (!day.checkIn && !day.leaveType && dow % 6 === 0)
          assert.equal(day.status, "weekend");
      }
      assert.ok(
        ["not_started", "weekend", "leave"].includes(view.days[0]!.status),
      );
    });

    let record!: AttendanceRecord;
    await t.test(
      "check-in is self-only, server-stamped and once per day",
      async () => {
        const spoofed = await post("/attendance/check-in", {
          checkIn: "07:00",
        });
        assert.equal(spoofed.status, 400);
        const response = await post("/attendance/check-in", {});
        assert.equal(response.status, 201);
        record = (await response.json()) as AttendanceRecord;
        records.push(record.id);
        assert.equal(record.workDate, today);
        assert.equal(record.checkOut, null);
        assert.match(record.checkIn, /^\d{2}:\d{2}$/);
        const again = await post("/attendance/check-in", {});
        assert.equal(again.status, 409);
      },
    );

    await t.test(
      "check-out stamps a later time once, with versions",
      async () => {
        // Backdate check-in so check-out lands at a strictly later minute.
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "UPDATE attendance_record SET check_in='00:00' WHERE id=$1",
            [record.id],
          );
        });
        const stale = await post("/attendance/check-out", {
          version: record.version + 1,
        });
        assert.equal(stale.status, 409);
        const response = await post("/attendance/check-out", {
          version: record.version,
        });
        assert.equal(response.status, 201);
        const done = (await response.json()) as AttendanceRecord;
        assert.ok(done.checkOut && done.checkOut > "00:00");
        const twice = await post("/attendance/check-out", {
          version: done.version,
        });
        assert.equal(twice.status, 409);
        const view = await overview();
        assert.equal(view.days[0]!.status, "present");
        assert.ok(view.days[0]!.minutes! > 0);
      },
    );

    let mine!: AttendanceCorrection;
    await t.test(
      "corrections cover only the previous 30 days, once per day, and route to HR without a manager",
      async () => {
        const day = await freeDay(maya, 2, today);
        for (const workDate of [today, shift(today, -40)]) {
          const bad = await post("/attendance/corrections", {
            workDate,
            checkIn: "09:00",
            checkOut: "17:00",
            reason: "Forgot to punch",
          });
          assert.equal(bad.status, 400);
        }
        const unordered = await post("/attendance/corrections", {
          workDate: day,
          checkIn: "17:00",
          checkOut: "09:00",
          reason: "Forgot to punch",
        });
        assert.equal(unordered.status, 400);
        const response = await post("/attendance/corrections", {
          workDate: day,
          checkIn: "09:00",
          checkOut: "17:30",
          reason: "Forgot to punch",
        });
        assert.equal(response.status, 201);
        mine = (await response.json()) as AttendanceCorrection;
        corrections.push(mine.id);
        assert.equal(mine.approver, "hr");
        assert.equal(mine.canCancel, true);
        const duplicate = await post("/attendance/corrections", {
          workDate: day,
          checkIn: "09:15",
          checkOut: "17:30",
          reason: "Second attempt",
        });
        assert.equal(duplicate.status, 409);
        const view = await overview();
        assert.equal(
          view.days.find((d) => d.date === day)!.correctionPending,
          true,
        );
      },
    );

    await t.test("nobody decides their own correction", async () => {
      await changeRole("hr_admin");
      assert.ok(!(await team()).pending.some((c) => c.id === mine.id));
      const own = await post(`/attendance/corrections/${mine.id}/decision`, {
        version: 1,
        decision: "approve",
        note: null,
      });
      assert.equal(own.status, 403);
      assert.equal((await request("/attendance")).status, 403);
    });

    let approved = "";
    await t.test(
      "a direct report's correction is decided once by the manager and rewrites that day",
      async () => {
        const day = await freeDay(arjun, 3, today);
        approved = await reportCorrection(day);
        const seenByHr = (await team()).pending.find((c) => c.id === approved)!;
        assert.equal(seenByHr.canDecide, false);
        const hrDecision = await post(
          `/attendance/corrections/${approved}/decision`,
          { version: 1, decision: "approve", note: null },
        );
        assert.equal(hrDecision.status, 403);
        await changeRole("manager");
        const board = await team();
        assert.ok(board.people.some((p) => p.employeeId === arjun));
        assert.ok(!board.people.some((p) => p.employeeId === maya));
        assert.equal(
          board.pending.find((c) => c.id === approved)!.canDecide,
          true,
        );
        const noNote = await post(
          `/attendance/corrections/${approved}/decision`,
          { version: 1, decision: "reject", note: null },
        );
        assert.equal(noNote.status, 400);
        const results = await Promise.all(
          [1, 2].map(() =>
            post(`/attendance/corrections/${approved}/decision`, {
              version: 1,
              decision: "approve",
              note: null,
            }),
          ),
        );
        assert.deepEqual(
          results.map((r) => r.status).sort((a, b) => a - b),
          [201, 409],
        );
        const applied = await admin.query(
          `SELECT to_char(check_in,'HH24:MI') AS i, to_char(check_out,'HH24:MI') AS o,
            source, correction_id FROM attendance_record WHERE employee_id=$1 AND work_date=$2`,
          [arjun, day],
        );
        assert.deepEqual(applied.rows, [
          {
            i: "09:30",
            o: "18:00",
            source: "correction",
            correction_id: approved,
          },
        ]);
      },
    );

    await t.test(
      "the correction path cannot be spoofed and past days stay closed",
      async () => {
        await assert.rejects(
          transaction(store.pool, async (client) => {
            await client.query(
              `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
                set_config('app.employee_id',$3,true), set_config('app.attendance_scope','self',true),
                set_config('attendance.applying',$4,true)`,
              [tenant, entity, arjun, approved],
            );
            await client.query(
              `INSERT INTO attendance_record(id,tenant_id,entity_id,employee_id,work_date,check_in,check_out,source,correction_id,version)
               VALUES ($1,$2,$3,$4,$5,'06:00','23:00','correction',$6,1)`,
              [randomUUID(), tenant, entity, arjun, shift(today, -1), approved],
            );
          }),
          /permission denied/,
        );
        await assert.rejects(
          asEmployee(arjun, "self", (client) =>
            client.query(
              "UPDATE attendance_record SET check_in='06:00', version=version+1 WHERE employee_id=$1 AND work_date=$2",
              [arjun, touched.at(-1)![1]],
            ),
          ),
          /only by checking out/,
        );
      },
    );

    await t.test(
      "a former manager cannot decide after the reporting line changes, and HR can",
      async () => {
        const id = await reportCorrection(await freeDay(arjun, 4, today));
        await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
          arjun,
          rohan,
        ]);
        try {
          const response = await post(
            `/attendance/corrections/${id}/decision`,
            { version: 1, decision: "approve", note: null },
          );
          assert.ok([403, 404].includes(response.status));
          await assert.rejects(
            asEmployee(maya, "team", (client) =>
              client.query(
                "UPDATE attendance_correction SET state='approved', version=version+1 WHERE id=$1",
                [id],
              ),
            ),
            /routed to another approver/,
          );
          // The request now falls to HR rather than staying stuck.
          await asEmployee(rohan, "entity", (client) =>
            client.query(
              "UPDATE attendance_correction SET state='approved', version=version+1 WHERE id=$1",
              [id],
            ),
          );
          const state = await admin.query(
            "SELECT state FROM attendance_correction WHERE id=$1",
            [id],
          );
          assert.equal(state.rows[0].state, "approved");
        } finally {
          await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
            arjun,
            maya,
          ]);
        }
      },
    );

    await t.test(
      "requesters see only their own corrections and can cancel pending ones",
      async () => {
        await changeRole("employee");
        const view = await overview();
        assert.ok(view.corrections.every((c) => c.employeeId === maya));
        const stale = await post(`/attendance/corrections/${mine.id}/cancel`, {
          version: 2,
        });
        assert.equal(stale.status, 409);
        const cancelled = await post(
          `/attendance/corrections/${mine.id}/cancel`,
          { version: 1 },
        );
        assert.equal(cancelled.status, 201);
        assert.equal(
          ((await cancelled.json()) as AttendanceCorrection).state,
          "cancelled",
        );
        const again = await post(`/attendance/corrections/${mine.id}/cancel`, {
          version: 2,
        });
        assert.equal(again.status, 409);
      },
    );

    await t.test("punches and decisions write audit and outbox", async () => {
      const auditRows = await admin.query(
        "SELECT action FROM audit_event WHERE target LIKE $1 OR target LIKE $2",
        [`attendance:${record.id}:%`, `attendance-correction:${mine.id}:%`],
      );
      const actions = new Set(
        auditRows.rows.map((r: { action: string }) => r.action),
      );
      for (const action of [
        "attendance.checked_in",
        "attendance.checked_out",
        "attendance.correction_requested",
        "attendance.correction_cancelled",
      ])
        assert.ok(actions.has(action), action);
      const events = await admin.query(
        "SELECT event_type FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[record.id, ...corrections]],
      );
      const kinds = new Set(
        events.rows.map((r: { event_type: string }) => r.event_type),
      );
      for (const kind of [
        "attendance.checked_in.v1",
        "attendance.correction_approved.v1",
      ])
        assert.ok(kinds.has(kind), kind);
    });
  } finally {
    await cleanup();
    await admin.end();
    await app.close();
  }
});
