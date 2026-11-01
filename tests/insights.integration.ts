import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import type {
  Directory,
  Insights,
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
const database = new URL(process.env.DATABASE_URL ?? "");
if (
  database.hostname !== "127.0.0.1" ||
  database.port !== "55432" ||
  database.pathname !== "/anvione"
)
  throw new Error("Integration tests require the local Compose database");

const sum = (items: { count: number }[]) =>
  items.reduce((total, item) => total + item.count, 0);

await test("Workforce insights respect each role's scope", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4485" });
  const { app, store } = await createApp(config);
  await app.listen(4485, "127.0.0.1");
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const get = (path: string, cookie = token) =>
    fetch(`http://127.0.0.1:4485/api/v1${path}`, {
      headers: { Cookie: `anvi_dev_session=${cookie}` },
    });
  async function changeRole(role: Role) {
    const response = await fetch(
      "http://127.0.0.1:4485/api/v1/session/role-context",
      {
        method: "POST",
        headers: {
          Cookie: `anvi_dev_session=${token}`,
          Origin: config.APP_ORIGIN,
          "X-CSRF-Token": session.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      },
    );
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  const insights = async () => {
    const response = await get("/insights");
    assert.equal(response.status, 200);
    return (await response.json()) as Insights;
  };
  const directoryTotal = async () =>
    ((await (await get("/employees?limit=1")).json()) as Directory).total;

  try {
    await t.test("anonymous callers are refused", async () => {
      const response = await fetch("http://127.0.0.1:4485/api/v1/insights");
      assert.equal(response.status, 401);
    });

    await t.test(
      "HR sees organization-wide, internally consistent counts",
      async () => {
        await changeRole("hr_admin");
        const view = await insights();
        assert.equal(view.scope, "entity");
        assert.equal(view.people.total, await directoryTotal());
        assert.equal(sum(view.people.byDepartment), view.people.total);
        assert.equal(sum(view.people.byLocation), view.people.total);
        assert.equal(view.people.joinersByMonth.length, 6);
        assert.equal(view.leave.byMonth.length, 12);
        assert.equal(view.attendance.days.length, 14);
        assert.equal(view.attendance.headcount, view.people.total);
        assert.equal(view.leave.year, Number(view.today.slice(0, 4)));
        const monthly = view.leave.byMonth.reduce((n, m) => n + m.value, 0);
        assert.ok(Math.abs(monthly - view.leave.daysApproved) < 0.01);
      },
    );

    await t.test("a manager sees only their team", async () => {
      await changeRole("hr_admin");
      const organization = (await insights()).people.total;
      await changeRole("manager");
      const view = await insights();
      assert.equal(view.scope, "team");
      assert.equal(view.people.total, await directoryTotal());
      assert.ok(view.people.total <= organization);
    });

    await t.test(
      "employees, auditors and platform admins are refused",
      async () => {
        for (const role of ["employee", "auditor", "platform_admin"] as const) {
          await changeRole(role);
          assert.equal((await get("/insights")).status, 403, role);
        }
      },
    );

    await t.test("the response carries counts only, never people", async () => {
      await changeRole("hr_admin");
      const text = JSON.stringify(await insights());
      for (const key of ["email", "employeeId", "code", "initials", "title"])
        assert.ok(!text.includes(`"${key}"`), key);
    });
  } finally {
    await app.close();
    await store.pool.end();
  }
});
