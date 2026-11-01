import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import {
  makePool,
  scoped,
  setContext,
  transaction,
} from "../packages/database/src/index";
import type {
  AssetDetail,
  ExitDetail,
  ExitList,
  MyExit,
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

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);

await test("Exits: resignation, clearance, completion and the guards underneath", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4493" });
  const { app, store } = await createApp(config);
  await app.listen(4493, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const cases: string[] = [];
  const assets: string[] = [];
  const restore = new Map<string, string>();
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4493/api/v1${path}`, {
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
  const detail = async (id: string) =>
    (await (await request(`/exits/${id}`)).json()) as ExitDetail;
  const today = (
    await admin.query<{ today: string }>(
      `SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS today FROM legal_entity WHERE id=$1`,
      [actor.entityId],
    )
  ).rows[0]!.today;
  // A colleague with no open case is the subject of the HR-run flow; their status is restored afterwards.
  const leaver = (
    await admin.query<{ id: string; status: string }>(
      `SELECT e.id, e.status FROM employee e WHERE e.entity_id=$1 AND e.id<>$2 AND e.status='active'
        AND NOT EXISTS(SELECT 1 FROM exit_case c WHERE c.employee_id=e.id AND c.status IN ('submitted','accepted'))
        AND NOT EXISTS(SELECT 1 FROM asset_assignment a WHERE a.employee_id=e.id AND a.returned_on IS NULL)
       ORDER BY e.code LIMIT 1`,
      [actor.entityId, actor.employeeId],
    )
  ).rows[0]!;
  const start = (body: Record<string, unknown> = {}) =>
    send("/exits", "POST", {
      employeeId: leaver.id,
      kind: "end_of_contract",
      reason: `Synthetic contract end ${run}`,
      noticeGivenOn: today,
      ...body,
    });

  try {
    await t.test(
      "only HR runs exits; auditors and admins see nothing",
      async () => {
        for (const role of ["auditor", "platform_admin"] as const) {
          await changeRole(role);
          assert.equal((await request("/exits")).status, 403, role);
          assert.equal((await request("/exits/mine")).status, 403, role);
          assert.equal((await start()).status, 403, role);
        }
        for (const role of ["employee", "manager"] as const) {
          await changeRole(role);
          assert.equal((await request("/exits")).status, 403, role);
          assert.equal((await start()).status, 403, role);
          assert.equal((await request("/exits/mine")).status, 200, role);
        }
      },
    );

    await t.test(
      "an employee resigns, sees only their own case and may withdraw it",
      async () => {
        await changeRole("employee");
        const bad = await send("/exits/mine", "POST", { reason: "x" });
        assert.equal(bad.status, 400);
        const sneaky = await send("/exits/mine", "POST", {
          reason: "Moving abroad",
          kind: "termination",
        });
        assert.equal(sneaky.status, 400, "employees cannot choose the kind");
        const submitted = await send("/exits/mine", "POST", {
          reason: `Moving to another city ${run}`,
        });
        assert.equal(submitted.status, 201, await submitted.clone().text());
        const mine = (await submitted.json()) as MyExit;
        assert.ok(mine.current);
        cases.push(mine.current!.case.id);
        assert.equal(mine.current!.case.kind, "resignation");
        assert.equal(mine.current!.case.status, "submitted");
        assert.equal(mine.current!.case.noticeGivenOn, today);
        assert.equal(mine.current!.clearances.length, 0);
        const twice = await send("/exits/mine", "POST", {
          reason: "A second resignation",
        });
        assert.equal(twice.status, 409, "one open case per employee");
        assert.equal(
          (await request(`/exits/${mine.current!.case.id}`)).status,
          403,
          "the HR view is not for employees",
        );

        await changeRole("hr_admin");
        const own = await send(
          `/exits/${mine.current!.case.id}/accept`,
          "POST",
          {
            version: 1,
            lastWorkingDay: addDays(today, 30),
          },
        );
        assert.equal(own.status, 403, "HR cannot accept their own exit");

        await changeRole("employee");
        const stale = await send(
          `/exits/mine/${mine.current!.case.id}/withdraw`,
          "POST",
          { version: 9 },
        );
        assert.equal(stale.status, 409);
        const back = await send(
          `/exits/mine/${mine.current!.case.id}/withdraw`,
          "POST",
          { version: 1, note: "Changed my mind" },
        );
        assert.equal(back.status, 201, await back.clone().text());
        const after = (await back.json()) as MyExit;
        assert.equal(after.current, null);
        assert.equal(after.history[0]!.status, "withdrawn");
        assert.equal(
          (
            await send(
              `/exits/mine/${mine.current!.case.id}/withdraw`,
              "POST",
              {
                version: 2,
              },
            )
          ).status,
          409,
          "a closed case is final",
        );
      },
    );

    await t.test(
      "HR starts, accepts, clears and completes; assets block the assets clearance",
      async () => {
        await changeRole("hr_admin");
        assert.equal(
          (await start({ noticeGivenOn: addDays(today, 3) })).status,
          400,
          "notice cannot be in the future",
        );
        const started = await start();
        assert.equal(started.status, 201, await started.clone().text());
        let exit = (await started.json()) as ExitDetail;
        cases.push(exit.case.id);
        assert.equal(exit.case.status, "submitted");
        assert.equal((await start()).status, 409, "one open case per employee");

        const complete = (version: number) =>
          send(`/exits/${exit.case.id}/complete`, "POST", { version });
        assert.equal(
          (await complete(exit.case.version)).status,
          409,
          "cannot complete before acceptance",
        );
        const early = await send(`/exits/${exit.case.id}/accept`, "POST", {
          version: exit.case.version,
          lastWorkingDay: addDays(today, -1),
        });
        assert.equal(early.status, 400, "last day before notice");
        const far = await send(`/exits/${exit.case.id}/accept`, "POST", {
          version: exit.case.version,
          lastWorkingDay: addDays(today, 181),
        });
        assert.equal(far.status, 400, "last day too far out");
        const accepted = await send(`/exits/${exit.case.id}/accept`, "POST", {
          version: exit.case.version,
          lastWorkingDay: addDays(today, 30),
        });
        assert.equal(accepted.status, 201, await accepted.clone().text());
        exit = (await accepted.json()) as ExitDetail;
        assert.equal(exit.case.status, "accepted");
        assert.equal(exit.case.lastWorkingDay, addDays(today, 30));
        assert.equal(exit.clearances.length, 5);
        assert.ok(exit.clearances.every((c) => c.status === "pending"));
        const status = async () =>
          (
            await admin.query<{ status: string }>(
              "SELECT status FROM employee WHERE id=$1",
              [leaver.id],
            )
          ).rows[0]!.status;
        assert.equal(await status(), "notice", "accepted means notice");

        // Issue a synthetic laptop to the leaver.
        const reg = await send("/assets", "POST", {
          tag: `EXT-${run}`,
          category: "laptop",
          name: `Synthetic exit laptop`,
          serialNumber: `SN-EXT-${run}`,
          condition: "good",
        });
        assert.equal(reg.status, 201, await reg.clone().text());
        let laptop = (await reg.json()) as AssetDetail;
        assets.push(laptop.asset.id);
        const issued = await send(`/assets/${laptop.asset.id}/issue`, "POST", {
          employeeId: leaver.id,
          version: laptop.asset.version,
        });
        assert.equal(issued.status, 201, await issued.clone().text());
        laptop = (await issued.json()) as AssetDetail;
        exit = await detail(exit.case.id);
        assert.equal(exit.openAssets, 1);

        const clear = (item: string, body: Record<string, unknown>) => {
          const c = exit.clearances.find((x) => x.item === item)!;
          return send(`/exits/${exit.case.id}/clearances/${c.id}`, "PUT", {
            version: c.version,
            ...body,
          });
        };
        assert.equal(
          (await clear("assets", { status: "cleared" })).status,
          409,
          "assets cannot be cleared while one is held",
        );
        assert.equal(
          (await clear("assets", { status: "waived", note: "Keeps laptop" }))
            .status,
          409,
          "or waived",
        );
        assert.equal(
          (await clear("finance", { status: "waived" })).status,
          400,
          "waiving needs a note",
        );

        const returned = await send(
          `/assets/${laptop.asset.id}/return`,
          "POST",
          {
            condition: "good",
            version: laptop.asset.version,
          },
        );
        assert.equal(returned.status, 201, await returned.clone().text());

        for (const [item, body] of [
          ["assets", { status: "cleared" }],
          ["finance", { status: "cleared", note: "Final settlement done" }],
          ["it_access", { status: "cleared" }],
          ["manager_handover", { status: "waived", note: "Role is closing" }],
        ] as const) {
          const response = await clear(item, body);
          assert.equal(response.status, 200, await response.clone().text());
          exit = (await response.json()) as ExitDetail;
        }
        const assetsRow = exit.clearances.find((c) => c.item === "assets")!;
        assert.ok(assetsRow.clearedBy && assetsRow.clearedAt);
        const stale = await send(
          `/exits/${exit.case.id}/clearances/${assetsRow.id}`,
          "PUT",
          { version: 1, status: "pending" },
        );
        assert.equal(stale.status, 409, "a stale clearance edit conflicts");
        assert.equal(
          (await complete(exit.case.version)).status,
          409,
          "one clearance is still pending",
        );
        exit = (await (
          await clear("hr_documents", { status: "cleared" })
        ).json()) as ExitDetail;
        assert.equal((await complete(99)).status, 409, "stale version");
        assert.equal(
          (await complete(exit.case.version)).status,
          409,
          "the last working day is 30 days out",
        );
        const finish = (body: Record<string, unknown>) =>
          send(`/exits/${exit.case.id}/complete`, "POST", {
            version: exit.case.version,
            ...body,
          });
        assert.equal(
          (await finish({ earlyRelease: true })).status,
          400,
          "early release needs a reason",
        );
        const done = await finish({
          earlyRelease: true,
          note: "Garden leave agreed",
        });
        assert.equal(done.status, 201, await done.clone().text());
        exit = (await done.json()) as ExitDetail;
        assert.equal(exit.case.status, "completed");
        assert.equal(exit.case.decisionNote, "Garden leave agreed");
        assert.ok(exit.case.closedAt && exit.case.closedBy);
        assert.equal(await status(), "inactive", "completion ends employment");
        const released = await admin.query<{
          reason: string;
          details: { earlyRelease?: boolean };
        }>(
          "SELECT reason, details FROM audit_event WHERE target=$1 AND action='exit.completed'",
          [`exit:${exit.case.id}`],
        );
        assert.equal(released.rows[0]!.reason, "Garden leave agreed");
        assert.equal(released.rows[0]!.details.earlyRelease, true);

        // Fix 1: no asset can be issued to someone whose exit is completed.
        laptop = (await (
          await request(`/assets/${laptop.asset.id}`)
        ).json()) as AssetDetail;
        const late = await send(`/assets/${laptop.asset.id}/issue`, "POST", {
          employeeId: leaver.id,
          version: laptop.asset.version,
        });
        assert.equal(late.status, 400, await late.clone().text());

        const doc = exit.clearances.find((c) => c.item === "hr_documents")!;
        assert.equal(
          (
            await send(`/exits/${exit.case.id}/clearances/${doc.id}`, "PUT", {
              version: doc.version,
              status: "pending",
            })
          ).status,
          409,
          "a completed case never changes",
        );
        assert.equal(
          (
            await send(`/exits/${exit.case.id}/withdraw`, "POST", {
              version: exit.case.version,
              note: "Undo",
            })
          ).status,
          409,
        );

        const listed = (await (
          await request(`/exits?status=completed&q=${run}`)
        ).json()) as ExitList;
        assert.ok(listed.items.some((i) => i.id === exit.case.id));
        assert.ok(listed.counts.completed >= 1);
        assert.equal(
          (await request("/exits?status=gone")).status,
          400,
          "unknown filters are refused",
        );
      },
    );

    await t.test("HR rejects with a reason", async () => {
      await changeRole("hr_admin");
      // The leaver is inactive now, so pick Maya's colleague via a fresh active employee.
      const other = (
        await admin.query<{ id: string }>(
          `SELECT e.id FROM employee e WHERE e.entity_id=$1 AND e.id<>$2 AND e.status='active'
            AND NOT EXISTS(SELECT 1 FROM exit_case c WHERE c.employee_id=e.id AND c.status IN ('submitted','accepted'))
           ORDER BY e.code LIMIT 1`,
          [actor.entityId, actor.employeeId],
        )
      ).rows[0]!.id;
      const started = await start({ employeeId: other, kind: "retirement" });
      assert.equal(started.status, 201, await started.clone().text());
      const exit = (await started.json()) as ExitDetail;
      cases.push(exit.case.id);
      assert.equal(
        (
          await send(`/exits/${exit.case.id}/reject`, "POST", {
            version: exit.case.version,
          })
        ).status,
        400,
      );
      const rejected = await send(`/exits/${exit.case.id}/reject`, "POST", {
        version: exit.case.version,
        note: "Recorded in error",
      });
      assert.equal(rejected.status, 201, await rejected.clone().text());
      assert.equal(
        ((await rejected.json()) as ExitDetail).case.status,
        "rejected",
      );
    });

    await t.test(
      "withdrawals need a fresh reason, own cases stay with others, completion and clearances serialize",
      async () => {
        await changeRole("hr_admin");
        const subject = (
          await admin.query<{ id: string; status: string }>(
            `SELECT e.id, e.status FROM employee e WHERE e.entity_id=$1 AND e.id<>$2 AND e.status='active'
              AND NOT EXISTS(SELECT 1 FROM exit_case c WHERE c.employee_id=e.id AND c.status IN ('submitted','accepted'))
              AND NOT EXISTS(SELECT 1 FROM asset_assignment a WHERE a.employee_id=e.id AND a.returned_on IS NULL)
             ORDER BY e.code DESC LIMIT 1`,
            [actor.entityId, actor.employeeId],
          )
        ).rows[0]!;
        restore.set(subject.id, subject.status);
        const open = async () => {
          const response = await start({ employeeId: subject.id });
          assert.equal(response.status, 201, await response.clone().text());
          let exit = (await response.json()) as ExitDetail;
          cases.push(exit.case.id);
          const accepted = await send(`/exits/${exit.case.id}/accept`, "POST", {
            version: exit.case.version,
            lastWorkingDay: today,
            note: "Accepted after talk",
          });
          assert.equal(accepted.status, 201, await accepted.clone().text());
          exit = (await accepted.json()) as ExitDetail;
          return exit;
        };
        // Fix 3: the accept note does not count as a withdrawal reason.
        let exit = await open();
        const withdraw = (body: Record<string, unknown>) =>
          send(`/exits/${exit.case.id}/withdraw`, "POST", {
            version: exit.case.version,
            ...body,
          });
        assert.equal((await withdraw({})).status, 400, "reason required");
        assert.equal(
          (await withdraw({ note: "Accepted after talk" })).status,
          400,
          "the old note is not a new reason",
        );
        const gone = await withdraw({ note: "Decided to stay" });
        assert.equal(gone.status, 201, await gone.clone().text());
        assert.equal(
          ((await gone.json()) as ExitDetail).case.decisionNote,
          "Decided to stay",
        );

        // Fix 2: a clearance reset in flight blocks completion until it commits.
        exit = await open();
        for (const c of exit.clearances) {
          const response = await send(
            `/exits/${exit.case.id}/clearances/${c.id}`,
            "PUT",
            { version: c.version, status: "cleared" },
          );
          assert.equal(response.status, 200, await response.clone().text());
          exit = (await response.json()) as ExitDetail;
        }
        const pool = makePool(process.env.DATABASE_URL!);
        const holder = await pool.connect();
        try {
          await holder.query("BEGIN");
          await setContext(holder, { ...actor, role: "hr_admin" });
          await holder.query(
            "UPDATE exit_clearance SET status='pending', note=NULL, version=version+1 WHERE case_id=$1 AND item='finance'",
            [exit.case.id],
          );
          const racing = send(`/exits/${exit.case.id}/complete`, "POST", {
            version: exit.case.version,
          });
          await new Promise((resolve) => setTimeout(resolve, 600));
          await holder.query("COMMIT");
          const raced = await racing;
          assert.equal(raced.status, 409, await raced.clone().text());
        } finally {
          holder.release();
          await pool.end();
        }
        const after = await detail(exit.case.id);
        assert.equal(after.case.status, "accepted");

        // Fix 4: HR cannot withdraw their own accepted case.
        await changeRole("employee");
        const mine = await send("/exits/mine", "POST", {
          reason: `Own accepted case ${run}`,
        });
        assert.equal(mine.status, 201, await mine.clone().text());
        const own = ((await mine.json()) as MyExit).current!.case;
        cases.push(own.id);
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "UPDATE exit_case SET status='accepted', last_working_day=notice_given_on, decided_at=now(), decided_by_label='Other HR', version=2 WHERE id=$1",
            [own.id],
          );
        });
        await changeRole("hr_admin");
        const self = await send(`/exits/${own.id}/withdraw`, "POST", {
          version: 2,
          note: "Withdrawing my own",
        });
        assert.equal(self.status, 403, await self.clone().text());
        await changeRole("employee");
        assert.equal(
          (
            await send(`/exits/mine/${own.id}/withdraw`, "POST", {
              version: 2,
            })
          ).status,
          403,
          "an accepted case is not the employee's to withdraw",
        );
      },
    );

    await t.test(
      "every action leaves an audit record and an outbox event",
      async () => {
        const audit = await admin.query<{ action: string }>(
          "SELECT action FROM audit_event WHERE target=ANY($1::text[])",
          [cases.map((id) => `exit:${id}`)],
        );
        const actions = new Set(audit.rows.map((r) => r.action));
        for (const action of [
          "exit.submitted",
          "exit.withdrawn",
          "exit.accepted",
          "exit.clearance_updated",
          "exit.completed",
          "exit.rejected",
        ])
          assert.ok(actions.has(action), action);
        const events = await admin.query<{ event_type: string }>(
          `SELECT event_type FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])
             OR aggregate_id IN (SELECT id FROM exit_clearance WHERE case_id=ANY($1::uuid[]))`,
          [cases],
        );
        const types = new Set(events.rows.map((r) => r.event_type));
        for (const type of [
          "exit.submitted.v1",
          "exit.withdrawn.v1",
          "exit.accepted.v1",
          "exit.clearance_updated.v1",
          "exit.completed.v1",
          "exit.rejected.v1",
        ])
          assert.ok(types.has(type), type);
      },
    );

    await t.test(
      "the database refuses what the API would never send",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const employeeActor = { ...actor, role: "employee" as const };
          const hr = { ...actor, role: "hr_admin" as const };
          const auditor = { ...actor, role: "auditor" as const };
          const completed = cases[1]!;
          // An employee cannot open a case for someone else, or anything but a resignation.
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "INSERT INTO exit_case(id,tenant_id,entity_id,employee_id,kind,reason,notice_given_on) VALUES ($1,$2,$3,$4,'resignation','Not mine at all',CURRENT_DATE)",
                [randomUUID(), actor.tenantId, actor.entityId, leaver.id],
              ),
            ),
          );
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "INSERT INTO exit_case(id,tenant_id,entity_id,employee_id,kind,reason,notice_given_on) VALUES ($1,$2,$3,$4,'termination','Fire myself',CURRENT_DATE)",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  actor.employeeId,
                ],
              ),
            ),
            /only submit a resignation/,
          );
          // Others' cases are invisible to employees and auditors.
          for (const who of [employeeActor, auditor]) {
            const seen = await scoped(pool, who, (client) =>
              client.query("SELECT id FROM exit_case WHERE id=$1", [completed]),
            );
            assert.equal(seen.rowCount, 0);
          }
          // HR on a fresh case: no skipping to completed, no clearing without acceptance.
          const direct = (employeeId: string, after?: string) =>
            scoped(pool, hr, async (client) => {
              const id = randomUUID();
              await client.query(
                "INSERT INTO exit_case(id,tenant_id,entity_id,employee_id,kind,reason,notice_given_on) VALUES ($1,$2,$3,$4,'other','Synthetic direct case',leave_entity_today())",
                [id, actor.tenantId, actor.entityId, employeeId],
              );
              if (after) await client.query(after, [id]);
              throw new Error("rolled back on purpose");
            });
          // The leaver is inactive now, so a new case for them is refused.
          await assert.rejects(direct(leaver.id), /only for current employees/);
          const active = (
            await admin.query<{ id: string }>(
              `SELECT e.id FROM employee e WHERE e.entity_id=$1 AND e.id<>$2 AND e.status='active'
                AND NOT EXISTS(SELECT 1 FROM exit_case c WHERE c.employee_id=e.id AND c.status IN ('submitted','accepted'))
               LIMIT 1`,
              [actor.entityId, actor.employeeId],
            )
          ).rows[0]!.id;
          await assert.rejects(
            direct(
              active,
              "UPDATE exit_case SET status='completed', last_working_day=notice_given_on, version=version+1 WHERE id=$1",
            ),
            /exit step is not allowed|last working day is set/,
          );
          await assert.rejects(
            direct(
              active,
              "UPDATE exit_case SET status='accepted', last_working_day=notice_given_on+400, version=version+1 WHERE id=$1",
            ),
            /within 180 days/,
          );
          const open = cases[2]!; // rejected case
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE exit_case SET status='completed', version=version+1 WHERE id=$1",
                [open],
              ),
            ),
            /closed exit case is final/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "INSERT INTO exit_clearance(id,tenant_id,entity_id,case_id,item) VALUES ($1,$2,$3,$4,'finance')",
                [randomUUID(), actor.tenantId, actor.entityId, open],
              ),
            ),
            /only while the case is accepted/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE exit_case SET reason='Rewritten history', version=version+1 WHERE id=$1",
                [completed],
              ),
            ),
            /permission denied/,
          );
          // An employee cannot touch clearances.
          const touched = await scoped(pool, employeeActor, (client) =>
            client
              .query(
                "UPDATE exit_clearance SET status='waived', note='Self cleared', version=version+1 WHERE case_id=$1",
                [completed],
              )
              .catch((error: Error) => error),
          );
          assert.ok(
            touched instanceof Error || touched.rowCount === 0,
            "employee clearance edit refused",
          );
          // Nothing is ever deleted.
          for (const table of ["exit_clearance", "exit_case"])
            await assert.rejects(
              scoped(pool, hr, (client) =>
                client.query(
                  `DELETE FROM ${table} WHERE ${table === "exit_case" ? "id" : "case_id"}=$1`,
                  [completed],
                ),
              ),
              /permission denied|never deleted/,
            );
        } finally {
          await pool.end();
        }
      },
    );
  } finally {
    // Synthetic cleanup only: exit history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const clearances = (
        await client.query<{ id: string }>(
          "SELECT id FROM exit_clearance WHERE case_id=ANY($1::uuid[])",
          [cases],
        )
      ).rows.map((r) => r.id);
      const assignments = (
        await client.query<{ id: string }>(
          "SELECT id FROM asset_assignment WHERE asset_id=ANY($1::uuid[])",
          [assets],
        )
      ).rows.map((r) => r.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [[...cases, ...clearances, ...assets, ...assignments]],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[]) OR target ~ ANY($2::text[])",
        [cases.map((id) => `exit:${id}`), assets.map((id) => `^asset:${id}`)],
      );
      await client.query(
        "DELETE FROM exit_clearance WHERE case_id=ANY($1::uuid[])",
        [cases],
      );
      await client.query("DELETE FROM exit_case WHERE id=ANY($1::uuid[])", [
        cases,
      ]);
      await client.query(
        "DELETE FROM asset_assignment WHERE asset_id=ANY($1::uuid[])",
        [assets],
      );
      await client.query("DELETE FROM asset WHERE id=ANY($1::uuid[])", [
        assets,
      ]);
      if (leaver) restore.set(leaver.id, leaver.status);
      for (const [id, status] of restore)
        await client.query("UPDATE employee SET status=$2 WHERE id=$1", [
          id,
          status,
        ]);
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
