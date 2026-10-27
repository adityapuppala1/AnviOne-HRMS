import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, transaction } from "../packages/database/src/index";
import type {
  AttendanceOverview,
  Calendar,
  Holiday,
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

const reason = "Synthetic calendar acceptance check";
function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// A Monday roughly `ahead` days out whose week stays inside one calendar year.
function monday(today: string, ahead: number) {
  let day = shift(today, ahead);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = shift(day, 1);
  while (day.slice(0, 4) !== shift(day, 6).slice(0, 4)) day = shift(day, 14);
  return day;
}

await test("Holiday and work-week calendar", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4472" });
  const { app, store } = await createApp(config);
  await app.listen(4472, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const holidays: string[] = [];
  const requests: string[] = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4472/api/v1${path}`, {
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
  async function calendar(year?: number) {
    const response = await request(`/calendar${year ? `?year=${year}` : ""}`);
    assert.equal(response.status, 200);
    return (await response.json()) as Calendar;
  }
  async function addHoliday(
    date: string,
    name: string,
    locationId: string | null,
  ): Promise<Holiday | number> {
    const response = await send("/calendar/holidays", "POST", {
      date,
      name,
      locationId,
      reason,
    });
    if (response.status !== 201) return response.status;
    const item = (await response.json()) as Holiday;
    holidays.push(item.id);
    return item;
  }
  async function requestLeave(start: string, end: string) {
    const overview = (await (await request("/leave")).json()) as LeaveOverview;
    const lop = overview.balances.find((b) => b.code === "LOP")!;
    const response = await send("/leave/requests", "POST", {
      leaveTypeId: lop.id,
      startDate: start,
      endDate: end,
      reason: "Calendar probe",
    });
    assert.equal(response.status, 201);
    const item = (await response.json()) as LeaveRequest;
    requests.push(item.id);
    return item;
  }
  const original = (
    await admin.query<{ days: number[] }>(
      "SELECT days FROM work_week WHERE entity_id=$1",
      [actor.entityId],
    )
  ).rows[0]!.days;
  try {
    await changeRole("employee");
    const view = await calendar();
    const today = view.today;
    const week = monday(today, 120);
    const [tue, wed, thu, fri] = [1, 2, 3, 4].map((n) => shift(week, n));
    const hyderabad = view.locations.find((l) => l.name === "Hyderabad")!;
    const bengaluru = view.locations.find((l) => l.name === "Bengaluru")!;

    await t.test("everyone reads the calendar; only HR writes", async () => {
      assert.equal(view.canManage, false);
      assert.ok(view.holidays.every((h) => h.active));
      assert.ok(view.workWeek.days.length >= 1);
      if (view.next) assert.ok(view.next.date >= today);
      assert.equal(await addHoliday(tue!, "Probe", null), 403);
      const blocked = await send("/calendar/work-week", "PUT", {
        days: [1, 2, 3, 4, 5],
        version: view.workWeek.version,
        reason,
      });
      assert.equal(blocked.status, 403);
    });

    await t.test(
      "HR adds holidays per scope, once per date, with versioned edits",
      async () => {
        await changeRole("hr_admin");
        const entityWide = (await addHoliday(
          tue!,
          "Founders Day",
          null,
        )) as Holiday;
        assert.equal(entityWide.locationName, null);
        assert.equal(await addHoliday(tue!, "Duplicate", null), 409);
        const local = (await addHoliday(
          tue!,
          "Local festival",
          bengaluru.id,
        )) as Holiday;
        assert.equal(local.locationName, "Bengaluru");
        assert.equal(await addHoliday(wed!, "Nowhere", randomUUID()), 400);
        await addHoliday(thu!, "Bengaluru only", bengaluru.id);
        await addHoliday(fri!, "Hyderabad only", hyderabad.id);
        const renamed = await send(
          `/calendar/holidays/${entityWide.id}`,
          "PUT",
          { name: "Foundation Day", active: true, version: 1, reason },
        );
        assert.equal(renamed.status, 200);
        assert.equal(((await renamed.json()) as Holiday).version, 2);
        const stale = await send(`/calendar/holidays/${entityWide.id}`, "PUT", {
          name: "Stale",
          active: true,
          version: 1,
          reason,
        });
        assert.equal(stale.status, 409);
        await assert.rejects(
          admin.query(
            "UPDATE holiday SET holiday_date=holiday_date+1, version=version+1 WHERE id=$1",
            [entityWide.id],
          ),
          /keeps its date and location/,
        );
        assert.equal((await calendar()).canManage, true);
      },
    );

    await t.test(
      "leave counts business days for the requester's own office",
      async () => {
        await changeRole("employee");
        // Maya works in Hyderabad: Tuesday (everyone) and Friday (Hyderabad) are
        // off; Thursday is a Bengaluru-only holiday and still counts.
        const item = await requestLeave(week, shift(week, 6));
        assert.equal(item.days, 3);
        const own = (await (await request("/leave")).json()) as LeaveOverview;
        const dates = new Set(own.calendar.holidays.map((h) => h.date));
        assert.ok(dates.has(tue!) && dates.has(fri!) && !dates.has(thu!));
      },
    );

    await t.test(
      "a work-week change applies to new requests only",
      async () => {
        await changeRole("hr_admin");
        const current = await calendar();
        const bad = await send("/calendar/work-week", "PUT", {
          days: [1, 1, 2],
          version: current.workWeek.version,
          reason,
        });
        assert.equal(bad.status, 400);
        const changed = await send("/calendar/work-week", "PUT", {
          days: [4, 1, 2, 3],
          version: current.workWeek.version,
          reason,
        });
        assert.equal(changed.status, 200);
        assert.deepEqual(
          ((await changed.json()) as { days: number[] }).days,
          [1, 2, 3, 4],
        );
        await changeRole("employee");
        const view = (await (await request("/leave")).json()) as LeaveOverview;
        // Seeded holidays move the count, so use the first far-off week without one.
        const holidays = new Set(view.calendar.holidays.map((h) => h.date));
        let next = monday(today, 140);
        while (
          Array.from({ length: 7 }, (_, i) => shift(next, i)).some((d) =>
            holidays.has(d),
          )
        )
          next = shift(next, 7);
        const item = await requestLeave(next, shift(next, 6));
        assert.equal(item.days, 4);
        const earlier = view.requests.find((r) => r.id === requests[0]);
        if (earlier) assert.equal(earlier.days, 3);
      },
    );

    await t.test(
      "attendance shows an unrecorded holiday as a holiday",
      async () => {
        const attendance = (await (
          await request("/attendance")
        ).json()) as AttendanceOverview;
        const gap = attendance.days.find((d) => d.status === "unaccounted");
        if (!gap) return;
        await changeRole("hr_admin");
        await addHoliday(gap.date, "Office closure", null);
        await changeRole("employee");
        const after = (await (
          await request("/attendance")
        ).json()) as AttendanceOverview;
        const day = after.days.find((d) => d.date === gap.date)!;
        assert.equal(day.status, "holiday");
        assert.equal(day.holiday, "Office closure");
      },
    );

    await t.test(
      "new entities start with a work week and leave types; inactive offices are refused",
      async () => {
        const client = await admin.connect();
        try {
          await client.query("BEGIN");
          const entity = randomUUID();
          await client.query(
            "INSERT INTO legal_entity(id,tenant_id,name) VALUES ($1,$2,'Rollback entity')",
            [entity, actor.tenantId],
          );
          const week = await client.query(
            "SELECT days FROM work_week WHERE entity_id=$1",
            [entity],
          );
          assert.deepEqual(week.rows[0]?.days, [1, 2, 3, 4, 5]);
          const types = await client.query(
            "SELECT code FROM leave_type WHERE entity_id=$1 ORDER BY code",
            [entity],
          );
          assert.deepEqual(
            types.rows.map((r: { code: string }) => r.code),
            ["CL", "EL", "LOP", "SL"],
          );
          const office = randomUUID();
          await client.query(
            "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name,active) VALUES ($1,$2,$3,'location','LOC-CLOSED','Closed office',false)",
            [office, actor.tenantId, entity],
          );
          await assert.rejects(
            client.query(
              "INSERT INTO holiday(id,tenant_id,entity_id,location_id,holiday_date,name) VALUES ($1,$2,$3,$4,'2027-05-03','Closed')",
              [randomUUID(), actor.tenantId, entity, office],
            ),
            /active work location/,
          );
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      },
    );

    await t.test("calendar changes write audit records", async () => {
      const auditRows = await admin.query(
        "SELECT action FROM audit_event WHERE target LIKE ANY($1::text[])",
        [
          [
            ...holidays.map((id) => `holiday:${id}:%`),
            `work-week:${actor.entityId}:%`,
          ],
        ],
      );
      const actions = new Set(
        auditRows.rows.map((r: { action: string }) => r.action),
      );
      for (const action of [
        "calendar.holiday_created",
        "calendar.holiday_updated",
        "calendar.work_week_updated",
      ])
        assert.ok(actions.has(action), action);
    });
  } finally {
    // Synthetic cleanup only: holidays and leave history are append-only at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "UPDATE work_week SET days=$2::smallint[] WHERE entity_id=$1",
        [actor.entityId, original],
      );
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...holidays, ...requests]],
      );
      await client.query("DELETE FROM holiday WHERE id=ANY($1::uuid[])", [
        holidays,
      ]);
      await client.query(
        "DELETE FROM leave_ledger WHERE request_id=ANY($1::uuid[])",
        [requests],
      );
      await client.query("DELETE FROM leave_request WHERE id=ANY($1::uuid[])", [
        requests,
      ]);
    });
    await admin.end();
    await app.close();
  }
});
