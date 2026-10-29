import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { LearnStore } from "../apps/api/src/learn.store";
import {
  makePool,
  scoped,
  transaction,
  type PoolClient,
} from "../packages/database/src/index";
import { lrnCourseCreateSchema } from "../packages/contracts/src/index";
import type {
  LrnAssignmentList,
  LrnCourse,
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

const PORT = Number(process.env.LEARN_TEST_PORT ?? 4523);
// Synthetic demo people: Maya (HR) manages Arjun, Zara and Neel; Neel manages Rohan, Kabir and
// others. Kabir also stands in as a second HR user for four-eyes checks.
const arjun = "30000000-0000-4000-8000-000000000002";
const zara = "30000000-0000-4000-8000-000000000003";
const neel = "30000000-0000-4000-8000-000000000004";
const rohan = "30000000-0000-4000-8000-000000000006";
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
// SQLSTATE of a direct statement, or "ok".
const sqlState = async (work: Promise<unknown>) => {
  try {
    await work;
    return "ok";
  } catch (error) {
    return String((error as { code?: string }).code);
  }
};
const dayOffset = (days: number) =>
  new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

await test("Learning: catalogue, assignments, progress, four-eyes and compliance", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const pool = makePool(process.env.DATABASE_URL!);
  const lrn = new LearnStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toLowerCase();
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
  const zaraE = as(zara, "Zara (synthetic)", "employee");
  const neelM = as(neel, "Neel (synthetic manager)", "manager");
  const rohanE = as(rohan, "Rohan (synthetic)", "employee");
  const auditor = as(maya, "Maya (auditor)", "auditor");
  // Markers that must never reach audit or outbox rows.
  const secret = `secret-${run}`;
  const ids = { courses: [] as string[], assignments: [] as string[] };
  const page = { page: 1, limit: 100 } as const;
  const courseInput = (title: string, extra: Partial<LrnCourse> = {}) => ({
    title: `${title} ${secret}`,
    description: `About ${secret}`,
    category: `Cat ${run}`,
    deliveryMode: "online" as const,
    durationMinutes: 45,
    externalUrl: "https://learn.example.test/course",
    mandatory: false,
    validityMonths: null,
    ...extra,
  });
  const newCourse = async (
    title: string,
    extra: Partial<LrnCourse> = {},
    publish = true,
  ) => {
    let course = await lrn.createCourse(
      hrMaya,
      courseInput(title, extra),
      randomUUID(),
    );
    ids.courses.push(course.id);
    if (publish)
      course = await lrn.courseStep(
        hrMaya,
        course.id,
        "publish",
        { version: course.version },
        randomUUID(),
      );
    return course;
  };
  const assignTo = async (courseId: string, employeeId: string, due = 30) => {
    const result = await lrn.assign(
      hrMaya,
      courseId,
      { target: { kind: "employee", employeeId }, dueOn: dayOffset(due) },
      randomUUID(),
    );
    ids.assignments.push(...result.assignmentIds);
    return result.assignmentIds[0]!;
  };
  const detail = (who: typeof arjunE, id: string) =>
    lrn.assignmentDetail(who, id);
  // Test-only: change dates with the guards off, as the migrator.
  const backdate = (id: string, column: "due_on" | "expires_on", on: string) =>
    transaction(admin, async (client) => {
      await client.query(
        "ALTER TABLE lrn_assignment DISABLE TRIGGER lrn_assignment_guard_update",
      );
      await client.query(`UPDATE lrn_assignment SET ${column}=$2 WHERE id=$1`, [
        id,
        on,
      ]);
      await client.query(
        "ALTER TABLE lrn_assignment ENABLE ALWAYS TRIGGER lrn_assignment_guard_update",
      );
    });
  const alwaysOff = async (client: PoolClient) => {
    const { rows } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE 'lrn\\_%'`,
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

  let optional: LrnCourse;
  let mandatory: LrnCourse;
  try {
    await t.test("access follows the learning permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/learning/courses",
          "/learning/assignments",
          "/learning/reports/compliance",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      for (const role of ["employee", "manager", "hr_admin"] as const) {
        await changeRole(role);
        assert.equal((await request("/learning/courses")).status, 200, role);
        assert.equal(
          (await request("/learning/assignments")).status,
          200,
          role,
        );
        assert.equal(
          (await request("/learning/reports/compliance")).status,
          role === "hr_admin" ? 200 : 403,
          role,
        );
        assert.equal(
          (await request("/learning/assignments?view=team")).status,
          role === "manager" ? 200 : 403,
          role,
        );
        assert.equal(
          (await request("/learning/assignments?view=all")).status,
          role === "hr_admin" ? 200 : 403,
          role,
        );
        const created = await send(
          "/learning/courses",
          "POST",
          courseInput(`Http ${role}`),
        );
        assert.equal(created.status, role === "hr_admin" ? 201 : 403, role);
        if (created.status === 201)
          ids.courses.push(((await created.json()) as LrnCourse).id);
      }
      assert.equal(
        (
          await send("/learning/courses", "POST", {
            ...courseInput("Plain link"),
            externalUrl: "http://insecure.example.test",
          })
        ).status,
        400,
      );
      assert.equal(
        await status(lrn.listCourses(auditor, { ...page, q: "" })),
        403,
      );
    });

    await t.test(
      "the catalogue: codes, drafts, publishing, archiving and versions",
      async () => {
        const draft = await newCourse("Draft course", {}, false);
        assert.match(draft.code, /^LRN-C-\d{6}$/);
        assert.equal(draft.status, "draft");
        assert.equal(draft.canPublish, true);
        // Learners never see drafts.
        assert.equal(await status(lrn.courseDetail(arjunE, draft.id)), 404);
        const edited = await lrn.updateCourse(
          hrMaya,
          draft.id,
          {
            ...courseInput("Draft course edited"),
            version: draft.version,
          },
          randomUUID(),
        );
        assert.equal(edited.version, 2);
        assert.equal(
          await status(
            lrn.updateCourse(
              hrMaya,
              draft.id,
              { ...courseInput("Stale"), version: draft.version },
              randomUUID(),
            ),
          ),
          409,
        );
        // Drafts cannot be assigned.
        assert.equal(
          await status(
            lrn.assign(
              hrMaya,
              draft.id,
              {
                target: { kind: "employee", employeeId: arjun },
                dueOn: dayOffset(10),
              },
              randomUUID(),
            ),
          ),
          409,
        );
        optional = await newCourse("Optional course");
        mandatory = await newCourse("Mandatory course", {
          mandatory: true,
          validityMonths: 12,
        });
        assert.equal(
          (await lrn.courseDetail(arjunE, optional.id)).canEnrol,
          true,
        );
        assert.equal(
          (await lrn.courseDetail(arjunE, mandatory.id)).canEnrol,
          false,
        );
        const archived = await lrn.courseStep(
          hrMaya,
          edited.id,
          "archive",
          { version: edited.version },
          randomUUID(),
        );
        assert.equal(archived.status, "archived");
        assert.equal(
          await status(
            lrn.updateCourse(
              hrMaya,
              archived.id,
              { ...courseInput("Too late"), version: archived.version },
              randomUUID(),
            ),
          ),
          409,
        );
        assert.equal(
          await status(
            lrn.courseStep(
              hrMaya,
              archived.id,
              "publish",
              { version: archived.version },
              randomUUID(),
            ),
          ),
          409,
        );
        // A non-https link is refused by the database too.
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query(
                "UPDATE lrn_course SET external_url='javascript:alert(1)', version=version+1 WHERE id=$1",
                [optional.id],
              ),
            ),
          ),
          "LN003",
        );
      },
    );

    await t.test(
      "assignments, self-enrolment and one open assignment per course",
      async () => {
        const toArjun = await assignTo(mandatory.id, arjun);
        const a = await detail(arjunE, toArjun);
        assert.equal(a.assignment.status, "assigned");
        assert.equal(a.assignment.mandatory, true);
        assert.equal(a.assignment.audience, "employee");
        assert.equal(a.assignment.canStart, true);
        assert.equal(
          await status(assignTo(mandatory.id, arjun)),
          409,
          "second open assignment",
        );
        assert.equal(
          await status(lrn.enrol(arjunE, mandatory.id, randomUUID())),
          400,
          "mandatory courses are not self-enrolled",
        );
        const enrolled = await lrn.enrol(zaraE, optional.id, randomUUID());
        ids.assignments.push(enrolled.assignment.id);
        assert.equal(enrolled.assignment.source, "self_enrolled");
        assert.equal(enrolled.assignment.dueOn, null);
        assert.equal(
          await status(lrn.enrol(zaraE, optional.id, randomUUID())),
          409,
        );
        assert.equal(
          (await lrn.courseDetail(zaraE, optional.id)).myOpenAssignmentId,
          enrolled.assignment.id,
        );
        // Past due dates and unknown people are refused.
        assert.equal(await status(assignTo(optional.id, rohan, -1)), 400);
        assert.equal(await status(assignTo(optional.id, randomUUID())), 400);
        // Employees cannot assign.
        assert.equal(
          await status(
            lrn.assign(
              arjunE,
              optional.id,
              {
                target: { kind: "employee", employeeId: zara },
                dueOn: dayOffset(5),
              },
              randomUUID(),
            ),
          ),
          403,
        );
      },
    );

    await t.test(
      "audience assignment snapshots the unit's current employees",
      async () => {
        const unit = (
          await admin.query<{ d: string }>(
            "SELECT department_id AS d FROM employee WHERE id=$1",
            [zara],
          )
        ).rows[0]!.d;
        const expected = (
          await admin.query<{ id: string }>(
            `SELECT id FROM employee WHERE tenant_id=$1 AND entity_id=$2 AND department_id=$3
             AND status IN ('active','notice') AND joined_on<=CURRENT_DATE ORDER BY id`,
            [actor.tenantId, actor.entityId, unit],
          )
        ).rows.map((r) => r.id);
        assert.ok(expected.length >= 2);
        const course = await newCourse("Audience course");
        // One person already holds an open assignment: they are skipped, not duplicated.
        await assignTo(course.id, expected[0]!);
        const result = await lrn.assign(
          hrMaya,
          course.id,
          {
            target: { kind: "department", unitId: unit },
            dueOn: dayOffset(20),
          },
          randomUUID(),
        );
        ids.assignments.push(...result.assignmentIds);
        assert.ok(result.batchId);
        assert.equal(result.assigned, expected.length - 1);
        assert.equal(result.skipped, 1);
        const rows = await admin.query<{ e: string; b: string; a: string }>(
          "SELECT employee_id AS e, batch_id AS b, audience AS a FROM lrn_assignment WHERE id=ANY($1::uuid[]) ORDER BY employee_id",
          [result.assignmentIds],
        );
        assert.deepEqual(
          rows.rows.map((r) => r.e),
          expected.slice(1),
        );
        assert.ok(
          rows.rows.every(
            (r) => r.b === result.batchId && r.a === "department",
          ),
        );
        // Running it again assigns nobody new.
        const again = await lrn.assign(
          hrMaya,
          course.id,
          {
            target: { kind: "department", unitId: unit },
            dueOn: dayOffset(20),
          },
          randomUUID(),
        );
        assert.equal(again.assigned, 0);
        assert.equal(again.skipped, expected.length);
        assert.equal(
          await status(
            lrn.assign(
              hrMaya,
              course.id,
              {
                target: { kind: "location", unitId: randomUUID() },
                dueOn: dayOffset(20),
              },
              randomUUID(),
            ),
          ),
          400,
        );
        // Archived courses cannot be newly assigned.
        const fresh = await lrn.courseDetail(hrMaya, course.id);
        await lrn.courseStep(
          hrMaya,
          course.id,
          "archive",
          { version: fresh.version },
          randomUUID(),
        );
        assert.equal(await status(assignTo(course.id, arjun)), 409);
        assert.equal(
          await status(lrn.enrol(arjunE, course.id, randomUUID())),
          404,
          "an archived course without an assignment is not visible",
        );
      },
    );

    await t.test("visibility: self, team (read only) and entity", async () => {
      const course = await newCourse("Team course");
      const toRohan = await assignTo(course.id, rohan);
      const toZara = await assignTo(course.id, zara);
      const mine = await lrn.listAssignments(arjunE, {
        ...page,
        view: "mine",
      });
      assert.ok(mine.items.every((i) => i.employeeId === arjun));
      assert.equal(await status(detail(arjunE, toRohan)), 404);
      const team = await lrn.listAssignments(neelM, {
        ...page,
        view: "team",
        courseId: course.id,
      });
      assert.deepEqual(
        team.items.map((i) => i.employeeId),
        [rohan],
        "Neel sees his direct report, not his peer",
      );
      const read = await detail(neelM, toRohan);
      assert.equal(read.assignment.canStart, false);
      assert.equal(read.assignment.canComplete, false);
      assert.equal(read.assignment.canRecord, false);
      assert.equal(await status(detail(neelM, toZara)), 404);
      assert.equal(
        await status(lrn.start(neelM, toRohan, { version: 1 }, randomUUID())),
        403,
      );
      assert.equal(
        await status(
          lrn.complete(neelM, toRohan, { version: 1 }, randomUUID()),
        ),
        403,
      );
      assert.equal(
        await status(
          lrn.recordOnBehalf(
            neelM,
            toRohan,
            "complete",
            { version: 1, reason: "Attended" },
            randomUUID(),
          ),
        ),
        403,
      );
      const all = await lrn.listAssignments(hrMaya, {
        ...page,
        view: "all",
        courseId: course.id,
      });
      assert.equal(all.total, 2);
      assert.equal(
        await status(lrn.listAssignments(rohanE, { ...page, view: "team" })),
        403,
      );
    });

    await t.test(
      "progress: start, complete with a note, and append-only history",
      async () => {
        const course = await newCourse("Progress course");
        const id = await assignTo(course.id, arjun);
        assert.equal(
          await status(lrn.start(arjunE, id, { version: 9 }, randomUUID())),
          409,
          "stale version",
        );
        const started = await lrn.start(
          arjunE,
          id,
          { version: 1 },
          randomUUID(),
        );
        assert.equal(started.assignment.status, "in_progress");
        assert.ok(started.assignment.startedAt);
        assert.equal(
          await status(lrn.start(arjunE, id, { version: 2 }, randomUUID())),
          409,
        );
        assert.equal(
          await status(
            lrn.complete(
              arjunE,
              id,
              { version: 2, note: "x".repeat(281) },
              randomUUID(),
            ),
          ),
          400,
        );
        const done = await lrn.complete(
          arjunE,
          id,
          { version: 2, note: `Finished ${secret}` },
          randomUUID(),
        );
        assert.equal(done.assignment.status, "completed");
        assert.equal(done.assignment.expiresOn, null);
        assert.equal(done.assignment.renewal, null);
        assert.equal(done.history.length, 1);
        assert.equal(done.history[0]!.recordedBy, "self");
        assert.equal(done.history[0]!.note, `Finished ${secret}`);
        assert.equal(
          await status(lrn.complete(arjunE, id, { version: 3 }, randomUUID())),
          409,
        );
        // Completed: the course can be assigned again.
        const again = await assignTo(course.id, arjun);
        // Straight from assigned to completed is allowed.
        const direct = await lrn.complete(
          arjunE,
          again,
          { version: 1 },
          randomUUID(),
        );
        assert.equal(direct.assignment.status, "completed");
        assert.equal(direct.assignment.startedAt, null);
        // Employees cannot waive or record on behalf, even directly.
        const third = await assignTo(course.id, arjun);
        for (const [outcome, by] of [
          ["waived", "self"],
          ["completed", "hr"],
          ["waived", "hr"],
        ])
          assert.equal(
            await sqlState(
              scoped(pool, arjunE, (c) =>
                c.query(
                  "INSERT INTO lrn_completion(id,tenant_id,entity_id,assignment_id,outcome,recorded_by,note) VALUES ($1,$2,$3,$4,$5,$6,'Because')",
                  [
                    randomUUID(),
                    actor.tenantId,
                    actor.entityId,
                    third,
                    outcome,
                    by,
                  ],
                ),
              ),
            ),
            "LN005",
            `${outcome} ${by}`,
          );
        // Someone else's assignment answers like a missing one.
        const zaras = await assignTo(course.id, zara);
        assert.equal(
          await sqlState(
            scoped(pool, arjunE, (c) =>
              c.query(
                "INSERT INTO lrn_completion(id,tenant_id,entity_id,assignment_id,outcome,recorded_by) VALUES ($1,$2,$3,$4,'completed','self')",
                [randomUUID(), actor.tenantId, actor.entityId, zaras],
              ),
            ),
          ),
          "LN003",
        );
      },
    );

    await t.test(
      "four-eyes: HR never records or waives their own assignment",
      async () => {
        const course = await newCourse("Four eyes course");
        const own = await assignTo(course.id, maya);
        for (const kind of ["complete", "waive"] as const)
          assert.equal(
            await status(
              lrn.recordOnBehalf(
                hrMaya,
                own,
                kind,
                { version: 1, reason: `Did it ${secret}` },
                randomUUID(),
              ),
            ),
            403,
            kind,
          );
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query(
                "INSERT INTO lrn_completion(id,tenant_id,entity_id,assignment_id,outcome,recorded_by,note) VALUES ($1,$2,$3,$4,'waived','hr','Myself')",
                [randomUUID(), actor.tenantId, actor.entityId, own],
              ),
            ),
          ),
          "LN005",
        );
        const recorded = await lrn.recordOnBehalf(
          hrKabir,
          own,
          "complete",
          { version: 1, reason: `Attended in person ${secret}` },
          randomUUID(),
        );
        assert.equal(recorded.assignment.status, "completed");
        assert.equal(recorded.history[0]!.recordedBy, "hr");
        // HR completes their own like anyone else.
        const second = await assignTo(course.id, maya);
        assert.equal(
          (await lrn.complete(hrMaya, second, { version: 1 }, randomUUID()))
            .assignment.status,
          "completed",
        );
        const toRohan = await assignTo(course.id, rohan);
        const waived = await lrn.recordOnBehalf(
          hrMaya,
          toRohan,
          "waive",
          { version: 1, reason: `Already certified ${secret}` },
          randomUUID(),
        );
        assert.equal(waived.assignment.status, "waived");
        assert.equal(waived.assignment.canWaive, false);
        assert.equal(
          await status(
            lrn.recordOnBehalf(
              hrMaya,
              toRohan,
              "complete",
              { version: 2, reason: "Changed mind" },
              randomUUID(),
            ),
          ),
          409,
        );
        // The learner sees the waiver in their history.
        assert.equal((await detail(rohanE, toRohan)).history.length, 1);
      },
    );

    await t.test("overdue and renewal are derived", async () => {
      const id = (
        await lrn.listAssignments(arjunE, {
          ...page,
          view: "mine",
          courseId: mandatory.id,
        })
      ).items[0]!.id;
      assert.equal((await detail(arjunE, id)).assignment.overdue, false);
      await backdate(id, "due_on", dayOffset(-3));
      assert.equal((await detail(arjunE, id)).assignment.overdue, true);
      const overdue = await lrn.listAssignments(hrMaya, {
        ...page,
        view: "all",
        overdue: true,
        courseId: mandatory.id,
      });
      assert.deepEqual(
        overdue.items.map((i) => i.id),
        [id],
      );
      const report = await lrn.compliance(hrMaya, { page: 1, limit: 100 });
      const row = report.items.find((i) => i.courseId === mandatory.id)!;
      assert.equal(row.overdue, 1);
      assert.equal(row.notStarted, 0);
      // Completing a 12-month course sets an expiry a year out.
      const done = await lrn.complete(arjunE, id, { version: 1 }, randomUUID());
      assert.equal(done.assignment.overdue, false);
      assert.ok(done.assignment.expiresOn! > dayOffset(360));
      assert.equal(done.assignment.renewal, "current");
      assert.equal(done.history[0]!.expiresOn, done.assignment.expiresOn);
      await backdate(id, "expires_on", dayOffset(10));
      assert.equal((await detail(arjunE, id)).assignment.renewal, "due");
      const due = await lrn.listAssignments(arjunE, {
        ...page,
        view: "mine",
        renewal: "due",
      });
      assert.ok(due.items.some((i) => i.id === id));
      let compliance = await lrn.compliance(hrMaya, { page: 1, limit: 100 });
      assert.equal(
        compliance.items.find((i) => i.courseId === mandatory.id)!
          .dueForRenewal,
        1,
      );
      await backdate(id, "expires_on", dayOffset(-1));
      assert.equal((await detail(arjunE, id)).assignment.renewal, "expired");
      compliance = await lrn.compliance(hrMaya, { page: 1, limit: 100 });
      const final = compliance.items.find((i) => i.courseId === mandatory.id)!;
      assert.equal(final.expired, 1);
      assert.equal(final.completed, 1);
      assert.equal(JSON.stringify(compliance).includes(secret), true);
      // Counts only: no notes or reasons in the report.
      assert.equal(JSON.stringify(compliance).includes("Finished"), false);
    });

    await t.test("immutability and direct-statement refusals", async () => {
      const any = (
        await admin.query<{ id: string; a: string }>(
          "SELECT id, assignment_id AS a FROM lrn_completion WHERE assignment_id=ANY($1::uuid[]) LIMIT 1",
          [ids.assignments],
        )
      ).rows[0]!;
      for (const sql of [
        "UPDATE lrn_completion SET note='changed' WHERE id=$1",
        "DELETE FROM lrn_completion WHERE id=$1",
      ])
        assert.notEqual(
          await sqlState(admin.query(sql, [any.id])),
          "ok",
          `migrator: ${sql}`,
        );
      assert.notEqual(
        await sqlState(
          admin.query("DELETE FROM lrn_assignment WHERE id=$1", [any.a]),
        ),
        "ok",
      );
      for (const sql of [
        "UPDATE lrn_assignment SET due_on=CURRENT_DATE+1 WHERE id=$1",
        "UPDATE lrn_assignment SET completed_at=now() WHERE id=$1",
        "DELETE FROM lrn_assignment WHERE id=$1",
        "UPDATE lrn_completion SET note='x' WHERE id=$1",
        "DELETE FROM lrn_course WHERE id=$1",
        "TRUNCATE lrn_completion",
      ])
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query(sql, sql.includes("$1") ? [any.a] : []),
            ),
          ),
          "42501",
          sql,
        );
      // The learner cannot jump to completed without a history row.
      const course = await newCourse("Direct course");
      const id = await assignTo(course.id, arjun);
      assert.equal(
        await sqlState(
          scoped(pool, arjunE, (c) =>
            c.query(
              "UPDATE lrn_assignment SET status='completed', version=version+1 WHERE id=$1",
              [id],
            ),
          ),
        ),
        "LN004",
      );
      assert.equal(
        await sqlState(
          scoped(pool, arjunE, (c) =>
            c.query(
              "INSERT INTO lrn_course(id,tenant_id,entity_id,title,category,delivery_mode,duration_minutes) VALUES ($1,$2,$3,'Rogue','Rogue','online',5)",
              [randomUUID(), actor.tenantId, actor.entityId],
            ),
          ),
        ),
        "LN005",
      );
      // HR cannot start someone else's assignment (RLS: no row matches).
      const touched = await scoped(pool, hrMaya, (c) =>
        c.query(
          "UPDATE lrn_assignment SET status='in_progress', version=version+1 WHERE id=$1",
          [id],
        ),
      );
      assert.equal(touched.rowCount, 0);
      // 066: an audience label must match the person's unit at assign time.
      const zaraUnit = (
        await admin.query<{ d: string }>(
          "SELECT department_id AS d FROM employee WHERE id=$1",
          [zara],
        )
      ).rows[0]!.d;
      const mislabelled = (unit: string) =>
        sqlState(
          scoped(pool, hrMaya, (c) =>
            c.query(
              `INSERT INTO lrn_assignment(id,tenant_id,entity_id,course_id,employee_id,source,audience,batch_id,
                due_on,audience_unit_id) VALUES ($1,$2,$3,$4,$5,'assigned','department',$6,CURRENT_DATE+5,$7)`,
              [
                randomUUID(),
                actor.tenantId,
                actor.entityId,
                course.id,
                rohan,
                randomUUID(),
                unit,
              ],
            ),
          ),
        );
      assert.equal(await mislabelled(randomUUID()), "LN003");
      const rohanUnit = (
        await admin.query<{ d: string }>(
          "SELECT department_id AS d FROM employee WHERE id=$1",
          [rohan],
        )
      ).rows[0]!.d;
      if (rohanUnit !== zaraUnit)
        assert.equal(await mislabelled(zaraUnit), "LN003");
      // 066: learners get one answer for draft, archived and missing courses.
      const archivedCourse = ids.courses[0]!;
      for (const courseId of [archivedCourse, randomUUID()])
        assert.equal(
          await sqlState(
            scoped(pool, arjunE, (c) =>
              c.query(
                "INSERT INTO lrn_assignment(id,tenant_id,entity_id,course_id,employee_id,source,audience) VALUES ($1,$2,$3,$4,$5,'self_enrolled','self')",
                [randomUUID(), actor.tenantId, actor.entityId, courseId, arjun],
              ),
            ),
          ),
          "LN003",
        );
      // A forged self-enrolment for someone else is refused.
      assert.equal(
        await sqlState(
          scoped(pool, arjunE, (c) =>
            c.query(
              "INSERT INTO lrn_assignment(id,tenant_id,entity_id,course_id,employee_id,source,audience) VALUES ($1,$2,$3,$4,$5,'self_enrolled','self')",
              [randomUUID(), actor.tenantId, actor.entityId, optional.id, zara],
            ),
          ),
        ),
        "LN005",
      );
    });

    await t.test("067: safe links, audience cap and archive race", async () => {
      const bad = [
        "https://learn.example.test@evil.example/x",
        "https://evil.example\\@learn.example.test",
        "https://learn.example.test/'onmouseover='x",
        "https://learn.example.test/‮txt.exe",
        "https://learn.example.test/a\u0001b",
        "javascript:alert(1)//https://x.example",
        "data:text/html,<b>x</b>",
        "https://localhost/x",
        `https://learn.example.test/${"a".repeat(480)}`,
      ];
      for (const url of bad) {
        assert.equal(
          lrnCourseCreateSchema.safeParse(
            courseInput("Link", { externalUrl: url }),
          ).success,
          false,
          url,
        );
        assert.notEqual(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query(
                "INSERT INTO lrn_course(id,tenant_id,entity_id,title,category,delivery_mode,duration_minutes,external_url) VALUES ($1,$2,$3,'Link test','Links','online',5,$4)",
                [randomUUID(), actor.tenantId, actor.entityId, url],
              ),
            ),
          ),
          "ok",
          url,
        );
      }
      const good = "https://learn.example.test:8443/path/a-b_c?x=1&y=%20#top";
      assert.ok(
        lrnCourseCreateSchema.safeParse(
          courseInput("Link", { externalUrl: good }),
        ).success,
      );
      const linked = await newCourse("Good link", { externalUrl: good }, false);
      assert.equal(linked.externalUrl, good);
      // The audience snapshot refuses more than 1000 people per call.
      const src = (
        await admin.query<{ s: string }>(
          "SELECT prosrc AS s FROM pg_proc WHERE proname='lrn_audience'",
        )
      ).rows[0]!.s;
      assert.match(src, /cardinality\(ids\)>1000/);
      // Archive race: an assignment waits for a concurrent archive and then is refused.
      const course = await newCourse("Archive race");
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const held = new Promise<void>((r) => (locked = r));
      const archiving = scoped(pool, hrMaya, async (c) => {
        await c.query(
          "UPDATE lrn_course SET status='archived', version=version+1 WHERE id=$1",
          [course.id],
        );
        locked();
        await gate;
      });
      await held;
      const assigning = status(assignTo(course.id, zara));
      await new Promise((r) => setTimeout(r, 300));
      release();
      await archiving;
      assert.equal(await assigning, 409);
      const open = await admin.query(
        "SELECT 1 FROM lrn_assignment WHERE course_id=$1",
        [course.id],
      );
      assert.equal(open.rowCount, 0);
    });

    await t.test("concurrency: one winner", async () => {
      const course = await newCourse("Race course");
      const results = await Promise.all(
        [1, 2, 3].map(() => status(lrn.enrol(rohanE, course.id, randomUUID()))),
      );
      assert.deepEqual(results.sort(), [200, 409, 409]);
      const mine = await lrn.listAssignments(rohanE, {
        ...page,
        view: "mine",
        courseId: course.id,
      });
      ids.assignments.push(...mine.items.map((i) => i.id));
      const id = mine.items[0]!.id;
      const done = await Promise.all(
        [1, 2].map(() =>
          status(lrn.complete(rohanE, id, { version: 1 }, randomUUID())),
        ),
      );
      assert.deepEqual(done.sort(), [200, 409]);
      assert.equal((await detail(rohanE, id)).history.length, 1);
      const course2 = await newCourse("Race course two");
      const assigns = await Promise.all(
        [1, 2].map(() => status(assignTo(course2.id, zara))),
      );
      assert.deepEqual(assigns.sort(), [200, 409]);
    });

    await t.test("tenant and entity isolation", async () => {
      for (const who of [
        { ...hrMaya, tenantId: randomUUID() },
        { ...hrMaya, entityId: randomUUID() },
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM lrn_course)+(SELECT count(*) FROM lrn_assignment)
              +(SELECT count(*) FROM lrn_completion)
              +(SELECT count(*) FROM lrn_audience('department',(SELECT department_id FROM employee LIMIT 1))) AS n`,
          ),
        );
        assert.equal(Number(seen.rows[0]!.n), 0);
        assert.equal(await status(lrn.courseDetail(who, optional.id)), 404);
        assert.equal(await status(detail(who, ids.assignments[0]!)), 404);
      }
    });

    await t.test(
      "pagination, and no free text in audit or outbox",
      async () => {
        const p1 = await lrn.listAssignments(hrMaya, {
          page: 1,
          limit: 2,
          view: "all",
        });
        const p2 = await lrn.listAssignments(hrMaya, {
          page: 2,
          limit: 2,
          view: "all",
        });
        assert.equal(p1.items.length, 2);
        assert.ok(p1.total >= 10);
        assert.ok(p2.items.every((k) => !p1.items.some((p) => p.id === k.id)));
        const courses = await lrn.listCourses(hrMaya, {
          page: 1,
          limit: 1,
          q: secret,
        });
        assert.equal(courses.items.length, 1);
        assert.ok(courses.total >= 8);
        await changeRole("hr_admin");
        const http = (await (
          await request("/learning/assignments?view=all&limit=2&overdue=false")
        ).json()) as LrnAssignmentList;
        assert.equal(http.limit, 2);
        const auditRows = await admin.query<{
          action: string;
          details: unknown;
          reason: string | null;
        }>(
          "SELECT action, details, reason FROM audit_event WHERE action LIKE 'learn.%' AND target=ANY($1::text[])",
          [
            [
              ...ids.courses.map((i) => `lrn-course:${i}`),
              ...ids.assignments.map((i) => `lrn-assignment:${i}`),
            ],
          ],
        );
        assert.ok(auditRows.rows.length > 30);
        for (const row of auditRows.rows) {
          const text = JSON.stringify(row);
          for (const marker of [secret, "Attended", "Already", "Finished"])
            assert.ok(!text.includes(marker), `${row.action} ${text}`);
          assert.ok(
            !/note|reason"|title|description/.test(JSON.stringify(row.details)),
            text,
          );
        }
        const outbox = await admin.query<{ t: string }>(
          "SELECT DISTINCT event_type AS t FROM outbox_event WHERE event_type LIKE 'learn.%'",
        );
        for (const type of [
          "learn.course_created.v1",
          "learn.course_updated.v1",
          "learn.course_published.v1",
          "learn.course_archived.v1",
          "learn.assigned.v1",
          "learn.audience_assigned.v1",
          "learn.enrolled.v1",
          "learn.started.v1",
          "learn.completed.v1",
          "learn.completion_recorded.v1",
          "learn.waived.v1",
        ])
          assert.ok(
            outbox.rows.some((r) => r.t === type),
            type,
          );
      },
    );
  } finally {
    // Synthetic cleanup only: learning records are never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      const assignments = (
        await client.query<{ id: string; b: string | null }>(
          "SELECT id, batch_id AS b FROM lrn_assignment WHERE course_id=ANY($1::uuid[])",
          [ids.courses],
        )
      ).rows;
      const all = [
        ...ids.courses,
        ...assignments.map((r) => r.id),
        ...assignments.flatMap((r) => (r.b ? [r.b] : [])),
      ];
      await client.query(
        "DELETE FROM outbox_event WHERE event_type LIKE 'learn.%' AND aggregate_id=ANY($1::uuid[])",
        [all],
      );
      await client.query(
        "DELETE FROM audit_event WHERE action LIKE 'learn.%' AND target=ANY($1::text[])",
        [
          [
            ...ids.courses.map((i) => `lrn-course:${i}`),
            ...assignments.map((r) => `lrn-assignment:${r.id}`),
          ],
        ],
      );
      await client.query(
        "DELETE FROM lrn_completion WHERE course_id=ANY($1::uuid[])",
        [ids.courses],
      );
      await client.query(
        "DELETE FROM lrn_assignment WHERE course_id=ANY($1::uuid[])",
        [ids.courses],
      );
      await client.query("DELETE FROM lrn_course WHERE id=ANY($1::uuid[])", [
        ids.courses,
      ]);
      await restore();
    });
    await Promise.all([admin.end(), pool.end(), app.close()]);
    await store.pool.end();
  }
});
