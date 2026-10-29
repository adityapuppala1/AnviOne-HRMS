import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { HelpdeskStore } from "../apps/api/src/helpdesk.store";
import {
  makePool,
  scoped,
  transaction,
  type PoolClient,
} from "../packages/database/src/index";
import type {
  HdCaseDetail,
  HdCaseList,
  HdCategoryList,
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

const PORT = Number(process.env.HELPDESK_TEST_PORT ?? 4519);
// Synthetic demo people: Maya (HR) manages Arjun, Zara and Neel; Neel manages Rohan;
// Kabir is a second HR user. Maya and Kabir carry the HR admin role, so they are agents.
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
const hours = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 3600000;

await test("Helpdesk: cases, thread, internal notes, confidentiality, service targets and articles", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const pool = makePool(process.env.DATABASE_URL!);
  const hd = new HelpdeskStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toLowerCase();
  const started = new Date();
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
  const hrKabir = as(kabir, "Kabir (synthetic HR)", "hr_admin");
  const arjunE = as(arjun, "Arjun (synthetic)", "employee");
  const zaraE = as(zara, "Zara (synthetic)", "employee");
  const neelM = as(neel, "Neel (synthetic manager)", "manager");
  const rohanE = as(rohan, "Rohan (synthetic)", "employee");
  const auditor = as(maya, "Maya (auditor)", "auditor");
  // Marker strings that must never reach audit or outbox rows.
  const secret = `secret-${run}`;
  const internalMarker = `internal-${run}`;
  const ids = {
    cases: [] as string[],
    articles: [] as string[],
    categories: [] as string[],
  };
  let categories: HdCategoryList;
  const categoryId = (name: string) =>
    categories.items.find((c) => c.name === name)!.id;
  const raise = async (
    who: typeof hrMaya,
    extra: Record<string, unknown> = {},
  ) => {
    const created = await hd.createCase(
      who,
      {
        categoryId: categoryId("Payroll query"),
        subject: `Payslip question ${secret}`,
        description: `My payslip looks wrong ${secret}`,
        priority: "normal",
        confidential: false,
        ...extra,
      } as never,
      randomUUID(),
    );
    ids.cases.push(created.case.id);
    return created;
  };
  // Synthetic setup only: moves a case's clock back, bypassing the guards as the migrator.
  const backdate = (sql: string, id: string) =>
    transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      await client.query(sql, [id]);
      await restore();
    });
  const alwaysOff = async (client: PoolClient) => {
    const { rows } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE 'hd_%'`,
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
  // Reads as an agent who holds helpdesk.agent without helpdesk.manage.
  const asAgentOnly = <T>(
    who: typeof hrKabir,
    work: (client: PoolClient) => Promise<T>,
  ) =>
    scoped(pool, who, async (client) => {
      await client.query(
        "SELECT set_config('app.helpdesk_scope','agent',true)",
      );
      return work(client);
    });

  let arjunCase: HdCaseDetail;
  let zaraCase: HdCaseDetail;
  let mayaCase: HdCaseDetail;
  let rohanCase: HdCaseDetail;
  let neelCase: HdCaseDetail;

  try {
    await t.test("access follows the helpdesk permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/helpdesk/cases",
          "/helpdesk/categories",
          "/helpdesk/articles",
          "/helpdesk/sla",
          "/helpdesk/agents",
          "/helpdesk/articles/suggest?q=payslip",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      for (const role of ["employee", "manager", "hr_admin"] as const) {
        await changeRole(role);
        assert.equal((await request("/helpdesk/cases")).status, 200, role);
        assert.equal((await request("/helpdesk/articles")).status, 200, role);
        assert.equal(
          (await request("/helpdesk/agents")).status,
          role === "hr_admin" ? 200 : 403,
          role,
        );
      }
      assert.equal((await request("/helpdesk/cases?limit=101")).status, 400);
      assert.equal((await request("/helpdesk/cases?unknown=1")).status, 400);
      const list = (await (
        await request("/helpdesk/cases")
      ).json()) as HdCaseList;
      assert.deepEqual([list.page, list.limit, list.canWork], [1, 25, true]);
      await changeRole("employee");
      assert.equal(
        (
          await send("/helpdesk/categories", "POST", {
            name: `Employee category ${run}`,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await send("/helpdesk/cases", "POST", {
            categoryId: randomUUID(),
            subject: "Hi",
            description: "short",
            extra: 1,
          })
        ).status,
        400,
      );
      assert.equal(
        await status(hd.listCases(auditor, {} as never)),
        403,
        "auditor store",
      );
      const agents = await hd.agents(hrMaya);
      assert.ok(agents.items.some((a) => a.employeeId === kabir));
      assert.ok(agents.items.every((a) => a.employeeId !== arjun));
    });

    await t.test("categories and service targets", async () => {
      categories = await hd.categories(arjunE);
      assert.equal(categories.canManage, false);
      for (const name of [
        "Payroll query",
        "Leave",
        "Policy",
        "IT and assets",
        "Benefits",
        "Grievance or harassment",
        "Other",
      ])
        assert.ok(
          categories.items.some((c) => c.name === name),
          name,
        );
      assert.equal(
        categories.items.find((c) => c.name === "Grievance or harassment")!
          .confidential,
        true,
      );
      const retired = await hd.createCategory(
        hrMaya,
        { name: `Retired ${run}`, confidential: false, sort: 500 },
        randomUUID(),
      );
      ids.categories.push(retired.id);
      assert.equal(
        await status(
          hd.createCategory(
            hrMaya,
            { name: `retired ${run}`, confidential: false, sort: 1 },
            randomUUID(),
          ),
        ),
        409,
        "names are unique ignoring case",
      );
      assert.equal(
        await status(
          hd.createCategory(
            arjunE,
            { name: `Nope ${run}`, confidential: false, sort: 1 },
            randomUUID(),
          ),
        ),
        403,
      );
      await hd.updateCategory(
        hrMaya,
        retired.id,
        {
          name: retired.name,
          confidential: false,
          active: false,
          sort: 500,
          version: 1,
        },
        randomUUID(),
      );
      assert.equal(
        await status(
          hd.updateCategory(
            hrMaya,
            retired.id,
            {
              name: retired.name,
              confidential: false,
              active: true,
              sort: 500,
              version: 1,
            },
            randomUUID(),
          ),
        ),
        409,
        "stale category version",
      );
      assert.ok(
        !(await hd.categories(arjunE)).items.some((c) => c.id === retired.id),
        "employees see active categories only",
      );
      assert.equal(
        await status(
          hd.createCase(
            arjunE,
            {
              categoryId: retired.id,
              subject: "Retired category",
              description: "This should be refused",
              priority: "normal",
              confidential: false,
            },
            randomUUID(),
          ),
        ),
        400,
      );
      const sla = await hd.sla(arjunE);
      assert.equal(sla.basis, "wall_clock_hours");
      assert.deepEqual(
        sla.items.map((s) => [s.priority, s.responseHours, s.resolveHours]),
        [
          ["urgent", 1, 8],
          ["high", 4, 24],
          ["normal", 8, 72],
          ["low", 24, 120],
        ],
      );
      const low = sla.items.find((s) => s.priority === "low")!;
      const saved = await hd.updateSla(
        hrMaya,
        "low",
        { responseHours: 12, resolveHours: 96, version: low.version },
        randomUUID(),
      );
      assert.equal(
        saved.items.find((s) => s.priority === "low")!.resolveHours,
        96,
      );
      assert.equal(
        await status(
          hd.updateSla(
            hrMaya,
            "low",
            { responseHours: 24, resolveHours: 120, version: low.version },
            randomUUID(),
          ),
        ),
        409,
        "stale target version",
      );
      assert.equal(
        await status(
          hd.updateSla(
            arjunE,
            "low",
            { responseHours: 1, resolveHours: 2, version: low.version + 1 },
            randomUUID(),
          ),
        ),
        403,
      );
      await hd.updateSla(
        hrMaya,
        "low",
        { responseHours: 24, resolveHours: 120, version: low.version + 1 },
        randomUUID(),
      );
    });

    await t.test("raising cases: codes, due times and visibility", async () => {
      arjunCase = await raise(arjunE);
      assert.match(arjunCase.case.code, /^HLP-\d{6}$/);
      assert.equal(arjunCase.case.status, "open");
      assert.equal(arjunCase.case.requesterEmployeeId, arjun);
      assert.equal(arjunCase.case.mine, true);
      assert.equal(arjunCase.case.assigneeEmployeeId, null);
      assert.equal(
        hours(arjunCase.case.createdAt, arjunCase.case.firstResponseDue),
        8,
      );
      assert.equal(
        hours(arjunCase.case.createdAt, arjunCase.case.resolveDue),
        72,
      );
      assert.equal(arjunCase.case.breached, false);
      assert.equal(arjunCase.history.length, 1);
      assert.equal(arjunCase.history[0]!.toStatus, "open");
      zaraCase = await raise(zaraE, {
        categoryId: categoryId("Grievance or harassment"),
        subject: `Concern ${secret}`,
        priority: "high",
      });
      assert.equal(
        zaraCase.case.confidential,
        true,
        "category forces the flag",
      );
      assert.equal(
        hours(zaraCase.case.createdAt, zaraCase.case.resolveDue),
        24,
      );
      mayaCase = await raise(hrMaya, { categoryId: categoryId("Benefits") });
      rohanCase = await raise(rohanE, { priority: "low" });
      neelCase = await raise(neelM);
      const codes = [arjunCase, zaraCase, mayaCase, rohanCase, neelCase].map(
        (c) => Number(c.case.code.slice(4)),
      );
      assert.deepEqual(
        codes,
        codes.map((_, i) => codes[0]! + i),
        "codes run in sequence per entity",
      );
      // The employee sees only their own cases.
      const mine = await hd.listCases(arjunE, {
        page: 1,
        limit: 100,
        q: "",
        view: "all",
      });
      assert.ok(mine.items.every((c) => c.requesterEmployeeId === arjun));
      assert.equal(mine.canWork, false);
      // A manager sees their own, never their team's (Rohan reports to Neel).
      const neelList = await hd.listCases(neelM, {
        page: 1,
        limit: 100,
        q: secret,
        view: "all",
      });
      assert.deepEqual(
        neelList.items.map((c) => c.id),
        [neelCase.case.id],
      );
      assert.equal(await status(hd.caseDetail(neelM, rohanCase.case.id)), 404);
      assert.equal(await status(hd.caseDetail(arjunE, zaraCase.case.id)), 404);
      assert.equal(
        await status(hd.caseDetail(mgrMaya, arjunCase.case.id)),
        404,
      );
      // HR sees the entity, confidential cases included (helpdesk.manage).
      const hr = await hd.listCases(hrKabir, {
        page: 1,
        limit: 100,
        q: secret,
        view: "all",
      });
      assert.equal(hr.total, 5);
      // An agent without helpdesk.manage sees the queue but not unassigned confidential cases.
      const seen = await asAgentOnly(hrKabir, (client) =>
        client.query<{ id: string }>(
          "SELECT id FROM hd_case WHERE id=ANY($1::uuid[])",
          [ids.cases],
        ),
      );
      assert.equal(seen.rows.length, 4);
      assert.ok(!seen.rows.some((r) => r.id === zaraCase.case.id));
      // Hidden or missing: one answer.
      const missing = randomUUID();
      const answers: string[] = [];
      for (const target of [zaraCase.case.id, missing])
        answers.push(
          await asAgentOnly(hrKabir, (client) =>
            client.query(
              `INSERT INTO hd_case_comment(id,tenant_id,entity_id,case_id,kind,body) VALUES ($1,$2,$3,$4,'comment','Hello')`,
              [randomUUID(), actor.tenantId, actor.entityId, target],
            ),
          ).then(
            () => "accepted",
            (error: { message: string; code: string }) =>
              `${error.code} ${error.message}`,
          ),
        );
      assert.deepEqual(answers, [
        "HD003 This case is unavailable",
        "HD003 This case is unavailable",
      ]);
      assert.equal(
        await status(
          hd.addComment(
            arjunE,
            zaraCase.case.id,
            { kind: "comment", body: "peek" },
            randomUUID(),
          ),
        ),
        404,
      );
      assert.equal(
        await status(
          hd.addComment(
            arjunE,
            missing,
            { kind: "comment", body: "peek" },
            randomUUID(),
          ),
        ),
        404,
      );
    });

    await t.test("state machine, four-eyes and internal notes", async () => {
      const id = arjunCase.case.id;
      let v = arjunCase.case.version;
      // Nobody starts an unassigned case; the requester never works it.
      assert.equal(
        await status(
          hd.caseStep(hrKabir, id, "start", { version: v }, randomUUID()),
        ),
        409,
      );
      assert.equal(
        await status(
          hd.caseStep(arjunE, id, "wait", { version: v }, randomUUID()),
        ),
        403,
      );
      assert.equal(
        await status(
          hd.caseStep(hrKabir, id, "resume", { version: v }, randomUUID()),
        ),
        409,
      );
      assert.equal(
        await status(
          hd.assign(
            arjunE,
            id,
            { version: v, assigneeEmployeeId: kabir },
            randomUUID(),
          ),
        ),
        403,
      );
      assert.equal(
        await status(
          hd.assign(
            hrKabir,
            id,
            { version: v, assigneeEmployeeId: zara },
            randomUUID(),
          ),
        ),
        400,
        "only HR agents are assignable",
      );
      let d = await hd.assign(
        hrKabir,
        id,
        { version: v, assigneeEmployeeId: kabir },
        randomUUID(),
      );
      assert.equal(d.case.assigneeName !== null, true);
      assert.equal(d.case.assignedToMe, true);
      v = d.case.version;
      // An internal note does not count as the first response, nor move the
      // requester-visible activity time (060).
      const before = d.case.lastActivityAt;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      d = await hd.addComment(
        hrKabir,
        id,
        { kind: "internal", body: `Check the ledger ${internalMarker}` },
        randomUUID(),
      );
      assert.equal(d.case.firstRespondedAt, null);
      assert.equal(d.case.lastActivityAt, before);
      assert.equal(
        d.case.version,
        v,
        "comments do not change the case version",
      );
      d = await hd.addComment(
        hrKabir,
        id,
        { kind: "comment", body: `Looking into it ${secret}` },
        randomUUID(),
      );
      assert.notEqual(d.case.firstRespondedAt, null);
      assert.equal(d.case.responseBreached, false);
      // The requester never sees the internal note, through the API or directly.
      const seen = await hd.caseDetail(arjunE, id);
      assert.equal(seen.comments.length, 1);
      assert.ok(seen.comments.every((c) => c.kind === "comment"));
      assert.ok(!JSON.stringify(seen).includes(internalMarker));
      assert.equal(seen.case.canAddInternalNote, false);
      const direct = await scoped(pool, arjunE, (client) =>
        client.query("SELECT body FROM hd_case_comment WHERE case_id=$1", [id]),
      );
      assert.equal(direct.rows.length, 1);
      assert.equal(
        await status(
          hd.addComment(
            arjunE,
            id,
            { kind: "internal", body: "sneak" },
            randomUUID(),
          ),
        ),
        403,
      );
      await assert.rejects(
        scoped(pool, arjunE, (client) =>
          client.query(
            `INSERT INTO hd_case_comment(id,tenant_id,entity_id,case_id,kind,body) VALUES ($1,$2,$3,$4,'internal','x')`,
            [randomUUID(), actor.tenantId, actor.entityId, id],
          ),
        ),
        /Only HR agents add internal notes/,
      );
      assert.equal(
        (await hd.caseDetail(hrMaya, id)).comments.length,
        2,
        "other agents see notes",
      );
      d = await hd.caseStep(hrKabir, id, "start", { version: v }, randomUUID());
      assert.equal(d.case.status, "in_progress");
      d = await hd.caseStep(
        hrKabir,
        id,
        "wait",
        { version: d.case.version, note: "Please share the month" },
        randomUUID(),
      );
      assert.equal(d.case.status, "waiting_on_employee");
      d = await hd.addComment(
        arjunE,
        id,
        { kind: "comment", body: "It was March" },
        randomUUID(),
      );
      d = await hd.caseStep(
        hrKabir,
        id,
        "resume",
        { version: d.case.version },
        randomUUID(),
      );
      // The requester cannot resolve; Maya (manage) could, but Kabir is the assignee.
      assert.equal(
        await status(
          hd.caseStep(
            arjunE,
            id,
            "resolve",
            { version: d.case.version },
            randomUUID(),
          ),
        ),
        403,
      );
      d = await hd.caseStep(
        hrKabir,
        id,
        "resolve",
        { version: d.case.version, note: "Corrected" },
        randomUUID(),
      );
      assert.equal(d.case.status, "resolved");
      assert.notEqual(d.case.reopenUntil, null);
      // Agents cannot close inside the reopen window; the requester reopens.
      assert.equal(
        await status(
          hd.closeCase(hrKabir, id, { version: d.case.version }, randomUUID()),
        ),
        403,
      );
      assert.equal(
        await status(
          hd.caseStep(
            hrKabir,
            id,
            "reopen",
            { version: d.case.version },
            randomUUID(),
          ),
        ),
        403,
      );
      d = await hd.caseStep(
        arjunE,
        id,
        "reopen",
        { version: d.case.version, note: "Still wrong" },
        randomUUID(),
      );
      assert.equal(d.case.status, "in_progress");
      assert.equal(d.case.reopenCount, 1);
      assert.equal(d.case.resolvedAt, null);
      d = await hd.caseStep(
        hrKabir,
        id,
        "resolve",
        { version: d.case.version },
        randomUUID(),
      );
      // Only the requester rates, only when closing.
      assert.equal(
        await status(
          hd.closeCase(
            hrKabir,
            id,
            { version: d.case.version, satisfaction: 5 },
            randomUUID(),
          ),
        ),
        403,
      );
      d = await hd.closeCase(
        arjunE,
        id,
        { version: d.case.version, satisfaction: 4 },
        randomUUID(),
      );
      assert.equal(d.case.status, "closed");
      assert.equal(d.case.satisfaction, 4);
      assert.deepEqual(
        d.history.map((h) => h.toStatus),
        [
          "open",
          "open",
          "in_progress",
          "waiting_on_employee",
          "in_progress",
          "resolved",
          "in_progress",
          "resolved",
          "closed",
        ],
      );
      assert.equal(d.history[1]!.assigneeChanged, true);
      // Closed is final. Each call starts only when awaited, so no rejection goes unhandled.
      for (const work of [
        () =>
          hd.addComment(
            arjunE,
            id,
            { kind: "comment", body: "again" },
            randomUUID(),
          ),
        () =>
          hd.caseStep(
            arjunE,
            id,
            "reopen",
            { version: d.case.version },
            randomUUID(),
          ),
        () =>
          hd.setPriority(
            hrKabir,
            id,
            { version: d.case.version, priority: "low" },
            randomUUID(),
          ),
      ])
        assert.equal(await status(work()), 409);

      // Four-eyes on an HR admin's own case: Maya is only the requester there.
      const m = mayaCase.case.id;
      let mv = mayaCase.case.version;
      assert.equal(
        await status(
          hd.assign(
            hrMaya,
            m,
            { version: mv, assigneeEmployeeId: maya },
            randomUUID(),
          ),
        ),
        403,
      );
      assert.equal(
        await status(
          hd.assign(
            hrKabir,
            m,
            { version: mv, assigneeEmployeeId: maya },
            randomUUID(),
          ),
        ),
        400,
      );
      assert.equal(
        await status(
          hd.addComment(
            hrMaya,
            m,
            { kind: "internal", body: "self note" },
            randomUUID(),
          ),
        ),
        403,
      );
      let md = await hd.assign(
        hrKabir,
        m,
        { version: mv, assigneeEmployeeId: kabir },
        randomUUID(),
      );
      mv = md.case.version;
      await hd.addComment(
        hrKabir,
        m,
        { kind: "internal", body: `About Maya ${internalMarker}` },
        randomUUID(),
      );
      const mayaView = await hd.caseDetail(hrMaya, m);
      assert.ok(!JSON.stringify(mayaView).includes(internalMarker));
      assert.equal(mayaView.case.canResolve, false);
      const mayaDirect = await scoped(pool, hrMaya, (client) =>
        client.query(
          "SELECT 1 FROM hd_case_comment WHERE case_id=$1 AND kind='internal'",
          [m],
        ),
      );
      assert.equal(
        mayaDirect.rows.length,
        0,
        "HR as requester never reads notes",
      );
      assert.equal(
        await status(
          hd.caseStep(hrMaya, m, "resolve", { version: mv }, randomUUID()),
        ),
        403,
      );
      md = await hd.caseStep(
        hrKabir,
        m,
        "resolve",
        { version: mv },
        randomUUID(),
      );
      assert.equal(md.case.resolvedBy, "Kabir (synthetic HR)");
      // Cancelling: the requester, or HR manage; never another employee.
      assert.equal(
        await status(
          hd.caseStep(
            arjunE,
            rohanCase.case.id,
            "cancel",
            { version: 1 },
            randomUUID(),
          ),
        ),
        404,
      );
      const cancelled = await hd.caseStep(
        rohanE,
        rohanCase.case.id,
        "cancel",
        { version: 1 },
        randomUUID(),
      );
      assert.equal(cancelled.case.status, "cancelled");
      assert.equal(
        await status(
          hd.caseStep(
            rohanE,
            rohanCase.case.id,
            "start",
            { version: 2 },
            randomUUID(),
          ),
        ),
        409,
      );
    });

    await t.test(
      "reopen window, service-target breach and priority",
      async () => {
        const m = mayaCase.case.id;
        // Push the resolution 8 days into the past: the requester can no longer reopen and an
        // agent may close.
        await backdate(
          "UPDATE hd_case SET resolved_at=resolved_at-interval '8 days' WHERE id=$1",
          m,
        );
        let md = await hd.caseDetail(hrMaya, m);
        assert.equal(md.case.canReopen, false);
        assert.equal(
          await status(
            hd.caseStep(
              hrMaya,
              m,
              "reopen",
              { version: md.case.version },
              randomUUID(),
            ),
          ),
          409,
        );
        md = await hd.caseDetail(hrKabir, m);
        assert.equal(md.case.canClose, true);
        md = await hd.closeCase(
          hrKabir,
          m,
          { version: md.case.version },
          randomUUID(),
        );
        assert.equal(md.case.status, "closed");
        assert.equal(md.case.satisfaction, null);

        // Neel's case: urgent priority recomputes due times from the creation time.
        const n = neelCase.case.id;
        let nd = await hd.setPriority(
          hrKabir,
          n,
          { version: neelCase.case.version, priority: "urgent" },
          randomUUID(),
        );
        assert.equal(hours(nd.case.createdAt, nd.case.firstResponseDue), 1);
        assert.equal(hours(nd.case.createdAt, nd.case.resolveDue), 8);
        assert.equal(nd.history.at(-1)!.priorityChanged, true);
        assert.equal(
          await status(
            hd.setPriority(
              neelM,
              n,
              { version: nd.case.version, priority: "low" },
              randomUUID(),
            ),
          ),
          403,
          "the requester cannot change the priority",
        );
        // Two hours old with no reply: the response target is breached, resolution is not.
        await backdate(
          `UPDATE hd_case SET created_at=created_at-interval '2 hours', first_response_due=first_response_due-interval '2 hours',
           resolve_due=resolve_due-interval '2 hours' WHERE id=$1`,
          n,
        );
        nd = await hd.caseDetail(neelM, n);
        assert.equal(nd.case.responseBreached, true);
        assert.equal(nd.case.resolveBreached, false);
        assert.equal(nd.case.breached, true);
        const breached = await hd.listCases(hrKabir, {
          page: 1,
          limit: 100,
          q: secret,
          view: "all",
          breached: "true",
        });
        assert.ok(breached.items.some((c) => c.id === n));
        assert.ok(breached.items.every((c) => c.breached));
        // A late reply keeps the response breach.
        nd = await hd.addComment(
          hrKabir,
          n,
          { kind: "comment", body: "Sorry for the wait" },
          randomUUID(),
        );
        assert.equal(nd.case.responseBreached, true);
      },
    );

    await t.test("confidential cases", async () => {
      const z = zaraCase.case.id;
      // The requester cannot clear the flag; an agent cannot see it until it is theirs.
      assert.equal(
        await status(
          hd.setConfidential(
            zaraE,
            z,
            { version: 1, confidential: false },
            randomUUID(),
          ),
        ),
        403,
      );
      let zd = await hd.assign(
        hrMaya,
        z,
        { version: 1, assigneeEmployeeId: kabir },
        randomUUID(),
      );
      const now = await asAgentOnly(hrKabir, (client) =>
        client.query("SELECT 1 FROM hd_case WHERE id=$1", [z]),
      );
      assert.equal(now.rows.length, 1, "visible once assigned to the agent");
      await hd.addComment(
        hrKabir,
        z,
        { kind: "internal", body: `Sensitive ${internalMarker}` },
        randomUUID(),
      );
      // Agent-only scope cannot clear the flag even when assigned.
      await assert.rejects(
        asAgentOnly(hrKabir, (client) =>
          client.query(
            "UPDATE hd_case SET confidential=false, version=version+1 WHERE id=$1",
            [z],
          ),
        ),
        /Only an HR manager clears the confidential flag/,
      );
      // Manage can clear and set it.
      zd = await hd.setConfidential(
        hrMaya,
        z,
        { version: zd.case.version, confidential: false },
        randomUUID(),
      );
      assert.equal(zd.case.confidential, false);
      zd = await hd.setConfidential(
        hrMaya,
        z,
        { version: zd.case.version, confidential: true },
        randomUUID(),
      );
      assert.equal(zd.history.filter((h) => h.confidentialChanged).length, 2);
      const zaraView = await hd.caseDetail(zaraE, z);
      assert.ok(!JSON.stringify(zaraView).includes(internalMarker));
      // A requester may mark any case confidential when raising it.
      const flagged = await raise(arjunE, { confidential: true });
      assert.equal(flagged.case.confidential, true);
      const hidden = await asAgentOnly(hrKabir, (client) =>
        client.query("SELECT 1 FROM hd_case WHERE id=$1", [flagged.case.id]),
      );
      assert.equal(hidden.rows.length, 0);
    });

    await t.test("knowledge articles and keyword suggestions", async () => {
      const article = await hd.createArticle(
        hrMaya,
        {
          categoryId: categoryId("Payroll query"),
          title: `Reading your payslip ${run}`,
          body: "Your payslip lists earnings, deductions and net pay.",
          keywords: ["Payslip", "salary", " deductions ", "payslip"],
        },
        randomUUID(),
      );
      ids.articles.push(article.id);
      assert.equal(article.status, "draft");
      assert.deepEqual(article.keywords, ["deductions", "payslip", "salary"]);
      const draft = await hd.createArticle(
        hrMaya,
        {
          categoryId: null,
          title: `Draft only ${run}`,
          body: "Not yet published to anyone at all.",
          keywords: ["payslip"],
        },
        randomUUID(),
      );
      ids.articles.push(draft.id);
      assert.equal(
        await status(
          hd.createArticle(
            arjunE,
            {
              title: "Mine",
              body: "Employees cannot write articles",
              keywords: [],
            },
            randomUUID(),
          ),
        ),
        403,
      );
      assert.equal(await status(hd.articleDetail(arjunE, article.id)), 404);
      const published = await hd.articleStep(
        hrMaya,
        article.id,
        "publish",
        { version: article.version },
        randomUUID(),
      );
      assert.equal(published.status, "published");
      assert.equal(
        await status(
          hd.articleStep(
            hrMaya,
            article.id,
            "publish",
            { version: published.version },
            randomUUID(),
          ),
        ),
        409,
      );
      const list = await hd.listArticles(arjunE, {
        page: 1,
        limit: 100,
        q: run,
      });
      assert.deepEqual(
        list.items.map((a) => a.id),
        [article.id],
      );
      const suggestions = await hd.suggest(arjunE, {
        categoryId: categoryId("Payroll query"),
        q: "Where is my PAYSLIP for March?",
      });
      assert.equal(suggestions.method, "keyword_match");
      const hit = suggestions.items.find((s) => s.id === article.id);
      assert.ok(hit);
      assert.equal(hit.matchedWords, 1);
      assert.ok(!suggestions.items.some((s) => s.id === draft.id));
      const none = await hd.suggest(arjunE, {
        categoryId: categoryId("Leave"),
        q: "payslip",
      });
      assert.ok(!none.items.some((s) => s.id === article.id), "other category");
      // Agents link articles; the requester sees them and cannot link.
      const n = neelCase.case.id;
      assert.equal(
        await status(
          hd.linkArticle(neelM, n, { articleId: article.id }, randomUUID()),
        ),
        403,
      );
      assert.equal(
        await status(
          hd.linkArticle(hrKabir, n, { articleId: draft.id }, randomUUID()),
        ),
        400,
      );
      await hd.linkArticle(hrKabir, n, { articleId: article.id }, randomUUID());
      assert.equal(
        await status(
          hd.linkArticle(hrKabir, n, { articleId: article.id }, randomUUID()),
        ),
        409,
      );
      const neelView = await hd.caseDetail(neelM, n);
      assert.equal(neelView.articles.length, 1);
      assert.equal(neelView.articles[0]!.title, published.title);
    });

    await t.test("direct statements as the app role are refused", async () => {
      const id = arjunCase.case.id;
      const n = neelCase.case.id;
      for (const sql of [
        "UPDATE hd_case SET last_activity_at=NULL WHERE id=$1",
        "UPDATE hd_case SET requester_employee_id=requester_employee_id WHERE id=$1",
        "UPDATE hd_case SET subject='changed' WHERE id=$1",
        "UPDATE hd_case SET resolved_at=now() WHERE id=$1",
        "UPDATE hd_case_comment SET body='changed' WHERE case_id=$1",
        "DELETE FROM hd_case_comment WHERE case_id=$1",
        "DELETE FROM hd_case WHERE id=$1",
        "INSERT INTO hd_case_history(tenant_id,entity_id,case_id,to_status,assignee_changed,priority,priority_changed,confidential,confidential_changed,by_employee,by_label) SELECT tenant_id,entity_id,id,'resolved',false,'low',false,false,false,requester_employee_id,'x' FROM hd_case WHERE id=$1",
        "UPDATE hd_case_history SET by_label='x' WHERE case_id=$1",
        "TRUNCATE hd_case_comment",
      ])
        await assert.rejects(
          scoped(pool, hrMaya, (client) =>
            client.query(sql, sql.includes("$1") ? [n] : []),
          ),
          /permission denied/,
          sql,
        );
      // The requester cannot move their own case as an agent would.
      await assert.rejects(
        scoped(pool, neelM, (client) =>
          client.query(
            "UPDATE hd_case SET status='resolved', version=version+1 WHERE id=$1",
            [n],
          ),
        ),
        /resolves a case/,
      );
      // Nor can anyone change two things at once or skip the version.
      await assert.rejects(
        scoped(pool, hrKabir, (client) =>
          client.query(
            "UPDATE hd_case SET priority='low', confidential=true, version=version+1 WHERE id=$1",
            [n],
          ),
        ),
        /one thing/,
      );
      await assert.rejects(
        scoped(pool, hrKabir, (client) =>
          client.query("UPDATE hd_case SET priority='low' WHERE id=$1", [n]),
        ),
        /own actions/,
      );
      // Forged requester: the guard always makes the caller the requester.
      const forged = randomUUID();
      await scoped(pool, arjunE, (client) =>
        client.query(
          `INSERT INTO hd_case(id,tenant_id,entity_id,category_id,subject,description,priority,confidential)
           VALUES ($1,$2,$3,$4,'Forged case','A forged case body',NULL,false)`,
          [forged, actor.tenantId, actor.entityId, categoryId("Other")],
        ),
      );
      ids.cases.push(forged);
      const own = await hd.caseDetail(arjunE, forged);
      assert.equal(own.case.requesterEmployeeId, arjun);
      assert.equal(own.case.priority, "normal");
      // Even the migrator cannot delete, rewrite or truncate the history.
      for (const sql of [
        "DELETE FROM hd_case WHERE id=$1",
        "DELETE FROM hd_case_comment WHERE case_id=$1",
        "DELETE FROM hd_case_history WHERE case_id=$1",
      ])
        await assert.rejects(admin.query(sql, [id]), /never deleted/, sql);
      await assert.rejects(
        admin.query("UPDATE hd_case_comment SET body='x' WHERE case_id=$1", [
          id,
        ]),
        /are final/,
      );
      for (const table of [
        "hd_case",
        "hd_case_comment",
        "hd_case_history",
        "hd_case_article",
        "hd_article",
        "hd_category",
        "hd_sla_target",
      ])
        await assert.rejects(
          admin.query(`TRUNCATE ${table} CASCADE`),
          /never deleted/,
          table,
        );
      // Tenant isolation: another tenant or entity reads nothing.
      for (const who of [
        { ...hrMaya, tenantId: randomUUID() },
        { ...hrMaya, entityId: randomUUID() },
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM hd_case WHERE id=ANY($1::uuid[]))
              +(SELECT count(*) FROM hd_case_comment WHERE case_id=ANY($1::uuid[]))
              +(SELECT count(*) FROM hd_case_history WHERE case_id=ANY($1::uuid[]))
              +(SELECT count(*) FROM hd_case_article WHERE case_id=ANY($1::uuid[]))
              +(SELECT count(*) FROM hd_article)+(SELECT count(*) FROM hd_category)
              +(SELECT count(*) FROM hd_sla_target) AS n`,
            [ids.cases],
          ),
        );
        assert.equal(Number(seen.rows[0]!.n), 0);
        assert.equal(await status(hd.caseDetail(who, n)), 404);
        assert.equal(
          (await scoped(pool, who, (c) => c.query("SELECT * FROM hd_agents()")))
            .rows.length,
          0,
        );
      }
      // Auditors read nothing.
      const none = await scoped(pool, auditor, (client) =>
        client.query<{ n: string }>(
          "SELECT (SELECT count(*) FROM hd_case)+(SELECT count(*) FROM hd_case_comment)+(SELECT count(*) FROM hd_category) AS n",
        ),
      );
      assert.equal(Number(none.rows[0]!.n), 0);
    });

    await t.test("optimistic concurrency", async () => {
      const fresh = await raise(arjunE);
      const race = await Promise.allSettled([
        hd.assign(
          hrKabir,
          fresh.case.id,
          { version: 1, assigneeEmployeeId: kabir },
          randomUUID(),
        ),
        hd.assign(
          hrMaya,
          fresh.case.id,
          { version: 1, assigneeEmployeeId: kabir },
          randomUUID(),
        ),
      ]);
      assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
      const failed = race.find((x) => x.status === "rejected");
      assert.equal((failed as PromiseRejectedResult).reason.getStatus(), 409);
      // Comments race freely and are all kept.
      await Promise.all(
        [1, 2, 3].map((i) =>
          hd.addComment(
            arjunE,
            fresh.case.id,
            { kind: "comment", body: `n${i}` },
            randomUUID(),
          ),
        ),
      );
      assert.equal(
        (await hd.caseDetail(arjunE, fresh.case.id)).comments.length,
        3,
      );
    });

    await t.test("independent review fixes (061)", async () => {
      // A priority change never moves a due time that has already passed, so a breach cannot
      // be erased by downgrading the case.
      const late = await raise(arjunE);
      await hd.assign(
        hrKabir,
        late.case.id,
        { version: 1, assigneeEmployeeId: kabir },
        randomUUID(),
      );
      await backdate(
        `UPDATE hd_case SET created_at=now()-interval '100 hours', first_response_due=now()-interval '92 hours',
           resolve_due=now()-interval '28 hours' WHERE id=$1`,
        late.case.id,
      );
      const ld = await hd.caseDetail(hrKabir, late.case.id);
      assert.equal(ld.case.breached, true);
      const after = await hd.setPriority(
        hrKabir,
        late.case.id,
        { version: ld.case.version, priority: "low" },
        randomUUID(),
      );
      assert.equal(after.case.priority, "low");
      assert.equal(after.case.firstResponseDue, ld.case.firstResponseDue);
      assert.equal(after.case.resolveDue, ld.case.resolveDue);
      assert.equal(after.case.responseBreached, true);
      assert.equal(after.case.resolveBreached, true);

      // An agent without helpdesk.manage cannot hide a case they have not taken by marking it
      // confidential through a direct statement.
      const open = await raise(zaraE);
      await assert.rejects(
        asAgentOnly(hrKabir, (client) =>
          client.query(
            "UPDATE hd_case SET confidential=true, version=version+1 WHERE id=$1",
            [open.case.id],
          ),
        ),
        /Take the case before marking it confidential/,
      );
      assert.equal(
        (await hd.caseDetail(hrMaya, open.case.id)).case.confidential,
        false,
      );

      // Each case takes at most 300 public comments and 300 internal notes, counted apart.
      const busy = await raise(arjunE);
      await backdate(
        `INSERT INTO hd_case_comment(id,tenant_id,entity_id,case_id,requester_employee_id,kind,body,
           author_employee_id,author_role,author_label)
         SELECT gen_random_uuid(),c.tenant_id,c.entity_id,c.id,c.requester_employee_id,'comment','filler',
           c.requester_employee_id,'requester','Filler'
         FROM hd_case c CROSS JOIN generate_series(1,300) WHERE c.id=$1`,
        busy.case.id,
      );
      assert.equal(
        await status(
          hd.addComment(
            arjunE,
            busy.case.id,
            { kind: "comment", body: "one more" },
            randomUUID(),
          ),
        ),
        409,
      );
      const noted = await hd.addComment(
        hrKabir,
        busy.case.id,
        { kind: "internal", body: `Still fine ${internalMarker}` },
        randomUUID(),
      );
      assert.equal(noted.comments.length, 301, "agents see the whole thread");
      assert.equal(
        (await hd.caseDetail(arjunE, busy.case.id)).comments.length,
        300,
      );

      // Internal notes emit their own outbox event type; public comments keep theirs.
      const note = noted.comments.find((c) => c.kind === "internal")!;
      const types = await admin.query<{ t: string }>(
        "SELECT event_type AS t FROM outbox_event WHERE aggregate_id=$1",
        [note.id],
      );
      assert.deepEqual(
        types.rows.map((r) => r.t),
        ["helpdesk.internal_note_added.v1"],
      );
    });

    await t.test(
      "audit and outbox carry no free text or personal values; lists paginate",
      async () => {
        const rows = await admin.query<{ action: string; details: unknown }>(
          "SELECT action, details FROM audit_event WHERE target=ANY($1::text[])",
          [
            [
              ...ids.cases.map((id) => `hd-case:${id}`),
              ...ids.articles.map((id) => `hd-article:${id}`),
              ...ids.categories.map((id) => `hd-category:${id}`),
            ],
          ],
        );
        assert.ok(rows.rows.length > 20);
        for (const row of rows.rows) {
          const text = JSON.stringify(row.details ?? {});
          for (const marker of [
            secret,
            internalMarker,
            run,
            "payslip",
            "Sensitive",
          ])
            assert.ok(
              !text.toLowerCase().includes(marker.toLowerCase()),
              `${row.action} ${text}`,
            );
          assert.ok(
            !/satisfaction|"confidential"|categoryId|subject|body/.test(text) ||
              row.action.startsWith("helpdesk.category"),
            `${row.action} ${text}`,
          );
        }
        const outbox = await admin.query<{ t: string }>(
          "SELECT DISTINCT event_type AS t FROM outbox_event WHERE aggregate_id=ANY($1::uuid[]) OR event_type LIKE 'helpdesk.%'",
          [ids.cases],
        );
        for (const type of [
          "helpdesk.case_created.v1",
          "helpdesk.case_assigned.v1",
          "helpdesk.case_status_changed.v1",
          "helpdesk.case_priority_changed.v1",
          "helpdesk.case_confidentiality_changed.v1",
          "helpdesk.comment_added.v1",
          "helpdesk.article_linked.v1",
          "helpdesk.article_created.v1",
          "helpdesk.article_status_changed.v1",
          "helpdesk.category_created.v1",
          "helpdesk.sla_updated.v1",
        ])
          assert.ok(
            outbox.rows.some((r) => r.t === type),
            type,
          );
        await changeRole("hr_admin");
        const page1 = (await (
          await request(`/helpdesk/cases?q=${secret}&limit=2&page=1`)
        ).json()) as HdCaseList;
        const page2 = (await (
          await request(`/helpdesk/cases?q=${secret}&limit=2&page=2`)
        ).json()) as HdCaseList;
        assert.equal(page1.items.length, 2);
        assert.equal(
          page1.total,
          ids.cases.length - 1,
          "all but the forged case",
        );
        assert.ok(
          page2.items.every((c) => !page1.items.some((p) => p.id === c.id)),
        );
        assert.equal(
          Object.values(page1.counts).reduce((a, b) => a + b, 0),
          page1.total,
        );
      },
    );
  } finally {
    // Synthetic cleanup only: helpdesk history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      const comments = (
        await client.query<{ id: string }>(
          "SELECT id FROM hd_case_comment WHERE case_id=ANY($1::uuid[])",
          [ids.cases],
        )
      ).rows.map((r) => r.id);
      const links = (
        await client.query<{ id: string }>(
          "SELECT id FROM hd_case_article WHERE case_id=ANY($1::uuid[])",
          [ids.cases],
        )
      ).rows.map((r) => r.id);
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [
          [
            ...ids.cases,
            ...ids.articles,
            ...ids.categories,
            ...comments,
            ...links,
          ],
        ],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[])",
        [
          [
            ...ids.cases.map((id) => `hd-case:${id}`),
            ...ids.articles.map((id) => `hd-article:${id}`),
            ...ids.categories.map((id) => `hd-category:${id}`),
          ],
        ],
      );
      await client.query(
        "DELETE FROM hd_case_article WHERE case_id=ANY($1::uuid[])",
        [ids.cases],
      );
      await client.query(
        "DELETE FROM hd_case_comment WHERE case_id=ANY($1::uuid[])",
        [ids.cases],
      );
      await client.query(
        "DELETE FROM hd_case_history WHERE case_id=ANY($1::uuid[])",
        [ids.cases],
      );
      await client.query("DELETE FROM hd_case WHERE id=ANY($1::uuid[])", [
        ids.cases,
      ]);
      await client.query("DELETE FROM hd_article WHERE id=ANY($1::uuid[])", [
        ids.articles,
      ]);
      await client.query("DELETE FROM hd_category WHERE id=ANY($1::uuid[])", [
        ids.categories,
      ]);
      await client.query(
        "DELETE FROM audit_event WHERE target LIKE 'hd-sla:%' AND occurred_at>=$1",
        [started],
      );
      await client.query(
        "DELETE FROM outbox_event WHERE event_type='helpdesk.sla_updated.v1' AND occurred_at>=$1",
        [started],
      );
      await restore();
    });
    await Promise.all([admin.end(), pool.end(), app.close()]);
    await store.pool.end();
  }
});
