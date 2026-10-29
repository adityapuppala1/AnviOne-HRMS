import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { ShiftStore } from "../apps/api/src/shift.store";
import {
  makePool,
  scoped,
  transaction,
  type PoolClient,
} from "../packages/database/src/index";
import type {
  Role,
  ShfRoster,
  ShfTemplate,
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

const PORT = Number(process.env.SHIFT_TEST_PORT ?? 4525);
// Synthetic demo people: Maya (HR) manages Arjun, Zara and Neel; Neel manages Rohan, Meera,
// Ishaan, Kabir and others. Kabir also stands in as a second HR user.
const arjun = "30000000-0000-4000-8000-000000000002";
const neel = "30000000-0000-4000-8000-000000000004";
const rohan = "30000000-0000-4000-8000-000000000006";
const meera = "30000000-0000-4000-8000-000000000007";
const ishaan = "30000000-0000-4000-8000-000000000008";
const kabir = "30000000-0000-4000-8000-000000000012";
const status = async (work: Promise<unknown>) => {
  try {
    await work;
    return 200;
  } catch (error) {
    const code = (error as { getStatus?: () => number }).getStatus?.();
    if (code === undefined) throw error;
    return code;
  }
};
const sqlState = async (work: Promise<unknown>) => {
  try {
    await work;
    return "ok";
  } catch (error) {
    return String((error as { code?: string }).code);
  }
};
const DAY = 24 * 3600 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

await test("Shifts: templates, rosters, conflicts, publishing, swaps and open shifts", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const pool = makePool(process.env.DATABASE_URL!);
  const shf = new ShiftStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${PORT}/api/v1${path}`, {
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
  const as = (employeeId: string, name: string, role: Role) => ({
    ...actor,
    employeeId,
    role,
    name,
  });
  const maya = actor.employeeId;
  const hrMaya = as(maya, "Maya (synthetic HR)", "hr_admin");
  const hrKabir = as(kabir, "Kabir (synthetic HR)", "hr_admin");
  const arjunE = as(arjun, "Arjun (synthetic)", "employee");
  const neelM = as(neel, "Neel (synthetic manager)", "manager");
  const rohanE = as(rohan, "Rohan (synthetic)", "employee");
  const rohanHR = as(rohan, "Rohan (as HR)", "hr_admin");
  const meeraE = as(meera, "Meera (synthetic)", "employee");
  const ishaanE = as(ishaan, "Ishaan (synthetic)", "employee");
  const ishaanHR = as(ishaan, "Ishaan (as HR)", "hr_admin");
  const auditor = as(maya, "Maya (auditor)", "auditor");
  // Markers that must never reach audit or outbox rows.
  const secret = `secret-${run}`;
  const ids = {
    templates: [] as string[],
    weeks: [] as string[],
    leave: [] as string[],
  };
  const page = { page: 1, limit: 100 } as const;
  // A Monday 20 to 40 weeks ahead, so runs do not collide and dates stay within a year.
  const now = Date.now();
  const nextMonday = now + ((8 - (new Date(now).getUTCDay() || 7)) % 7) * DAY;
  const W = nextMonday + (20 + Math.floor(Math.random() * 20)) * 7 * DAY;
  const d = (n: number) => iso(W + n * DAY);
  const priorSetting = (
    await admin.query<{ h: number }>(
      "SELECT min_rest_hours AS h FROM shf_setting WHERE tenant_id=$1 AND entity_id=$2",
      [actor.tenantId, actor.entityId],
    )
  ).rows[0];

  const newTemplate = async (
    code: string,
    startTime: string,
    endTime: string,
  ) => {
    const tpl = await shf.createTemplate(
      hrMaya,
      {
        code: `${code}${run}`.slice(0, 12),
        name: `${code} ${secret}`,
        startTime,
        endTime,
        breakMinutes: 30,
        colour: "teal",
      },
      randomUUID(),
    );
    ids.templates.push(tpl.id);
    return tpl;
  };
  const assign = (
    who: typeof hrMaya,
    employeeId: string,
    templateId: string,
    from: string,
    extra: { to?: string; weekdays?: number[]; reason?: string } = {},
  ) =>
    shf.assign(who, { employeeId, templateId, from, ...extra }, randomUUID());
  const rosterOf = (who: typeof hrMaya, view: "mine" | "team" | "all") =>
    shf.roster(who, { ...page, view, from: d(0), to: d(13), status: "active" });
  const alwaysOff = async (client: PoolClient) => {
    const { rows } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE 'shf\\_%'`,
    );
    for (const row of rows)
      await client.query(`ALTER TABLE ${row.t} DISABLE TRIGGER ${row.name}`);
    return async () => {
      for (const row of rows)
        await client.query(
          `ALTER TABLE ${row.t} ENABLE ALWAYS TRIGGER ${row.name}`,
        );
    };
  };

  let day: ShfTemplate;
  let night: ShfTemplate;
  let early: ShfTemplate;
  let rohanDays: string[] = [];
  let meeraTue = "";
  try {
    await t.test("access follows the shift permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/shifts/roster",
          "/shifts/templates",
          "/shifts/swaps",
          "/shifts/open",
          "/shifts/hours",
          "/shifts/settings",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      for (const role of ["employee", "manager", "hr_admin"] as const) {
        await changeRole(role);
        assert.equal((await request("/shifts/roster")).status, 200, role);
        assert.equal(
          (await request("/shifts/roster?view=team")).status,
          role === "manager" ? 200 : 403,
          role,
        );
        assert.equal(
          (await request("/shifts/roster?view=all")).status,
          role === "hr_admin" ? 200 : 403,
          role,
        );
        assert.equal(
          (await request("/shifts/swaps?view=approvals")).status,
          role === "employee" ? 403 : 200,
          role,
        );
        const created = await send("/shifts/templates", "POST", {
          code: `H${role.slice(0, 1).toUpperCase()}${run}`,
          name: `Http ${secret}`,
          startTime: "10:00",
          endTime: "18:00",
          breakMinutes: 30,
          colour: "sky",
        });
        assert.equal(created.status, role === "hr_admin" ? 201 : 403, role);
        if (created.status === 201)
          ids.templates.push(((await created.json()) as ShfTemplate).id);
      }
      assert.equal(
        (await send("/shifts/weeks/2026-01-06/publish", "POST", {})).status,
        400,
        "not a Monday",
      );
      assert.equal(await status(shf.settings(auditor)), 403);
    });

    await t.test(
      "templates: codes, overnight shifts, breaks and versions",
      async () => {
        day = await newTemplate("D", "09:00", "17:00");
        night = await newTemplate("N", "22:00", "06:00");
        early = await newTemplate("E", "06:00", "14:00");
        assert.equal(day.crossesMidnight, false);
        assert.equal(night.crossesMidnight, true);
        assert.equal(night.paidMinutes, 450);
        assert.equal(await status(newTemplate("D", "09:00", "17:00")), 409);
        assert.equal(
          await status(
            shf.createTemplate(
              hrMaya,
              {
                code: `B${run}`,
                name: "Too long a break",
                startTime: "09:00",
                endTime: "09:30",
                breakMinutes: 30,
                colour: "rose",
              },
              randomUUID(),
            ),
          ),
          400,
        );
        const edited = await shf.updateTemplate(
          hrMaya,
          early.id,
          {
            name: `Early ${secret}`,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 30,
            colour: "amber",
            active: true,
            version: early.version,
          },
          randomUUID(),
        );
        assert.equal(edited.version, 2);
        assert.equal(edited.code, early.code);
        assert.equal(
          await status(
            shf.updateTemplate(
              hrMaya,
              early.id,
              {
                name: "Stale",
                startTime: "06:00",
                endTime: "14:00",
                breakMinutes: 30,
                colour: "amber",
                active: true,
                version: early.version,
              },
              randomUUID(),
            ),
          ),
          409,
        );
        early = edited;
        // Employees read templates but never change them.
        assert.equal((await shf.templateDetail(rohanE, day.id)).canEdit, false);
        assert.equal(
          await status(
            shf.updateSettings(
              rohanE,
              { minRestHours: 8, version: 0 },
              randomUUID(),
            ),
          ),
          403,
        );
      },
    );

    await t.test(
      "planning: ranges, weekday patterns and who may plan",
      async () => {
        const week = await assign(neelM, rohan, day.id, d(0), {
          to: d(6),
          weekdays: [1, 2, 3, 4, 5],
        });
        assert.equal(week.created, 5);
        assert.ok(week.batchId);
        rohanDays = week.assignmentIds;
        meeraTue = (await assign(neelM, meera, early.id, d(1)))
          .assignmentIds[0]!;
        assert.equal((await assign(hrMaya, arjun, day.id, d(0))).created, 1);
        // A manager plans only their direct reports; employees never plan.
        assert.equal(await status(assign(neelM, arjun, day.id, d(1))), 400);
        assert.equal(await status(assign(rohanE, rohan, day.id, d(6))), 403);
        // Nothing matches, or the range is too long.
        assert.equal(
          await status(
            assign(neelM, rohan, day.id, d(0), { to: d(1), weekdays: [7] }),
          ),
          400,
        );
        assert.equal(
          await status(assign(neelM, rohan, day.id, d(0), { to: d(70) })),
          400,
        );
        const detail = await shf.assignmentDetail(neelM, rohanDays[0]!);
        assert.equal(detail.assignment.startAt, `${d(0)}T09:00`);
        assert.equal(detail.assignment.plannedMinutes, 450);
        assert.deepEqual(
          detail.history.map((h) => h.kind),
          ["assigned"],
        );
      },
    );

    await t.test("conflicts: overlap, rest and approved leave", async () => {
      // Overlap; the whole range is refused, not just the clashing date.
      assert.equal(
        await status(
          assign(hrMaya, rohan, early.id, d(0), { to: d(5), weekdays: [1, 6] }),
        ),
        409,
      );
      const sat = await admin.query(
        "SELECT 1 FROM shf_assignment WHERE employee_id=$1 AND work_date=$2 AND status='active'",
        [rohan, d(5)],
      );
      assert.equal(sat.rows.length, 0);
      // Saturday night ends 06:00 Sunday; a 09:00 Sunday start leaves 3 hours of rest.
      await assign(neelM, rohan, night.id, d(5));
      const rest = await shf
        .assign(
          neelM,
          { employeeId: rohan, templateId: day.id, from: d(6) },
          randomUUID(),
        )
        .catch((e: Error) => e);
      assert.ok(
        rest instanceof Error && /rest/.test(rest.message),
        String(rest),
      );
      // The minimum rest is configurable by HR.
      const before = await shf.settings(hrMaya);
      const loose = await shf.updateSettings(
        hrMaya,
        { minRestHours: 2, version: before.version },
        randomUUID(),
      );
      assert.equal(loose.minRestHours, 2);
      assert.equal(
        await status(
          shf.updateSettings(
            hrMaya,
            { minRestHours: 3, version: before.version },
            randomUUID(),
          ),
        ),
        409,
      );
      await assign(neelM, rohan, day.id, d(6));
      await shf.updateSettings(
        hrMaya,
        { minRestHours: 11, version: loose.version },
        randomUUID(),
      );
      // Approved leave: Meera is planned on Thursday, then leave for Wednesday and Thursday is approved.
      const thursday = (await assign(neelM, meera, day.id, d(3)))
        .assignmentIds[0]!;
      const leaveId = randomUUID();
      ids.leave.push(leaveId);
      await transaction(admin, async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        const type = (
          await client.query<{ id: string }>(
            "SELECT id FROM leave_type WHERE tenant_id=$1 AND entity_id=$2 LIMIT 1",
            [actor.tenantId, actor.entityId],
          )
        ).rows[0]!.id;
        await client.query(
          `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,days,reason,
            state,approver,version,requested_by_actor,decided_at,decided_by_employee,decided_by_label)
           VALUES ($1,$2,$3,$4,$5,$6,$7,2,'Synthetic shift test','approved','hr',1,$8,now(),$9,'HR')`,
          [
            leaveId,
            actor.tenantId,
            actor.entityId,
            meera,
            type,
            d(2),
            d(3),
            actor.actorId,
            maya,
          ],
        );
      });
      const onLeave = await assign(neelM, meera, day.id, d(2)).catch(
        (e: Error) => e,
      );
      assert.ok(
        onLeave instanceof Error && /leave/.test(onLeave.message),
        String(onLeave),
      );
      assert.equal(
        (await shf.assignmentDetail(neelM, thursday)).assignment.onLeave,
        true,
      );
      // Concurrency: two clashing plans for the same person, one winner.
      const raced = await Promise.all(
        [early.id, day.id].map((tpl) =>
          status(assign(hrMaya, ishaan, tpl, d(2))),
        ),
      );
      assert.deepEqual(raced.sort(), [200, 409]);
    });

    await t.test("visibility and planned hours before publishing", async () => {
      assert.equal((await rosterOf(rohanE, "mine")).total, 0, "draft hidden");
      assert.equal(
        await status(shf.assignmentDetail(rohanE, rohanDays[0]!)),
        404,
      );
      const team = await rosterOf(neelM, "team");
      assert.ok(team.items.every((i) => i.employeeId !== arjun));
      assert.ok(team.items.some((i) => i.employeeId === rohan));
      assert.ok(team.items.every((i) => !i.published && !i.mine));
      assert.equal(
        await status(
          shf.assignmentDetail(
            neelM,
            (await rosterOf(hrMaya, "all")).items.find(
              (i) => i.employeeId === arjun,
            )!.id,
          ),
        ),
        404,
      );
      const hours = await shf.hours(neelM, {
        ...page,
        weekStart: d(0),
        view: "team",
      });
      const r = hours.items.find((i) => i.employeeId === rohan)!;
      assert.equal(r.shifts, 7);
      assert.equal(r.plannedMinutes, 7 * 450);
      assert.equal(
        await status(shf.hours(rohanE, { ...page, view: "all" })),
        403,
      );
      assert.equal(
        await status(
          shf.hours(hrMaya, { ...page, weekStart: d(1), view: "all" }),
        ),
        400,
      );
    });

    await t.test(
      "publishing locks the week: reasons and the after-publish flag",
      async () => {
        assert.equal(await status(shf.publish(neelM, d(0), randomUUID())), 403);
        const week = await shf.publish(hrMaya, d(0), randomUUID());
        ids.weeks.push(d(0));
        assert.equal(week.published, true);
        assert.equal(
          await status(shf.publish(hrMaya, d(0), randomUUID())),
          409,
        );
        const mine = await rosterOf(rohanE, "mine");
        assert.equal(mine.total, 7);
        assert.ok(
          mine.items.every(
            (i) => i.published && i.mine && !i.canCancel && i.canSwap,
          ),
        );
        // Changes now need a reason and are flagged.
        const friday = rohanDays[4]!;
        assert.equal(
          await status(shf.cancel(neelM, friday, { version: 1 }, randomUUID())),
          400,
        );
        const cancelled = await shf.cancel(
          neelM,
          friday,
          { version: 1, reason: `Covering elsewhere ${secret}` },
          randomUUID(),
        );
        assert.equal(cancelled.assignment.status, "cancelled");
        assert.equal(cancelled.assignment.afterPublish, true);
        assert.equal(cancelled.history.at(-1)!.kind, "cancelled");
        assert.match(cancelled.history.at(-1)!.reason ?? "", /Covering/);
        assert.equal(
          await status(
            shf.cancel(
              neelM,
              friday,
              { version: 2, reason: "Again" },
              randomUUID(),
            ),
          ),
          409,
        );
        assert.equal(await status(assign(neelM, ishaan, day.id, d(4))), 400);
        const added = await assign(neelM, ishaan, day.id, d(4), {
          reason: `Extra cover ${secret}`,
        });
        const ishaanFri = await shf.assignmentDetail(
          ishaanE,
          added.assignmentIds[0]!,
        );
        assert.equal(ishaanFri.assignment.afterPublish, true);
        // Employees see only their own shifts.
        assert.equal(await status(shf.assignmentDetail(rohanE, meeraTue)), 404);
        assert.equal(
          await status(
            shf.cancel(rohanE, rohanDays[0]!, { version: 1 }, randomUUID()),
          ),
          403,
        );
        // Concurrency: two cancels, one winner.
        const raced = await Promise.all(
          [1, 2].map(() =>
            status(
              shf.cancel(
                hrMaya,
                added.assignmentIds[0]!,
                { version: 1, reason: "Race test" },
                randomUUID(),
              ),
            ),
          ),
        );
        assert.deepEqual(raced.sort(), [200, 409]);
      },
    );

    await t.test(
      "swaps: colleague accepts, an approver who is neither person decides",
      async () => {
        const tue = rohanDays[1]!;
        const swap = await shf.proposeSwap(
          rohanE,
          { assignmentId: tue, colleagueId: meera },
          randomUUID(),
        );
        assert.equal(swap.status, "proposed");
        assert.equal(swap.colleague.assignmentId, meeraTue);
        assert.equal(
          await status(
            shf.proposeSwap(
              rohanE,
              { assignmentId: tue, colleagueId: meera },
              randomUUID(),
            ),
          ),
          409,
        );
        // Someone else's shift, or a colleague without a shift that day, is refused alike.
        assert.equal(
          await status(
            shf.proposeSwap(
              rohanE,
              { assignmentId: meeraTue, colleagueId: meera },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await status(
            shf.proposeSwap(
              rohanE,
              { assignmentId: rohanDays[0]!, colleagueId: meera },
              randomUUID(),
            ),
          ),
          400,
        );
        // Swapping Thursday would put Meera on her approved leave; the proposer is not told why.
        const leaveClash = await shf
          .proposeSwap(
            rohanE,
            { assignmentId: rohanDays[3]!, colleagueId: meera },
            randomUUID(),
          )
          .catch((e: Error & { getStatus?: () => number }) => e);
        assert.ok(leaveClash instanceof Error);
        assert.equal(
          (leaveClash as { getStatus?: () => number }).getStatus?.(),
          409,
        );
        assert.doesNotMatch(leaveClash.message, /leave on|\d{4}-\d{2}/);
        assert.equal(
          await status(
            shf.swapStep(
              rohanE,
              swap.id,
              "accept",
              { version: 1 },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(await status(shf.swapDetail(ishaanE, swap.id)), 404);
        const accepted = await shf.swapStep(
          meeraE,
          swap.id,
          "accept",
          { version: 1 },
          randomUUID(),
        );
        assert.equal(accepted.status, "accepted");
        // Four-eyes: neither person approves, even holding HR authority.
        assert.equal(
          await status(
            shf.swapStep(
              rohanHR,
              swap.id,
              "approve",
              { version: 2 },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(
          await status(
            shf.swapStep(
              meeraE,
              swap.id,
              "approve",
              { version: 2 },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(
          await status(
            shf.swapStep(
              neelM,
              swap.id,
              "approve",
              { version: 1 },
              randomUUID(),
            ),
          ),
          409,
        );
        const queue = await shf.listSwaps(neelM, {
          ...page,
          view: "approvals",
        });
        assert.ok(queue.items.some((s) => s.id === swap.id && s.canApprove));
        const approved = await shf.swapStep(
          neelM,
          swap.id,
          "approve",
          { version: 2 },
          randomUUID(),
        );
        assert.equal(approved.status, "approved");
        const now1 = await shf.assignmentDetail(neelM, tue);
        assert.equal(now1.assignment.employeeId, meera);
        assert.equal(now1.assignment.source, "swap");
        assert.equal(now1.assignment.afterPublish, true);
        assert.deepEqual(
          now1.history.map((h) => h.kind),
          ["assigned", "swapped_out", "swapped_in"],
        );
        assert.equal(
          (await shf.assignmentDetail(rohanE, meeraTue)).assignment.employeeId,
          rohan,
        );
        assert.equal(await status(shf.assignmentDetail(rohanE, tue)), 404);
        // Decline, then a rejection that needs a reason.
        const monIshaan = (
          await assign(neelM, ishaan, early.id, d(0), {
            reason: "Cover Monday",
          })
        ).assignmentIds[0]!;
        const second = await shf.proposeSwap(
          rohanE,
          { assignmentId: rohanDays[0]!, colleagueId: ishaan },
          randomUUID(),
        );
        const declined = await shf.swapStep(
          ishaanE,
          second.id,
          "decline",
          { version: 1 },
          randomUUID(),
        );
        assert.equal(declined.status, "declined");
        const third = await shf.proposeSwap(
          rohanE,
          { assignmentId: rohanDays[0]!, colleagueId: ishaan },
          randomUUID(),
        );
        await shf.swapStep(
          ishaanE,
          third.id,
          "accept",
          { version: 1 },
          randomUUID(),
        );
        assert.equal(
          await status(
            shf.swapStep(
              neelM,
              third.id,
              "reject",
              { version: 2 },
              randomUUID(),
            ),
          ),
          400,
        );
        const rejected = await shf.swapStep(
          neelM,
          third.id,
          "reject",
          { version: 2, reason: `Not this week ${secret}` },
          randomUUID(),
        );
        assert.equal(rejected.status, "rejected");
        assert.equal(
          (await shf.assignmentDetail(ishaanE, monIshaan)).assignment
            .employeeId,
          ishaan,
        );
        const fourth = await shf.proposeSwap(
          rohanE,
          { assignmentId: rohanDays[0]!, colleagueId: ishaan },
          randomUUID(),
        );
        const cancelled = await shf.swapStep(
          rohanE,
          fourth.id,
          "cancel",
          { version: 1 },
          randomUUID(),
        );
        assert.equal(cancelled.status, "cancelled");
      },
    );

    await t.test(
      "open shifts: eligibility, claims, four-eyes and the approval race",
      async () => {
        const team = await shf.postOpen(
          neelM,
          { templateId: day.id, workDate: d(9) },
          randomUUID(),
        );
        assert.equal(team.openShift.audience, "team");
        assert.equal(
          await status(
            shf.postOpen(
              rohanE,
              { templateId: day.id, workDate: d(9) },
              randomUUID(),
            ),
          ),
          403,
        );
        // Only Neel's reports see and claim his team open shift.
        assert.ok(
          !(await shf.listOpen(arjunE, page)).items.some(
            (o) => o.id === team.openShift.id,
          ),
        );
        assert.equal(
          await status(shf.claim(arjunE, team.openShift.id, randomUUID())),
          400,
        );
        const c1 = await shf.claim(ishaanE, team.openShift.id, randomUUID());
        const c2 = await shf.claim(meeraE, team.openShift.id, randomUUID());
        assert.equal(
          await status(shf.claim(ishaanE, team.openShift.id, randomUUID())),
          409,
        );
        assert.equal(
          await status(
            shf.claimStep(
              ishaanHR,
              c1.id,
              "approve",
              { version: 1 },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(
          await status(
            shf.claimStep(
              rohanE,
              c1.id,
              "approve",
              { version: 1 },
              randomUUID(),
            ),
          ),
          404,
        );
        const detail = await shf.openDetail(neelM, team.openShift.id);
        assert.equal(detail.claims.length, 2);
        assert.equal(
          (await shf.openDetail(meeraE, team.openShift.id)).claims.length,
          1,
        );
        const raced = await Promise.all(
          [c1, c2].map((c) =>
            status(
              shf.claimStep(
                neelM,
                c.id,
                "approve",
                { version: 1 },
                randomUUID(),
              ),
            ),
          ),
        );
        assert.deepEqual(raced.sort(), [200, 409]);
        const after = await shf.openDetail(neelM, team.openShift.id);
        assert.equal(after.openShift.status, "filled");
        const statuses = after.claims.map((c) => c.status).sort();
        assert.deepEqual(statuses, ["approved", "not_selected"]);
        const winner = after.claims.find((c) => c.status === "approved")!;
        const filled = await admin.query<{
          source: string;
          e: string;
          id: string;
        }>(
          "SELECT source, employee_id AS e, id FROM shf_assignment WHERE open_shift_id=$1",
          [team.openShift.id],
        );
        assert.equal(filled.rows[0]!.source, "open_shift");
        assert.equal(filled.rows[0]!.e, winner.employeeId);
        const history = await shf.assignmentDetail(neelM, filled.rows[0]!.id);
        assert.deepEqual(
          history.history.map((h) => h.kind),
          ["claimed"],
        );
        // HR entity open shift: anyone may claim; one claim per person under a race; withdrawing closes claims.
        const entity = await shf.postOpen(
          hrMaya,
          { templateId: night.id, workDate: d(10) },
          randomUUID(),
        );
        assert.equal(entity.openShift.audience, "entity");
        const claims = await Promise.all(
          [1, 2, 3].map(() =>
            status(shf.claim(rohanE, entity.openShift.id, randomUUID())),
          ),
        );
        assert.deepEqual(claims.sort(), [200, 409, 409]);
        await shf.claim(arjunE, entity.openShift.id, randomUUID());
        assert.equal(
          await status(
            shf.withdrawOpen(
              neelM,
              entity.openShift.id,
              { version: 1 },
              randomUUID(),
            ),
          ),
          403,
        );
        const withdrawn = await shf.withdrawOpen(
          hrMaya,
          entity.openShift.id,
          { version: 1 },
          randomUUID(),
        );
        assert.equal(withdrawn.openShift.status, "withdrawn");
        assert.ok(withdrawn.claims.every((c) => c.status === "not_selected"));
        assert.equal(
          await status(
            shf.withdrawOpen(
              hrMaya,
              entity.openShift.id,
              { version: 2 },
              randomUUID(),
            ),
          ),
          409,
        );
        // A claimant withdraws their own claim; HR rejects with a reason.
        const hrOpen = await shf.postOpen(
          hrMaya,
          { templateId: day.id, workDate: d(11) },
          randomUUID(),
        );
        const mine = await shf.claim(arjunE, hrOpen.openShift.id, randomUUID());
        assert.equal(
          (
            await shf.claimStep(
              arjunE,
              mine.id,
              "withdraw",
              { version: 1 },
              randomUUID(),
            )
          ).status,
          "withdrawn",
        );
        const again = await shf.claim(
          arjunE,
          hrOpen.openShift.id,
          randomUUID(),
        );
        assert.equal(
          await status(
            shf.claimStep(
              hrKabir,
              again.id,
              "reject",
              { version: 1 },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          (
            await shf.claimStep(
              hrKabir,
              again.id,
              "reject",
              { version: 1, reason: `Covered ${secret}` },
              randomUUID(),
            )
          ).status,
          "rejected",
        );
        assert.equal(
          (await shf.listClaims(arjunE, { ...page, view: "mine" })).total >= 3,
          true,
        );
        assert.equal(
          await status(shf.listClaims(arjunE, { ...page, view: "approvals" })),
          403,
        );
      },
    );

    await t.test(
      "history is append-only and direct statements are refused",
      async () => {
        const mon = rohanDays[0]!;
        assert.notEqual(
          await sqlState(
            admin.query(
              "UPDATE shf_change SET reason='rewritten' WHERE assignment_id=$1",
              [mon],
            ),
          ),
          "ok",
        );
        assert.equal(
          await sqlState(
            admin.query("DELETE FROM shf_assignment WHERE id=$1", [mon]),
          ),
          "23514",
        );
        assert.equal(
          await sqlState(
            admin.query("DELETE FROM shf_change WHERE assignment_id=$1", [mon]),
          ),
          "23514",
        );
        assert.notEqual(
          await sqlState(admin.query("TRUNCATE shf_change")),
          "ok",
        );
        assert.equal(
          await sqlState(
            admin.query(
              "UPDATE shf_week SET published_by_label='x' WHERE week_start=$1",
              [d(0)],
            ),
          ),
          "SF004",
        );
        const direct = (
          who: typeof hrMaya,
          sql: string,
          params: unknown[] = [],
        ) => sqlState(scoped(pool, who, (c) => c.query(sql, params)));
        assert.equal(
          await direct(
            rohanE,
            "INSERT INTO shf_change(id,tenant_id,entity_id,assignment_id,employee_id,work_date,kind,after_publish,by_employee,by_label) VALUES ($1,$2,$3,$4,$5,$6,'assigned',false,$5,'x')",
            [randomUUID(), actor.tenantId, actor.entityId, mon, rohan, d(0)],
          ),
          "42501",
        );
        assert.equal(
          await direct(
            neelM,
            "UPDATE shf_assignment SET employee_id=$2, version=version+1 WHERE id=$1",
            [mon, meera],
          ),
          "42501",
        );
        assert.equal(
          await direct(
            neelM,
            "UPDATE shf_assignment SET status='active', version=version+1 WHERE id=$1",
            [mon],
          ),
          "SF004",
        );
        assert.equal(
          await direct(
            rohanE,
            "INSERT INTO shf_assignment(id,tenant_id,entity_id,employee_id,template_id,work_date,source) VALUES ($1,$2,$3,$4,$5,$6,'assigned')",
            [
              randomUUID(),
              actor.tenantId,
              actor.entityId,
              rohan,
              day.id,
              d(12),
            ],
          ),
          "SF005",
        );
        assert.equal(
          await direct(
            neelM,
            "INSERT INTO shf_assignment(id,tenant_id,entity_id,employee_id,template_id,work_date,source) VALUES ($1,$2,$3,$4,$5,$6,'open_shift')",
            [
              randomUUID(),
              actor.tenantId,
              actor.entityId,
              rohan,
              day.id,
              d(12),
            ],
          ),
          "SF005",
        );
        assert.equal(
          await direct(
            neelM,
            "INSERT INTO shf_assignment(id,tenant_id,entity_id,employee_id,template_id,work_date,source) VALUES ($1,$2,$3,$4,$5,$6,'assigned')",
            [
              randomUUID(),
              actor.tenantId,
              actor.entityId,
              arjun,
              day.id,
              d(12),
            ],
          ),
          "SF003",
        );
        assert.equal(
          await direct(
            neelM,
            "INSERT INTO shf_week(tenant_id,entity_id,week_start) VALUES ($1,$2,$3)",
            [actor.tenantId, actor.entityId, d(7)],
          ),
          "SF005",
        );
        assert.equal(
          await direct(
            hrMaya,
            "INSERT INTO shf_template(id,tenant_id,entity_id,code,name,start_time,end_time,break_minutes,colour) VALUES ($1,$2,$3,$4,'Bad','09:00','09:00',0,'teal')",
            [randomUUID(), actor.tenantId, actor.entityId, `Z${run}`],
          ),
          "SF003",
        );
        // A forged approval of one's own swap, a forged fill, and a forged closing of claims.
        const swap = await shf.proposeSwap(
          rohanE,
          { assignmentId: mon, colleagueId: ishaan },
          randomUUID(),
        );
        {
          await shf.swapStep(
            ishaanE,
            swap.id,
            "accept",
            { version: 1 },
            randomUUID(),
          );
          assert.equal(
            await direct(
              rohanE,
              "UPDATE shf_swap SET status='approved', version=3 WHERE id=$1",
              [swap.id],
            ),
            "SF005",
          );
          assert.equal(
            await direct(
              neelM,
              "UPDATE shf_swap SET decided_by_employee=$2, version=3 WHERE id=$1",
              [swap.id, neel],
            ),
            "42501",
          );
        }
        const open = await shf.postOpen(
          hrMaya,
          { templateId: day.id, workDate: d(12) },
          randomUUID(),
        );
        const claim = await shf.claim(rohanE, open.openShift.id, randomUUID());
        assert.equal(
          await direct(
            hrMaya,
            "UPDATE shf_open_shift SET status='filled', version=2 WHERE id=$1",
            [open.openShift.id],
          ),
          "SF005",
        );
        assert.equal(
          await direct(
            hrMaya,
            "UPDATE shf_claim SET status='not_selected', version=2 WHERE id=$1",
            [claim.id],
          ),
          "SF004",
        );
        assert.equal(
          await direct(
            rohanE,
            "INSERT INTO shf_claim(id,tenant_id,entity_id,open_shift_id,employee_id) VALUES ($1,$2,$3,$4,$5)",
            [
              randomUUID(),
              actor.tenantId,
              actor.entityId,
              open.openShift.id,
              meera,
            ],
          ),
          "SF005",
        );
        const hidden = await scoped(pool, rohanE, (c) =>
          c.query(
            "UPDATE shf_open_shift SET status='withdrawn', version=2 WHERE id=$1",
            [open.openShift.id],
          ),
        );
        assert.equal(hidden.rowCount, 0);
        // The derived helpers answer only about people the caller may see.
        const probe = await scoped(pool, rohanE, (c) =>
          c.query<{ leave: boolean; poster: string | null }>(
            "SELECT shf_on_leave($1,$2) AS leave, shf_open_poster($3) AS poster",
            [meera, d(2), open.openShift.id],
          ),
        );
        assert.equal(probe.rows[0]!.leave, false);
        assert.equal(probe.rows[0]!.poster, null);
        const own = await scoped(pool, neelM, (c) =>
          c.query<{ leave: boolean }>("SELECT shf_on_leave($1,$2) AS leave", [
            meera,
            d(2),
          ]),
        );
        assert.equal(own.rows[0]!.leave, true);
      },
    );

    await t.test(
      "review fixes: no past-date fills, no draft-week dates in refusals",
      async () => {
        // A refusal never names the date of the claimant's shift in an unpublished week.
        const late = await newTemplate("R", "22:00", "06:00");
        await assign(hrMaya, arjun, day.id, d(7));
        const opened = await shf.postOpen(
          hrMaya,
          { templateId: late.id, workDate: d(6) },
          randomUUID(),
        );
        const refused = await shf
          .claim(arjunE, opened.openShift.id, randomUUID())
          .catch((e: Error) => e);
        assert.ok(
          refused instanceof Error && /rest|overlap/.test(refused.message),
          String(refused),
        );
        assert.ok(!refused.message.includes(d(7)), refused.message);
        // HR planning the same person still gets the date.
        const planned = await assign(hrMaya, arjun, late.id, d(6), {
          reason: "Cover needed",
        }).catch((e: Error) => e);
        assert.ok(
          planned instanceof Error && planned.message.includes(d(7)),
          String(planned),
        );

        // A claim on an open shift whose date has passed is never approved.
        const today = (
          await admin.query<{ d: string }>(
            "SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS d FROM legal_entity WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, actor.entityId],
          )
        ).rows[0]!.d;
        const soon = await shf.postOpen(
          hrMaya,
          { templateId: late.id, workDate: today },
          randomUUID(),
        );
        const pending = await shf.claim(
          meeraE,
          soon.openShift.id,
          randomUUID(),
        );
        await transaction(admin, async (client) => {
          const restore = await alwaysOff(client);
          await client.query(
            `UPDATE shf_open_shift SET work_date=work_date-2, start_at=start_at-interval '2 days',
              end_at=end_at-interval '2 days' WHERE id=$1`,
            [soon.openShift.id],
          );
          await restore();
        });
        assert.equal(
          await status(
            shf.claimStep(
              hrKabir,
              pending.id,
              "approve",
              { version: 1 },
              randomUUID(),
            ),
          ),
          409,
        );
        const filled = await admin.query(
          "SELECT 1 FROM shf_assignment WHERE open_shift_id=$1",
          [soon.openShift.id],
        );
        assert.equal(filled.rows.length, 0);
        assert.equal(
          (
            await shf.claimStep(
              hrKabir,
              pending.id,
              "reject",
              { version: 1, reason: "Date passed" },
              randomUUID(),
            )
          ).status,
          "rejected",
        );
      },
    );

    await t.test("tenant and entity isolation", async () => {
      for (const who of [
        { ...hrMaya, tenantId: randomUUID() },
        { ...hrMaya, entityId: randomUUID() },
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM shf_template)+(SELECT count(*) FROM shf_assignment)
              +(SELECT count(*) FROM shf_change)+(SELECT count(*) FROM shf_swap)+(SELECT count(*) FROM shf_week)
              +(SELECT count(*) FROM shf_open_shift)+(SELECT count(*) FROM shf_claim) AS n`,
          ),
        );
        assert.equal(Number(seen.rows[0]!.n), 0);
        assert.equal(await status(shf.templateDetail(who, day.id)), 404);
        assert.equal(
          await status(shf.assignmentDetail(who, rohanDays[0]!)),
          404,
        );
      }
    });

    await t.test(
      "pagination, and no free text or names in audit or outbox",
      async () => {
        const p1 = await shf.roster(hrMaya, {
          page: 1,
          limit: 2,
          view: "all",
          from: d(0),
          to: d(13),
          status: "active",
        });
        const p2 = await shf.roster(hrMaya, {
          page: 2,
          limit: 2,
          view: "all",
          from: d(0),
          to: d(13),
          status: "active",
        });
        assert.equal(p1.items.length, 2);
        assert.ok(p1.total >= 10);
        assert.ok(p2.items.every((k) => !p1.items.some((p) => p.id === k.id)));
        await changeRole("hr_admin");
        const http = (await (
          await request(
            `/shifts/roster?view=all&limit=2&from=${d(0)}&to=${d(6)}`,
          )
        ).json()) as ShfRoster;
        assert.equal(http.limit, 2);
        assert.equal(
          (await request(`/shifts/roster?from=${d(0)}&to=${d(70)}`)).status,
          400,
        );
        const auditRows = await admin.query<{
          action: string;
          details: unknown;
          reason: string | null;
        }>(
          "SELECT action, details, reason FROM audit_event WHERE action LIKE 'shift.%' AND occurred_at>now()-interval '1 hour'",
        );
        assert.ok(auditRows.rows.length > 30);
        for (const row of auditRows.rows) {
          const text = JSON.stringify(row);
          for (const marker of [
            secret,
            "Covering",
            "Cover Monday",
            "Rohan",
            "Meera",
            "Ishaan",
            "Arjun",
          ])
            assert.ok(!text.includes(marker), `${row.action} ${text}`);
          assert.ok(!/reason|name/i.test(JSON.stringify(row.details)), text);
        }
        const outbox = await admin.query<{ t: string }>(
          "SELECT DISTINCT event_type AS t FROM outbox_event WHERE event_type LIKE 'shift.%'",
        );
        for (const type of [
          "shift.settings_updated.v1",
          "shift.template_created.v1",
          "shift.template_updated.v1",
          "shift.assigned.v1",
          "shift.cancelled.v1",
          "shift.week_published.v1",
          "shift.swap_proposed.v1",
          "shift.swap_accepted.v1",
          "shift.swap_declined.v1",
          "shift.swap_cancelled.v1",
          "shift.swap_approved.v1",
          "shift.swap_rejected.v1",
          "shift.open_posted.v1",
          "shift.open_withdrawn.v1",
          "shift.open_claimed.v1",
          "shift.claim_withdrawn.v1",
          "shift.claim_approved.v1",
          "shift.claim_rejected.v1",
        ])
          assert.ok(
            outbox.rows.some((r) => r.t === type),
            type,
          );
      },
    );
  } finally {
    // Synthetic cleanup only: shift records are never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      const tpl = ids.templates;
      const asg = (
        await client.query<{ id: string; b: string | null }>(
          "SELECT id, batch_id AS b FROM shf_assignment WHERE template_id=ANY($1::uuid[])",
          [tpl],
        )
      ).rows;
      const swaps = (
        await client.query<{ id: string }>(
          "SELECT id FROM shf_swap WHERE requester_template_id=ANY($1::uuid[]) OR target_template_id=ANY($1::uuid[])",
          [tpl],
        )
      ).rows.map((r) => r.id);
      const opens = (
        await client.query<{ id: string }>(
          "SELECT id FROM shf_open_shift WHERE template_id=ANY($1::uuid[])",
          [tpl],
        )
      ).rows.map((r) => r.id);
      const claims = (
        await client.query<{ id: string }>(
          "SELECT id FROM shf_claim WHERE open_shift_id=ANY($1::uuid[])",
          [opens],
        )
      ).rows.map((r) => r.id);
      await client.query(
        "DELETE FROM outbox_event WHERE event_type LIKE 'shift.%' AND occurred_at>now()-interval '1 hour'",
      );
      await client.query(
        "DELETE FROM audit_event WHERE action LIKE 'shift.%' AND occurred_at>now()-interval '1 hour'",
      );
      await client.query(
        "DELETE FROM shf_change WHERE assignment_id=ANY($1::uuid[])",
        [asg.map((r) => r.id)],
      );
      await client.query("DELETE FROM shf_claim WHERE id=ANY($1::uuid[])", [
        claims,
      ]);
      await client.query("DELETE FROM shf_swap WHERE id=ANY($1::uuid[])", [
        swaps,
      ]);
      await client.query(
        "DELETE FROM shf_assignment WHERE template_id=ANY($1::uuid[])",
        [tpl],
      );
      await client.query(
        "DELETE FROM shf_open_shift WHERE id=ANY($1::uuid[])",
        [opens],
      );
      await client.query("DELETE FROM shf_template WHERE id=ANY($1::uuid[])", [
        tpl,
      ]);
      await client.query(
        "DELETE FROM shf_week WHERE tenant_id=$1 AND entity_id=$2 AND week_start=ANY($3::date[])",
        [actor.tenantId, actor.entityId, ids.weeks],
      );
      if (priorSetting)
        await client.query(
          "UPDATE shf_setting SET min_rest_hours=$3 WHERE tenant_id=$1 AND entity_id=$2",
          [actor.tenantId, actor.entityId, priorSetting.h],
        );
      else
        await client.query(
          "DELETE FROM shf_setting WHERE tenant_id=$1 AND entity_id=$2",
          [actor.tenantId, actor.entityId],
        );
      await client.query("DELETE FROM leave_request WHERE id=ANY($1::uuid[])", [
        ids.leave,
      ]);
      await restore();
    });
    await Promise.all([admin.end(), pool.end(), app.close()]);
    await store.pool.end();
  }
});
