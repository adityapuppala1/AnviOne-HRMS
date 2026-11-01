import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createCandidateApp } from "../apps/api/src/candidate-app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import { OnboardingStore } from "../apps/api/src/onboarding.store";
import type { CandidateTask } from "../packages/contracts/src/index";
import { hash } from "../apps/api/src/platform.store";
if (process.env.NODE_ENV !== "development" || process.env.AUTH_MODE !== "demo")
  throw new Error("Synthetic development database required");
for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "CANDIDATE_DATABASE_URL",
]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  )
    throw new Error("Local Compose database required");
}
await test("Isolated candidate onboarding", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4478" });
  const { app, store } = await createApp(config),
    candidate = await createCandidateApp(config, 4477),
    admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  await app.listen(4478, "127.0.0.1");
  await candidate.app.listen(4477, "127.0.0.1");
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let employeeToken = await store.createSession(actor, randomUUID()),
    employeeSession = await store.session(employeeToken);
  const hr = async (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:4478/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: `anvi_dev_session=${employeeToken}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": employeeSession.csrfToken,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const switchRole = async (role: string) => {
    const r = await hr("/session/role-context", { role });
    assert.equal(r.status, 201);
    employeeToken = r.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    employeeSession = await store.session(employeeToken);
  };
  let cookie = "",
    csrf = "",
    id = "",
    version = 1,
    token = "";
  const api = async (
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:4477/api/candidate/${path}`, {
      method,
      headers: {
        Origin: config.CANDIDATE_ORIGIN,
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const reason = "Synthetic onboarding acceptance verification";
  const extraCases: string[] = [];
  let ownTask: CandidateTask, hrTask: CandidateTask, adminTask: CandidateTask;
  const detail = async () => {
    const r = await hr(`/candidates/${id}`);
    assert.equal(r.status, 200);
    return r.json();
  };
  const invite = async () => {
    const r = await hr(`/candidates/${id}/invitation`, { version, reason });
    assert.equal(r.status, 201);
    version = (await r.json()).version;
    const delivery = await (
      await hr(`/candidates/${id}/delivery-preview`)
    ).json();
    token = new URL(delivery.invitationUrl).hash.slice(8);
  };
  const challenge = async () => {
    const r = await api("challenge", { token });
    assert.equal(r.status, 201);
    const challengeId = (await r.json()).challengeId;
    const delivery = await (
      await hr(`/candidates/${id}/delivery-preview`)
    ).json();
    return { challengeId, code: delivery.code };
  };
  const login = async () => {
    const input = await challenge();
    const r = await api("exchange", { token, ...input });
    assert.equal(r.status, 201);
    cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    const me = await (await api("session")).json();
    csrf = me.csrfToken;
    version = me.candidate.version;
  };
  try {
    await t.test(
      "HR permission and synthetic address constraints",
      async () => {
        await switchRole("employee");
        assert.equal((await hr("/candidates")).status, 403);
        await switchRole("hr_admin");
        const options = await (await hr("/candidates/options")).json();
        const input = {
          name: "QA Candidate",
          email: `qa-${randomUUID()}@anvi.example`,
          title: "Synthetic designer",
          joinedOn: "2027-01-01",
          departmentId: options.departments[0].id,
          locationId: options.locations[0].id,
          managerId: options.managers[0].id,
        };
        assert.equal(
          (await hr("/candidates", { ...input, email: "real@example.com" }))
            .status,
          400,
        );
        const r = await hr("/candidates", input);
        assert.equal(r.status, 201);
        const c = await r.json();
        id = c.id;
        version = c.version;
        assert.equal(c.state, "draft");
        assert.equal(
          (await admin.query("SELECT id FROM employee WHERE id=$1", [id]))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "invitation GET cannot consume; credential storage is protected",
      async () => {
        await invite();
        assert.equal((await api("session")).status, 401);
        const row = (
          await admin.query(
            "SELECT invitation_hash,invitation_consumed_at FROM candidate_case WHERE id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(row.invitation_hash, hash(token));
        assert.equal(row.invitation_consumed_at, null);
        const tray = (
          await admin.query(
            "SELECT ciphertext FROM candidate_delivery_preview WHERE candidate_id=$1",
            [id],
          )
        ).rows[0];
        assert.ok(!tray.ciphertext.includes(token));
        assert.equal(
          (await candidate.store.pool.query("SELECT * FROM candidate_case"))
            .rowCount,
          0,
        );
        await assert.rejects(
          candidate.store.pool.query("SELECT * FROM employee"),
        );
        await assert.rejects(
          candidate.store.pool.query("SELECT * FROM person"),
        );
        assert.equal(
          (
            await api("challenge", { token }, "POST", {
              Origin: config.APP_ORIGIN,
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "expired challenges and invitations fail without exposing the case",
      async () => {
        const input = await challenge();
        await admin.query(
          "UPDATE candidate_challenge SET expires_at=now()-interval '1 minute' WHERE id=$1",
          [input.challengeId],
        );
        assert.equal((await api("exchange", { token, ...input })).status, 401);
        await admin.query(
          "UPDATE candidate_case SET invitation_expires_at=now()-interval '1 minute',otp_sent_at=now()-interval '2 minutes' WHERE id=$1",
          [id],
        );
        const expired = await api("challenge", { token });
        assert.equal(expired.status, 201);
        assert.equal(
          (
            await api("exchange", {
              token,
              challengeId: (await expired.json()).challengeId,
              code: "123456",
            })
          ).status,
          401,
        );
        await admin.query(
          "UPDATE candidate_case SET invitation_expires_at=now()+interval '72 hours' WHERE id=$1",
          [id],
        );
      },
    );
    await t.test(
      "wrong OTP attempts persist and exhaust the challenge",
      async () => {
        const input = await challenge();
        for (let n = 0; n < 5; n++)
          assert.equal(
            (
              await api("exchange", {
                token,
                challengeId: input.challengeId,
                code: input.code === "111111" ? "222222" : "111111",
              })
            ).status,
            401,
          );
        assert.equal((await api("exchange", { token, ...input })).status, 401);
        assert.equal(
          (
            await admin.query(
              "SELECT attempts FROM candidate_challenge WHERE id=$1",
              [input.challengeId],
            )
          ).rows[0].attempts,
          5,
        );
        await admin.query(
          "UPDATE candidate_case SET otp_sent_at=now()-interval '2 minutes' WHERE id=$1",
          [id],
        );
      },
    );
    await t.test(
      "single use exchange, independent cookie and CSRF boundary",
      async () => {
        await login();
        assert.equal(
          (
            await api("exchange", {
              token,
              challengeId: randomUUID(),
              code: "123456",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api("session", undefined, "GET", {
              Cookie: `anvi_dev_session=${employeeToken}`,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await fetch("http://127.0.0.1:4478/api/v1/me", {
              headers: { Cookie: cookie },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api(
              "draft",
              {
                version,
                draft: {
                  preferredName: "QA",
                  introduction: "Fictional professional introduction.",
                  acknowledged: true,
                },
              },
              "PUT",
              { "X-CSRF-Token": "wrong" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "versioned autosave, immutable submission, corrections and form approval",
      async () => {
        const draft = {
          preferredName: "QA",
          introduction: "Fictional professional introduction for this test.",
          acknowledged: true,
        };
        let r = await api("draft", { version, draft }, "PUT");
        assert.equal(r.status, 200);
        const saved = await r.json();
        assert.equal(
          (await api("draft", { version, draft }, "PUT")).status,
          409,
        );
        version = saved.candidate.version;
        const candidateActor = await candidate.store.session(
          cookie.split("=")[1],
        );
        await assert.rejects(
          candidate.store.submit(
            candidateActor,
            version,
            "invalid-request-uuid",
          ),
          (error: unknown) => {
            assert.ok(error && typeof error === "object" && "code" in error);
            assert.equal(error.code, "22P02");
            return true;
          },
        );
        assert.equal((await detail()).submissions.length, 0);
        assert.equal(
          (await candidate.store.me(candidateActor)).candidate.version,
          version,
        );
        const concurrent = await Promise.all([
          api("submit", { version }),
          api("submit", { version }),
        ]);
        assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
        let d = await detail();
        version = d.candidate.version;
        assert.equal(d.submissions.length, 1);
        r = await hr(`/candidates/${id}/review`, {
          version,
          reason,
          decision: "changes_requested",
        });
        assert.equal(r.status, 201);
        version = (await r.json()).version;
        r = await api(
          "draft",
          {
            version,
            draft: {
              ...draft,
              introduction:
                "Updated fictional professional introduction for correction.",
            },
          },
          "PUT",
        );
        assert.equal(r.status, 200);
        version = (await r.json()).candidate.version;
        assert.equal((await api("submit", { version })).status, 201);
        d = await detail();
        assert.equal(d.submissions.length, 2);
        assert.equal(d.submissions[1].payload.introduction, draft.introduction);
        version = d.candidate.version;
        r = await hr(`/candidates/${id}/review`, {
          version,
          reason,
          decision: "approved",
        });
        assert.equal(r.status, 201);
        version = (await r.json()).version;
        d = await detail();
        assert.equal(d.readiness.activationReady, false);
        assert.equal(d.readiness.controls[0].status, "passed");
        assert.equal(d.readiness.controls[1].status, "blocked");
        assert.equal(
          (await api("draft", { version, draft }, "PUT")).status,
          409,
        );
        assert.equal(
          (await admin.query("SELECT id FROM employee WHERE id=$1", [id]))
            .rowCount,
          0,
        );
        await assert.rejects(
          candidate.store.pool.query(
            "UPDATE candidate_submission SET payload='{}' WHERE candidate_id=$1",
            [id],
          ),
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM audit_event WHERE target=$1 AND action='candidate.submitted'",
              [id],
            )
          ).rowCount,
          2,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1 AND event_type='candidate.submitted.v1'",
              [id],
            )
          ).rowCount,
          2,
        );
      },
    );
    await t.test(
      "starter checklist is explicit, versioned, dated and HR scoped",
      async () => {
        const starts = await Promise.all([
          hr(`/candidates/${id}/checklist`, { version, reason }),
          hr(`/candidates/${id}/checklist`, { version, reason }),
        ]);
        assert.deepEqual(starts.map((r) => r.status).sort(), [201, 409]);
        const d = await detail();
        version = d.candidate.version;
        assert.equal(d.tasks.length, 5);
        ownTask = d.tasks.find((t: CandidateTask) => t.owner === "candidate");
        hrTask = d.tasks.find((t: CandidateTask) => t.owner === "hr");
        adminTask = d.tasks.find(
          (t: CandidateTask) => t.owner === "administration",
        );
        assert.equal(ownTask.dueOn, "2026-12-30");
        assert.equal(hrTask.dueOn, "2026-12-31");
        assert.equal(hrTask.waitingOn, true);
        assert.equal(
          (await hr(`/candidates/${id}/checklist`, { version, reason })).status,
          409,
        );
        await switchRole("employee");
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks`, {
              caseVersion: version,
              label: "Forbidden test task",
              owner: "hr",
              required: true,
              dueOffsetDays: 0,
              dependsOn: null,
            })
          ).status,
          403,
        );
        await switchRole("hr_admin");
        assert.equal(
          (
            await scoped(
              store.pool,
              { ...actor, role: "hr_admin", entityId: randomUUID() },
              (c) => c.query("SELECT id FROM candidate_task"),
            )
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "task assignments are actor-bound, entity-scoped and self-visible",
      async () => {
        const options = await (await hr("/candidates/options")).json();
        assert.ok(
          options.assignees.some(
            (employee: { id: string }) => employee.id === actor.employeeId,
          ),
        );
        const alternateEmployee = "30000000-0000-4000-8000-000000000002";
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}/assignment`, {
              caseVersion: version,
              assignmentVersion: null,
              employeeId: "30000000-0000-4000-8000-000000000099",
              reason: "A cross-entity assignment must be rejected safely.",
            })
          ).status,
          409,
        );
        await admin.query("UPDATE employee SET status='inactive' WHERE id=$1", [
          alternateEmployee,
        ]);
        try {
          assert.equal(
            (
              await hr(`/candidates/${id}/tasks/${hrTask.id}/assignment`, {
                caseVersion: version,
                assignmentVersion: null,
                employeeId: alternateEmployee,
                reason: "An inactive employee must not receive this task.",
              })
            ).status,
            409,
          );
        } finally {
          await admin.query("UPDATE employee SET status='active' WHERE id=$1", [
            alternateEmployee,
          ]);
        }
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}/assignment`, {
              caseVersion: version,
              assignmentVersion: null,
              employeeId: actor.employeeId,
              reason:
                "Assign this fictional HR task to the signed-in employee.",
            })
          ).status,
          201,
        );
        const assignedDetail = await detail();
        version = assignedDetail.candidate.version;
        hrTask = assignedDetail.tasks.find(
          (task: CandidateTask) => task.id === hrTask.id,
        );
        assert.ok(hrTask.assignee);
        assert.equal(hrTask.assignee.name, actor.name);
        assert.equal(hrTask.assignee.version, 1);
        await assert.rejects(
          new OnboardingStore(store).assignTask(
            actor,
            id,
            hrTask.id,
            {
              caseVersion: version,
              assignmentVersion: 1,
              employeeId: alternateEmployee,
              reason: "This assignment must roll back with its failed audit.",
            },
            "invalid-request-uuid",
          ),
          (error: unknown) => {
            assert.ok(error && typeof error === "object" && "code" in error);
            assert.equal(error.code, "22P02");
            return true;
          },
        );
        let afterAssignment = await detail();
        assert.equal(afterAssignment.candidate.version, version);
        let assignedTask = afterAssignment.tasks.find(
          (task: CandidateTask) => task.id === hrTask.id,
        );
        assert.equal(assignedTask.assignee.employeeId, actor.employeeId);
        assert.equal(assignedTask.assignee.version, 1);
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}/assignment`, {
              caseVersion: version,
              assignmentVersion: 1,
              employeeId: alternateEmployee,
              reason:
                "Reassign this fictional task to another active employee.",
            })
          ).status,
          201,
        );
        afterAssignment = await detail();
        version = afterAssignment.candidate.version;
        assignedTask = afterAssignment.tasks.find(
          (task: CandidateTask) => task.id === hrTask.id,
        );
        assert.equal(assignedTask.assignee.version, 2);
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}/assignment`, {
              caseVersion: version,
              assignmentVersion: 1,
              employeeId: actor.employeeId,
              reason: "A stale reassignment version must be rejected.",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}/assignment`, {
              caseVersion: version,
              assignmentVersion: 2,
              employeeId: actor.employeeId,
              reason: "Return this fictional task to the signed-in employee.",
            })
          ).status,
          201,
        );
        afterAssignment = await detail();
        version = afterAssignment.candidate.version;
        hrTask = afterAssignment.tasks.find(
          (task: CandidateTask) => task.id === hrTask.id,
        );
        assert.ok(hrTask.assignee);
        assert.equal(hrTask.assignee.version, 3);
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM audit_event WHERE target=$1 AND action='candidate.task_assigned'",
              [id],
            )
          ).rowCount,
          3,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1 AND event_type='candidate.task_assigned.v1'",
              [id],
            )
          ).rowCount,
          3,
        );
        await switchRole("employee");
        const assignedResponse = await hr("/onboarding/tasks");
        assert.equal(assignedResponse.status, 200);
        const assigned = await assignedResponse.json();
        const visibleTask = assigned.items.find(
          (task: { id: string }) => task.id === hrTask.id,
        );
        assert.equal(
          assigned.items.filter((task: { id: string }) => task.id === hrTask.id)
            .length,
          1,
        );
        assert.equal(visibleTask.candidateName, "QA Candidate");
        assert.ok(!("email" in visibleTask));
        assert.ok(!("draft" in visibleTask));
        assert.equal(
          (
            await scoped(store.pool, { ...actor, role: "employee" }, (client) =>
              client.query(
                "SELECT task_id FROM candidate_task_assignment WHERE task_id=$1",
                [hrTask.id],
              ),
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await scoped(
              store.pool,
              {
                ...actor,
                actorId: randomUUID(),
                employeeId: randomUUID(),
                role: "employee",
                roles: ["employee"],
              },
              (client) =>
                client.query("SELECT task_id FROM candidate_task_assignment"),
            )
          ).rowCount,
          0,
        );
        await assert.rejects(
          scoped(store.pool, { ...actor, role: "employee" }, (client) =>
            client.query(
              `INSERT INTO candidate_task_assignment(task_id,employee_id,version,assigned_by,assigner_label)
               VALUES($1,$2,1,$3,$4)`,
              [adminTask.id, actor.employeeId, actor.actorId, actor.name],
            ),
          ),
        );
        await assert.rejects(
          scoped(store.pool, { ...actor, role: "hr_admin" }, (client) =>
            client.query(
              `INSERT INTO candidate_task_assignment(task_id,employee_id,version,assigned_by,assigner_label)
               VALUES($1,$2,1,$3,$4)`,
              [ownTask.id, actor.employeeId, actor.actorId, actor.name],
            ),
          ),
        );
        await switchRole("hr_admin");
      },
    );
    await t.test(
      "candidate sees only owned tasks and cannot forge metadata or case changes",
      async () => {
        const me = await (await api("session")).json();
        assert.equal(me.tasks.length, 1);
        assert.equal(me.tasks[0].id, ownTask.id);
        assert.ok(!("owner" in me.tasks[0]));
        assert.ok(!("dependsOn" in me.tasks[0]));
        assert.equal(
          (
            await api(`tasks/${hrTask.id}`, {
              caseVersion: version,
              version: hrTask.version,
              state: "completed",
              reason,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await api(`tasks/${ownTask.id}`, {
              caseVersion: version,
              version: ownTask.version,
              state: "completed",
              reason,
              owner: "hr",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}`, {
              caseVersion: version,
              version: hrTask.version,
              state: "completed",
              reason,
            })
          ).status,
          409,
        );
        await assert.rejects(
          scoped(store.pool, { ...actor, role: "hr_admin" }, (c) =>
            c.query(
              "UPDATE candidate_task SET label='Forged metadata',version=version+1,note=$2 WHERE id=$1",
              [ownTask.id, reason],
            ),
          ),
        );
        await assert.rejects(
          transaction(candidate.store.pool, async (c) => {
            await c.query(
              "SELECT set_config('candidate.id',$1,true),set_config('candidate.operation','task',true)",
              [id],
            );
            await c.query(
              "UPDATE candidate_case SET draft='{}',version=version+1 WHERE id=$1",
              [id],
            );
          }),
        );
        assert.equal(
          (await candidate.store.pool.query("SELECT id FROM candidate_task"))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "task audit failure rolls back and concurrent candidate completion commits once after form approval",
      async () => {
        const candidateActor = await candidate.store.session(
          cookie.split("=")[1],
        );
        const input = {
          caseVersion: version,
          version: ownTask.version,
          state: "completed" as const,
          reason,
        };
        await assert.rejects(
          candidate.store.updateTask(
            candidateActor,
            ownTask.id,
            input,
            "invalid-request-uuid",
          ),
          (error: unknown) => {
            assert.ok(error && typeof error === "object" && "code" in error);
            assert.equal(error.code, "22P02");
            return true;
          },
        );
        let d = await detail();
        assert.equal(d.candidate.version, version);
        assert.equal(
          d.tasks.find((t: CandidateTask) => t.id === ownTask.id).state,
          "pending",
        );
        const results = await Promise.all([
          api(`tasks/${ownTask.id}`, input),
          api(`tasks/${ownTask.id}`, input),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        d = await detail();
        version = d.candidate.version;
        ownTask = d.tasks.find((t: CandidateTask) => t.id === ownTask.id);
        hrTask = d.tasks.find((t: CandidateTask) => t.id === hrTask.id);
        assert.equal(hrTask.waitingOn, false);
        assert.equal(d.candidate.state, "approved");
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM audit_event WHERE target=$1 AND action='candidate.task_updated'",
              [id],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1 AND event_type='candidate.task_updated.v1'",
              [id],
            )
          ).rowCount,
          1,
        );
        await switchRole("employee");
        const assigned = await (await hr("/onboarding/tasks")).json();
        const assignedHrTask = assigned.items.find(
          (task: { id: string }) => task.id === hrTask.id,
        );
        await assert.rejects(
          new OnboardingStore(store).updateAssignedTask(
            { ...actor, role: "employee" },
            hrTask.id,
            {
              taskVersion: assignedHrTask.version,
              state: "completed",
              reason:
                "This status update must roll back with its failed audit.",
            },
            "invalid-request-uuid",
          ),
          (error: unknown) => {
            assert.ok(error && typeof error === "object" && "code" in error);
            assert.equal(error.code, "22P02");
            return true;
          },
        );
        const unchangedAssigned = await (await hr("/onboarding/tasks")).json();
        assert.equal(
          unchangedAssigned.items.find(
            (task: { id: string }) => task.id === hrTask.id,
          ).state,
          "pending",
        );
        const assignedUpdates = await Promise.all([
          hr(`/onboarding/tasks/${hrTask.id}`, {
            taskVersion: assignedHrTask.version,
            state: "completed",
            reason: "Completed the assigned fictional HR coordination task.",
          }),
          hr(`/onboarding/tasks/${hrTask.id}`, {
            taskVersion: assignedHrTask.version,
            state: "completed",
            reason:
              "Concurrent duplicate assigned-task completion is rejected.",
          }),
        ]);
        assert.deepEqual(
          assignedUpdates.map((r) => r.status).sort(),
          [201, 409],
        );
        await switchRole("hr_admin");
        d = await detail();
        version = d.candidate.version;
        hrTask = d.tasks.find((task: CandidateTask) => task.id === hrTask.id);
        assert.equal(hrTask.state, "completed");
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM audit_event WHERE target=$1 AND action='candidate.assigned_task_updated'",
              [id],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1 AND event_type='candidate.assigned_task_updated.v1'",
              [id],
            )
          ).rowCount,
          1,
        );
      },
    );
    await t.test(
      "completed dependencies cannot be invalidated until dependents are reopened",
      async () => {
        for (const taskId of [adminTask.id]) {
          const d = await detail();
          const task = d.tasks.find((t: CandidateTask) => t.id === taskId);
          assert.equal(
            (
              await hr(`/candidates/${id}/tasks/${taskId}`, {
                caseVersion: d.candidate.version,
                version: task.version,
                state: "completed",
                reason,
              })
            ).status,
            201,
          );
        }
        let d = await detail();
        assert.equal(d.readiness.activationReady, false);
        assert.equal(d.readiness.controls[1].status, "passed");
        assert.equal(
          d.readiness.controls.filter(
            (control: { source: string }) => control.source === "external",
          ).length,
          4,
        );
        version = d.candidate.version;
        hrTask = d.tasks.find((t: CandidateTask) => t.id === hrTask.id);
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${hrTask.id}`, {
              caseVersion: version,
              version: hrTask.version,
              state: "pending",
              reason,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await api(`tasks/${ownTask.id}`, {
              caseVersion: version,
              version: ownTask.version,
              state: "pending",
              reason,
            })
          ).status,
          409,
        );
        for (const taskId of [adminTask.id, hrTask.id]) {
          d = await detail();
          const task = d.tasks.find((t: CandidateTask) => t.id === taskId);
          assert.equal(
            (
              await hr(`/candidates/${id}/tasks/${taskId}`, {
                caseVersion: d.candidate.version,
                version: task.version,
                state: "pending",
                reason,
              })
            ).status,
            201,
          );
        }
        d = await detail();
        version = d.candidate.version;
      },
    );
    await t.test(
      "custom prerequisites remain case scoped and candidate dependency lookup reveals only a flag",
      async () => {
        const options = await (await hr("/candidates/options")).json();
        const foreign = await hr("/candidates", {
          name: "Other synthetic candidate",
          email: `other-${randomUUID()}@anvi.example`,
          title: "Synthetic colleague",
          joinedOn: "2027-01-01",
          departmentId: options.departments[0].id,
          locationId: options.locations[0].id,
          managerId: options.managers[0].id,
        });
        assert.equal(foreign.status, 201);
        const other = await foreign.json();
        extraCases.push(other.id);
        const otherInput = {
          caseVersion: other.version,
          label: "Other intake prerequisite",
          owner: "hr",
          required: true,
          dueOffsetDays: 0,
          dependsOn: null,
        };
        assert.equal(
          (await hr(`/candidates/${other.id}/tasks`, otherInput)).status,
          201,
        );
        const otherDetail = await (await hr(`/candidates/${other.id}`)).json();
        const input = {
          caseVersion: version,
          label: "Confirm a fictional induction preference",
          owner: "candidate" as const,
          required: true,
          dueOffsetDays: 1,
          dependsOn: hrTask.id,
        };
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks`, {
              ...input,
              dependsOn: otherDetail.tasks[0].id,
            })
          ).status,
          400,
        );
        await assert.rejects(
          new OnboardingStore(store).createTask(
            { ...actor, role: "hr_admin" },
            id,
            input,
            "invalid-request-uuid",
          ),
        );
        assert.equal((await detail()).tasks.length, 5);
        assert.equal((await hr(`/candidates/${id}/tasks`, input)).status, 201);
        const d = await detail();
        version = d.candidate.version;
        const me = await (await api("session")).json();
        assert.equal(me.tasks.length, 2);
        const waiting = me.tasks.find(
          (t: CandidateTask) => t.label === input.label,
        );
        assert.equal(waiting.waitingOn, true);
        assert.ok(!("dependsOn" in waiting));
        assert.equal(
          (
            await api(`tasks/${waiting.id}`, {
              caseVersion: version,
              version: waiting.version,
              state: "completed",
              reason,
            })
          ).status,
          409,
        );
        assert.equal(
          (await admin.query("SELECT id FROM employee WHERE id=$1", [id]))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "checklists enforce the 30-task limit without mutating the case",
      async () => {
        await admin.query(
          "INSERT INTO candidate_task(id,candidate_id,label,owner,required,due_on) SELECT gen_random_uuid(),$1,'Synthetic limit fixture '||n,'hr',false,CURRENT_DATE FROM generate_series(1,24) n",
          [id],
        );
        const before = await detail();
        assert.equal(before.tasks.length, 30);
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks`, {
              caseVersion: version,
              label: "Task beyond the accepted limit",
              owner: "hr",
              required: false,
              dueOffsetDays: 0,
              dependsOn: null,
            })
          ).status,
          409,
        );
        const after = await detail();
        assert.equal(after.tasks.length, 30);
        assert.equal(after.candidate.version, before.candidate.version);
      },
    );
    await t.test(
      "local readiness decisions are actor-bound, independent and terminal",
      async () => {
        const reviewId = randomUUID();
        const maker = { ...actor, role: "hr_admin" as const };
        const checker = {
          ...maker,
          actorId: randomUUID(),
          name: "Independent synthetic HR reviewer",
        };
        await assert.rejects(
          scoped(store.pool, maker, (c) =>
            c.query(
              `INSERT INTO candidate_local_review(id,candidate_id,proposed_by,proposer_label,proposal_note)
               VALUES($1,$2,$3,$4,$5)`,
              [randomUUID(), id, randomUUID(), maker.name, reason],
            ),
          ),
        );
        await scoped(store.pool, maker, (c) =>
          c.query(
            `INSERT INTO candidate_local_review(id,candidate_id,proposed_by,proposer_label,proposal_note)
             VALUES($1,$2,$3,$4,$5)`,
            [reviewId, id, maker.actorId, maker.name, reason],
          ),
        );
        await assert.rejects(
          scoped(store.pool, maker, (c) =>
            c.query(
              "UPDATE candidate_local_review SET state='approved',version=2,decided_by=$2,decider_label=$3,decision_note=$4,decided_at=now() WHERE id=$1",
              [reviewId, maker.actorId, maker.name, reason],
            ),
          ),
        );
        await scoped(store.pool, checker, (c) =>
          c.query(
            "UPDATE candidate_local_review SET state='approved',version=2,decided_by=$2,decider_label=$3,decision_note=$4,decided_at=now() WHERE id=$1",
            [reviewId, checker.actorId, checker.name, reason],
          ),
        );
        await assert.rejects(
          scoped(store.pool, maker, (c) =>
            c.query(
              "UPDATE candidate_local_review SET state='rejected',version=3,decided_by=$2,decider_label=$3,decision_note=$4,decided_at=now() WHERE id=$1",
              [reviewId, maker.actorId, maker.name, reason],
            ),
          ),
        );
        const row = await admin.query(
          "SELECT state,version,proposed_by,decided_by FROM candidate_local_review WHERE id=$1",
          [reviewId],
        );
        assert.deepEqual(row.rows[0], {
          state: "approved",
          version: 2,
          proposed_by: maker.actorId,
          decided_by: checker.actorId,
        });
      },
    );
    await t.test(
      "local readiness proposal requires complete local evidence",
      async () => {
        employeeToken = await store.createSession(actor, randomUUID());
        employeeSession = await store.session(employeeToken);
        let d = await detail();
        assert.equal(
          (
            await hr(`/candidates/${id}/local-reviews`, {
              caseVersion: d.candidate.version,
              reason: "Incomplete synthetic evidence cannot enter review.",
            })
          ).status,
          409,
        );
        for (;;) {
          const next = d.tasks.find(
            (task: CandidateTask) =>
              task.required && task.state !== "completed" && !task.waitingOn,
          );
          if (!next) break;
          assert.equal(
            (
              await hr(`/candidates/${id}/tasks/${next.id}`, {
                caseVersion: d.candidate.version,
                version: next.version,
                state: "completed",
                reason,
              })
            ).status,
            201,
          );
          d = await detail();
        }
        assert.equal(d.readiness.controls[0].status, "passed");
        assert.equal(d.readiness.controls[1].status, "passed");
        const eligibleVersion = d.candidate.version;
        const reviewsBefore = d.localReviews.length;
        await assert.rejects(
          new OnboardingStore(store).proposeLocalReview(
            { ...actor, role: "hr_admin" },
            id,
            {
              caseVersion: eligibleVersion,
              reason: "This proposal must roll back with its failed audit.",
            },
            "invalid-request-uuid",
          ),
        );
        d = await detail();
        assert.equal(d.candidate.version, eligibleVersion);
        assert.equal(d.localReviews.length, reviewsBefore);
        const proposals = await Promise.allSettled(
          ["one", "two"].map(() =>
            new OnboardingStore(store).proposeLocalReview(
              { ...actor, role: "hr_admin" },
              id,
              {
                caseVersion: d.candidate.version,
                reason:
                  "Request independent review of complete synthetic evidence.",
              },
              randomUUID(),
            ),
          ),
        );
        assert.deepEqual(proposals.map((result) => result.status).sort(), [
          "fulfilled",
          "rejected",
        ]);
        d = await detail();
        version = d.candidate.version;
        const review = d.localReviews[0];
        assert.equal(review.state, "pending");
        const outsider = {
          ...actor,
          actorId: randomUUID(),
          entityId: randomUUID(),
          role: "hr_admin" as const,
          name: "Out-of-scope synthetic HR reviewer",
        };
        await assert.rejects(new OnboardingStore(store).detail(outsider, id));
        await assert.rejects(
          new OnboardingStore(store).proposeLocalReview(
            outsider,
            id,
            {
              caseVersion: version,
              reason: "Cross-entity proposal must not discover this intake.",
            },
            randomUUID(),
          ),
        );
        await assert.rejects(
          new OnboardingStore(store).decideLocalReview(
            outsider,
            id,
            review.id,
            {
              caseVersion: version,
              reviewVersion: review.version,
              decision: "rejected",
              reason: "Cross-entity decision must not discover this review.",
            },
            randomUUID(),
          ),
        );
        await assert.rejects(
          new OnboardingStore(store).decideLocalReview(
            {
              ...actor,
              actorId: randomUUID(),
              role: "hr_admin",
              name: "Non-maker synthetic HR reviewer",
            },
            id,
            review.id,
            {
              caseVersion: version,
              reviewVersion: review.version,
              decision: "withdrawn",
              reason: "Only the maker may withdraw this review request.",
            },
            randomUUID(),
          ),
        );
        const added = d.tasks.find(
          (task: CandidateTask) =>
            task.label === "Confirm a fictional induction preference",
        );
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${added.id}`, {
              caseVersion: version,
              version: added.version,
              state: "pending",
              reason:
                "Reopen synthetic evidence to verify decision eligibility.",
            })
          ).status,
          201,
        );
        d = await detail();
        const reopened = d.tasks.find(
          (task: CandidateTask) => task.id === added.id,
        );
        await assert.rejects(
          new OnboardingStore(store).decideLocalReview(
            {
              ...actor,
              actorId: randomUUID(),
              role: "hr_admin",
              name: "Eligibility synthetic reviewer",
            },
            id,
            review.id,
            {
              caseVersion: d.candidate.version,
              reviewVersion: review.version,
              decision: "approved",
              reason: "Approval must recheck the complete local evidence.",
            },
            randomUUID(),
          ),
        );
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${reopened.id}`, {
              caseVersion: d.candidate.version,
              version: reopened.version,
              state: "completed",
              reason,
            })
          ).status,
          201,
        );
        d = await detail();
        version = d.candidate.version;
        assert.equal(
          (
            await hr(`/candidates/${id}/local-reviews/${review.id}`, {
              caseVersion: version,
              reviewVersion: review.version,
              decision: "approved",
              reason: "Attempted self approval must remain forbidden.",
            })
          ).status,
          409,
        );
        const reviewers = ["First", "Second"].map((label) => ({
          ...actor,
          actorId: randomUUID(),
          role: "hr_admin" as const,
          name: `${label} independent synthetic reviewer`,
        }));
        const decisions = await Promise.allSettled(
          reviewers.map((reviewer) =>
            new OnboardingStore(store).decideLocalReview(
              reviewer,
              id,
              review.id,
              {
                caseVersion: version,
                reviewVersion: review.version,
                decision: "approved",
                reason:
                  "Independently approved complete synthetic local evidence.",
              },
              randomUUID(),
            ),
          ),
        );
        assert.deepEqual(decisions.map((result) => result.status).sort(), [
          "fulfilled",
          "rejected",
        ]);
        d = await detail();
        version = d.candidate.version;
        assert.equal(d.localReviews[0].state, "approved");
        assert.ok(
          reviewers.some(
            (reviewer) => reviewer.name === d.localReviews[0].deciderLabel,
          ),
        );
        assert.equal(d.readiness.activationReady, false);
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM audit_event WHERE target=$1 AND action IN ('candidate.local_review_proposed','candidate.local_review_decided')",
              [id],
            )
          ).rowCount,
          2,
        );
        assert.equal(
          (await admin.query("SELECT id FROM employee WHERE id=$1", [id]))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "rotation revokes sessions and old invitations, cancellation closes access",
      async () => {
        const oldToken = token;
        await admin.query(
          "UPDATE candidate_case SET invitation_sent_at=now()-interval '2 minutes' WHERE id=$1",
          [id],
        );
        await invite();
        assert.notEqual(token, oldToken);
        assert.equal((await api("session")).status, 401);
        await login();
        const r = await hr(`/candidates/${id}/revoke`, { version, reason });
        assert.equal(r.status, 201);
        assert.equal((await api("session")).status, 401);
        const d = await detail();
        assert.equal(
          (
            await hr(`/candidates/${id}/tasks/${ownTask.id}`, {
              caseVersion: d.candidate.version,
              version: ownTask.version,
              state: "pending",
              reason,
            })
          ).status,
          409,
        );
        await switchRole("employee");
        const closedAssignments = await (await hr("/onboarding/tasks")).json();
        assert.equal(
          closedAssignments.items.some(
            (task: { id: string }) => task.id === hrTask.id,
          ),
          false,
        );
        assert.equal(
          (
            await scoped(store.pool, { ...actor, role: "employee" }, (client) =>
              client.query("SELECT id FROM candidate_task WHERE id=$1", [
                hrTask.id,
              ]),
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await scoped(store.pool, { ...actor, role: "employee" }, (client) =>
              client.query(
                "SELECT task_id FROM candidate_task_assignment WHERE task_id=$1",
                [hrTask.id],
              ),
            )
          ).rowCount,
          0,
        );
        await switchRole("hr_admin");
      },
    );
  } finally {
    for (const cleanupId of [id, ...extraCases].filter(Boolean)) {
      await admin.query(
        "DELETE FROM candidate_task_assignment WHERE task_id IN (SELECT id FROM candidate_task WHERE candidate_id=$1)",
        [cleanupId],
      );
      for (const table of [
        "candidate_local_review",
        "candidate_task",
        "candidate_delivery_preview",
        "candidate_challenge",
        "candidate_session",
        "candidate_submission",
      ])
        await admin.query(`DELETE FROM ${table} WHERE candidate_id=$1`, [
          cleanupId,
        ]);
      await admin.query("DELETE FROM candidate_case WHERE id=$1", [cleanupId]);
    }
    await candidate.store.pool.end();
    await candidate.app.close();
    await store.pool.end();
    await app.close();
    await admin.end();
  }
});
