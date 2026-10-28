import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { ProjectStore } from "../apps/api/src/project.store";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import type {
  MyTime,
  Project,
  ProjectList,
  ProjectMemberList,
  ProjectTask,
  Role,
  TimeEntry,
  TimeReview,
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

const PORT = Number(process.env.PROJECTS_TEST_PORT ?? 4511);
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
// Arjun reports to Maya (the demo identity); Rohan reports to someone else.
const arjun = "30000000-0000-4000-8000-000000000002";
const rohan = "30000000-0000-4000-8000-000000000006";
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

await test("Projects: membership, tasks, time logging, approval and the guards underneath", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const projects = new ProjectStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const ids = {
    projects: [] as string[],
    members: [] as string[],
    tasks: [] as string[],
  };
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
  const as = (employeeId: string, name: string, role: Role = "employee") => ({
    ...actor,
    employeeId,
    role,
    name,
  });
  const arjunE = as(arjun, "Arjun (synthetic)");
  const rohanE = as(rohan, "Rohan (synthetic)");
  const rohanHr = as(rohan, "Rohan (synthetic HR)", "hr_admin");
  const today = (
    await admin.query<{ today: string }>(
      `SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS today FROM legal_entity WHERE id=$1`,
      [actor.entityId],
    )
  ).rows[0]!.today;
  const timeIds = async () =>
    (
      await admin.query<{ id: string }>(
        "SELECT id FROM time_entry WHERE project_id=ANY($1::uuid[])",
        [ids.projects],
      )
    ).rows.map((r) => r.id);
  const createProject = async (body: Record<string, unknown>) => {
    const response = await send("/projects", "POST", {
      name: `Synthetic project ${run}`,
      startDate: addDays(today, -30),
      ...body,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const project = (await response.json()) as Project;
    ids.projects.push(project.id);
    return project;
  };
  const log = (who: typeof arjunE, body: Record<string, unknown>) =>
    projects.logTime(
      who,
      {
        taskId: null,
        note: null,
        workDate: today,
        minutes: 60,
        ...body,
      } as never,
      randomUUID(),
    );
  const added = (mine: MyTime, known: Set<string>) => {
    const fresh = mine.items.filter((item) => !known.has(item.id));
    assert.equal(fresh.length, 1);
    known.add(fresh[0]!.id);
    return fresh[0]!;
  };
  const seen = new Set<string>();
  // Rohan gets a synthetic manager binding so he can own projects; removed in cleanup.
  const rohanBinding = randomUUID();
  await admin.query(
    `INSERT INTO identity_binding(id,tenant_id,entity_id,employee_id,issuer,subject,active,roles)
     VALUES ($1,$2,$3,$4,'urn:anvione:projects-test',$5,true,ARRAY['employee','manager'])`,
    [rohanBinding, actor.tenantId, actor.entityId, rohan, `projects-${run}`],
  );
  let p1: Project;
  let p2: Project;
  let task: ProjectTask;
  let arjunEntry: TimeEntry;

  try {
    await t.test("access follows the project permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of ["/projects", "/time/mine", "/time/review"])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      await changeRole("employee");
      assert.equal((await request("/projects")).status, 200);
      assert.equal((await request("/time/mine")).status, 200);
      assert.equal((await request("/time/review")).status, 403);
      const denied = await send("/projects", "POST", {
        code: `E${run}`,
        name: "Not allowed",
        startDate: today,
      });
      assert.equal(denied.status, 403);
      await changeRole("hr_admin");
      assert.equal((await request("/time/review")).status, 200);
      assert.equal(
        (await request("/time/mine")).status,
        403,
        "HR logs time as an employee or manager",
      );
    });

    await t.test(
      "managers create projects they own; HR assigns owners",
      async () => {
        await changeRole("manager");
        const bad = await send("/projects", "POST", {
          code: "lower",
          name: "Bad code",
          startDate: today,
        });
        assert.equal(bad.status, 400);
        const backwards = await send("/projects", "POST", {
          code: `B${run}`,
          name: "Backwards",
          startDate: today,
          endDate: addDays(today, -1),
        });
        assert.equal(backwards.status, 400);
        const forOther = await send("/projects", "POST", {
          code: `O${run}`,
          name: "For someone else",
          startDate: today,
          ownerEmployeeId: arjun,
        });
        assert.equal(forOther.status, 403);
        p1 = await createProject({ code: `P${run}`, status: "active" });
        assert.equal(p1.ownerEmployeeId, actor.employeeId);
        assert.equal(p1.version, 1);
        assert.ok(p1.canManage && p1.canLogTime && !p1.canReopen);
        const duplicate = await send("/projects", "POST", {
          code: `P${run}`,
          name: "Duplicate",
          startDate: today,
        });
        assert.equal(duplicate.status, 409);
        await changeRole("hr_admin");
        const notManager = await send("/projects", "POST", {
          code: `N${run}`,
          name: "Owned by a non-manager",
          startDate: today,
          ownerEmployeeId: arjun,
        });
        assert.equal(notManager.status, 400, "owners must be able to manage");
        p2 = await createProject({ code: `Q${run}`, ownerEmployeeId: rohan });
        assert.equal(p2.ownerEmployeeId, rohan);
        assert.equal(p2.status, "planned");
        const list = (await (await request("/projects")).json()) as ProjectList;
        assert.ok(list.items.some((p) => p.id === p1.id));
        assert.ok(list.items.some((p) => p.id === p2.id));
        assert.equal(list.limit, 200);
        // The manager does not see a project they neither own nor belong to.
        await changeRole("manager");
        assert.equal((await request(`/projects/${p2.id}`)).status, 404);
        const update = await send(`/projects/${p2.id}`, "PUT", {
          version: 1,
          name: "Taken over",
          ownerEmployeeId: actor.employeeId,
          startDate: today,
        });
        assert.equal(update.status, 404);
      },
    );

    await t.test("members see their projects; others do not", async () => {
      await changeRole("manager");
      assert.equal(await status(projects.detail(arjunE, p1.id)), 404);
      const addedMember = await send(`/projects/${p1.id}/members`, "POST", {
        employeeId: arjun,
      });
      assert.equal(addedMember.status, 201, await addedMember.clone().text());
      const members = (await addedMember.json()) as ProjectMemberList;
      assert.equal(members.counts.active, 1);
      ids.members.push(...members.items.map((m) => m.id));
      assert.equal(members.items[0]!.role, "member");
      const again = await send(`/projects/${p1.id}/members`, "POST", {
        employeeId: arjun,
      });
      assert.equal(again.status, 409);
      const seenByArjun = await projects.detail(arjunE, p1.id);
      assert.ok(seenByArjun.canLogTime && !seenByArjun.canManage);
      assert.equal(await status(projects.detail(rohanE, p1.id)), 404);
      assert.equal(
        await status(
          projects.addMember(
            arjunE,
            p1.id,
            { employeeId: rohan, role: "member" },
            randomUUID(),
          ),
        ),
        403,
      );
    });

    await t.test(
      "tasks go to current members; assignees move their status",
      async () => {
        await changeRole("manager");
        const notMember = await send(`/projects/${p1.id}/tasks`, "POST", {
          title: "Owner is not a member",
          assigneeEmployeeId: rohan,
        });
        assert.equal(notMember.status, 400);
        const created = await send(`/projects/${p1.id}/tasks`, "POST", {
          title: `Build the thing ${run}`,
          assigneeEmployeeId: arjun,
          priority: "high",
          dueDate: addDays(today, 7),
        });
        assert.equal(created.status, 201, await created.clone().text());
        task = (await created.json()) as ProjectTask;
        ids.tasks.push(task.id);
        assert.equal(task.status, "todo");
        assert.equal(task.assigneeName !== null, true);
        const moved = await projects.changeTaskStatus(
          arjunE,
          p1.id,
          task.id,
          { version: 1, status: "in_progress" },
          randomUUID(),
        );
        assert.equal(moved.version, 2);
        assert.ok(moved.canChangeStatus && !moved.canEdit);
        assert.equal(
          await status(
            projects.updateTask(
              arjunE,
              p1.id,
              task.id,
              {
                version: 2,
                title: "Renamed by assignee",
                description: null,
                assigneeEmployeeId: arjun,
                priority: "low",
                dueDate: null,
              },
              randomUUID(),
            ),
          ),
          403,
        );
        const stale = await send(
          `/projects/${p1.id}/tasks/${task.id}/status`,
          "POST",
          {
            version: 1,
            status: "blocked",
          },
        );
        assert.equal(stale.status, 409);
        const list = await (await request(`/projects/${p1.id}/tasks`)).json();
        assert.equal(list.counts.in_progress, 1);
        task = moved;
      },
    );

    await t.test("members log time and the owner approves it", async () => {
      await changeRole("manager");
      const mine = await log(arjunE, {
        projectId: p1.id,
        taskId: task.id,
        minutes: 120,
        note: "Synthetic work",
      });
      arjunEntry = added(mine, seen);
      assert.equal(arjunEntry.status, "submitted");
      assert.equal(arjunEntry.taskTitle, task.title);
      assert.ok(arjunEntry.canWithdraw && !arjunEntry.canDecide);
      assert.equal(mine.week.totalMinutes >= 120, true);
      assert.ok(mine.week.projects.some((p) => p.projectId === p1.id));
      assert.ok(mine.projects.some((p) => p.id === p1.id));
      // Rohan cannot see Arjun's time; the owner can.
      const review = (await (
        await request("/time/review")
      ).json()) as TimeReview;
      const pending = review.items.find((e) => e.id === arjunEntry.id);
      assert.ok(pending?.canDecide);
      assert.equal(
        await status(
          projects.approve(
            as(rohan, "Rohan (synthetic)", "manager"),
            arjunEntry.id,
            { version: 1 },
            randomUUID(),
          ),
        ),
        404,
      );
      // Nobody approves their own time.
      assert.equal(
        await status(
          projects.approve(
            as(arjun, "Arjun (synthetic)", "manager"),
            arjunEntry.id,
            { version: 1 },
            randomUUID(),
          ),
        ),
        403,
      );
      const approved = await send(`/time/${arjunEntry.id}/approve`, "POST", {
        version: 1,
      });
      assert.equal(approved.status, 201, await approved.clone().text());
      const entry = (await approved.json()) as TimeEntry;
      assert.equal(entry.status, "approved");
      assert.equal(entry.approvedBy, actor.name);
      const again = await send(`/time/${arjunEntry.id}/approve`, "POST", {
        version: 2,
      });
      assert.equal(again.status, 409);
      const reject = await send(`/time/${arjunEntry.id}/reject`, "POST", {
        version: 2,
      });
      assert.equal(reject.status, 400, "a rejection needs a note");
    });

    await t.test("the owner's own time goes to HR", async () => {
      await changeRole("manager");
      const response = await send("/time/mine", "POST", {
        projectId: p1.id,
        workDate: today,
        minutes: 30,
      });
      assert.equal(response.status, 201, await response.clone().text());
      const own = added((await response.json()) as MyTime, seen);
      assert.equal(own.canDecide, false);
      const self = await send(`/time/${own.id}/approve`, "POST", {
        version: 1,
      });
      assert.equal(self.status, 403);
      await changeRole("hr_admin");
      const hrSelf = await send(`/time/${own.id}/approve`, "POST", {
        version: 1,
      });
      assert.equal(
        hrSelf.status,
        403,
        "HR does not approve their own time either",
      );
      const rejected = await projects.reject(
        rohanHr,
        own.id,
        { version: 1, note: "Wrong project" },
        randomUUID(),
      );
      assert.equal(rejected.status, "rejected");
      assert.equal(rejected.decisionNote, "Wrong project");
    });

    await t.test(
      "an owner without manage scope sees only their own time",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const rows = await scoped(
            pool,
            { ...actor, role: "employee" as const },
            (client) =>
              client.query("SELECT id FROM time_entry WHERE project_id=$1", [
                p1.id,
              ]),
          );
          assert.ok(
            rows.rows.every((r) => !seen.has(r.id) || r.id !== arjunEntry.id),
          );
          assert.equal(
            rows.rows.some((r) => r.id === arjunEntry.id),
            false,
          );
        } finally {
          await pool.end();
        }
      },
    );

    await t.test(
      "a decision racing an ownership transfer never lets the old owner decide",
      async () => {
        const maya = { ...actor, role: "manager" as const };
        const hr = { ...actor, role: "hr_admin" as const };
        const transfer = (owner: string) =>
          projects.detail(hr, p1.id).then((current) =>
            projects.update(
              hr,
              p1.id,
              {
                version: current.version,
                name: current.name,
                description: current.description,
                ownerEmployeeId: owner,
                startDate: current.startDate,
                endDate: current.endDate,
              },
              randomUUID(),
            ),
          );
        for (let round = 0; round < 3; round++) {
          const entry = added(
            await log(arjunE, { projectId: p1.id, minutes: 15 }),
            seen,
          );
          const [moved, decided] = await Promise.allSettled([
            transfer(rohan),
            projects.approve(maya, entry.id, { version: 1 }, randomUUID()),
          ]);
          assert.equal(
            moved.status,
            "fulfilled",
            String((moved as PromiseRejectedResult).reason),
          );
          if (decided.status === "fulfilled") {
            const order = await admin.query<{ ok: boolean }>(
              `SELECT e.decided_at <= p.updated_at AS ok FROM time_entry e JOIN project p ON p.id=e.project_id WHERE e.id=$1`,
              [entry.id],
            );
            assert.ok(order.rows[0]!.ok, "approved only before the transfer");
          } else {
            const code = (
              decided.reason as { getStatus?: () => number }
            ).getStatus?.();
            assert.ok(
              code === 403 || code === 404 || code === 409,
              String(decided.reason),
            );
          }
          // After the transfer the old owner can neither see nor decide new time.
          const later = added(
            await log(arjunE, { projectId: p1.id, minutes: 15 }),
            seen,
          );
          assert.equal(
            await status(
              projects.approve(maya, later.id, { version: 1 }, randomUUID()),
            ),
            404,
          );
          await transfer(actor.employeeId);
        }
      },
    );

    await t.test(
      "time rules: membership, dates, minutes, open projects",
      async () => {
        // Not a member of P2 (and P2 is only planned).
        assert.equal(await status(log(arjunE, { projectId: p2.id })), 403);
        assert.equal(await status(log(rohanE, { projectId: p2.id })), 409);
        assert.equal(await status(log(rohanE, { projectId: p1.id })), 403);
        assert.equal(
          await status(
            log(arjunE, { projectId: p1.id, workDate: addDays(today, 1) }),
          ),
          400,
        );
        assert.equal(
          await status(
            log(arjunE, { projectId: p1.id, workDate: addDays(today, -61) }),
          ),
          400,
        );
        await changeRole("employee");
        for (const minutes of [0, 20, 735, 10])
          assert.equal(
            (
              await send("/time/mine", "POST", {
                projectId: p1.id,
                workDate: today,
                minutes,
              })
            ).status,
            400,
            String(minutes),
          );
        // A task from another project is refused.
        await changeRole("hr_admin");
        const other = await send(`/projects/${p2.id}/tasks`, "POST", {
          title: "Another project's task",
        });
        assert.equal(other.status, 201, await other.clone().text());
        const otherTask = (await other.json()) as ProjectTask;
        ids.tasks.push(otherTask.id);
        assert.equal(
          await status(log(arjunE, { projectId: p1.id, taskId: otherTask.id })),
          400,
        );
      },
    );

    await t.test("a day holds at most 24 hours", async () => {
      const date = addDays(today, -3);
      added(
        await log(arjunE, { projectId: p1.id, workDate: date, minutes: 720 }),
        seen,
      );
      const second = added(
        await log(arjunE, { projectId: p1.id, workDate: date, minutes: 720 }),
        seen,
      );
      assert.equal(
        await status(
          log(arjunE, { projectId: p1.id, workDate: date, minutes: 15 }),
        ),
        400,
      );
      // Withdrawn time frees the day; a withdrawn entry is final.
      const mine = await projects.withdraw(
        arjunE,
        second.id,
        { version: 1 },
        randomUUID(),
      );
      assert.equal(
        mine.items.find((e) => e.id === second.id)?.status,
        "withdrawn",
      );
      assert.equal(
        await status(
          projects.withdraw(arjunE, second.id, { version: 1 }, randomUUID()),
        ),
        409,
      );
      assert.equal(
        await status(
          projects.withdraw(arjunE, second.id, { version: 2 }, randomUUID()),
        ),
        409,
      );
      added(
        await log(arjunE, { projectId: p1.id, workDate: date, minutes: 15 }),
        seen,
      );
    });

    await t.test(
      "two entries racing past 24 hours: exactly one lands",
      async () => {
        const date = addDays(today, -4);
        added(
          await log(arjunE, { projectId: p1.id, workDate: date, minutes: 720 }),
          seen,
        );
        const results = await Promise.allSettled([
          log(arjunE, { projectId: p1.id, workDate: date, minutes: 720 }),
          log(arjunE, { projectId: p1.id, workDate: date, minutes: 720 }),
        ]);
        const ok = results.filter((r) => r.status === "fulfilled");
        assert.equal(ok.length, 1);
        for (const r of results)
          if (r.status === "rejected")
            assert.equal(
              (r.reason as { getStatus: () => number }).getStatus(),
              400,
            );
        const total = await admin.query<{ minutes: number }>(
          `SELECT sum(minutes)::int AS minutes FROM time_entry WHERE employee_id=$1 AND work_date=$2
           AND status IN ('submitted','approved')`,
          [arjun, date],
        );
        assert.ok(total.rows[0]!.minutes <= 1440);
        for (const id of await timeIds()) seen.add(id);
      },
    );

    await t.test(
      "members leave softly and closed projects are read-only",
      async () => {
        await changeRole("manager");
        const members = (await (
          await request(`/projects/${p1.id}/members`)
        ).json()) as ProjectMemberList;
        const membership = members.items.find((m) => m.employeeId === arjun)!;
        const busy = await send(
          `/projects/${p1.id}/members/${arjun}/remove`,
          "POST",
          {
            version: membership.version,
          },
        );
        assert.equal(busy.status, 409, "open tasks must be reassigned first");
        const done = await send(
          `/projects/${p1.id}/tasks/${task.id}/status`,
          "POST",
          {
            version: task.version,
            status: "done",
          },
        );
        assert.equal(done.status, 201, await done.clone().text());
        const removed = await send(
          `/projects/${p1.id}/members/${arjun}/remove`,
          "POST",
          {
            version: membership.version,
          },
        );
        assert.equal(removed.status, 201, await removed.clone().text());
        const after = (await removed.json()) as ProjectMemberList;
        assert.equal(after.counts.active, 0);
        assert.equal(after.counts.removed, 1);
        assert.equal(await status(projects.detail(arjunE, p1.id)), 404);
        // Arjun keeps his history, with the project code even though he cannot see the project.
        const mine = await projects.myTime(arjunE, {});
        const kept = mine.items.find((e) => e.id === arjunEntry.id)!;
        assert.equal(kept.projectCode, p1.code);
        assert.equal(kept.projectName, null);
        assert.equal(await status(log(arjunE, { projectId: p1.id })), 403);

        const current = (await (
          await request(`/projects/${p1.id}`)
        ).json()) as Project;
        const stale = await send(`/projects/${p1.id}/status`, "POST", {
          version: current.version - 1 || 99,
          status: "completed",
        });
        assert.equal(stale.status, 409);
        const completed = await send(`/projects/${p1.id}/status`, "POST", {
          version: current.version,
          status: "completed",
        });
        assert.equal(completed.status, 201, await completed.clone().text());
        const closed = (await completed.json()) as Project;
        assert.ok(!closed.canManage && !closed.canLogTime && !closed.canReopen);
        for (const [path, method, body] of [
          [
            `/projects/${p1.id}`,
            "PUT",
            {
              version: closed.version,
              name: "Edited while closed",
              ownerEmployeeId: actor.employeeId,
              startDate: closed.startDate,
            },
          ],
          [`/projects/${p1.id}/tasks`, "POST", { title: "Late task" }],
          [
            `/projects/${p1.id}/status`,
            "POST",
            { version: closed.version, status: "active" },
          ],
          [
            "/time/mine",
            "POST",
            { projectId: p1.id, workDate: today, minutes: 15 },
          ],
        ] as const)
          assert.equal((await send(path, method, body)).status, 409, path);
        await changeRole("hr_admin");
        const view = (await (
          await request(`/projects/${p1.id}`)
        ).json()) as Project;
        assert.ok(view.canReopen);
        const reopened = await send(`/projects/${p1.id}/status`, "POST", {
          version: closed.version,
          status: "active",
        });
        assert.equal(reopened.status, 201, await reopened.clone().text());
        assert.equal(((await reopened.json()) as Project).status, "active");
      },
    );

    await t.test(
      "every action leaves an audit record and an outbox event",
      async () => {
        const entries = await timeIds();
        const targets = [
          ...ids.projects.map((id) => `project:${id}`),
          ...ids.members.map((id) => `project-member:${id}`),
          ...ids.tasks.map((id) => `project-task:${id}`),
          ...entries.map((id) => `time:${id}`),
        ];
        const audit = await admin.query<{ action: string }>(
          "SELECT action FROM audit_event WHERE target=ANY($1::text[])",
          [targets],
        );
        const actions = new Set(audit.rows.map((r) => r.action));
        const expected = [
          "project.created",
          "project.status_changed",
          "project.member_added",
          "project.member_removed",
          "project.task_created",
          "project.task_status_changed",
          "time.logged",
          "time.approved",
          "time.rejected",
          "time.withdrawn",
        ];
        for (const action of expected) assert.ok(actions.has(action), action);
        const events = await admin.query<{ event_type: string }>(
          "SELECT event_type FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
          [[...ids.projects, ...ids.members, ...ids.tasks, ...entries]],
        );
        const types = new Set(events.rows.map((r) => r.event_type));
        for (const action of expected)
          assert.ok(types.has(`${action}.v1`), action);
      },
    );

    await t.test(
      "the database refuses what the API would never send",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const employee = { ...actor, role: "employee" as const };
          const auditor = { ...actor, role: "auditor" as const };
          const hr = { ...actor, role: "hr_admin" as const };
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(
                `INSERT INTO project(id,tenant_id,entity_id,code,name,owner_employee_id,status,start_date)
               VALUES ($1,$2,$3,'SNEAKY','Sneaky',$4,'active',leave_entity_today())`,
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  actor.employeeId,
                ],
              ),
            ),
          );
          await assert.rejects(
            scoped(pool, arjunE, (client) =>
              client.query(
                `INSERT INTO time_entry(id,tenant_id,entity_id,employee_id,project_id,work_date,minutes)
               VALUES ($1,$2,$3,$4,$5,leave_entity_today(),60)`,
                [randomUUID(), actor.tenantId, actor.entityId, rohan, p1.id],
              ),
            ),
            /own time|row-level security/,
          );
          await assert.rejects(
            scoped(pool, arjunE, (client) =>
              client.query(
                `INSERT INTO time_entry(id,tenant_id,entity_id,employee_id,project_id,work_date,minutes,status)
               VALUES ($1,$2,$3,$4,$5,leave_entity_today(),60,'approved')`,
                [randomUUID(), actor.tenantId, actor.entityId, arjun, p1.id],
              ),
            ),
            /permission denied/,
          );
          for (const sql of [
            "UPDATE time_entry SET minutes=15 WHERE id=$1",
            "UPDATE time_entry SET approved_by_label='Me' WHERE id=$1",
          ])
            await assert.rejects(
              scoped(pool, arjunE, (client) =>
                client.query(sql, [arjunEntry.id]),
              ),
              /permission denied/,
            );
          // An approved entry is final, even for HR.
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE time_entry SET status='rejected', decision_note='Changed mind', version=version+1 WHERE id=$1",
                [arjunEntry.id],
              ),
            ),
            /final/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query("UPDATE project SET code='CHANGED' WHERE id=$1", [
                p1.id,
              ]),
            ),
            /permission denied/,
          );
          // An employee cannot reach a project's details or tasks they only work on.
          const touched = await scoped(pool, employee, (client) =>
            client.query(
              "UPDATE project SET name='Hijacked', version=version+1 WHERE id=$1",
              [p1.id],
            ),
          );
          assert.equal(touched.rowCount, 0);
          const invisible = await scoped(pool, auditor, (client) =>
            client.query(
              "SELECT (SELECT count(*) FROM project WHERE id=ANY($1::uuid[]))::int AS p, (SELECT count(*) FROM time_entry WHERE project_id=ANY($1::uuid[]))::int AS t",
              [ids.projects],
            ),
          );
          assert.deepEqual(invisible.rows[0], { p: 0, t: 0 });
          for (const [table, id] of [
            ["project", p1.id],
            ["project_member", ids.members[0]!],
            ["project_task", task.id],
            ["time_entry", arjunEntry.id],
          ] as const) {
            await assert.rejects(
              scoped(pool, hr, (client) =>
                client.query(`DELETE FROM ${table} WHERE id=$1`, [id]),
              ),
              /permission denied|never deleted/,
            );
            await assert.rejects(
              admin.query(`DELETE FROM ${table} WHERE id=$1`, [id]),
              /never deleted/,
            );
          }
        } finally {
          await pool.end();
        }
      },
    );
  } finally {
    // Synthetic cleanup only: project history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM identity_binding WHERE id=$1", [
        rohanBinding,
      ]);
      const entries = (
        await client.query<{ id: string }>(
          "SELECT id FROM time_entry WHERE project_id=ANY($1::uuid[])",
          [ids.projects],
        )
      ).rows.map((r) => r.id);
      const members = (
        await client.query<{ id: string }>(
          "SELECT id FROM project_member WHERE project_id=ANY($1::uuid[])",
          [ids.projects],
        )
      ).rows.map((r) => r.id);
      const tasks = (
        await client.query<{ id: string }>(
          "SELECT id FROM project_task WHERE project_id=ANY($1::uuid[])",
          [ids.projects],
        )
      ).rows.map((r) => r.id);
      const all = [...ids.projects, ...members, ...tasks, ...entries];
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [all],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[])",
        [
          [
            ...ids.projects.map((id) => `project:${id}`),
            ...members.map((id) => `project-member:${id}`),
            ...tasks.map((id) => `project-task:${id}`),
            ...entries.map((id) => `time:${id}`),
          ],
        ],
      );
      await client.query(
        "DELETE FROM time_entry WHERE project_id=ANY($1::uuid[])",
        [ids.projects],
      );
      await client.query(
        "DELETE FROM project_task WHERE project_id=ANY($1::uuid[])",
        [ids.projects],
      );
      await client.query(
        "DELETE FROM project_member WHERE project_id=ANY($1::uuid[])",
        [ids.projects],
      );
      await client.query("DELETE FROM project WHERE id=ANY($1::uuid[])", [
        ids.projects,
      ]);
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
