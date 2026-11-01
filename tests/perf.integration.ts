import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { PerformanceStore } from "../apps/api/src/performance.store";
import {
  makePool,
  scoped,
  transaction,
  type PoolClient,
} from "../packages/database/src/index";
import type {
  PerfObjectiveDetail,
  PerfObjectiveList,
  PerfReview,
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

const PORT = Number(process.env.PERF_TEST_PORT ?? 4517);
// Synthetic demo people: Maya (HR, no manager) manages Arjun, Zara and Neel; Neel manages
// Rohan and Kabir (a second HR user).
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
const ratings = (n: number) => ({
  quality: n,
  delivery: n,
  collaboration: n,
  ownership: n,
  growth: n,
});
const today = new Date().toISOString().slice(0, 10);
const plusDays = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

await test("Performance: goals, key results, progress, review cycles and reviews", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const pool = makePool(process.env.DATABASE_URL!);
  const perf = new PerformanceStore(store);
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
  const mgrMaya = as(maya, "Maya (synthetic manager)", "manager");
  const arjunE = as(arjun, "Arjun (synthetic)", "employee");
  const zaraE = as(zara, "Zara (synthetic)", "employee");
  const neelM = as(neel, "Neel (synthetic manager)", "manager");
  const rohanE = as(rohan, "Rohan (synthetic)", "employee");
  const hrRohan = as(rohan, "Rohan (synthetic HR)", "hr_admin");
  const hrKabir = as(kabir, "Kabir (synthetic HR)", "hr_admin");
  const auditor = as(maya, "Maya (auditor)", "auditor");
  // Marker strings that must never reach audit or outbox rows.
  const secret = `secret-${run}`;
  const ids = { objectives: [] as string[], cycles: [] as string[] };
  const goal = async (
    who: typeof hrMaya,
    extra: Record<string, unknown> = {},
  ) => {
    const created = await perf.createObjective(
      who,
      {
        title: `Goal ${secret}`,
        description: `Why ${secret}`,
        periodStart: today,
        periodEnd: plusDays(90),
        ...extra,
      },
      randomUUID(),
    );
    ids.objectives.push(created.objective.id);
    return created;
  };
  const alwaysOff = async (client: PoolClient) => {
    const { rows } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE 'perf_%'`,
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

  let mayaGoal: PerfObjectiveDetail;
  let arjunGoal: PerfObjectiveDetail;
  let cycleId = "";
  let reviews: PerfReview[] = [];
  const reviewOf = (employeeId: string) =>
    reviews.find((r) => r.employeeId === employeeId)!;

  try {
    await t.test("access follows the performance permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/performance/objectives",
          "/performance/cycles",
          "/performance/reviews",
          "/performance/objectives/alignable",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      for (const role of ["employee", "manager", "hr_admin"] as const) {
        await changeRole(role);
        assert.equal((await request("/performance/objectives")).status, 200);
        assert.equal((await request("/performance/reviews")).status, 200);
      }
      assert.equal(
        (await request("/performance/objectives?limit=101")).status,
        400,
      );
      assert.equal(
        (await request("/performance/objectives?unknown=1")).status,
        400,
      );
      const defaults = (await (
        await request("/performance/cycles")
      ).json()) as { page: number; limit: number; canCreate: boolean };
      assert.deepEqual([defaults.page, defaults.limit], [1, 25]);
      assert.equal(defaults.canCreate, true);
      await changeRole("employee");
      const created = await send("/performance/cycles", "POST", {
        name: `Employee cycle ${run}`,
        periodStart: today,
        periodEnd: plusDays(30),
        selfDue: today,
        managerDue: plusDays(10),
      });
      assert.equal(created.status, 403);
      assert.equal(
        await status(perf.listObjectives(auditor, {} as never)),
        403,
      );
    });

    await t.test("goals: who may set them and who may see them", async () => {
      mayaGoal = await goal(hrMaya, { title: `Company goal ${secret}` });
      assert.equal(mayaGoal.objective.status, "draft");
      assert.equal(mayaGoal.objective.ownerEmployeeId, maya);
      // Someone else's draft is unpublished: not listed and not alignable until active.
      assert.equal(
        await status(
          goal(arjunE, { parentObjectiveId: mayaGoal.objective.id }),
        ),
        400,
      );
      assert.ok(
        !(await perf.alignable(arjunE, {})).items.some(
          (i) => i.id === mayaGoal.objective.id,
        ),
      );
      await perf.addKeyResult(
        hrMaya,
        mayaGoal.objective.id,
        {
          title: `Company KR ${secret}`,
          unit: "percent",
          startValue: 0,
          targetValue: 100,
        },
        randomUUID(),
      );
      mayaGoal = await perf.objectiveStep(
        hrMaya,
        mayaGoal.objective.id,
        "activate",
        { version: mayaGoal.objective.version },
        randomUUID(),
      );
      arjunGoal = await goal(arjunE, {
        parentObjectiveId: mayaGoal.objective.id,
      });
      assert.equal(arjunGoal.objective.ownerName, "Arjun Mehta");
      assert.equal(
        arjunGoal.objective.parentObjectiveId,
        mayaGoal.objective.id,
      );
      // Arjun cannot see his manager's goal itself, only its id and title for alignment.
      assert.equal(arjunGoal.objective.parentTitle, null);
      const alignable = await perf.alignable(arjunE, {});
      assert.ok(alignable.items.some((i) => i.id === mayaGoal.objective.id));
      // An employee sets only their own goals; a manager their direct reports'.
      assert.equal(await status(goal(arjunE, { ownerEmployeeId: zara })), 403);
      const forArjun = await goal(mgrMaya, { ownerEmployeeId: arjun });
      assert.equal(forArjun.objective.ownerEmployeeId, arjun);
      assert.equal(
        await status(goal(mgrMaya, { ownerEmployeeId: rohan })),
        403,
      );
      const forRohan = await goal(neelM, { ownerEmployeeId: rohan });
      // Alignment: own or the manager's goals; HR may align anywhere but never in a loop.
      assert.equal(
        await status(
          goal(rohanE, { parentObjectiveId: arjunGoal.objective.id }),
        ),
        400,
      );
      // Own drafts are alignable, but never in a loop.
      const sub = await goal(arjunE, {
        parentObjectiveId: arjunGoal.objective.id,
      });
      await assert.rejects(
        perf.updateObjective(
          arjunE,
          arjunGoal.objective.id,
          {
            title: arjunGoal.objective.title,
            periodStart: today,
            periodEnd: plusDays(90),
            parentObjectiveId: sub.objective.id,
            version: arjunGoal.objective.version,
          },
          randomUUID(),
        ),
        /loop/,
      );
      // Visibility: employee own, manager team, HR entity.
      const mine = await perf.listObjectives(arjunE, {
        page: 1,
        limit: 100,
        q: secret,
        view: "all",
      });
      assert.ok(mine.items.length >= 2);
      assert.ok(mine.items.every((i) => i.ownerEmployeeId === arjun));
      assert.equal(
        await status(perf.objectiveDetail(zaraE, arjunGoal.objective.id)),
        404,
      );
      assert.equal(
        await status(perf.objectiveDetail(neelM, arjunGoal.objective.id)),
        404,
      );
      assert.equal(
        await status(perf.objectiveDetail(mgrMaya, arjunGoal.objective.id)),
        200,
      );
      const team = await perf.listObjectives(mgrMaya, {
        page: 1,
        limit: 100,
        q: secret,
        view: "team",
      });
      assert.ok(team.items.some((i) => i.id === arjunGoal.objective.id));
      assert.ok(!team.items.some((i) => i.id === forRohan.objective.id));
      assert.ok(!team.items.some((i) => i.ownerEmployeeId === maya));
      const all = await perf.listObjectives(hrMaya, {
        page: 1,
        limit: 100,
        q: secret,
        view: "all",
      });
      assert.equal(all.total, ids.objectives.length);
      // Maya's own view of her company goal shows the aligned child.
      const withChild = await perf.objectiveDetail(
        hrMaya,
        mayaGoal.objective.id,
      );
      assert.ok(
        withChild.children.some((c) => c.id === arjunGoal.objective.id),
      );
    });

    await t.test(
      "key results, append-only progress and derived progress",
      async () => {
        const goalId = arjunGoal.objective.id;
        assert.equal(
          await status(
            perf.objectiveStep(
              arjunE,
              goalId,
              "activate",
              { version: arjunGoal.objective.version },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await status(
            perf.addKeyResult(
              arjunE,
              goalId,
              {
                title: `KR ${secret}`,
                unit: "percent",
                startValue: 0,
                targetValue: 120,
              },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await status(
            perf.addKeyResult(
              arjunE,
              goalId,
              {
                title: `KR ${secret}`,
                unit: "number",
                startValue: 5,
                targetValue: 5,
              },
              randomUUID(),
            ),
          ),
          400,
        );
        let detail = await perf.addKeyResult(
          arjunE,
          goalId,
          {
            title: `KR ${secret}`,
            unit: "number",
            startValue: 0,
            targetValue: 10,
          },
          randomUUID(),
        );
        const kr = detail.keyResults[0]!;
        assert.equal(kr.currentValue, 0);
        assert.equal(kr.canEdit, true);
        // Edit the target while a draft.
        detail = await perf.updateKeyResult(
          arjunE,
          kr.id,
          {
            title: kr.title,
            unit: "number",
            startValue: 0,
            targetValue: 20,
            version: kr.version,
          },
          randomUUID(),
        );
        assert.equal(detail.keyResults[0]!.targetValue, 20);
        // No progress on a draft.
        assert.equal(
          await status(
            perf.recordProgress(
              arjunE,
              kr.id,
              { value: 1, version: detail.keyResults[0]!.version },
              randomUUID(),
            ),
          ),
          409,
        );
        detail = await perf.objectiveStep(
          arjunE,
          goalId,
          "activate",
          { version: detail.objective.version },
          randomUUID(),
        );
        assert.equal(detail.objective.status, "active");
        const active = detail.keyResults[0]!;
        // Targets are fixed once active.
        assert.equal(
          await status(
            perf.updateKeyResult(
              arjunE,
              kr.id,
              {
                title: kr.title,
                unit: "number",
                startValue: 0,
                targetValue: 5,
                version: active.version,
              },
              randomUUID(),
            ),
          ),
          409,
        );
        detail = await perf.recordProgress(
          arjunE,
          kr.id,
          {
            value: 4242.42 % 10,
            version: active.version,
            note: `Note ${secret}`,
          },
          randomUUID(),
        );
        // The manager may record progress too.
        detail = await perf.recordProgress(
          mgrMaya,
          kr.id,
          { value: 10, version: detail.keyResults[0]!.version },
          randomUUID(),
        );
        assert.equal(detail.keyResults[0]!.currentValue, 10);
        assert.equal(detail.keyResults[0]!.progress, 50);
        assert.equal(detail.objective.progress, 50);
        // Stale version, and someone outside the goal.
        assert.equal(
          await status(
            perf.recordProgress(
              arjunE,
              kr.id,
              { value: 12, version: active.version },
              randomUUID(),
            ),
          ),
          409,
        );
        assert.equal(
          await status(
            perf.recordProgress(
              zaraE,
              kr.id,
              { value: 12, version: detail.keyResults[0]!.version },
              randomUUID(),
            ),
          ),
          404,
        );
        // Concurrency: two updates on the same version, exactly one lands.
        const race = await Promise.allSettled([
          perf.recordProgress(
            arjunE,
            kr.id,
            { value: 30, version: detail.keyResults[0]!.version },
            randomUUID(),
          ),
          perf.recordProgress(
            mgrMaya,
            kr.id,
            { value: 31, version: detail.keyResults[0]!.version },
            randomUUID(),
          ),
        ]);
        assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
        const after = await perf.objectiveDetail(arjunE, goalId);
        assert.equal(after.keyResults[0]!.progress, 100); // clamped
        const history = await perf.progressHistory(arjunE, kr.id, {
          page: 1,
          limit: 2,
        });
        assert.equal(history.total, 3);
        assert.equal(history.items.length, 2);
        assert.equal(history.items[1]!.value, 10);
        assert.equal(history.items[1]!.previousValue, 2.42);
        const last = await perf.progressHistory(arjunE, kr.id, {
          page: 2,
          limit: 2,
        });
        assert.equal(last.items[0]!.note, `Note ${secret}`);
        assert.equal(
          await status(
            perf.progressHistory(zaraE, kr.id, { page: 1, limit: 2 }),
          ),
          404,
        );
        // Completing makes it final.
        const done = await perf.objectiveStep(
          arjunE,
          goalId,
          "complete",
          { version: after.objective.version },
          randomUUID(),
        );
        assert.equal(done.objective.canEdit, false);
        assert.equal(
          await status(
            perf.objectiveStep(
              arjunE,
              goalId,
              "cancel",
              { version: done.objective.version, note: "Not needed now" },
              randomUUID(),
            ),
          ),
          409,
        );
        // Cancelling needs a reason.
        const spare = await goal(arjunE);
        assert.equal(
          await status(
            perf.objectiveStep(
              arjunE,
              spare.objective.id,
              "cancel",
              { version: 1 },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          (
            await perf.objectiveStep(
              arjunE,
              spare.objective.id,
              "cancel",
              { version: 1, note: `Dropped ${secret}` },
              randomUUID(),
            )
          ).objective.status,
          "cancelled",
        );
      },
    );

    await t.test(
      "review cycles: HR opens one and reviews are generated",
      async () => {
        const body = {
          name: `Cycle ${secret}`,
          periodStart: today,
          periodEnd: plusDays(60),
          selfDue: plusDays(10),
          managerDue: plusDays(20),
        };
        assert.equal(
          await status(perf.createCycle(mgrMaya, body, randomUUID())),
          403,
        );
        assert.equal(
          await status(
            perf.createCycle(
              hrMaya,
              { ...body, name: `Bad ${run}`, selfDue: plusDays(30) },
              randomUUID(),
            ),
          ),
          400,
        );
        const cycle = await perf.createCycle(hrMaya, body, randomUUID());
        ids.cycles.push(cycle.id);
        cycleId = cycle.id;
        assert.equal(cycle.status, "draft");
        assert.equal(
          await status(perf.createCycle(hrMaya, body, randomUUID())),
          409,
        );
        const edited = await perf.updateCycle(
          hrMaya,
          cycle.id,
          { ...body, managerDue: plusDays(25), version: cycle.version },
          randomUUID(),
        );
        const expected = (
          await admin.query<{ managed: number; skipped: number }>(
            `SELECT count(*) FILTER (WHERE e.manager_id IS NOT NULL AND m.status IN ('active','notice'))::int AS managed,
             count(*) FILTER (WHERE NOT (e.manager_id IS NOT NULL AND coalesce(m.status IN ('active','notice'),false)))::int AS skipped
           FROM employee e LEFT JOIN employee m ON m.id=e.manager_id
           WHERE e.tenant_id=$1 AND e.entity_id=$2 AND e.status IN ('active','notice')`,
            [actor.tenantId, actor.entityId],
          )
        ).rows[0]!;
        const opened = await perf.openCycle(
          hrMaya,
          cycle.id,
          { version: edited.version },
          randomUUID(),
        );
        assert.equal(opened.cycle.status, "active");
        assert.equal(opened.generated, expected.managed);
        assert.equal(opened.skippedNoManager, expected.skipped);
        assert.ok(opened.skippedNoManager >= 1); // Maya has no manager
        assert.equal(
          await status(
            perf.updateCycle(
              hrMaya,
              cycle.id,
              { ...body, version: opened.cycle.version },
              randomUUID(),
            ),
          ),
          409,
        );
        reviews = (
          await perf.listReviews(hrMaya, {
            page: 1,
            limit: 100,
            q: "",
            cycleId,
            view: "all",
          })
        ).items;
        assert.equal(reviews.length, expected.managed);
        assert.equal(reviewOf(arjun).managerId, maya);
        assert.equal(reviewOf(rohan).managerId, neel);
        assert.equal(
          reviews.find((r) => r.employeeId === maya),
          undefined,
        );
        // Visibility: own review; a manager also the ones they write; HR all.
        const zaraSees = await perf.listReviews(zaraE, {
          page: 1,
          limit: 100,
          q: "",
          cycleId,
          view: "all",
        });
        assert.deepEqual(
          zaraSees.items.map((r) => r.employeeId),
          [zara],
        );
        const mayaTeam = await perf.listReviews(mgrMaya, {
          page: 1,
          limit: 100,
          q: "",
          cycleId,
          view: "team",
        });
        assert.deepEqual(
          mayaTeam.items.map((r) => r.employeeId).sort(),
          [arjun, zara, neel].sort(),
        );
        assert.equal(
          await status(perf.reviewDetail(mgrMaya, reviewOf(rohan).id)),
          404,
        );
        assert.equal(
          await status(perf.reviewDetail(neelM, reviewOf(rohan).id)),
          200,
        );
        // A cycle is visible to people who have a review in it.
        assert.equal(await status(perf.cycleDetail(zaraE, cycleId)), 200);
        // Pagination over HTTP.
        await changeRole("hr_admin");
        const page = (await (
          await request(
            `/performance/reviews?cycleId=${cycleId}&limit=3&page=2`,
          )
        ).json()) as {
          total: number;
          page: number;
          limit: number;
          items: unknown[];
          counts: Record<string, number>;
        };
        assert.equal(page.total, expected.managed);
        assert.equal(page.page, 2);
        assert.equal(
          page.items.length,
          Math.min(3, Math.max(0, expected.managed - 3)),
        );
        assert.equal(page.counts.self_pending, expected.managed);
      },
    );

    await t.test(
      "blind reviews, immutability and four-eyes finalisation",
      async () => {
        const a = reviewOf(arjun);
        const submit = (
          who: typeof hrMaya,
          r: PerfReview,
          kind: "self" | "manager",
          n = 4,
        ) =>
          perf.submitReview(
            who,
            r.id,
            kind,
            {
              version: r.version,
              ratings: ratings(n),
              comment: `Comment ${secret}`,
            },
            randomUUID(),
          );
        assert.equal(await status(submit(mgrMaya, a, "manager")), 409); // self first
        assert.equal(await status(submit(zaraE, a, "self")), 404);
        assert.equal(await status(submit(mgrMaya, a, "self")), 403);
        assert.equal(
          await status(
            perf.submitReview(
              arjunE,
              a.id,
              "self",
              { version: a.version + 5, ratings: ratings(3) },
              randomUUID(),
            ),
          ),
          409,
        );
        const selfDone = await submit(arjunE, a, "self", 3);
        assert.equal(selfDone.review.status, "manager_pending");
        assert.equal(selfDone.entries.length, 1);
        assert.equal(selfDone.entries[0]!.overall, 3);
        assert.equal(
          await status(submit(arjunE, selfDone.review, "self")),
          409,
        );
        // Blind: the manager does not see the self-review yet, not even with a direct query.
        const mgrView = await perf.reviewDetail(mgrMaya, a.id);
        assert.equal(mgrView.blind, true);
        assert.equal(mgrView.entries.length, 0);
        assert.equal(mgrView.review.canSubmitManager, true);
        const direct = await scoped(pool, mgrMaya, (client) =>
          client.query("SELECT 1 FROM perf_review_entry WHERE review_id=$1", [
            a.id,
          ]),
        );
        assert.equal(direct.rowCount, 0);
        // HR as Maya is the manager here, so the manager rules apply to her too.
        assert.equal((await perf.reviewDetail(hrMaya, a.id)).entries.length, 0);
        // A manager in their employee workspace cannot write a manager review.
        assert.equal(
          await status(
            submit(as(maya, "Maya", "employee"), mgrView.review, "manager"),
          ),
          403,
        );
        const mgrDone = await submit(mgrMaya, mgrView.review, "manager", 5);
        assert.equal(mgrDone.review.status, "calibration");
        assert.equal(mgrDone.blind, false);
        assert.equal(mgrDone.entries.length, 2);
        // The employee does not see the manager review until finalised.
        const arjunView = await perf.reviewDetail(arjunE, a.id);
        assert.deepEqual(
          arjunView.entries.map((e) => e.kind),
          ["self"],
        );
        assert.equal(arjunView.review.finalRating, null);
        // Four-eyes: not the employee, not the reviewing manager, not outside HR.
        const fin = (who: typeof hrMaya, version: number) =>
          perf.finaliseReview(
            who,
            a.id,
            { version, finalRating: 4, reason: `Calibrated ${secret}` },
            randomUUID(),
          );
        assert.equal(await status(fin(arjunE, mgrDone.review.version)), 403);
        assert.equal(await status(fin(mgrMaya, mgrDone.review.version)), 403);
        assert.equal(await status(fin(hrMaya, mgrDone.review.version)), 403);
        assert.equal(mgrDone.review.canFinalise, false);
        assert.equal(
          await status(
            perf.finaliseReview(
              hrKabir,
              a.id,
              {
                version: mgrDone.review.version,
                finalRating: 4,
                reason: "short",
              },
              randomUUID(),
            ),
          ),
          400,
        );
        const kabirView = await perf.reviewDetail(hrKabir, a.id);
        assert.equal(kabirView.entries.length, 2);
        assert.equal(kabirView.review.canFinalise, true);
        const finalised = await fin(hrKabir, mgrDone.review.version);
        assert.equal(finalised.review.status, "finalised");
        assert.equal(finalised.review.finalRating, 4);
        assert.equal(finalised.review.finalisedBy, "Kabir (synthetic HR)");
        // Now the employee sees the results.
        const result = await perf.reviewDetail(arjunE, a.id);
        assert.equal(result.entries.length, 2);
        assert.equal(result.review.finalRating, 4);
        // Finalised reviews and submitted entries never change.
        assert.equal(await status(fin(hrKabir, finalised.review.version)), 409);
        await assert.rejects(
          scoped(pool, hrKabir, (client) =>
            client.query(
              "UPDATE perf_review SET final_reason='Changed afterwards', version=version+1 WHERE id=$1",
              [a.id],
            ),
          ),
          /never changes/,
        );
        // HR cannot finalise their own review.
        const r = reviewOf(rohan);
        const rSelf = await submit(rohanE, r, "self", 2);
        const rMgr = await submit(neelM, rSelf.review, "manager", 3);
        assert.equal(
          await status(
            perf.finaliseReview(
              hrRohan,
              r.id,
              {
                version: rMgr.review.version,
                finalRating: 3,
                reason: `Own review ${secret}`,
              },
              randomUUID(),
            ),
          ),
          403,
        );
        // HR who is not involved sees every entry of someone else's review.
        const z = reviewOf(zara);
        await submit(zaraE, z, "self", 5);
        assert.equal(
          (await perf.reviewDetail(hrKabir, z.id)).entries.length,
          1,
        );
        // The cycle closes only once every review is finalised.
        const cycle = await perf.cycleDetail(hrMaya, cycleId);
        assert.equal(cycle.canClose, false);
        assert.equal(
          await status(
            perf.cycleStep(
              hrMaya,
              cycleId,
              "close",
              { version: cycle.version },
              randomUUID(),
            ),
          ),
          409,
        );
        // Concurrency: two HR users finalise the same review at once; one wins.
        const race = await Promise.allSettled([
          perf.finaliseReview(
            hrKabir,
            r.id,
            {
              version: rMgr.review.version,
              finalRating: 3,
              reason: `Race one ${secret}`,
            },
            randomUUID(),
          ),
          perf.finaliseReview(
            hrMaya,
            r.id,
            {
              version: rMgr.review.version,
              finalRating: 2,
              reason: `Race two ${secret}`,
            },
            randomUUID(),
          ),
        ]);
        assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
      },
    );

    await t.test("direct statements as the app role are refused", async () => {
      const goalId = arjunGoal.objective.id;
      for (const sql of [
        "UPDATE perf_objective SET progress=1 WHERE id=$1",
        "UPDATE perf_key_result SET current_value=1 WHERE objective_id=$1",
        "UPDATE perf_kr_update SET value=1 WHERE objective_id=$1",
        "UPDATE perf_objective SET owner_employee_id=owner_employee_id WHERE id=$1",
        "DELETE FROM perf_objective WHERE id=$1",
        "DELETE FROM perf_kr_update WHERE objective_id=$1",
      ])
        await assert.rejects(
          scoped(pool, hrMaya, (client) => client.query(sql, [goalId])),
          /permission denied/,
          sql,
        );
      for (const sql of [
        "UPDATE perf_review_entry SET comment='x' WHERE review_id=$1",
        "UPDATE perf_review SET status='finalised' WHERE id=$1",
        "UPDATE perf_review SET self_submitted_at=now() WHERE id=$1",
        "DELETE FROM perf_review WHERE id=$1",
      ])
        await assert.rejects(
          scoped(pool, hrKabir, (client) =>
            client.query(sql, [reviewOf(arjun).id]),
          ),
          /permission denied/,
          sql,
        );
      // Forged rows: another person's self-review, and a progress update as someone else.
      await assert.rejects(
        scoped(pool, zaraE, (client) =>
          client.query(
            `INSERT INTO perf_review_entry(id,tenant_id,entity_id,review_id,kind,ratings) VALUES ($1,$2,$3,$4,'self',$5)`,
            [
              randomUUID(),
              actor.tenantId,
              actor.entityId,
              reviewOf(neel).id,
              JSON.stringify(ratings(5)),
            ],
          ),
        ),
        /Only the person reviewed/,
      );
      await assert.rejects(
        scoped(pool, neelM, (client) =>
          client.query(
            `INSERT INTO perf_review(id,tenant_id,entity_id,cycle_id,employee_id) VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), actor.tenantId, actor.entityId, cycleId, neel],
          ),
        ),
        /row-level security|Only HR/,
      );
      // A partial or out-of-range rating set is refused by the guard too.
      await assert.rejects(
        scoped(pool, neelM, (client) =>
          client.query(
            `INSERT INTO perf_review_entry(id,tenant_id,entity_id,review_id,kind,ratings) VALUES ($1,$2,$3,$4,'self',$5)`,
            [
              randomUUID(),
              actor.tenantId,
              actor.entityId,
              reviewOf(neel).id,
              JSON.stringify({ quality: 6 }),
            ],
          ),
        ),
        /Rate quality/,
      );
      await assert.rejects(
        admin.query("DELETE FROM perf_objective WHERE id=$1", [goalId]),
        /never deleted/,
      );
      // Tenant isolation: another tenant or entity reads nothing.
      for (const who of [
        { ...hrMaya, tenantId: randomUUID() },
        { ...hrMaya, entityId: randomUUID() },
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM perf_objective WHERE id=ANY($1::uuid[]))
              +(SELECT count(*) FROM perf_key_result WHERE objective_id=ANY($1::uuid[]))
              +(SELECT count(*) FROM perf_kr_update WHERE objective_id=ANY($1::uuid[]))
              +(SELECT count(*) FROM perf_cycle WHERE id=ANY($2::uuid[]))
              +(SELECT count(*) FROM perf_review WHERE cycle_id=ANY($2::uuid[]))
              +(SELECT count(*) FROM perf_review_entry WHERE cycle_id=ANY($2::uuid[])) AS n`,
            [ids.objectives, ids.cycles],
          ),
        );
        assert.equal(Number(seen.rows[0]!.n), 0);
        assert.equal(await status(perf.objectiveDetail(who, goalId)), 404);
      }
      // Auditors and platform admins read nothing either.
      const none = await scoped(pool, auditor, (client) =>
        client.query<{ n: string }>(
          "SELECT (SELECT count(*) FROM perf_objective)+(SELECT count(*) FROM perf_review) AS n",
        ),
      );
      assert.equal(Number(none.rows[0]!.n), 0);
    });

    await t.test("security review fixes (058)", async () => {
      // Alignment never reveals whether a goal id exists or its status: one message for all.
      for (const parent of [
        randomUUID(),
        arjunGoal.objective.id,
        mayaGoal.objective.id,
      ])
        await assert.rejects(
          goal(rohanE, { parentObjectiveId: parent }),
          /Align to one of the goals listed as alignable/,
        );
      // Adding a key result to a goal you cannot see is a plain 404.
      assert.equal(
        await status(
          perf.addKeyResult(
            zaraE,
            arjunGoal.objective.id,
            {
              title: "Hidden KR",
              unit: "number",
              startValue: 0,
              targetValue: 1,
            },
            randomUUID(),
          ),
        ),
        404,
      );
      // Percent progress stays within 0..100.
      const company = await perf.objectiveDetail(hrMaya, mayaGoal.objective.id);
      const pct = company.keyResults.find((k) => k.unit === "percent")!;
      await assert.rejects(
        perf.recordProgress(
          hrMaya,
          pct.id,
          { version: pct.version, value: 150 },
          randomUUID(),
        ),
        /Percentages run from 0 to 100/,
      );
      // perf_sees_entry answers only about reviews in the caller's tenant and entity.
      const r = reviewOf(arjun);
      const ask = (who: typeof arjunE) =>
        scoped(pool, who, (client) =>
          client.query<{ v: boolean }>(
            "SELECT perf_sees_entry($1,'manager',$2,$3) AS v",
            [r.id, arjun, r.managerId],
          ),
        );
      assert.equal(
        (await ask(arjunE)).rows[0]!.v,
        r.status === "finalised" ||
          (
            await admin.query<{ s: string }>(
              "SELECT status AS s FROM perf_review WHERE id=$1",
              [r.id],
            )
          ).rows[0]!.s === "finalised",
      );
      for (const who of [
        { ...arjunE, tenantId: randomUUID() },
        { ...arjunE, entityId: randomUUID() },
      ])
        assert.equal((await ask(who)).rows[0]!.v, false);
      // TRUNCATE is blocked even for the table owner.
      for (const table of ["perf_review_entry", "perf_kr_update"]) {
        const client = await admin.connect();
        try {
          await client.query("BEGIN");
          await assert.rejects(
            client.query(`TRUNCATE ${table}`),
            /never deleted/,
          );
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
    });

    await t.test(
      "no titles, names, comments, reasons or ratings in audit or outbox",
      async () => {
        const krs = (
          await admin.query<{ id: string }>(
            "SELECT id FROM perf_key_result WHERE objective_id=ANY($1::uuid[])",
            [ids.objectives],
          )
        ).rows.map((r) => r.id);
        const revs = reviews.map((r) => r.id);
        const rows = await admin.query<{ row: string }>(
          `SELECT (details::text || coalesce(reason,'') || target) AS row FROM audit_event WHERE target=ANY($1::text[])
         UNION ALL SELECT row_to_json(o)::text FROM outbox_event o WHERE aggregate_id=ANY($2::uuid[])`,
          [
            [
              ...ids.objectives.map((id) => `perf-objective:${id}`),
              ...krs.map((id) => `perf-key-result:${id}`),
              ...ids.cycles.map((id) => `perf-cycle:${id}`),
              ...revs.map((id) => `perf-review:${id}`),
            ],
            [...ids.objectives, ...krs, ...ids.cycles, ...revs],
          ],
        );
        assert.ok(rows.rows.length > 20);
        for (const { row } of rows.rows) {
          assert.ok(!row.includes(secret), "no free text");
          for (const name of ["Arjun", "Zara", "Rohan", "Neel", "Kabir"])
            assert.ok(!row.includes(name), "no names");
          assert.ok(
            !/"ratings"|"finalRating"|"value"/.test(row),
            "no ratings or values",
          );
        }
        const types = await admin.query<{ t: string }>(
          "SELECT DISTINCT event_type AS t FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
          [[...ids.objectives, ...krs, ...ids.cycles, ...revs]],
        );
        for (const type of [
          "performance.objective_created.v1",
          "performance.key_result_added.v1",
          "performance.progress_recorded.v1",
          "performance.cycle_status_changed.v1",
          "performance.review_self_submitted.v1",
          "performance.review_manager_submitted.v1",
          "performance.review_finalised.v1",
        ])
          assert.ok(
            types.rows.some((r) => r.t === type),
            type,
          );
        const list = (await (
          await request(`/performance/objectives?q=${secret}&limit=2&page=1`)
        ).json()) as PerfObjectiveList;
        assert.equal(list.items.length, 2);
        assert.equal(list.total, ids.objectives.length);
      },
    );
  } finally {
    // Synthetic cleanup only: performance history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      const krs = (
        await client.query<{ id: string }>(
          "SELECT id FROM perf_key_result WHERE objective_id=ANY($1::uuid[])",
          [ids.objectives],
        )
      ).rows.map((r) => r.id);
      const revs = (
        await client.query<{ id: string }>(
          "SELECT id FROM perf_review WHERE cycle_id=ANY($1::uuid[])",
          [ids.cycles],
        )
      ).rows.map((r) => r.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...ids.objectives, ...krs, ...ids.cycles, ...revs]],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[])",
        [
          [
            ...ids.objectives.map((id) => `perf-objective:${id}`),
            ...krs.map((id) => `perf-key-result:${id}`),
            ...ids.cycles.map((id) => `perf-cycle:${id}`),
            ...revs.map((id) => `perf-review:${id}`),
          ],
        ],
      );
      await client.query(
        "DELETE FROM perf_review_entry WHERE cycle_id=ANY($1::uuid[])",
        [ids.cycles],
      );
      await client.query(
        "DELETE FROM perf_review WHERE cycle_id=ANY($1::uuid[])",
        [ids.cycles],
      );
      await client.query("DELETE FROM perf_cycle WHERE id=ANY($1::uuid[])", [
        ids.cycles,
      ]);
      await client.query(
        "DELETE FROM perf_kr_update WHERE objective_id=ANY($1::uuid[])",
        [ids.objectives],
      );
      await client.query(
        "DELETE FROM perf_key_result WHERE objective_id=ANY($1::uuid[])",
        [ids.objectives],
      );
      await client.query(
        "DELETE FROM perf_objective WHERE id=ANY($1::uuid[])",
        [ids.objectives],
      );
      await restore();
    });
    await Promise.all([admin.end(), pool.end(), app.close()]);
    await store.pool.end();
  }
});
