import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import {
  makePool,
  scoped,
  transaction,
  drainOutbox,
} from "../packages/database/src/index";
import { hash } from "../apps/api/src/platform.store";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.AUTH_MODE !== "demo"
) {
  throw new Error(
    "Integration tests require the synthetic development/demo database",
  );
}
for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "WORKER_DATABASE_URL",
]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  ) {
    throw new Error("Integration tests require the local Compose database");
  }
}

await test("PostgreSQL and HTTP security boundaries", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4401" });
  const { app, store } = await createApp(config);
  await app.listen(4401, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const worker = makePool(process.env.WORKER_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  const base = "http://127.0.0.1:4401";
  let cookie = "",
    csrf = "";
  const request = (path: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        Cookie: cookie,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": csrf,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  const capture = async (response: Response) => {
    const header = response.headers.get("set-cookie");
    if (header) cookie = header.split(";")[0]!;
    const me = await (await request("/api/v1/me")).json();
    csrf = me.csrfToken;
    return me;
  };
  try {
    await t.test(
      "unauthenticated requests and unknown identities are rejected",
      async () => {
        assert.equal((await request("/api/v1/employees")).status, 401);
        await assert.rejects(
          store.resolveIdentity("urn:anvione:local-demo", "unapproved"),
        );
        assert.equal(
          (await request("/api/v1/signup", { method: "POST" })).status,
          404,
        );
      },
    );
    await t.test(
      "login is origin checked and issues an HttpOnly host-only session",
      async () => {
        assert.equal(
          (
            await request("/api/v1/auth/demo", {
              method: "POST",
              headers: { Origin: "https://attacker.example" },
            })
          ).status,
          403,
        );
        const response = await request("/api/v1/auth/demo", { method: "POST" });
        assert.equal(response.status, 201);
        assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
        assert.doesNotMatch(response.headers.get("set-cookie")!, /Domain=/i);
        assert.equal((await capture(response)).role, "hr_admin");
      },
    );
    await t.test(
      "directory validates queries and never reveals another entity",
      async () => {
        const response = await request("/api/v1/employees");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const data = await response.json();
        assert.equal(data.total, 12);
        assert.equal(
          data.items.some(
            (p: { name: string }) => p.name === "Isolation fixture",
          ),
          false,
        );
        assert.equal(
          (
            await request(
              "/api/v1/employees/30000000-0000-4000-8000-000000000099",
            )
          ).status,
          404,
        );
        assert.equal(
          (await request("/api/v1/employees?limit=50000")).status,
          400,
        );
        assert.equal(
          (await (await request("/api/v1/employees?q=%25")).json()).total,
          0,
        );
      },
    );
    await t.test(
      "tenant context is transaction-local and RLS fails closed",
      async () => {
        assert.equal(
          (await store.pool.query("SELECT * FROM employee")).rowCount,
          0,
        );
        assert.equal(
          await scoped(
            store.pool,
            actor,
            async (c) => (await c.query("SELECT * FROM employee")).rowCount,
          ),
          12,
        );
        assert.equal(
          (await store.pool.query("SELECT * FROM employee")).rowCount,
          0,
        );
        assert.equal(
          await scoped(
            store.pool,
            { ...actor, tenantId: randomUUID() },
            async (c) => (await c.query("SELECT * FROM employee")).rowCount,
          ),
          0,
        );
        await assert.rejects(
          store.pool.query("SELECT * FROM identity_binding"),
        );
        await assert.rejects(worker.query("SELECT * FROM employee"));
      },
    );
    await t.test("CSRF and origin checks protect mutations", async () => {
      const body = JSON.stringify({ role: "employee" });
      assert.equal(
        (
          await request("/api/v1/session/role-context", {
            method: "POST",
            body,
            headers: { "X-CSRF-Token": "wrong" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/v1/session/role-context", {
            method: "POST",
            body,
            headers: { Origin: "https://attacker.example" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/api/v1/session/role-context", {
            method: "POST",
            body: JSON.stringify({ role: "root" }),
          })
        ).status,
        400,
      );
    });
    await t.test(
      "switching reduces API scope and invalidates the previous session",
      async () => {
        const previous = cookie;
        await capture(
          await request("/api/v1/session/role-context", {
            method: "POST",
            body: JSON.stringify({ role: "employee" }),
          }),
        );
        assert.equal(
          (await (await request("/api/v1/employees")).json()).total,
          1,
        );
        assert.equal(
          (
            await request(
              "/api/v1/employees/30000000-0000-4000-8000-000000000002",
            )
          ).status,
          404,
        );
        assert.equal((await request("/api/v1/audit-events")).status, 403);
        assert.equal(
          (await request("/api/v1/me", { headers: { Cookie: previous } }))
            .status,
          401,
        );
        await capture(
          await request("/api/v1/session/role-context", {
            method: "POST",
            body: JSON.stringify({ role: "manager" }),
          }),
        );
        assert.equal(
          (await (await request("/api/v1/employees")).json()).total,
          4,
        );
      },
    );
    await t.test(
      "branding enforces permission, version checks, and atomic audit/outbox writes",
      async () => {
        const current = await store.branding(actor);
        assert.equal(
          (
            await request("/api/v1/branding/active", {
              method: "PUT",
              body: JSON.stringify(current),
            })
          ).status,
          403,
        );
        await capture(
          await request("/api/v1/session/role-context", {
            method: "POST",
            body: JSON.stringify({ role: "platform_admin" }),
          }),
        );
        assert.equal((await request("/api/v1/employees")).status, 403);
        const response = await request("/api/v1/branding/active", {
          method: "PUT",
          body: JSON.stringify(current),
        });
        assert.equal(response.status, 200);
        const updated = await response.json();
        assert.equal(updated.version, current.version + 1);
        assert.equal(
          (
            await request("/api/v1/branding/active", {
              method: "PUT",
              body: JSON.stringify(current),
            })
          ).status,
          409,
        );
        const auditResult = await admin.query(
          "SELECT 1 FROM audit_event WHERE action=$1 AND target=$2",
          ["branding.published", `branding:v${updated.version}`],
        );
        assert.equal(auditResult.rowCount, 1);
        const event = await admin.query(
          "SELECT 1 FROM outbox_event WHERE aggregate_version=$1 AND event_type='branding.published.v1' AND aggregate_id=$2",
          [updated.version, actor.entityId],
        );
        assert.equal(event.rowCount, 1);
      },
    );
    await t.test(
      "mandatory audit failure rolls back the branding update",
      async () => {
        const before = await store.branding(actor);
        await admin.query("REVOKE INSERT ON audit_event FROM anvione_app");
        try {
          assert.equal(
            (
              await request("/api/v1/branding/active", {
                method: "PUT",
                body: JSON.stringify({
                  ...before,
                  platformName: "Must not persist",
                }),
              })
            ).status,
            500,
          );
          assert.deepEqual(await store.branding(actor), before);
        } finally {
          await admin.query("GRANT INSERT ON audit_event TO anvione_app");
        }
      },
    );
    await t.test(
      "runtime audit updates and deletes are prohibited",
      async () => {
        await assert.rejects(
          scoped(store.pool, actor, (c) =>
            c.query("UPDATE audit_event SET action='tampered'"),
          ),
        );
        await assert.rejects(
          scoped(store.pool, actor, (c) => c.query("DELETE FROM audit_event")),
        );
      },
    );
    await t.test(
      "concurrent outbox workers receipt once and replay is harmless",
      async () => {
        await Promise.all([drainOutbox(worker), drainOutbox(worker)]);
        assert.equal(await drainOutbox(worker), 0);
        const result = await admin.query(
          "SELECT count(*)::int AS missing FROM outbox_event o LEFT JOIN event_receipt r ON r.event_id=o.id WHERE r.event_id IS NULL OR o.processed_at IS NULL",
        );
        assert.equal(result.rows[0].missing, 0);
      },
    );
    await t.test(
      "deactivation revokes existing access immediately",
      async () => {
        await admin.query(
          "UPDATE identity_binding SET active=false WHERE id=$1",
          [actor.actorId],
        );
        try {
          assert.equal((await request("/api/v1/me")).status, 401);
        } finally {
          await admin.query(
            "UPDATE identity_binding SET active=true WHERE id=$1",
            [actor.actorId],
          );
        }
      },
    );
    await t.test("an ungranted role cannot be selected", async () => {
      await admin.query(
        "UPDATE identity_binding SET roles=ARRAY['platform_admin'] WHERE id=$1",
        [actor.actorId],
      );
      try {
        assert.equal(
          (
            await request("/api/v1/session/role-context", {
              method: "POST",
              body: JSON.stringify({ role: "auditor" }),
            })
          ).status,
          403,
        );
      } finally {
        await admin.query("UPDATE identity_binding SET roles=$1 WHERE id=$2", [
          actor.roles,
          actor.actorId,
        ]);
      }
    });
    await t.test(
      "absolute expiry cannot be extended with a role switch",
      async () => {
        const currentHash = hash(cookie.split("=")[1]!);
        const original = await admin.query(
          "SELECT expires_at FROM app_session WHERE token_hash=$1",
          [currentHash],
        );
        await capture(
          await request("/api/v1/session/role-context", {
            method: "POST",
            body: JSON.stringify({ role: "auditor" }),
          }),
        );
        const next = await admin.query(
          "SELECT expires_at FROM app_session WHERE token_hash=$1",
          [hash(cookie.split("=")[1]!)],
        );
        assert.equal(
          next.rows[0].expires_at.toISOString(),
          original.rows[0].expires_at.toISOString(),
        );
        assert.equal((await request("/api/v1/audit-events")).status, 200);
        assert.equal(
          (await request("/api/v1/auth/logout", { method: "POST" })).status,
          201,
        );
        assert.equal((await request("/api/v1/me")).status, 401);
      },
    );
    await t.test(
      "rolled-back work cannot leak connection context",
      async () => {
        await assert.rejects(
          transaction(store.pool, async (c) => {
            await c.query("SELECT set_config('app.tenant_id',$1,true)", [
              actor.tenantId,
            ]);
            throw new Error("rollback");
          }),
        );
        assert.equal(
          (await store.pool.query("SELECT * FROM employee")).rowCount,
          0,
        );
      },
    );
  } finally {
    await app.close();
    await Promise.all([store.pool.end(), admin.end(), worker.end()]);
  }
});
