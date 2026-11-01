import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { hash } from "../apps/api/src/platform.store";
import { makePool } from "../packages/database/src/index";
import type { Role } from "../packages/contracts/src/index";

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

await test("Idle sessions expire, and background polling never extends them", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4488" });
  const { app, store } = await createApp(config);
  await app.listen(4488, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:4488/api/v1${path}`, {
      headers: { Cookie: `anvi_dev_session=${token}`, ...headers },
    });
  async function changeRole(role: Role) {
    const response = await fetch(
      "http://127.0.0.1:4488/api/v1/session/role-context",
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
  const lastSeen = async () =>
    (
      await admin.query<{ seconds: number }>(
        "SELECT extract(epoch FROM now() - last_seen_at)::float8 AS seconds FROM app_session WHERE token_hash=$1",
        [hash(token)],
      )
    ).rows[0]!.seconds;
  const setIdle = (minutes: number) =>
    admin.query(
      "UPDATE app_session SET last_seen_at = now() - ($2 || ' minutes')::interval WHERE token_hash=$1",
      [hash(token), String(minutes)],
    );

  try {
    await t.test("the portal is told each role's idle limit", async () => {
      await changeRole("employee");
      let me = (await (await get("/me")).json()) as {
        idleLimitSeconds: number;
      };
      assert.equal(me.idleLimitSeconds, 1800);
      await changeRole("hr_admin");
      me = (await (await get("/me")).json()) as { idleLimitSeconds: number };
      assert.equal(me.idleLimitSeconds, 900);
    });

    await t.test(
      "a request marked idle validates the session but does not refresh it",
      async () => {
        await changeRole("employee");
        await setIdle(10);
        const before = await lastSeen();
        assert.ok(before > 590, "planted ten idle minutes");
        assert.equal((await get("/me", { "X-Anvi-Idle": "1" })).status, 200);
        const after = await lastSeen();
        assert.ok(after >= before, "an idle poll must not refresh the clock");
        // A normal request is activity and refreshes it.
        assert.equal((await get("/me")).status, 200);
        assert.ok((await lastSeen()) < 5, "a normal request refreshes it");
      },
    );

    await t.test(
      "polling alone cannot keep a session past its limit",
      async () => {
        await changeRole("employee");
        await setIdle(31);
        assert.equal((await get("/me", { "X-Anvi-Idle": "1" })).status, 401);
        assert.equal((await get("/me")).status, 401);
        await setIdle(0);
      },
    );

    await t.test("employees and managers get 30 idle minutes", async () => {
      for (const role of ["employee", "manager"] as const) {
        await changeRole(role);
        await setIdle(29);
        assert.equal((await get("/me")).status, 200, `${role} at 29 minutes`);
        await setIdle(31);
        assert.equal((await get("/me")).status, 401, `${role} at 31 minutes`);
        await setIdle(0);
      }
    });

    await t.test(
      "HR, platform admin and auditor get 15 idle minutes",
      async () => {
        for (const role of ["hr_admin", "platform_admin", "auditor"] as const) {
          await changeRole(role);
          await setIdle(14);
          assert.equal((await get("/me")).status, 200, `${role} at 14 minutes`);
          await setIdle(16);
          assert.equal((await get("/me")).status, 401, `${role} at 16 minutes`);
          await setIdle(0);
        }
      },
    );
  } finally {
    await admin.query("DELETE FROM app_session WHERE actor_id=$1", [
      actor.actorId,
    ]);
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
