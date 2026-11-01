import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { OrganizationStore } from "../apps/api/src/organization.store";
import {
  RateLimits,
  personLimiter,
  runLimit,
} from "../apps/api/src/rate-limit";
import type { Request, Response } from "express";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import type {
  OrgChartNeighborhood,
  OrgChartNodeLite,
  OrgChartSearch,
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

const PORT = 4503;
// Seeded: Rohan reports to Neel (not the demo identity); the isolation fixture
// lives in another legal entity of the same tenant.
const rohan = "30000000-0000-4000-8000-000000000006";
const neel = "30000000-0000-4000-8000-000000000004";
const isolated = "30000000-0000-4000-8000-000000000099";
const LITE_KEYS = [
  "department",
  "directReportCount",
  "id",
  "initials",
  "managerId",
  "name",
  "title",
];

async function resetOrgChartLimits() {
  const url = process.env.RATE_LIMIT_URL;
  if (!url) return;
  const client = createClient({ url });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: "anvione:rl:orgchart-*",
      COUNT: 200,
    }))
      if (keys.length) await client.del(keys);
  } finally {
    await client.quit();
  }
}

await test("Org chart search and neighbourhood: entity-wide basic structure only", async (t) => {
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
  const prefix = `QN${randomUUID().slice(0, 6).toUpperCase()}`;
  const people: string[] = [];
  const employments: string[] = [];
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
  async function changeRole(role: Role) {
    const response = await request("/session/role-context", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  const search = async (q: string, limit?: number) => {
    const response = await request(
      `/organization/chart/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ""}`,
    );
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as OrgChartSearch;
  };
  const neighborhood = async (id: string) => {
    const response = await request(`/organization/chart/neighborhood/${id}`);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as OrgChartNeighborhood;
  };
  const assertLite = (node: OrgChartNodeLite) =>
    assert.deepEqual(Object.keys(node).sort(), LITE_KEYS);
  const home = (
    await admin.query(
      "SELECT department_id,location_id FROM employee WHERE id=$1",
      [actor.employeeId],
    )
  ).rows[0] as { department_id: string; location_id: string };

  // One person and one employment per synthetic node, issued codes are permanent.
  async function add(
    name: string,
    options: { managerId?: string | null; status?: string } = {},
  ) {
    const personId = randomUUID();
    const id = randomUUID();
    await admin.query(
      "INSERT INTO person(id,tenant_id,name,initials) VALUES($1,$2,$3,'QN')",
      [personId, actor.tenantId, name],
    );
    people.push(personId);
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
        home.department_id,
        home.location_id,
        `${id}@anvi.example`,
        options.status ?? "active",
        options.managerId ?? null,
      ],
    );
    employments.push(id);
    return id;
  }

  try {
    await resetOrgChartLimits();
    const gone = await add(`${prefix} Former`, { status: "inactive" });
    const orphan = await add(`${prefix} Orphan`, { managerId: gone });
    const boss = await add(`${prefix} Boss`);
    const lead = await add(`${prefix} Lead`, { managerId: boss });
    const member = await add(`${prefix} Member`, { managerId: lead });
    await add(`${prefix} Leaver`, { managerId: lead, status: "inactive" });
    const literal = await add(`${prefix} 50%_off`);
    await add(`${prefix} 50xxoff`);

    await t.test(
      "employee, manager and HR all search and open neighbourhoods across teams",
      async () => {
        for (const role of ["employee", "manager", "hr_admin"] as const) {
          await changeRole(role);
          const found = await search("Rohan");
          assert.equal(found.items.length, 1);
          assert.equal(found.items[0]!.id, rohan);
          assert.equal(found.items[0]!.managerId, neel);
          assertLite(found.items[0]!);
          const view = await neighborhood(rohan);
          assert.equal(view.focus.id, rohan);
          assert.equal(view.manager?.id, neel);
          assert.equal(view.skipLevelHint.managerHasManager, true);
          for (const node of [view.focus, view.manager!, ...view.reports])
            assertLite(node);
          assert.deepEqual(Object.keys(view).sort(), [
            "focus",
            "manager",
            "reportCount",
            "reports",
            "skipLevelHint",
            "truncated",
          ]);
          const text = JSON.stringify(view) + JSON.stringify(found);
          for (const banned of ["@anvi.example", "ANV-", "Hyderabad"])
            assert.ok(!text.includes(banned), banned);

          const lead1 = await neighborhood(lead);
          assert.equal(lead1.manager?.id, boss);
          assert.equal(lead1.skipLevelHint.managerHasManager, false);
          assert.deepEqual(
            lead1.reports.map((r) => r.id),
            [member],
          );
          assert.equal(lead1.reportCount, 1);
          assert.equal(lead1.truncated, false);
          assert.equal(lead1.focus.directReportCount, 1);
        }
        // Search by title and by department name too, ordered by name, capped.
        const byTitle = await search("Synthetic role", 3);
        assert.equal(byTitle.items.length, 3);
        const names = byTitle.items.map((i) => i.name);
        assert.deepEqual(names, [...names].sort());
        const department = (
          await admin.query("SELECT name FROM org_unit WHERE id=$1", [
            home.department_id,
          ])
        ).rows[0].name as string;
        assert.ok((await search(department, 10)).items.length >= 1);
        assert.equal((await search(prefix, 10)).items.length, 6);
      },
    );

    await t.test(
      "inactive and other-entity people never appear and all answer 404 alike",
      async () => {
        await changeRole("hr_admin");
        const items = (await search(prefix, 10)).items;
        assert.ok(!items.some((i) => i.name.includes("Former")));
        assert.ok(!items.some((i) => i.name.includes("Leaver")));
        assert.equal((await search("Isolation")).items.length, 0);
        const bodies: string[] = [];
        for (const id of [randomUUID(), isolated, gone]) {
          const response = await request(
            `/organization/chart/neighborhood/${id}`,
          );
          assert.equal(response.status, 404);
          const body = (await response.json()) as Record<string, unknown>;
          delete body.requestId;
          bodies.push(JSON.stringify(body));
        }
        assert.equal(new Set(bodies).size, 1);
        assert.equal(
          (await request("/organization/chart/neighborhood/not-a-uuid")).status,
          400,
        );
        for (const q of ["a", "x".repeat(61)])
          assert.equal(
            (
              await request(
                `/organization/chart/search?q=${encodeURIComponent(q)}`,
              )
            ).status,
            400,
          );
        assert.equal(
          (await request("/organization/chart/search?q=ab&limit=11")).status,
          400,
        );
        assert.equal(
          (await request("/organization/chart/search?q=ab&extra=1")).status,
          400,
        );
      },
    );

    await t.test("orphans, loops and the report cap are safe", async () => {
      await changeRole("employee");
      const lone = await neighborhood(orphan);
      assert.equal(lone.manager, null);
      assert.equal(lone.focus.managerId, null);
      assert.equal(lone.skipLevelHint.managerHasManager, false);
      const found = (await search(`${prefix} Orphan`)).items[0]!;
      assert.equal(found.managerId, null);

      const x = await add(`${prefix} LoopX`);
      const y = await add(`${prefix} LoopY`, { managerId: x });
      await admin.query("UPDATE employee SET manager_id=$1 WHERE id=$2", [
        y,
        x,
      ]);
      const loop = await neighborhood(x);
      assert.equal(loop.manager?.id, y);
      assert.deepEqual(
        loop.reports.map((r) => r.id),
        [y],
      );
      assert.equal(loop.skipLevelHint.managerHasManager, true);
      await admin.query("UPDATE employee SET manager_id=NULL WHERE id=$1", [x]);

      const big = await add(`${prefix} Big`);
      const ids = Array.from({ length: 201 }, () => randomUUID());
      const persons = ids.map(() => randomUUID());
      await admin.query(
        `INSERT INTO person(id,tenant_id,name,initials)
         SELECT p,$2,$3||' R'||lpad(n::text,3,'0'),'QR' FROM unnest($1::uuid[]) WITH ORDINALITY u(p,n)`,
        [persons, actor.tenantId, prefix],
      );
      people.push(...persons);
      await admin.query(
        "SELECT issue_employee_code($1,$2,id) FROM unnest($3::uuid[]) id",
        [actor.tenantId, actor.entityId, ids],
      );
      await admin.query(
        `INSERT INTO employee(id,tenant_id,entity_id,person_id,code,title,department_id,location_id,email,joined_on,status,manager_id)
         SELECT u.id,$2,$3,u.p,a.code,'Synthetic role',$4,$5,u.id||'@anvi.example','2026-01-01','active',$6
         FROM unnest($1::uuid[],$7::uuid[]) u(id,p)
         JOIN employee_code_allocation a ON a.tenant_id=$2 AND a.employee_id=u.id`,
        [
          ids,
          actor.tenantId,
          actor.entityId,
          home.department_id,
          home.location_id,
          big,
          persons,
        ],
      );
      employments.push(...ids);
      const capped = await neighborhood(big);
      assert.equal(capped.reports.length, 200);
      assert.equal(capped.reportCount, 201);
      assert.equal(capped.truncated, true);
      assert.equal(capped.focus.directReportCount, 201);
      assert.ok(capped.reports[0]!.name.endsWith("R001"));
    });

    await t.test("search text is matched literally", async () => {
      const percent = await search(`${prefix} 50%_`);
      assert.deepEqual(
        percent.items.map((i) => i.id),
        [literal],
      );
      assert.equal((await search(`${prefix} 5_x`)).items.length, 0);
      assert.equal((await search("%%")).items.length, 0);
      assert.equal((await search(`\\${prefix}`)).items.length, 0);
    });

    await t.test("roles without directory.read are refused", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        assert.equal(
          (await request("/organization/chart/search?q=Rohan")).status,
          403,
        );
        assert.equal(
          (await request(`/organization/chart/neighborhood/${rohan}`)).status,
          403,
        );
      }
    });

    await t.test(
      "the app role reads nothing new and the functions need a session context",
      async () => {
        const employee = {
          ...actor,
          role: "employee" as const,
          roles: actor.roles,
        };
        const visible = await scoped(store.pool, employee, async (c) => ({
          employees: (
            await c.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM employee",
            )
          ).rows[0]!.n,
          directory: (
            await c.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM employee_directory",
            )
          ).rows[0]!.n,
          persons: (
            await c.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM person WHERE id=ANY($1::uuid[])",
              [people],
            )
          ).rows[0]!.n,
        }));
        assert.deepEqual(visible, { employees: 1, directory: 1, persons: 0 });
        // The function itself only returns the whitelisted columns.
        const columns = await scoped(store.pool, employee, async (c) =>
          (await c.query("SELECT * FROM org_chart_search('Rohan',5)")).fields
            .map((f) => f.name)
            .sort(),
        );
        assert.deepEqual(columns, [
          "department",
          "direct_report_count",
          "id",
          "initials",
          "manager_id",
          "name",
          "title",
        ]);
        for (const sql of [
          "SELECT * FROM org_chart_search('Rohan',5)",
          `SELECT * FROM org_chart_neighborhood('${rohan}',5)`,
        ]) {
          await assert.rejects(store.pool.query(sql), { code: "42501" });
          await assert.rejects(
            transaction(store.pool, async (c) => {
              await c.query(
                `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
                 set_config('app.employee_id',$3,true), set_config('app.directory_scope','none',true)`,
                [actor.tenantId, actor.entityId, actor.employeeId],
              );
              return c.query(sql);
            }),
            { code: "42501" },
          );
        }
        await assert.rejects(
          store.pool.query("SELECT * FROM org_chart_context()"),
          { code: "42501" },
        );
        const grants = await admin.query<{ grantee: string; fn: string }>(
          `SELECT grantee, routine_name AS fn FROM information_schema.routine_privileges
           WHERE routine_name LIKE 'org_chart_%' AND privilege_type='EXECUTE'
           ORDER BY 2,1`,
        );
        assert.deepEqual(
          grants.rows.map((r) => `${r.fn}:${r.grantee}`),
          [
            "org_chart_context:anvione_orgchart_keeper",
            "org_chart_neighborhood:anvione_app",
            "org_chart_neighborhood:anvione_orgchart_keeper",
            "org_chart_search:anvione_app",
            "org_chart_search:anvione_orgchart_keeper",
          ],
        );
        const role = await admin.query(
          `SELECT rolcanlogin, rolinherit, pg_has_role('anvione_app','anvione_orgchart_keeper','MEMBER') AS member,
             has_column_privilege('anvione_orgchart_keeper','employee','email','SELECT') AS email,
             has_column_privilege('anvione_orgchart_keeper','person','id','SELECT') AS person_id,
             (SELECT prosecdef FROM pg_proc WHERE proname='org_chart_search') AS definer
           FROM pg_roles WHERE rolname='anvione_orgchart_keeper'`,
        );
        assert.deepEqual(role.rows[0], {
          rolcanlogin: false,
          rolinherit: false,
          member: false,
          email: false,
          person_id: true,
          definer: true,
        });
      },
    );

    await t.test(
      "missing or forged employee context is refused before budget and in the database",
      async () => {
        const organization = new OrganizationStore(store);
        const hr = { ...actor, role: "hr_admin" as const };
        for (const call of [
          () =>
            organization.search(
              { ...hr, employeeId: "" },
              { q: "Rohan", limit: 5 },
            ),
          () => organization.neighborhood({ ...hr, employeeId: "" }, rohan),
        ])
          await assert.rejects(call(), { status: 403 });
        // The limiter itself never buckets an actor without an employee id.
        const limits = await RateLimits.connect(process.env.RATE_LIMIT_URL);
        try {
          const limiter = personLimiter(limits, "orgchart-search", 120, "x");
          const headers: Record<string, string> = {};
          const res = {
            setHeader: (k: string, v: string) => (headers[k] = v),
            getHeader: (k: string) => headers[k],
            headersSent: false,
          } as unknown as Response;
          await assert.rejects(
            runLimit(
              limiter,
              {
                actor: { ...hr, employeeId: "" },
                ip: "127.0.0.1",
              } as unknown as Request,
              res,
            ),
            { status: 403 },
          );
        } finally {
          await limits.onApplicationShutdown();
        }
        if (process.env.RATE_LIMIT_URL) {
          const client = createClient({ url: process.env.RATE_LIMIT_URL });
          await client.connect();
          try {
            const keys: string[] = [];
            for await (const batch of client.scanIterator({
              MATCH: "anvione:rl:orgchart-*",
              COUNT: 200,
            }))
              keys.push(...batch);
            assert.ok(
              !keys.some((k) => k.endsWith(":") || k.includes("undefined")),
              keys.join(","),
            );
          } finally {
            await client.quit();
          }
        }
        // A session whose employee id is unknown, in another entity or former is refused.
        for (const employeeId of [randomUUID(), isolated, gone]) {
          const forged = { ...actor, role: "employee" as const, employeeId };
          await assert.rejects(
            scoped(store.pool, forged, (c) =>
              c.query("SELECT * FROM org_chart_search('Rohan',5)"),
            ),
            { code: "42501" },
          );
          await assert.rejects(
            scoped(store.pool, forged, (c) =>
              c.query("SELECT * FROM org_chart_neighborhood($1,5)", [rohan]),
            ),
            { code: "42501" },
          );
          await assert.rejects(
            organization.search(forged, { q: "Rohan", limit: 5 }),
            { status: 403 },
          );
        }
        const config = await admin.query<{
          proname: string;
          cfg: string[];
          def: string;
        }>(
          `SELECT proname, proconfig AS cfg, pg_get_functiondef(oid) AS def FROM pg_proc
           WHERE proname IN ('org_chart_search','org_chart_neighborhood') ORDER BY proname`,
        );
        assert.equal(config.rows.length, 2);
        for (const row of config.rows) {
          assert.ok(row.cfg.includes("statement_timeout=2s"), row.proname);
          // Department is optional: people without one still appear.
          assert.match(row.def, /LEFT JOIN public\.org_unit d/);
        }
      },
    );

    await t.test(
      "a person whose department is unavailable still appears with department null",
      async () => {
        // employee.department_id is NOT NULL with an entity FK, so a missing
        // department is simulated by hiding every department from the keeper.
        await changeRole("employee");
        const nameless = await add(`${prefix} Nodept`, { managerId: boss });
        await admin.query(
          "ALTER POLICY org_unit_orgchart_keeper ON org_unit USING(false)",
        );
        try {
          const found = (await search(`${prefix} Nodept`)).items;
          assert.equal(found.length, 1);
          assert.equal(found[0]!.department, null);
          assert.equal(found[0]!.managerId, boss);
          const view = await neighborhood(nameless);
          assert.equal(view.focus.department, null);
          assert.equal(view.manager?.id, boss);
          assert.equal(view.focus.managerId, view.manager?.id);
        } finally {
          await admin.query(
            `ALTER POLICY org_unit_orgchart_keeper ON org_unit USING(
              tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
              AND entity_id=nullif(current_setting('app.entity_id',true),'')::uuid
              AND kind='department')`,
          );
        }
      },
    );

    await t.test(
      "per-person budget: 429 after 120, kept across role switch and new session",
      async () => {
        await resetOrgChartLimits();
        if (!process.env.RATE_LIMIT_URL) return;
        await changeRole("employee");
        for (let i = 0; i < 120; i++)
          assert.equal(
            (await request("/organization/chart/search?q=Rohan")).status,
            200,
          );
        assert.equal(
          (await request("/organization/chart/search?q=Rohan")).status,
          429,
        );
        // Bad input is refused before the budget is consulted.
        assert.equal(
          (await request("/organization/chart/search?q=a")).status,
          400,
        );
        await changeRole("hr_admin");
        assert.equal(
          (await request("/organization/chart/search?q=Rohan")).status,
          429,
        );
        token = await store.createSession(actor, randomUUID());
        session = await store.session(token);
        assert.equal(
          (await request("/organization/chart/search?q=Rohan")).status,
          429,
        );
        // Neighbourhoods have their own budget.
        assert.equal((await neighborhood(rohan)).focus.id, rohan);
        // Permission is checked before the budget.
        await changeRole("auditor");
        assert.equal(
          (await request("/organization/chart/search?q=Rohan")).status,
          403,
        );
      },
    );
  } finally {
    await resetOrgChartLimits();
    // Synthetic employments and persons are removed; issued codes are permanent by design.
    await admin.query(
      "UPDATE employee SET manager_id=NULL WHERE id=ANY($1::uuid[])",
      [employments],
    );
    await admin.query("DELETE FROM employee WHERE id=ANY($1::uuid[])", [
      employments,
    ]);
    await admin.query("DELETE FROM person WHERE id=ANY($1::uuid[])", [people]);
    const left = await admin.query(
      `SELECT count(*)::int AS n FROM employee e JOIN person p ON p.id=e.person_id
       WHERE p.name LIKE $1`,
      [`${prefix}%`],
    );
    assert.equal(left.rows[0].n, 0);
    await store.pool.end();
    await admin.end();
    await app.close();
  }
});
