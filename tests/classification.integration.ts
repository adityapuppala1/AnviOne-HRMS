import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped } from "../packages/database/src/index";
import type {
  EmployeeClassification,
  EmployeeDetail,
  OrganizationDirectory,
  OrganizationUnit,
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

const PORT = 4505;

await test("Employee designation, grade and cost centre", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const units: string[] = [];
  const people: string[] = [];
  const employments: string[] = [];
  const prefix = `QC-${randomUUID().slice(0, 8).toUpperCase()}`;
  const reason = "Synthetic classification acceptance check";
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
  const post = (path: string, body: unknown) =>
    request(path, { method: "POST", body: JSON.stringify(body) });
  const put = (path: string, body: unknown) =>
    request(path, { method: "PUT", body: JSON.stringify(body) });
  async function changeRole(role: Role) {
    const response = await post("/session/role-context", { role });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  async function createUnit(
    suffix: string,
    kind: string,
    extra: Record<string, unknown> = {},
  ) {
    const response = await post("/organization", {
      kind,
      code: `${prefix}-${suffix}`,
      name: `${prefix} ${suffix} name`,
      reason,
      ...extra,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const item = (await response.json()) as OrganizationUnit;
    units.push(item.id);
    return item;
  }
  const versionOf = async (employeeId: string): Promise<number> =>
    ((
      await admin.query(
        "SELECT classification_version AS v FROM employee WHERE id=$1",
        [employeeId],
      )
    ).rows[0]?.v as number | undefined) ?? 0;
  const classify = async (
    employeeId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    put(`/people/${employeeId}/classification`, {
      designationId: null,
      gradeId: null,
      costCenterId: null,
      reason,
      version: await versionOf(employeeId),
      ...body,
    });
  const dates = (
    await admin.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS today, to_char(d-1,'YYYY-MM-DD') AS yesterday,
         to_char(d+1,'YYYY-MM-DD') AS tomorrow, to_char(d-10,'YYYY-MM-DD') AS earlier
       FROM org_entity_today($1,$2) d`,
      [actor.tenantId, actor.entityId],
    )
  ).rows[0] as Record<string, string>;
  const home = (
    await admin.query(
      "SELECT department_id,location_id FROM employee WHERE id=$1",
      [actor.employeeId],
    )
  ).rows[0] as { department_id: string; location_id: string };
  const personId = randomUUID();
  const personName = `${prefix} person`;
  people.push(personId);
  await admin.query(
    "INSERT INTO person(id,tenant_id,name,initials) VALUES($1,$2,$3,'QC')",
    [personId, actor.tenantId, personName],
  );
  async function addEmployment(status = "active") {
    const id = randomUUID();
    const code = (
      await admin.query("SELECT issue_employee_code($1,$2,$3) AS code", [
        actor.tenantId,
        actor.entityId,
        id,
      ])
    ).rows[0].code;
    await admin.query(
      `INSERT INTO employee(id,tenant_id,entity_id,person_id,code,title,department_id,location_id,email,joined_on,status)
       VALUES($1,$2,$3,$4,$5,'Synthetic role',$6,$7,$8,'2026-01-01',$9)`,
      [
        id,
        actor.tenantId,
        actor.entityId,
        personId,
        code,
        home.department_id,
        home.location_id,
        `${id}@anvi.example`,
        status,
      ],
    );
    employments.push(id);
    return id;
  }
  const count = async (kind: string, id: string) => {
    const list = (await (
      await request(`/organization?kind=${kind}&q=${prefix}&limit=50`)
    ).json()) as OrganizationDirectory;
    return list.items.find((i) => i.id === id)!.employeeCount;
  };

  try {
    await changeRole("hr_admin");
    const designation = await createUnit("DES", "designation");
    const grade = await createUnit("GRD", "grade");
    const cost = await createUnit("CC", "cost_center");
    const worker = await addEmployment("active");
    const former = await addEmployment("inactive");

    await t.test("HR assigns, replays and clears", async () => {
      const response = await classify(worker, {
        designationId: designation.id,
        gradeId: grade.id,
        costCenterId: cost.id,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const body = (await response.json()) as EmployeeClassification;
      assert.equal(body.changed, true);
      assert.equal(body.version, 1);
      assert.deepEqual(body.designation, {
        id: designation.id,
        code: designation.code,
        name: designation.name,
      });
      assert.equal(body.costCenter?.id, cost.id);
      const replay = (await (
        await classify(worker, {
          designationId: designation.id,
          gradeId: grade.id,
          costCenterId: cost.id,
        })
      ).json()) as EmployeeClassification;
      assert.equal(replay.changed, false);
      assert.equal(replay.version, 1);
      const detail = (await (
        await request(`/employees/${worker}`)
      ).json()) as EmployeeDetail;
      assert.equal(detail.designation?.code, designation.code);
      assert.equal(detail.grade?.name, grade.name);
      assert.equal(detail.costCenter?.id, cost.id);
      const list = await (
        await request(`/employees?q=${encodeURIComponent(personName)}`)
      ).json();
      assert.equal(list.items.length, 1);
      assert.equal("designation" in list.items[0], false);
      assert.equal(await count("designation", designation.id), 1);
      assert.equal(await count("grade", grade.id), 1);
      assert.equal(await count("cost_center", cost.id), 1);
      const cleared = (await (
        await classify(worker, { designationId: designation.id })
      ).json()) as EmployeeClassification;
      assert.equal(cleared.grade, null);
      assert.equal(cleared.costCenter, null);
      assert.equal(cleared.version, 2);
      assert.equal(await count("grade", grade.id), 0);
    });

    await t.test("refuses wrong, foreign and unusable units", async () => {
      const ended = await createUnit("END", "designation", {
        effectiveFrom: dates.earlier,
        effectiveTo: dates.yesterday,
      });
      const scheduled = await createUnit("SCH", "designation", {
        effectiveFrom: dates.tomorrow,
      });
      const inactive = await createUnit("INA", "designation");
      const off = await put(`/organization/${inactive.id}`, {
        name: inactive.name,
        active: false,
        version: inactive.version,
        reason,
      });
      assert.equal(off.status, 200);
      const dept = await createUnit("DPT", "department");
      const other = await admin.query(
        "SELECT tenant_id,id FROM legal_entity WHERE id<>$1 LIMIT 1",
        [actor.entityId],
      );
      const foreignId = randomUUID();
      await admin.query(
        `INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name) VALUES($1,$2,$3,'designation',$4,$5)`,
        [
          foreignId,
          other.rows[0].tenant_id,
          other.rows[0].id,
          `${prefix}-FOR`,
          `${prefix} foreign`,
        ],
      );
      units.push(foreignId);
      for (const id of [
        grade.id,
        dept.id,
        foreignId,
        ended.id,
        scheduled.id,
        inactive.id,
      ]) {
        const r = await classify(worker, { designationId: id });
        assert.equal(r.status, 400, id);
      }
      // A merged unit is always a department or location, so it is the wrong kind here.
      const target = await createUnit("DPT2", "department");
      const merged = await post(`/organization/${dept.id}/merge`, {
        targetId: target.id,
        version: dept.version,
        targetVersion: target.version,
        reason,
      });
      assert.equal(merged.status, 201, await merged.clone().text());
      assert.equal(
        (await classify(worker, { costCenterId: dept.id })).status,
        400,
      );
      assert.equal(
        (await classify(randomUUID(), { gradeId: grade.id })).status,
        404,
      );
      assert.equal((await classify(former, { gradeId: grade.id })).status, 404);
      const foreignEmployee = await admin.query(
        "SELECT id FROM employee WHERE entity_id<>$1 LIMIT 1",
        [actor.entityId],
      );
      if (foreignEmployee.rows[0])
        assert.equal(
          (await classify(foreignEmployee.rows[0].id, { gradeId: grade.id }))
            .status,
          404,
        );
      assert.equal(
        (await classify(worker, { gradeId: grade.id, reason: "too short" }))
          .status,
        400,
      );
      assert.equal(
        (await classify(worker, { gradeId: grade.id, extra: 1 })).status,
        400,
      );
    });

    await t.test("in-use units cannot be ended or postponed", async () => {
      const unit = (await (
        await request(`/organization/${designation.id}`)
      ).json()) as { item: OrganizationUnit };
      const end = await put(`/organization/${designation.id}`, {
        name: unit.item.name,
        active: true,
        version: unit.item.version,
        effectiveFrom: dates.earlier,
        effectiveTo: dates.yesterday,
        reason,
      });
      assert.equal(end.status, 409);
      const postpone = await put(`/organization/${designation.id}`, {
        name: unit.item.name,
        active: true,
        version: unit.item.version,
        effectiveFrom: dates.tomorrow,
        reason,
      });
      assert.equal(postpone.status, 409);
      // Ended after assignment (outside the API): still readable, kept on other edits.
      await admin.query(
        "UPDATE org_unit SET effective_from=$2, effective_to=$3, version=version+1 WHERE id=$1",
        [designation.id, dates.earlier, dates.yesterday],
      );
      const detail = (await (
        await request(`/employees/${worker}`)
      ).json()) as EmployeeDetail;
      assert.equal(detail.designation?.id, designation.id);
      const kept = await classify(worker, {
        designationId: designation.id,
        gradeId: grade.id,
      });
      assert.equal(kept.status, 200, await kept.clone().text());
      assert.equal(
        ((await kept.json()) as EmployeeClassification).designation?.id,
        designation.id,
      );
    });

    await t.test("audit and outbox carry ids and codes only", async () => {
      const audits = await admin.query(
        "SELECT reason,details FROM audit_event WHERE action='employee.classified' AND target LIKE $1 ORDER BY occurred_at",
        [`employee:${worker}:classification:%`],
      );
      assert.ok(audits.rows.length >= 3);
      for (const row of audits.rows) {
        assert.equal(row.reason, reason);
        const text = JSON.stringify(row.details);
        assert.ok(!text.includes(" name"), text);
        assert.ok(!text.includes(personName), text);
      }
      assert.equal(
        audits.rows[0].details.after.designation.code,
        designation.code,
      );
      const events = await admin.query(
        "SELECT event_type,aggregate_version FROM outbox_event WHERE aggregate_id=$1 ORDER BY aggregate_version",
        [worker],
      );
      assert.deepEqual(
        events.rows.map((r) => [r.event_type, r.aggregate_version]),
        [
          ["employee.classified.v1", 1],
          ["employee.classified.v1", 2],
          ["employee.classified.v1", 3],
        ],
      );
    });

    await t.test("no direct writes to the classification columns", async () => {
      await assert.rejects(
        scoped(store.pool, actor, (c) =>
          c.query("UPDATE employee SET grade_id=$2 WHERE id=$1", [
            worker,
            randomUUID(),
          ]),
        ),
      );
      await assert.rejects(
        admin.query("UPDATE employee SET grade_id=$2 WHERE id=$1", [
          worker,
          randomUUID(),
        ]),
        /only through classification/,
      );
      await assert.rejects(
        admin.query(
          "UPDATE employee SET classification_version=0 WHERE id=$1",
          [worker],
        ),
        /only through classification/,
      );
    });

    await t.test("concurrent changes serialize", async () => {
      const a = await createUnit("CA", "grade");
      const b = await createUnit("CB", "grade");
      const before = (
        await admin.query(
          "SELECT classification_version AS v FROM employee WHERE id=$1",
          [worker],
        )
      ).rows[0].v as number;
      const results = await Promise.all([
        classify(worker, { gradeId: a.id, version: before }),
        classify(worker, { gradeId: b.id, version: before }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const after = (
        await admin.query(
          "SELECT classification_version AS v, grade_id FROM employee WHERE id=$1",
          [worker],
        )
      ).rows[0];
      assert.equal(after.v, before + 1);
      assert.ok([a.id, b.id].includes(after.grade_id));

      const c = await createUnit("CC2", "cost_center", {
        effectiveFrom: dates.earlier,
      });
      const [assign, end] = await Promise.all([
        classify(worker, { gradeId: after.grade_id, costCenterId: c.id }),
        put(`/organization/${c.id}`, {
          name: c.name,
          active: true,
          version: c.version,
          effectiveFrom: dates.earlier,
          effectiveTo: dates.yesterday,
          reason,
        }),
      ]);
      const pair = [assign.status, end.status];
      assert.ok(
        (pair[0] === 200 && pair[1] === 409) ||
          (pair[0] === 400 && pair[1] === 200),
        String(pair),
      );
    });

    await t.test("only HR may classify; the profile shows it", async () => {
      await changeRole("employee");
      assert.equal((await classify(worker, { gradeId: grade.id })).status, 403);
      const own = (await (
        await request(`/employees/${actor.employeeId}`)
      ).json()) as EmployeeDetail;
      assert.equal(own.classificationRestricted, false);
      assert.equal(typeof own.version, "number");
      await changeRole("hr_admin");
    });

    await t.test("grade and cost centre are HR or self only", async () => {
      const fresh = await createUnit("VIS", "cost_center");
      const title = await createUnit("VISD", "designation");
      const r = await classify(worker, {
        designationId: title.id,
        gradeId: grade.id,
        costCenterId: fresh.id,
      });
      assert.equal(r.status, 200, await r.clone().text());
      const hr = (await (
        await request(`/employees/${worker}`)
      ).json()) as EmployeeDetail;
      assert.equal(hr.classificationRestricted, false);
      assert.equal(hr.costCenter?.id, fresh.id);
      await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
        worker,
        actor.employeeId,
      ]);
      await changeRole("manager");
      const seen = await request(`/employees/${worker}`);
      assert.equal(seen.status, 200, await seen.clone().text());
      const mgr = (await seen.json()) as EmployeeDetail;
      assert.equal(mgr.classificationRestricted, true);
      assert.equal(mgr.grade, null);
      assert.equal(mgr.costCenter, null);
      assert.equal(mgr.designation?.id, title.id);
      await changeRole("hr_admin");
      await admin.query("UPDATE employee SET manager_id=NULL WHERE id=$1", [
        worker,
      ]);
    });

    await t.test(
      "lost updates and in-use deactivation are refused",
      async () => {
        const stale = await versionOf(worker);
        assert.equal(
          (await classify(worker, { gradeId: grade.id })).status,
          200,
        );
        const lost = await classify(worker, { gradeId: null, version: stale });
        assert.equal(lost.status, 409);
        const g = (await (
          await request(`/organization/${grade.id}`)
        ).json()) as {
          item: OrganizationUnit;
        };
        const off = await put(`/organization/${grade.id}`, {
          name: g.item.name,
          active: false,
          version: g.item.version,
          reason,
        });
        assert.equal(off.status, 409);
        assert.match(await off.text(), /Reclassify/);
        const ended = await put(`/organization/${grade.id}`, {
          name: g.item.name,
          active: true,
          version: g.item.version,
          effectiveFrom: dates.earlier,
          effectiveTo: dates.yesterday,
          reason,
        });
        assert.equal(ended.status, 409);
        assert.match(await ended.text(), /Reclassify/);
      },
    );
  } finally {
    await admin.query("DELETE FROM employee WHERE id=ANY($1::uuid[])", [
      employments,
    ]);
    await admin.query("DELETE FROM person WHERE id=ANY($1::uuid[])", [people]);
    await admin.query("DELETE FROM org_unit WHERE id=ANY($1::uuid[])", [units]);
    const left = await admin.query(
      "SELECT count(*)::int AS n FROM org_unit WHERE code LIKE $1",
      [`${prefix}-%`],
    );
    assert.equal(left.rows[0].n, 0);
    await store.pool.end();
    await admin.end();
    await app.close();
  }
});
