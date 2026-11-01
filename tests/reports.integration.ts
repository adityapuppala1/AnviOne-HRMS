import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { ExpenseStore } from "../apps/api/src/expense.store";
import { ReportStore } from "../apps/api/src/report.store";
import { toCsv } from "../apps/api/src/report.csv";
import { createClient } from "redis";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import type {
  ReportCatalog,
  ReportResult,
  Role,
  SavedReport,
  SavedReportList,
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

// Arjun reports to Maya (the demo identity); Rohan reports to someone else.
const arjun = "30000000-0000-4000-8000-000000000002";
const rohan = "30000000-0000-4000-8000-000000000006";
const PORT = 4501;
const BOM = String.fromCharCode(0xfeff);
// Clears this file's report budgets so a later subtest starts with a full allowance.
async function resetReportLimits() {
  const url = process.env.RATE_LIMIT_URL;
  if (!url) return;
  const client = createClient({ url });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: "anvione:rl:report-*",
      COUNT: 200,
    }))
      if (keys.length) await client.del(keys);
  } finally {
    await client.quit();
  }
}

await test("Reports: catalog, row and field authorization, CSV export and saved definitions", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const reports = new ReportStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const started = (await admin.query<{ now: Date }>("SELECT now() AS now"))
    .rows[0]!.now;
  const savedIds: string[] = [];
  const synthetic = {
    source: randomUUID(),
    target: randomUUID(),
    person: randomUUID(),
    employee: randomUUID(),
    exit: randomUUID(),
    leave: randomUUID(),
    code: `RPT-${run}`,
  };
  const claims: string[] = [];
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
  const runReport = (definition: Record<string, unknown>) =>
    send("/reports/run", "POST", { definition });
  const ok = async (definition: Record<string, unknown>) => {
    const response = await runReport(definition);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as ReportResult;
  };
  const catalog = async () => {
    const response = await request("/reports/datasets");
    assert.equal(response.status, 200);
    return (await response.json()) as ReportCatalog;
  };
  const codes = async (sql: string, values: unknown[]) =>
    new Set(
      (await admin.query<{ code: string }>(sql, values)).rows.map(
        (r) => r.code,
      ),
    );
  const team = await codes(
    "SELECT code FROM employee WHERE id=$1 OR manager_id=$1",
    [actor.employeeId],
  );
  const rohanCode = [
    ...(await codes("SELECT code FROM employee WHERE id=$1", [rohan])),
  ][0]!;
  assert.ok(!team.has(rohanCode));

  // A synthetic claim of Maya's own, with text that would be dangerous in a spreadsheet.
  const category = (
    await admin.query<{ id: string }>(
      "SELECT id FROM expense_category WHERE entity_id=$1 AND code='MEALS'",
      [actor.entityId],
    )
  ).rows[0]!.id;
  const title = `=SUM(1,2) "q", ${run} 100%_x`;
  const mine = await new ExpenseStore(store).submit(
    { ...actor, role: "employee" },
    {
      kind: "expense",
      title,
      categoryId: category,
      amountMinor: 12345,
      expenseDate: (
        await admin.query<{ today: string }>(
          `SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS today FROM legal_entity WHERE id=$1`,
          [actor.entityId],
        )
      ).rows[0]!.today,
      description: "-1 owed\nsecond line",
    } as never,
    randomUUID(),
  );
  claims.push(mine.items.find((item) => item.title === title)!.id);
  const ourClaim = {
    dataset: "expenses",
    columns: ["title", "amount", "description", "employeeCode"],
    filters: [{ column: "title", op: "contains", value: run }],
  };

  try {
    await t.test(
      "anonymous callers and roles without reporting are refused",
      async () => {
        assert.equal(
          (await fetch(`http://127.0.0.1:${PORT}/api/v1/reports/datasets`))
            .status,
          401,
        );
        for (const role of ["employee", "auditor", "platform_admin"] as const) {
          await changeRole(role);
          assert.equal((await request("/reports/datasets")).status, 403, role);
          assert.equal((await request("/reports/saved")).status, 403, role);
          assert.equal(
            (await runReport({ dataset: "people", columns: ["name"] })).status,
            403,
            role,
          );
          assert.equal(
            (
              await send("/reports/export", "POST", {
                definition: { dataset: "people", columns: ["name"] },
              })
            ).status,
            403,
            role,
          );
        }
      },
    );

    await t.test("the catalog differs by role", async () => {
      await changeRole("hr_admin");
      const hr = await catalog();
      assert.equal(hr.scope, "entity");
      assert.equal(hr.canExport, true);
      assert.deepEqual(
        hr.datasets.map((d) => d.key),
        [
          "people",
          "leave",
          "attendance",
          "expenses",
          "assets",
          "policyAcknowledgements",
          "exits",
        ],
      );
      const hrExpenses = hr.datasets.find((d) => d.key === "expenses")!;
      assert.ok(
        hrExpenses.columns.some(
          (c) => c.key === "receiptReference" && c.sensitive,
        ),
      );
      assert.deepEqual(
        hrExpenses.columns.find((c) => c.key === "amount")!.operators,
        ["eq", "between", "gte", "lte"],
      );
      await changeRole("manager");
      const manager = await catalog();
      assert.equal(manager.scope, "team");
      assert.equal(manager.canExport, false);
      assert.deepEqual(
        manager.datasets.map((d) => d.key),
        ["people", "leave", "attendance", "expenses"],
      );
      for (const dataset of manager.datasets)
        assert.ok(
          dataset.columns.every((c) => !c.sensitive),
          dataset.key,
        );
    });

    await t.test(
      "no contact or profile data is ever offered or returned",
      async () => {
        await changeRole("hr_admin");
        // Column keys and labels only: "phone" is legitimately an asset category value.
        const text = JSON.stringify(
          (await catalog()).datasets.flatMap((d) =>
            d.columns.map((c) => [c.key, c.label]),
          ),
        ).toLowerCase();
        for (const word of [
          "email",
          "phone",
          "mobile",
          "address",
          "birth",
          "pan",
          "aadhaar",
          "bank",
          "emergency",
          "personal",
        ])
          assert.ok(!text.includes(word), word);
        const people = (await catalog()).datasets.find(
          (d) => d.key === "people",
        )!;
        const all = await ok({
          dataset: "people",
          columns: people.columns.map((c) => c.key),
          limit: 1000,
        });
        assert.ok(all.rows.length > 0);
        for (const row of all.rows)
          for (const cell of row)
            assert.ok(
              typeof cell !== "string" || !cell.includes("@"),
              String(cell),
            );
      },
    );

    await t.test(
      "a manager sees only their team; HR sees the organization",
      async () => {
        await changeRole("hr_admin");
        const everyone = await ok({
          dataset: "people",
          columns: ["code"],
          limit: 1000,
        });
        assert.ok(everyone.rows.some((r) => r[0] === rohanCode));
        await changeRole("manager");
        const mineOnly = await ok({
          dataset: "people",
          columns: ["code", "managerName"],
          limit: 1000,
        });
        assert.ok(mineOnly.total < everyone.total);
        for (const [code] of mineOnly.rows)
          assert.ok(code === null || team.has(String(code)), String(code));
        for (const dataset of ["leave", "attendance", "expenses"]) {
          const result = await ok({
            dataset,
            columns: ["employeeCode"],
            limit: 1000,
          });
          for (const [code] of result.rows)
            assert.ok(
              code === null || team.has(String(code)),
              `${dataset} ${String(code)}`,
            );
        }
        // The manager's own claim is visible to them, with the amount in paise.
        const own = await ok({ ...ourClaim, columns: ["title", "amount"] });
        assert.deepEqual(own.rows, [[title, 12345]]);
        assert.equal(own.columns[1]!.type, "money");
      },
    );

    await t.test(
      "managers cannot reach HR datasets, sensitive columns or export",
      async () => {
        await changeRole("manager");
        for (const dataset of ["assets", "policyAcknowledgements", "exits"])
          assert.equal(
            (
              await runReport({
                dataset,
                columns: [dataset === "assets" ? "tag" : "employeeName"],
              })
            ).status,
            403,
            dataset,
          );
        for (const definition of [
          { dataset: "expenses", columns: ["title", "receiptReference"] },
          { dataset: "leave", columns: ["reason"] },
          {
            dataset: "leave",
            columns: ["state"],
            filters: [{ column: "reason", op: "contains", value: "a" }],
          },
          {
            dataset: "leave",
            columns: ["state"],
            sort: { column: "decisionNote", direction: "asc" },
          },
        ])
          assert.equal(
            (await runReport(definition)).status,
            403,
            JSON.stringify(definition),
          );
        const exported = await send("/reports/export", "POST", {
          definition: { dataset: "people", columns: ["name"] },
        });
        assert.equal(exported.status, 403);
        const saved = await send("/reports/saved", "POST", {
          name: `Exits ${run}`,
          definition: { dataset: "exits", columns: ["status"] },
        });
        assert.equal(saved.status, 403);
      },
    );

    await t.test(
      "only whitelisted columns, operators and values are accepted",
      async () => {
        await changeRole("hr_admin");
        const rejected = [
          { dataset: "people", columns: ["salary"] },
          // A column that exists, but in another dataset.
          { dataset: "people", columns: ["amount"] },
          { dataset: "people", columns: ["name;DROP TABLE employee"] },
          { dataset: "people", columns: ['name" FROM employee --'] },
          {
            dataset: "people",
            columns: ["name"],
            filters: [{ column: "name", op: "regex", value: "a" }],
          },
          {
            dataset: "people",
            columns: ["name"],
            filters: [{ column: "joinedOn", op: "contains", value: "2" }],
          },
          {
            dataset: "people",
            columns: ["name"],
            filters: [{ column: "status", op: "eq", value: "inactive" }],
          },
          {
            dataset: "people",
            columns: ["name"],
            filters: [{ column: "status", op: "in", values: ["active", "x"] }],
          },
          {
            dataset: "people",
            columns: ["name"],
            filters: [{ column: "joinedOn", op: "gte", value: "2026-02-30" }],
          },
          {
            dataset: "people",
            columns: ["name"],
            filters: [{ column: "joinedOn", op: "gte", value: "1 OR 1=1" }],
          },
          {
            dataset: "expenses",
            columns: ["title"],
            filters: [{ column: "amount", op: "gte", value: "100" }],
          },
          {
            dataset: "expenses",
            columns: ["title"],
            filters: [{ column: "amount", op: "gte", value: 1.234 }],
          },
          {
            dataset: "attendance",
            columns: ["workDate"],
            filters: [{ column: "checkIn", op: "eq", value: "09:00" }],
          },
          {
            dataset: "people",
            columns: ["name"],
            sort: { column: "email", direction: "asc" },
          },
          {
            dataset: "people",
            columns: ["name"],
            sort: { column: "name", direction: "sideways" },
          },
          { dataset: "people", columns: ["name", "name"] },
          { dataset: "people", columns: [] },
          {
            dataset: "people",
            columns: Array.from({ length: 21 }, (_, i) => `c${i}`),
          },
          { dataset: "people", columns: ["name"], limit: 1001 },
          { dataset: "people", columns: ["name"], sql: "SELECT 1" },
          { dataset: "salaries", columns: ["name"] },
        ];
        for (const definition of rejected)
          assert.equal(
            (await runReport(definition)).status,
            400,
            JSON.stringify(definition),
          );
        // Values are parameters: an injection attempt is just text that matches nothing.
        const injected = await ok({
          dataset: "people",
          columns: ["name"],
          filters: [
            {
              column: "name",
              op: "contains",
              value: "'; DROP TABLE report_definition; --",
            },
          ],
        });
        assert.equal(injected.total, 0);
        const still = await admin.query(
          "SELECT count(*) FROM report_definition",
        );
        assert.equal(still.rowCount, 1);
      },
    );

    await t.test(
      "contains matches % and _ literally; limits and truncation",
      async () => {
        await changeRole("hr_admin");
        const literal = await ok({
          dataset: "expenses",
          columns: ["title"],
          filters: [
            { column: "title", op: "contains", value: `${run} 100%_x` },
          ],
        });
        assert.equal(literal.total, 1);
        // Unescaped, "1_0%" would match "100%_x"; escaped it matches nothing.
        for (const value of [`${run} 1_0%`, `${run}%x`, `${run}\\`])
          assert.equal(
            (
              await ok({
                dataset: "expenses",
                columns: ["title"],
                filters: [{ column: "title", op: "contains", value }],
              })
            ).total,
            0,
            value,
          );
        const money = await ok({
          dataset: "expenses",
          columns: ["amount"],
          filters: [
            { column: "title", op: "contains", value: run },
            { column: "amount", op: "between", from: 123.45, to: 123.45 },
          ],
        });
        assert.deepEqual(money.rows, [[12345]]);
        const limited = await ok({
          dataset: "people",
          columns: ["name"],
          limit: 1,
          sort: { column: "name", direction: "desc" },
        });
        assert.equal(limited.rows.length, 1);
        assert.ok(limited.total > 1);
        assert.equal(limited.truncated, true);
        assert.equal(limited.totalCapped, false);
        // Oversized definitions are refused by the contract.
        const huge = Array.from({ length: 10 }, () => ({
          column: "name",
          op: "in",
          values: Array.from({ length: 8 }, (_, i) => `${"x".repeat(110)}${i}`),
        }));
        assert.equal(
          (
            await runReport({
              dataset: "people",
              columns: ["name"],
              filters: huge,
            })
          ).status,
          400,
        );
        const full = await ok({
          dataset: "people",
          columns: ["name"],
          limit: 1000,
        });
        assert.equal(full.truncated, false);
        assert.equal(full.rows.length, full.total);
        // Every catalog dataset runs for HR with all of its columns.
        for (const dataset of (await catalog()).datasets) {
          const result = await ok({
            dataset: dataset.key,
            columns: dataset.columns.slice(0, 20).map((c) => c.key),
            limit: 5,
          });
          assert.equal(
            result.columns.length,
            Math.min(20, dataset.columns.length),
          );
        }
      },
    );

    await t.test(
      "CSV golden output: BOM, CRLF, quoting, formula neutralization, rupees",
      () => {
        const csv = toCsv(
          [
            { label: "Name", type: "text" },
            { label: "Amount (INR)", type: "money" },
            { label: "Days", type: "number" },
            { label: "Note", type: "text" },
          ],
          [
            ["=cmd|' /C calc'!A0", 70000, 1.5, null],
            ["+1", -5, 0, "@SUM(A1)"],
            ["\tlead", 5, 2, 'say "hi", ok'],
            ["\rx", 100, 3, "multi\r\nline"],
            ["Plain", 123456789, -1, "a,b"],
            [" =1+1", 0, 0, "\u00a0+1"],
            ["\u200b@x", 0, 0, "\u3000-2"],
            ["\uff1d1", 0, 0, "\uff0b1"],
            ["\uff0d1", 0, 0, "\uff20x"],
            ["\u22125", 0, 0, "ok - fine"],
          ],
        );
        assert.equal(
          csv,
          BOM +
            "Name,Amount (INR),Days,Note\r\n" +
            "'=cmd|' /C calc'!A0,700.00,1.5,\r\n" +
            "'+1,-0.05,0,'@SUM(A1)\r\n" +
            '\'\tlead,0.05,2,"say ""hi"", ok"\r\n' +
            '"\'\rx",1.00,3,"multi\r\nline"\r\n' +
            'Plain,1234567.89,-1,"a,b"\r\n' +
            "' =1+1,0.00,0,'\u00a0+1\r\n" +
            "'\u200b@x,0.00,0,'\u3000-2\r\n" +
            "'\uff1d1,0.00,0,'\uff0b1\r\n" +
            "'\uff0d1,0.00,0,'\uff20x\r\n" +
            "'\u22125,0.00,0,ok - fine\r\n",
        );
      },
    );

    let exportId = "";
    await t.test(
      "HR exports a CSV attachment that is audited without values",
      async () => {
        await changeRole("hr_admin");
        const response = await send("/reports/export", "POST", {
          definition: ourClaim,
          fileName: '../Team "Claims"\r\nSet-Cookie: x',
        });
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(
          response.headers.get("content-type"),
          "text/csv; charset=utf-8",
        );
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(
          response.headers.get("content-disposition")!,
          /^attachment; filename="team-claims-set-cookie-x-\d{8}\.csv"$/,
        );
        assert.equal(response.headers.get("x-report-truncated"), "false");
        assert.equal(response.headers.get("x-report-row-count"), "1");
        exportId = response.headers.get("x-report-export-id")!;
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
        const code = [
          ...(await codes("SELECT code FROM employee WHERE id=$1", [
            actor.employeeId,
          ])),
        ][0]!;
        assert.equal(
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
          BOM +
            "Title,Amount (INR),Description,Employee code\r\n" +
            `"'=SUM(1,2) ""q"", ${run} 100%_x",123.45,"'-1 owed\nsecond line",${code}\r\n`,
        );
        const audit = await admin.query<{
          action: string;
          details: unknown;
          role: string;
        }>("SELECT action, details, role FROM audit_event WHERE target=$1", [
          `report-export:${exportId}`,
        ]);
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0]!.role, "hr_admin");
        assert.deepEqual(audit.rows[0]!.details, {
          dataset: "expenses",
          columns: ["title", "amount", "description", "employeeCode"],
          filters: [{ column: "title", op: "contains" }],
          sort: null,
          rowCount: 1,
          truncated: false,
        });
        assert.ok(!JSON.stringify(audit.rows[0]).includes(run));
        const events = await admin.query(
          "SELECT 1 FROM outbox_event WHERE aggregate_id=$1 AND event_type='report.exported.v1'",
          [exportId],
        );
        assert.equal(events.rowCount, 1);
      },
    );

    await t.test(
      "saved reports: create, update, conflicts, archive, ownership and the cap",
      async () => {
        await changeRole("manager");
        const definition = {
          dataset: "leave",
          columns: ["employeeName", "state"],
          filters: [{ column: "state", op: "eq", value: "pending" }],
        };
        const created = await send("/reports/saved", "POST", {
          name: `Pending ${run}`,
          definition,
        });
        assert.equal(created.status, 201, await created.clone().text());
        const report = (await created.json()) as SavedReport;
        savedIds.push(report.id);
        assert.equal(report.version, 1);
        assert.equal(report.runnable, true);
        assert.equal(report.definition!.limit, 100);
        const duplicate = await send("/reports/saved", "POST", {
          name: `pending ${run}`,
          definition,
        });
        assert.equal(duplicate.status, 409);
        assert.equal(
          (await send("/reports/saved", "POST", { name: "ab", definition }))
            .status,
          400,
        );
        assert.equal(
          (
            await send("/reports/saved", "POST", {
              name: `Bad ${run}`,
              definition: { ...definition, columns: ["salary"] },
            })
          ).status,
          400,
        );
        const updated = await send(`/reports/saved/${report.id}`, "PUT", {
          name: `Pending leave ${run}`,
          definition: { ...definition, limit: 50 },
          version: 1,
        });
        assert.equal(updated.status, 200, await updated.clone().text());
        assert.equal(((await updated.json()) as SavedReport).version, 2);
        const stale = await send(`/reports/saved/${report.id}`, "PUT", {
          name: `Stale ${run}`,
          definition,
          version: 1,
        });
        assert.equal(stale.status, 409);
        const list = (await (
          await request("/reports/saved")
        ).json()) as SavedReportList;
        assert.equal(list.limit, 50);
        assert.ok(
          list.items.some(
            (i) => i.id === report.id && i.name === `Pending leave ${run}`,
          ),
        );
        // In HR context the same owner sees the same private list.
        await changeRole("hr_admin");
        const asHr = (await (
          await request("/reports/saved")
        ).json()) as SavedReportList;
        assert.ok(asHr.items.some((i) => i.id === report.id));
        await changeRole("manager");
        const archived = await send(
          `/reports/saved/${report.id}/archive`,
          "POST",
          { version: 2 },
        );
        assert.equal(archived.status, 201, await archived.clone().text());
        assert.equal(((await archived.json()) as SavedReport).archived, true);
        const after = (await (
          await request("/reports/saved")
        ).json()) as SavedReportList;
        assert.ok(!after.items.some((i) => i.id === report.id));
        assert.equal(
          (
            await send(`/reports/saved/${report.id}`, "PUT", {
              name: `Again ${run}`,
              definition,
              version: 3,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await send(`/reports/saved/${report.id}/archive`, "POST", {
              version: 3,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await send(`/reports/saved/not-a-uuid/archive`, "POST", {
              version: 1,
            })
          ).status,
          400,
        );
        // Someone else's report looks like no report at all.
        const theirs = await reports.create(
          {
            ...actor,
            employeeId: arjun,
            role: "manager",
            name: "Arjun (synthetic)",
          },
          {
            name: `Arjun ${run}`,
            definition: {
              dataset: "people",
              columns: ["name"],
              filters: [],
              limit: 10,
            },
          },
          randomUUID(),
        );
        savedIds.push(theirs.id);
        assert.equal(
          (
            await send(`/reports/saved/${theirs.id}`, "PUT", {
              name: `Mine now ${run}`,
              definition,
              version: 1,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await send(`/reports/saved/${theirs.id}/archive`, "POST", {
              version: 1,
            })
          ).status,
          404,
        );
        // At most 50 live saved reports per person.
        const manager = { ...actor, role: "manager" as const };
        const existing = (await reports.saved(manager)).items.length;
        for (let i = existing; i < 50; i++) {
          const made = await reports.create(
            manager,
            {
              name: `Cap ${run} ${i}`,
              definition: {
                dataset: "people",
                columns: ["name"],
                filters: [],
                limit: 10,
              },
            },
            randomUUID(),
          );
          savedIds.push(made.id);
        }
        const over = await send("/reports/saved", "POST", {
          name: `Over ${run}`,
          definition,
        });
        assert.equal(over.status, 409);
        assert.match(
          ((await over.json()) as { title: string }).title,
          /up to 50/,
        );
      },
    );

    await t.test(
      "the database refuses what the API would never send",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        const hr = { ...actor, role: "hr_admin" as const };
        const arjunManager = {
          ...actor,
          employeeId: arjun,
          role: "manager" as const,
          name: "Arjun (synthetic)",
        };
        const insert = `INSERT INTO report_definition(id,tenant_id,entity_id,owner_employee_id,name,dataset,definition)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`;
        const values = (owner: string, dataset = "people") => [
          randomUUID(),
          actor.tenantId,
          actor.entityId,
          owner,
          `Direct ${run} ${randomUUID().slice(0, 4)}`,
          dataset,
          JSON.stringify({ dataset, columns: ["name"] }),
        ];
        try {
          const arjunReport = (
            await admin.query<{ id: string }>(
              "SELECT id FROM report_definition WHERE owner_employee_id=$1 AND id=ANY($2::uuid[])",
              [arjun, savedIds],
            )
          ).rows[0]!.id;
          // Another owner's rows are invisible and unchangeable.
          const seen = await scoped(pool, hr, (c) =>
            c.query("SELECT id FROM report_definition WHERE id=$1", [
              arjunReport,
            ]),
          );
          assert.equal(seen.rowCount, 0);
          const changed = await scoped(pool, hr, (c) =>
            c.query(
              "UPDATE report_definition SET name='Taken over', version=version+1 WHERE id=$1",
              [arjunReport],
            ),
          );
          assert.equal(changed.rowCount, 0);
          await assert.rejects(
            scoped(pool, hr, (c) => c.query(insert, values(arjun))),
            /row-level security|own saved/,
          );
          // People without reporting cannot save; team scope cannot save HR-only datasets.
          await assert.rejects(
            scoped(pool, { ...actor, role: "employee" }, (c) =>
              c.query(insert, values(actor.employeeId)),
            ),
            /row-level security|own saved/,
          );
          await assert.rejects(
            scoped(pool, arjunManager, (c) =>
              c.query(insert, values(arjun, "exits")),
            ),
            /not available/,
          );
          // Only the granted columns, and only through a version step.
          await assert.rejects(
            scoped(pool, arjunManager, (c) =>
              c.query(
                "UPDATE report_definition SET owner_employee_id=$2, version=version+1 WHERE id=$1",
                [arjunReport, actor.employeeId],
              ),
            ),
            /permission denied/,
          );
          await assert.rejects(
            scoped(pool, arjunManager, (c) =>
              c.query(
                "UPDATE report_definition SET name='No version' WHERE id=$1",
                [arjunReport],
              ),
            ),
            /own actions/,
          );
          await assert.rejects(
            scoped(pool, arjunManager, (c) =>
              c.query(
                `UPDATE report_definition SET definition='{"dataset":"leave","columns":["name"]}', version=version+1 WHERE id=$1`,
                [arjunReport],
              ),
            ),
            /check constraint/,
          );
          // Nothing is ever deleted, even by the migration owner.
          await assert.rejects(
            scoped(pool, arjunManager, (c) =>
              c.query("DELETE FROM report_definition WHERE id=$1", [
                arjunReport,
              ]),
            ),
            /permission denied/,
          );
          await assert.rejects(
            admin.query("DELETE FROM report_definition WHERE id=$1", [
              arjunReport,
            ]),
            /never deleted/,
          );
        } finally {
          await pool.end();
        }
      },
    );

    await t.test(
      "a saved report the current role cannot run is listed by name only",
      async () => {
        // Free one slot under the 50-report cap filled earlier.
        await reports.archive(
          { ...actor, role: "manager" },
          savedIds[savedIds.length - 1]!,
          { version: 1 },
          randomUUID(),
        );
        await changeRole("hr_admin");
        const created = await send("/reports/saved", "POST", {
          name: `Exits ${run}`,
          definition: {
            dataset: "exits",
            columns: ["status"],
            filters: [
              { column: "reason", op: "contains", value: `secret ${run}` },
            ],
          },
        });
        assert.equal(created.status, 201, await created.clone().text());
        const exits = (await created.json()) as SavedReport;
        savedIds.push(exits.id);
        assert.equal(exits.runnable, true);
        await changeRole("manager");
        const list = (await (
          await request("/reports/saved")
        ).json()) as SavedReportList;
        const item = list.items.find((i) => i.id === exits.id)!;
        assert.equal(item.runnable, false);
        assert.equal(item.definition, null);
        assert.equal(item.dataset, "exits");
        assert.ok(!JSON.stringify(list).includes(`secret ${run}`));
      },
    );

    await t.test(
      "HR reports keep exited employees and follow department merges",
      async () => {
        const hr = { ...actor, role: "hr_admin" as const };
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const units = await admin.query<{ id: string }>(
            `INSERT INTO org_unit SELECT (jsonb_populate_record(NULL::org_unit,
              to_jsonb(o) || jsonb_build_object('id',$2::uuid,'code',$3::text,'name',$4::text,'version',1))).*
           FROM org_unit o WHERE o.id=(SELECT department_id FROM employee WHERE id=$1)
           RETURNING id`,
            [rohan, synthetic.source, `RPT${run}S`, `Reports ${run} source`],
          );
          await admin.query(
            `INSERT INTO org_unit SELECT (jsonb_populate_record(NULL::org_unit,
              to_jsonb(o) || jsonb_build_object('id',$2::uuid,'code',$3::text,'name',$4::text,'version',1))).*
           FROM org_unit o WHERE o.id=$1`,
            [
              units.rows[0]!.id,
              synthetic.target,
              `RPT${run}T`,
              `Reports ${run} target`,
            ],
          );
          await transaction(admin, async (client) => {
            await client.query("SET LOCAL session_replication_role = replica");
            await client.query(
              "INSERT INTO person SELECT (jsonb_populate_record(NULL::person, to_jsonb(p) || jsonb_build_object('id',$2::uuid,'name',$3::text))).* FROM person p WHERE p.id=(SELECT person_id FROM employee WHERE id=$1)",
              [rohan, synthetic.person, `Former ${run}`],
            );
            await client.query(
              `INSERT INTO employee(id,tenant_id,entity_id,code,title,email,joined_on,status,manager_id,person_id,department_id,location_id)
             SELECT $2,tenant_id,entity_id,$3,title,$4,joined_on,'inactive',NULL,$5,$6,location_id
             FROM employee WHERE id=$1`,
              [
                rohan,
                synthetic.employee,
                synthetic.code,
                `former-${run.toLowerCase()}@anvi.example`,
                synthetic.person,
                synthetic.source,
              ],
            );
            await client.query(
              `INSERT INTO exit_case(id,tenant_id,entity_id,employee_id,kind,reason,notice_given_on,last_working_day,status,version,
               submitted_by_label,decided_at,decided_by_label,closed_at,closed_by_label)
             VALUES ($1,$2,$3,$4,'resignation','Synthetic exit',current_date-40,current_date-10,'completed',3,'HR',now(),'HR',now(),'HR')`,
              [
                synthetic.exit,
                actor.tenantId,
                actor.entityId,
                synthetic.employee,
              ],
            );
            await client.query(
              `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,days,reason,state,approver,
               version,requested_by_actor,decided_at,decided_by_label)
             SELECT $1,$2,$3,$4,id,make_date(date_part('year',current_date)::int,1,5),make_date(date_part('year',current_date)::int,1,5),1,
               'Synthetic leave','approved','hr',2,$5,now(),'HR'
             FROM leave_type WHERE entity_id=$3 ORDER BY code LIMIT 1`,
              [
                synthetic.leave,
                actor.tenantId,
                actor.entityId,
                synthetic.employee,
                actor.actorId,
              ],
            );
          });
          // HR merges the department away: the former employee moves to the target.
          await scoped(pool, hr, (c) =>
            c.query("SELECT merge_org_units($1,$2,1,1)", [
              synthetic.source,
              synthetic.target,
            ]),
          );
          await changeRole("hr_admin");
          for (const dataset of ["exits", "leave"]) {
            const result = await ok({
              dataset,
              columns: ["employeeName", "employeeCode", "department"],
              filters: [
                { column: "employeeCode", op: "eq", value: synthetic.code },
              ],
            });
            assert.deepEqual(
              result.rows,
              [[`Former ${run}`, synthetic.code, `Reports ${run} target`]],
              dataset,
            );
          }
        } finally {
          await pool.end();
        }
      },
    );

    await t.test(
      "on-screen runs are rate limited per person, after validation",
      async () => {
        await resetReportLimits();
        await changeRole("hr_admin");
        // Refused definitions never spend the budget.
        for (let i = 0; i < 5; i++)
          assert.equal(
            (await runReport({ dataset: "people", columns: ["salary"] }))
              .status,
            400,
          );
        let limitedAt = 0;
        for (let i = 1; i <= 61 && !limitedAt; i++) {
          const response = await runReport({
            dataset: "people",
            columns: ["code"],
            limit: 1,
          });
          if (response.status === 429) limitedAt = i;
          else assert.equal(response.status, 200);
          await response.arrayBuffer();
        }
        assert.equal(limitedAt, 61);
        await resetReportLimits();
      },
    );

    await t.test("exports are rate limited per person", async () => {
      await resetReportLimits();
      await changeRole("hr_admin");
      let limited: Response | undefined;
      for (let i = 0; i < 11 && !limited; i++) {
        const response = await send("/reports/export", "POST", {
          definition: { dataset: "people", columns: ["code"], limit: 1 },
        });
        if (response.status === 429) limited = response;
        else assert.equal(response.status, 200);
        if (!limited) await response.arrayBuffer();
      }
      assert.ok(limited, "expected a 429 within 11 exports");
      assert.equal(
        limited.headers.get("content-type"),
        "application/problem+json; charset=utf-8",
      );
      assert.match(
        ((await limited.json()) as { title: string }).title,
        /Too many exports/,
      );
      // Running on screen is not export-limited.
      await ok({ dataset: "people", columns: ["code"], limit: 1 });
      // Neither a role switch nor a brand-new session resets the person's budget.
      await changeRole("manager");
      await changeRole("hr_admin");
      const exportOnce = () =>
        send("/reports/export", "POST", {
          definition: { dataset: "people", columns: ["code"], limit: 1 },
        });
      assert.equal((await exportOnce()).status, 429);
      token = await store.createSession(
        { ...actor, role: "hr_admin" },
        randomUUID(),
      );
      session = await store.session(token);
      assert.equal((await exportOnce()).status, 429);
    });
  } finally {
    // Synthetic cleanup only: saved reports and history are never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[]) OR (event_type LIKE 'report.%' AND occurred_at>=$2)",
        [[...savedIds, ...claims], started],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[]) OR (action LIKE 'report.%' AND occurred_at>=$2)",
        [
          [
            ...savedIds.map((id) => `report:${id}`),
            ...claims.map((id) => `expense:${id}`),
          ],
          started,
        ],
      );
      await client.query(
        `DELETE FROM report_definition WHERE id=ANY($1::uuid[]) OR (created_at>=$2 AND name LIKE $3)`,
        [savedIds, started, `%${run}%`],
      );
      await client.query("DELETE FROM leave_request WHERE id=$1", [
        synthetic.leave,
      ]);
      await client.query("DELETE FROM exit_case WHERE id=$1", [synthetic.exit]);
      await client.query("DELETE FROM employee WHERE id=$1", [
        synthetic.employee,
      ]);
      await client.query("DELETE FROM person WHERE id=$1", [synthetic.person]);
      await client.query("DELETE FROM org_unit WHERE id=ANY($1::uuid[])", [
        [synthetic.source, synthetic.target],
      ]);
      await client.query("DELETE FROM expense_claim WHERE id=ANY($1::uuid[])", [
        claims,
      ]);
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
