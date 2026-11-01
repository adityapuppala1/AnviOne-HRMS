import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped } from "../packages/database/src/index";
import type {
  OrganizationChart,
  OrganizationDetail,
  OrganizationMergeResult,
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

const PORT = 4499;

await test("Organization masters, effective windows, merges and chart", async (t) => {
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
  const candidates: string[] = [];
  const prefix = `QB-${randomUUID().slice(0, 8).toUpperCase()}`;
  const reason = "Synthetic organization v2 acceptance check";
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
  // Merge bodies default targetVersion to 1 (fresh targets) unless a test sets it.
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      body: JSON.stringify(
        path.endsWith("/merge") &&
          body &&
          typeof body === "object" &&
          !("targetVersion" in body)
          ? { targetVersion: 1, ...body }
          : body,
      ),
    });
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
    kind = "department",
    extra: Record<string, unknown> = {},
  ) {
    const response = await post("/organization", {
      kind,
      code: `${prefix}-${suffix}`,
      name: `${prefix} ${suffix}`,
      reason,
      ...extra,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const item = (await response.json()) as OrganizationUnit;
    units.push(item.id);
    return item;
  }
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
  people.push(personId);
  await admin.query(
    "INSERT INTO person(id,tenant_id,name,initials) VALUES($1,$2,$3,'QB')",
    [personId, actor.tenantId, `${prefix} person`],
  );
  async function addEmployment(
    departmentId: string,
    options: { managerId?: string | null; status?: string } = {},
  ) {
    const id = randomUUID();
    const code = (
      await admin.query("SELECT issue_employee_code($1,$2,$3) AS code", [
        actor.tenantId,
        actor.entityId,
        id,
      ])
    ).rows[0].code;
    await admin.query(
      `INSERT INTO employee(id,tenant_id,entity_id,person_id,code,title,department_id,location_id,email,joined_on,status,manager_id)
       VALUES($1,$2,$3,$4,$5,'Synthetic role',$6,$7,$8,'2026-01-01',$9,$10)`,
      [
        id,
        actor.tenantId,
        actor.entityId,
        personId,
        code,
        departmentId,
        home.location_id,
        `${id}@anvi.example`,
        options.status ?? "inactive",
        options.managerId ?? null,
      ],
    );
    employments.push(id);
    return id;
  }

  try {
    await t.test(
      "designations, grades and cost centres use the same master rules",
      async () => {
        for (const kind of ["designation", "grade", "cost_center"]) {
          const item = await createUnit(kind.toUpperCase().slice(0, 4), kind);
          assert.equal(item.kind, kind);
          assert.equal(item.employeeCount, 0);
          assert.equal(item.effectiveFrom, dates.today);
          assert.equal(item.effectiveTo, null);
          assert.equal(item.status, "in_effect");
          assert.equal(item.inEffect, true);
          assert.equal(item.mergedIntoId, null);
          const list = await (
            await request(`/organization?kind=${kind}&q=${prefix}`)
          ).json();
          assert.equal(list.total, 1);
          assert.equal(list.items[0].id, item.id);
          const renamed = await put(`/organization/${item.id}`, {
            name: `${item.name} renamed`,
            active: true,
            version: item.version,
            reason,
          });
          assert.equal(renamed.status, 200);
          assert.equal(((await renamed.json()) as OrganizationUnit).version, 2);
          const duplicate = await post("/organization", {
            kind,
            code: item.code,
            name: `${prefix} other ${kind}`,
            reason,
          });
          assert.equal(duplicate.status, 409);
          const audit = await admin.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE target LIKE $1",
            [`organization:${item.id}:%`],
          );
          assert.equal(audit.rows[0].n, 2);
        }
        assert.equal((await request("/organization?kind=team")).status, 400);
        for (const role of ["employee", "manager"] as const) {
          await changeRole(role);
          assert.equal((await request("/organization?kind=grade")).status, 403);
          assert.equal(
            (
              await post("/organization", {
                kind: "grade",
                code: `${prefix}-DENY`,
                name: `${prefix} denied`,
                reason,
              })
            ).status,
            403,
          );
          await assert.rejects(
            scoped(store.pool, { ...actor, role }, (c) =>
              c.query(
                "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name) VALUES($1,$2,$3,'grade',$4,$5)",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  `${prefix}-RLS`,
                  `${prefix} rls`,
                ],
              ),
            ),
          );
        }
        await changeRole("hr_admin");
      },
    );

    await t.test(
      "effective windows drive status and refuse assignment outside them",
      async () => {
        const scheduled = await createUnit("SCHED", "department", {
          effectiveFrom: dates.tomorrow,
        });
        assert.equal(scheduled.status, "scheduled");
        assert.equal(scheduled.inEffect, false);
        const ended = await createUnit("ENDED", "department", {
          effectiveFrom: dates.earlier,
          effectiveTo: dates.yesterday,
        });
        assert.equal(ended.status, "ended");
        const lastDay = await createUnit("LAST", "department", {
          effectiveFrom: dates.earlier,
          effectiveTo: dates.today,
        });
        assert.equal(lastDay.status, "in_effect");
        assert.equal(
          (
            await post("/organization", {
              kind: "grade",
              code: `${prefix}-BAD`,
              name: `${prefix} bad window`,
              reason,
              effectiveFrom: dates.today,
              effectiveTo: dates.yesterday,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post("/organization", {
              kind: "grade",
              code: `${prefix}-BADD`,
              name: `${prefix} bad date`,
              reason,
              effectiveFrom: "2026-02-30",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await put(`/organization/${ended.id}`, {
              name: ended.name,
              active: true,
              version: ended.version,
              reason,
              effectiveTo: "2000-01-01",
            })
          ).status,
          400,
        );
        // The database guard refuses new employment in a unit that is not in effect.
        await assert.rejects(addEmployment(scheduled.id), /in effect/);
        await assert.rejects(addEmployment(ended.id), /in effect/);
        await addEmployment(lastDay.id);
        const otherCandidate = {
          name: `${prefix} candidate`,
          email: `${randomUUID()}@anvi.example`,
          title: "Synthetic role",
          locationId: home.location_id,
          managerId: actor.employeeId,
          joinedOn: dates.tomorrow,
        };
        for (const departmentId of [scheduled.id, ended.id]) {
          assert.equal(
            (await post("/candidates", { ...otherCandidate, departmentId }))
              .status,
            400,
          );
          await assert.rejects(
            admin.query(
              `INSERT INTO candidate_case(id,tenant_id,entity_id,name,email,title,department_id,location_id,manager_id,joined_on)
               VALUES($1,$2,$3,'Never stored',$4,'Synthetic',$5,$6,$7,$8)`,
              [
                randomUUID(),
                actor.tenantId,
                actor.entityId,
                `${randomUUID()}@anvi.example`,
                departmentId,
                home.location_id,
                actor.employeeId,
                dates.tomorrow,
              ],
            ),
            /in effect/,
          );
        }
        const options = await (await request("/candidates/options")).json();
        assert.ok(
          !options.departments.some(
            (d: OrganizationUnit) => d.id === scheduled.id || d.id === ended.id,
          ),
        );
        // Reopening the window is an audited HR edit.
        const reopened = await put(`/organization/${ended.id}`, {
          name: ended.name,
          active: true,
          version: ended.version,
          reason,
          effectiveTo: null,
        });
        assert.equal(reopened.status, 200);
        const item = (await reopened.json()) as OrganizationUnit;
        assert.equal(item.status, "in_effect");
        assert.equal(item.effectiveTo, null);
        const audit = await admin.query(
          "SELECT details FROM audit_event WHERE target=$1",
          [`organization:${ended.id}:v2`],
        );
        assert.equal(audit.rows[0].details.before.effectiveTo, dates.yesterday);
        assert.equal(audit.rows[0].details.after.effectiveTo, null);
        const inactive = await put(`/organization/${lastDay.id}`, {
          name: lastDay.name,
          active: false,
          version: lastDay.version,
          reason,
        });
        assert.equal(
          ((await inactive.json()) as OrganizationUnit).status,
          "inactive",
        );
      },
    );

    await t.test(
      "merge moves every employee, closes the source and audits once",
      async () => {
        const source = await createUnit("SRC");
        const target = await createUnit("TGT");
        const moved = [
          await addEmployment(source.id, { status: "active" }),
          await addEmployment(source.id, { status: "notice" }),
          await addEmployment(source.id),
        ];
        const before = await (
          await request(`/organization?kind=department&q=${prefix}-SRC`)
        ).json();
        assert.equal(before.items[0].employeeCount, 2);
        const response = await post(`/organization/${source.id}/merge`, {
          targetId: target.id,
          version: source.version,
          reason: "Teams combined",
        });
        assert.equal(response.status, 201, await response.clone().text());
        const result = (await response.json()) as OrganizationMergeResult;
        assert.equal(result.movedEmployees, 3);
        assert.equal(result.movedActive, 2);
        assert.equal(result.movedInactive, 1);
        assert.equal(result.movedCandidates, 0);
        assert.equal(result.source.active, false);
        assert.equal(result.source.status, "inactive");
        assert.equal(result.source.mergedIntoId, target.id);
        assert.equal(result.source.effectiveTo, dates.today);
        assert.equal(result.source.version, source.version + 1);
        assert.equal(result.source.employeeCount, 0);
        assert.equal(result.target.employeeCount, 2);
        assert.equal(result.target.version, target.version);
        const rows = await admin.query(
          "SELECT DISTINCT department_id FROM employee WHERE id=ANY($1::uuid[])",
          [moved],
        );
        assert.deepEqual(rows.rows, [{ department_id: target.id }]);
        const audit = await admin.query(
          "SELECT reason,details FROM audit_event WHERE action='organization.merged' AND target LIKE $1",
          [`organization:${source.id}:%`],
        );
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0].reason, "Teams combined");
        assert.equal(audit.rows[0].details.movedEmployees, 3);
        assert.equal(audit.rows[0].details.movedActive, 2);
        assert.equal(audit.rows[0].details.movedInactive, 1);
        assert.ok(!JSON.stringify(audit.rows[0].details).includes("person"));
        const outbox = await admin.query(
          "SELECT event_type FROM outbox_event WHERE aggregate_id=$1 ORDER BY aggregate_version",
          [source.id],
        );
        assert.deepEqual(
          outbox.rows.map((r) => r.event_type),
          ["organization.created.v1", "organization.merged.v1"],
        );
        const detail = (await (
          await request(`/organization/${source.id}`)
        ).json()) as OrganizationDetail;
        assert.equal(detail.mergedInto?.id, target.id);
        assert.ok(detail.mergedInto?.mergedAt);
        const targetDetail = (await (
          await request(`/organization/${target.id}`)
        ).json()) as OrganizationDetail;
        assert.deepEqual(
          targetDetail.mergedFrom.map((r) => r.id),
          [source.id],
        );
        // A merged record is closed: no edit, no second merge, no new assignment.
        assert.equal(
          (
            await put(`/organization/${source.id}`, {
              name: source.name,
              active: true,
              version: result.source.version,
              reason,
            })
          ).status,
          409,
        );
        await assert.rejects(
          admin.query(
            "UPDATE org_unit SET active=true,version=version+1 WHERE id=$1",
            [source.id],
          ),
          /merged/,
        );
        await assert.rejects(addEmployment(source.id), /in effect/);
        const other = await createUnit("TGT2");
        assert.equal(
          (
            await post(`/organization/${source.id}/merge`, {
              targetId: other.id,
              version: result.source.version,
              reason: "Again for this check",
            })
          ).status,
          409,
        );
        assert.equal(
          (await request(`/organization/${randomUUID()}`)).status,
          404,
        );
      },
    );

    await t.test("merge refuses invalid pairs and stale versions", async () => {
      const a = await createUnit("RA");
      const b = await createUnit("RB");
      const location = await createUnit("RLOC", "location");
      const grade = await createUnit("RGRADE", "grade");
      const grade2 = await createUnit("RGRADE2", "grade");
      const later = await createUnit("RLATER", "department", {
        effectiveFrom: dates.tomorrow,
      });
      const foreign = (
        await admin.query(
          "SELECT id FROM org_unit WHERE entity_id<>$1 AND kind='department' LIMIT 1",
          [actor.entityId],
        )
      ).rows[0].id as string;
      const merge = (id: string, body: Record<string, unknown>) =>
        post(`/organization/${id}/merge`, {
          reason: "Tidy up for this check",
          ...body,
        });
      assert.equal(
        (await merge(a.id, { targetId: a.id, version: 1 })).status,
        400,
      );
      assert.equal(
        (await merge(a.id, { targetId: location.id, version: 1 })).status,
        400,
      );
      assert.equal(
        (await merge(grade.id, { targetId: grade2.id, version: 1 })).status,
        400,
      );
      assert.equal(
        (await merge(a.id, { targetId: later.id, version: 1 })).status,
        400,
      );
      assert.equal(
        (await merge(a.id, { targetId: b.id, version: 9 })).status,
        409,
      );
      assert.equal(
        (await merge(a.id, { targetId: b.id, version: 1, targetVersion: 9 }))
          .status,
        409,
      );
      assert.equal(
        (await merge(a.id, { targetId: foreign, version: 1 })).status,
        404,
      );
      assert.equal(
        (await merge(foreign, { targetId: a.id, version: 1 })).status,
        404,
      );
      for (const body of [
        { targetId: b.id, version: 1, reason: "no" },
        { targetId: b.id, version: 1, tenantId: actor.tenantId },
        { targetId: "x", version: 1 },
      ]) {
        assert.equal((await merge(a.id, body)).status, 400);
      }
      const inactiveTarget = await put(`/organization/${b.id}`, {
        name: b.name,
        active: false,
        version: b.version,
        reason,
      });
      assert.equal(inactiveTarget.status, 200);
      assert.equal(
        (await merge(a.id, { targetId: b.id, version: 1, targetVersion: 2 }))
          .status,
        400,
      );
      for (const role of ["employee", "manager"] as const) {
        await changeRole(role);
        assert.equal(
          (await merge(a.id, { targetId: location.id, version: 1 })).status,
          403,
        );
      }
      await changeRole("hr_admin");
      const unchanged = await admin.query(
        "SELECT active,version,merged_into_id FROM org_unit WHERE id=$1",
        [a.id],
      );
      assert.deepEqual(unchanged.rows[0], {
        active: true,
        version: 1,
        merged_into_id: null,
      });
    });

    await t.test(
      "app role cannot write merge columns, employee placement or call the merge out of scope",
      async () => {
        const a = await createUnit("DA");
        const b = await createUnit("DB");
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query(
              "UPDATE org_unit SET merged_into_id=$2,merged_at=now(),active=false,effective_to=effective_from,version=version+1 WHERE id=$1",
              [a.id, b.id],
            ),
          ),
          /permission denied/,
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query("UPDATE employee SET department_id=$1 WHERE id=$2", [
              b.id,
              actor.employeeId,
            ]),
          ),
          /permission denied/,
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query(
              "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name,merged_into_id) VALUES($1,$2,$3,'department',$4,$5,$6)",
              [
                randomUUID(),
                actor.tenantId,
                actor.entityId,
                `${prefix}-MX`,
                `${prefix} merged insert`,
                b.id,
              ],
            ),
          ),
          /permission denied/,
        );
        await assert.rejects(
          scoped(store.pool, { ...actor, role: "employee" }, (c) =>
            c.query("SELECT merge_org_units($1,$2,1,NULL)", [a.id, b.id]),
          ),
          /Only HR/,
        );
        await assert.rejects(
          store.pool.query("SELECT merge_org_units($1,$2,1,NULL)", [
            a.id,
            b.id,
          ]),
          /Only HR/,
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query("DELETE FROM org_unit WHERE id=$1", [a.id]),
          ),
        );
        // Even the owner cannot record a merge outside the merge function.
        await assert.rejects(
          admin.query(
            "UPDATE org_unit SET merged_into_id=$2,merged_at=now(),active=false,effective_to=effective_from,version=version+1 WHERE id=$1",
            [a.id, b.id],
          ),
          /Only a merge/,
        );
      },
    );

    await t.test(
      "concurrent merges and assignments settle without lost employees",
      async () => {
        const a = await createUnit("CA");
        const b = await createUnit("CB");
        await addEmployment(a.id);
        await addEmployment(b.id);
        const opposite = await Promise.all([
          post(`/organization/${a.id}/merge`, {
            targetId: b.id,
            version: 1,
            reason: "Race one for this check",
          }),
          post(`/organization/${b.id}/merge`, {
            targetId: a.id,
            version: 1,
            reason: "Race two for this check",
          }),
        ]);
        const statuses = opposite.map((r) => r.status).sort();
        assert.equal(statuses[0], 201);
        assert.ok([400, 409].includes(statuses[1]!));
        const merged = await admin.query(
          "SELECT count(*)::int AS n FROM org_unit WHERE id IN ($1,$2) AND merged_into_id IS NOT NULL",
          [a.id, b.id],
        );
        assert.equal(merged.rows[0].n, 1);
        const placed = await admin.query(
          "SELECT count(DISTINCT department_id)::int AS n FROM employee WHERE department_id IN ($1,$2)",
          [a.id, b.id],
        );
        assert.equal(placed.rows[0].n, 1);

        const c = await createUnit("CC");
        const d = await createUnit("CD");
        const same = await Promise.all(
          ["Twice one for this check", "Twice two for this check"].map((r) =>
            post(`/organization/${c.id}/merge`, {
              targetId: d.id,
              version: 1,
              reason: r,
            }),
          ),
        );
        assert.deepEqual(same.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM audit_event WHERE action='organization.merged' AND target LIKE $1",
              [`organization:${c.id}:%`],
            )
          ).rows[0].n,
          1,
        );

        const e = await createUnit("CE");
        const f = await createUnit("CF");
        const [assigned, mergedResponse] = await Promise.allSettled([
          addEmployment(e.id),
          post(`/organization/${e.id}/merge`, {
            targetId: f.id,
            version: 1,
            reason: "Race assignment for this check",
          }),
        ]);
        assert.equal(mergedResponse.status, "fulfilled");
        assert.equal(
          (mergedResponse as PromiseFulfilledResult<Response>).value.status,
          201,
        );
        // Either the assignment landed first and was moved, or it was refused.
        assert.ok(
          assigned.status === "fulfilled" ||
            /in effect/.test(String(assigned.reason)),
        );
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int AS n FROM employee WHERE department_id=$1",
              [e.id],
            )
          ).rows[0].n,
          0,
        );
      },
    );

    await t.test("location merges use the same path", async () => {
      const a = await createUnit("LA", "location");
      const b = await createUnit("LB", "location");
      const response = await post(`/organization/${a.id}/merge`, {
        targetId: b.id,
        version: 1,
        reason: "Office closed for this check",
      });
      assert.equal(response.status, 201);
      const result = (await response.json()) as OrganizationMergeResult;
      assert.equal(result.movedEmployees, 0);
      assert.equal(result.source.mergedIntoId, b.id);
    });

    await t.test(
      "merge re-points open candidates and waits for policies and holidays",
      async () => {
        const source = await createUnit("PSRC");
        const target = await createUnit("PTGT");
        const locSource = await createUnit("HSRC", "location");
        const locTarget = await createUnit("HTGT", "location");
        const addCandidate = async (state: string) => {
          const id = randomUUID();
          await admin.query(
            `INSERT INTO candidate_case(id,tenant_id,entity_id,name,email,title,department_id,location_id,manager_id,joined_on,state)
             VALUES($1,$2,$3,'Synthetic candidate',$4,'Synthetic',$5,$6,$7,$8,$9)`,
            [
              id,
              actor.tenantId,
              actor.entityId,
              `${id}@anvi.example`,
              source.id,
              home.location_id,
              actor.employeeId,
              dates.tomorrow,
              state,
            ],
          );
          candidates.push(id);
          return id;
        };
        const open = await addCandidate("draft");
        const finished = await addCandidate("approved");
        // Policy and holiday rows are never deleted, so their refusals are
        // exercised inside a transaction that is rolled back.
        const refusal = async (
          setup: string,
          params: unknown[],
          pair: [string, string],
        ) => {
          const client = await admin.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
               set_config('app.hr_scope','write',true), set_config('app.policy_scope','entity',true),
               set_config('app.employee_id',$3,true), set_config('app.actor_label','QA',true)`,
              [actor.tenantId, actor.entityId, actor.employeeId],
            );
            await client.query(setup, params);
            await assert.rejects(
              client.query("SELECT merge_org_units($1,$2,1,1)", pair),
              (error: { code?: string; message?: string }) =>
                error.code === "OG002" &&
                /Move 1 draft or published policy|and 1 active holiday/.test(
                  error.message ?? "",
                ),
            );
          } finally {
            await client.query("ROLLBACK");
            client.release();
          }
        };
        await refusal(
          `WITH p AS (INSERT INTO policy(id,tenant_id,entity_id,code,category) VALUES($1,$2,$3,$4,'other') RETURNING id)
           INSERT INTO policy_version(id,tenant_id,entity_id,policy_id,version_number,title,summary,body,effective_on,
             audience_department_id,status,version,created_by_label)
           SELECT $5,$2,$3,p.id,1,'Synthetic policy','Synthetic summary text','Synthetic policy body text for a check',
             $6::date,$7,'draft',1,'QA' FROM p`,
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            `${prefix}-P`,
            randomUUID(),
            dates.tomorrow,
            source.id,
          ],
          [source.id, target.id],
        );
        await refusal(
          `INSERT INTO holiday(id,tenant_id,entity_id,location_id,holiday_date,name) VALUES($1,$2,$3,$4,$5,'Synthetic holiday')`,
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            locSource.id,
            dates.tomorrow,
          ],
          [locSource.id, locTarget.id],
        );
        const response = await post(`/organization/${source.id}/merge`, {
          targetId: target.id,
          version: 1,
          reason: "Candidates follow the merge",
        });
        assert.equal(response.status, 201, await response.clone().text());
        const result = (await response.json()) as OrganizationMergeResult;
        assert.equal(result.movedCandidates, 1);
        const rows = await admin.query(
          "SELECT id,department_id,version FROM candidate_case WHERE id=ANY($1::uuid[])",
          [[open, finished]],
        );
        const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
        assert.equal(byId[open].department_id, target.id);
        assert.equal(byId[open].version, 2);
        assert.equal(byId[finished].department_id, source.id);
      },
    );

    await t.test(
      "both versions are required and ending a used unit by date is refused",
      async () => {
        const a = await createUnit("VA");
        const b = await createUnit("VB");
        const missing = await request(`/organization/${a.id}/merge`, {
          method: "POST",
          body: JSON.stringify({
            targetId: b.id,
            version: 1,
            reason: "No target version given",
          }),
        });
        assert.equal(missing.status, 400);
        for (const sql of [
          "SELECT merge_org_units($1,$2,NULL,NULL)",
          "SELECT merge_org_units($1,$2,1,NULL)",
        ]) {
          await assert.rejects(
            scoped(store.pool, actor, (c) => c.query(sql, [a.id, b.id])),
            (error: { code?: string }) => error.code === "OG001",
          );
        }
        await addEmployment(a.id, { status: "active" });
        for (const window of [
          { effectiveFrom: dates.earlier, effectiveTo: dates.yesterday },
          { effectiveFrom: dates.tomorrow },
        ]) {
          const refused = await put(`/organization/${a.id}`, {
            name: a.name,
            active: true,
            version: 1,
            reason,
            ...window,
          });
          assert.equal(refused.status, 409);
          assert.match(JSON.stringify(await refused.json()), /Merge it/);
        }
        // Unused units, and deactivation itself, keep the ORG-01 rules.
        const ended = await put(`/organization/${b.id}`, {
          name: b.name,
          active: true,
          version: 1,
          reason,
          effectiveFrom: dates.earlier,
          effectiveTo: dates.yesterday,
        });
        assert.equal(ended.status, 200);
        const off = await put(`/organization/${a.id}`, {
          name: a.name,
          active: false,
          version: 1,
          reason,
          effectiveFrom: dates.earlier,
          effectiveTo: dates.yesterday,
        });
        assert.equal(off.status, 200);
      },
    );

    await t.test(
      "the app may read only its own entity's business date",
      async () => {
        const own = await scoped(store.pool, actor, (c) =>
          c.query("SELECT org_entity_today($1,$2) AS d", [
            actor.tenantId,
            actor.entityId,
          ]),
        );
        assert.ok(own.rows[0].d);
        const other = await admin.query(
          "SELECT tenant_id,id FROM legal_entity WHERE id<>$1 LIMIT 1",
          [actor.entityId],
        );
        const foreign = await scoped(store.pool, actor, (c) =>
          c.query("SELECT org_entity_today($1,$2) AS d", [
            other.rows[0].tenant_id,
            other.rows[0].id,
          ]),
        );
        assert.equal(foreign.rows[0].d, null);
        const bare = await store.pool.query(
          "SELECT org_entity_today($1,$2) AS d",
          [actor.tenantId, actor.entityId],
        );
        assert.equal(bare.rows[0].d, null);
      },
    );

    await t.test(
      "chart follows directory scope and never widens it",
      async () => {
        const hr = (await (
          await request("/organization/chart")
        ).json()) as OrganizationChart;
        assert.equal(hr.scope, "entity");
        assert.ok(hr.total >= 12);
        const directory = await admin.query(
          "SELECT count(*)::int AS n FROM employee WHERE entity_id=$1 AND tenant_id=$2 AND status IN ('active','notice')",
          [actor.entityId, actor.tenantId],
        );
        assert.equal(hr.total, directory.rows[0].n);
        const maya = hr.nodes.find((n) => n.id === actor.employeeId)!;
        assert.ok(maya);
        assert.ok(!("email" in maya) && !("code" in maya));
        for (const node of hr.nodes) {
          if (node.managerId)
            assert.ok(hr.nodes.some((n) => n.id === node.managerId));
        }
        const shallow = (await (
          await request("/organization/chart?depth=1")
        ).json()) as OrganizationChart;
        assert.ok(shallow.nodes.every((n) => n.depth === 0));
        assert.equal(shallow.truncated, true);
        const sub = (await (
          await request(`/organization/chart?rootId=${actor.employeeId}`)
        ).json()) as OrganizationChart;
        assert.deepEqual(sub.rootIds, [actor.employeeId]);
        assert.equal(sub.nodes[0]!.managerId, null);
        assert.equal(
          (await request("/organization/chart?depth=0")).status,
          400,
        );
        assert.equal(
          (await request("/organization/chart?depth=21")).status,
          400,
        );
        assert.equal(
          (await request("/organization/chart?rootId=x")).status,
          400,
        );
        assert.equal(
          (await request("/organization/chart?extra=1")).status,
          400,
        );
        assert.equal(
          (await request(`/organization/chart?rootId=${randomUUID()}`)).status,
          404,
        );

        await changeRole("manager");
        const team = (await (
          await request("/organization/chart")
        ).json()) as OrganizationChart;
        assert.equal(team.scope, "team");
        const reports = await admin.query(
          "SELECT id FROM employee WHERE manager_id=$1 AND status IN ('active','notice')",
          [actor.employeeId],
        );
        assert.equal(team.total, reports.rowCount! + 1);
        assert.deepEqual(team.rootIds, [actor.employeeId]);
        const me = team.nodes.find((n) => n.id === actor.employeeId)!;
        assert.equal(me.managerId, null);
        assert.equal(me.directReportCount, reports.rowCount);

        await changeRole("employee");
        const self = (await (
          await request("/organization/chart")
        ).json()) as OrganizationChart;
        assert.equal(self.scope, "self");
        assert.deepEqual(
          self.nodes.map((n) => n.id),
          [actor.employeeId],
        );
        const someoneElse = hr.nodes.find((n) => n.id !== actor.employeeId)!;
        assert.equal(
          (await request(`/organization/chart?rootId=${someoneElse.id}`))
            .status,
          404,
        );
        await changeRole("hr_admin");
      },
    );

    await t.test(
      "reporting loops are broken safely and inactive people are left out",
      async () => {
        const dept = await createUnit("LOOP");
        const x = await addEmployment(dept.id, { status: "active" });
        const y = await addEmployment(dept.id, {
          status: "active",
          managerId: x,
        });
        await admin.query("UPDATE employee SET manager_id=$1 WHERE id=$2", [
          y,
          x,
        ]);
        const gone = await addEmployment(dept.id, { managerId: x });
        const chart = (await (
          await request("/organization/chart")
        ).json()) as OrganizationChart;
        assert.equal(chart.truncated, true);
        const loop = chart.nodes.filter((n) => n.id === x || n.id === y);
        assert.equal(loop.length, 2);
        assert.equal(loop.filter((n) => n.managerId === null).length, 1);
        assert.ok(!chart.nodes.some((n) => n.id === gone));
        assert.equal(
          new Set(chart.nodes.map((n) => n.id)).size,
          chart.nodes.length,
        );
        const rooted = (await (
          await request(`/organization/chart?rootId=${x}`)
        ).json()) as OrganizationChart;
        assert.equal(rooted.total, 2);
        await admin.query(
          "UPDATE employee SET manager_id=NULL WHERE id=ANY($1::uuid[])",
          [[x, y]],
        );
      },
    );
  } finally {
    // Synthetic employments, the person and masters are removed; issued codes,
    // audit and outbox rows are permanent by design.
    await admin.query(
      "UPDATE employee SET manager_id=NULL WHERE id=ANY($1::uuid[])",
      [employments],
    );
    await admin.query("DELETE FROM employee WHERE id=ANY($1::uuid[])", [
      employments,
    ]);
    await admin.query("DELETE FROM candidate_case WHERE id=ANY($1::uuid[])", [
      candidates,
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
