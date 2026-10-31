import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped } from "../packages/database/src/index";
import type {
  Branding,
  BrandingHistory,
  IntegrationReadiness,
  PermissionMatrix,
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

const PORT = 4509;

await test("Configuration history, rollback and read-only administration", async (t) => {
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
  const original = await store.branding(actor);
  const reason = "Synthetic configuration history check";
  try {
    await t.test("history and rollback need branding.write", async () => {
      await changeRole("hr_admin");
      assert.equal((await request("/branding/history")).status, 403);
      assert.equal(
        (
          await post("/branding/rollback", {
            toVersion: 1,
            version: original.version,
            reason,
          })
        ).status,
        403,
      );
      // Runtime reads without branding.write see no history rows (row security).
      const hidden = await scoped(
        store.pool,
        { ...actor, role: "hr_admin" },
        (c) => c.query("SELECT 1 FROM branding_history"),
      );
      assert.equal(hidden.rowCount, 0);
    });

    await t.test("baseline exists and edits record history", async () => {
      await changeRole("platform_admin");
      const baseline = await admin.query(
        "SELECT 1 FROM branding_history WHERE tenant_id=$1 AND entity_id=$2 AND source='baseline'",
        [actor.tenantId, actor.entityId],
      );
      assert.equal(baseline.rowCount, 1);
      const edited = await put("/branding/active", {
        ...original,
        platformName: "Anvi History",
        reason,
      });
      assert.equal(edited.status, 200, await edited.clone().text());
      const v1 = (await edited.json()) as Branding;
      const plain = await put("/branding/active", {
        ...v1,
        theme: v1.theme === "iris" ? "forest" : "iris",
      });
      assert.equal(plain.status, 200);
      const v2 = (await plain.json()) as Branding;
      const history = (await (
        await request("/branding/history?limit=2")
      ).json()) as BrandingHistory;
      assert.deepEqual(
        history.items.map((i) => [i.version, i.source, i.reason]),
        [
          [v2.version, "edit", null],
          [v1.version, "edit", reason],
        ],
      );
      assert.equal(history.items[1]!.platformName, "Anvi History");
      assert.equal(history.items[1]!.changedBy, actor.name);
      assert.equal(history.nextBeforeVersion, v1.version);
      const next = (await (
        await request(`/branding/history?limit=50&beforeVersion=${v1.version}`)
      ).json()) as BrandingHistory;
      assert.ok(next.items.every((i) => i.version < v1.version));
      assert.equal((await request("/branding/history?limit=51")).status, 400);
      const audit = await admin.query(
        "SELECT reason FROM audit_event WHERE action='branding.published' AND target=$1",
        [`branding:v${v1.version}`],
      );
      assert.equal(audit.rows[0].reason, reason);
      assert.equal(
        (await put("/branding/active", { ...v2, reason: "short" })).status,
        400,
      );
    });

    await t.test(
      "rollback publishes a new version and keeps history",
      async () => {
        const current = await store.branding(actor);
        const before = await admin.query(
          "SELECT version,platform_name,theme FROM branding_history WHERE tenant_id=$1 AND entity_id=$2 ORDER BY version",
          [actor.tenantId, actor.entityId],
        );
        const refuse = async (body: unknown, status: number) =>
          assert.equal((await post("/branding/rollback", body)).status, status);
        await refuse(
          { toVersion: original.version, version: current.version - 1, reason },
          409,
        );
        await refuse(
          { toVersion: current.version, version: current.version, reason },
          409,
        );
        await refuse(
          { toVersion: current.version + 50, version: current.version, reason },
          404,
        );
        await refuse(
          {
            toVersion: original.version,
            version: current.version,
            reason: "short",
          },
          400,
        );
        await refuse(
          {
            toVersion: original.version,
            version: current.version,
            reason,
            extra: 1,
          },
          400,
        );
        const response = await post("/branding/rollback", {
          toVersion: original.version,
          version: current.version,
          reason,
        });
        assert.equal(response.status, 201, await response.clone().text());
        const restored = (await response.json()) as Branding;
        assert.equal(restored.version, current.version + 1);
        assert.deepEqual(
          { ...restored, version: 0 },
          { ...original, version: 0 },
        );
        const after = await admin.query(
          "SELECT version,platform_name,theme FROM branding_history WHERE tenant_id=$1 AND entity_id=$2 ORDER BY version",
          [actor.tenantId, actor.entityId],
        );
        assert.deepEqual(after.rows.slice(0, before.rows.length), before.rows);
        const row = (
          await admin.query(
            "SELECT source,restored_version,reason FROM branding_history WHERE tenant_id=$1 AND entity_id=$2 AND version=$3",
            [actor.tenantId, actor.entityId, restored.version],
          )
        ).rows[0];
        assert.deepEqual(row, {
          source: "rollback",
          restored_version: original.version,
          reason,
        });
        const audit = (
          await admin.query(
            "SELECT reason,details FROM audit_event WHERE action='branding.rolled_back' AND target=$1",
            [`branding:v${restored.version}`],
          )
        ).rows[0];
        assert.equal(audit.reason, reason);
        assert.equal(audit.details.fromVersion, current.version);
        assert.equal(audit.details.toVersion, original.version);
        assert.ok(audit.details.fields.includes("platformName"));
        const outbox = await admin.query(
          "SELECT 1 FROM outbox_event WHERE event_type='branding.rolled_back.v1' AND aggregate_id=$1 AND aggregate_version=$2",
          [actor.entityId, restored.version],
        );
        assert.equal(outbox.rowCount, 1);
        // Values already match the target: nothing to roll back.
        await refuse(
          { toVersion: original.version, version: restored.version, reason },
          409,
        );
      },
    );

    await t.test("history is immutable", async () => {
      for (const sql of [
        "UPDATE branding_history SET reason='tampered with history'",
        "DELETE FROM branding_history",
        "INSERT INTO branding_history(tenant_id,entity_id,version,platform_name,employee_name,organization_name,theme,source,changed_by) SELECT tenant_id,entity_id,9999,'x','x','x','ocean','edit','x' FROM branding",
      ])
        await assert.rejects(
          scoped(store.pool, { ...actor, role: "platform_admin" }, (c) =>
            c.query(sql),
          ),
        );
      await assert.rejects(
        admin.query(
          "UPDATE branding_history SET reason='tampered with history'",
        ),
        /immutable/,
      );
      await assert.rejects(
        admin.query("DELETE FROM branding_history"),
        /immutable/,
      );
      // A forged rollback claim is refused by the trigger.
      await assert.rejects(
        scoped(store.pool, { ...actor, role: "platform_admin" }, async (c) => {
          await c.query(
            "SELECT set_config('app.branding_source','rollback',true), set_config('app.branding_restored_version','1',true)",
          );
          await c.query(
            "UPDATE branding SET platform_name='Forged rollback', version=version+1",
          );
        }),
      );
    });

    await t.test("no-op updates and long labels are tolerated", async () => {
      const count = async () =>
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM branding_history WHERE tenant_id=$1 AND entity_id=$2",
            [actor.tenantId, actor.entityId],
          )
        ).rows[0].n as number;
      const before = await count();
      await scoped(store.pool, { ...actor, role: "platform_admin" }, (c) =>
        c.query("UPDATE branding SET theme=theme"),
      );
      assert.equal(await count(), before);
      const now = await store.branding(actor);
      await store.updateBranding(
        { ...actor, role: "platform_admin", name: "L".repeat(400) },
        { ...now, platformName: "Anvi Long Label" },
        randomUUID(),
      );
      const row = (
        await admin.query(
          "SELECT char_length(changed_by) AS n FROM branding_history WHERE tenant_id=$1 AND entity_id=$2 AND version=$3",
          [actor.tenantId, actor.entityId, now.version + 1],
        )
      ).rows[0];
      assert.equal(row.n, 200);
      // A stale write surfaces as a generic 409.
      await assert.rejects(
        store.updateBranding(
          { ...actor, role: "platform_admin" },
          { ...now, platformName: "Anvi Forged" },
          randomUUID(),
        ),
        (e: Error) =>
          e.name === "ConflictException" &&
          !/version at a time/.test(e.message),
      );
    });

    await t.test("permission matrix mirrors the authz policy", async () => {
      for (const role of ["employee", "manager", "hr_admin"] as const) {
        await changeRole(role);
        assert.equal((await request("/admin/permissions")).status, 403);
        assert.equal((await request("/admin/integrations")).status, 403);
      }
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        const response = await request("/admin/permissions");
        assert.equal(response.status, 200);
        const matrix = (await response.json()) as PermissionMatrix;
        assert.equal(matrix.source, "code");
        const grants = (p: string) =>
          matrix.permissions.find((x) => x.permission === p)!.grants;
        assert.deepEqual(grants("admin.read"), [
          { role: "platform_admin", scope: "entity" },
          { role: "auditor", scope: "entity" },
        ]);
        assert.deepEqual(grants("branding.write"), [
          { role: "platform_admin", scope: "entity" },
        ]);
        assert.deepEqual(grants("directory.read"), [
          { role: "employee", scope: "self" },
          { role: "manager", scope: "team" },
          { role: "hr_admin", scope: "entity" },
        ]);
        assert.deepEqual(grants("report.export"), [
          { role: "hr_admin", scope: "entity" },
        ]);
        assert.equal(matrix.roles.length, 5);
        assert.ok(matrix.permissions.every((p) => p.description.length > 0));
      }
    });

    await t.test("integration readiness never leaks secrets", async () => {
      const response = await request("/admin/integrations");
      assert.equal(response.status, 200);
      const text = await response.text();
      const body = JSON.parse(text) as IntegrationReadiness;
      assert.equal(body.items.length, 7);
      assert.equal(body.items.find((i) => i.key === "oidc")!.status, "demo");
      assert.equal(
        body.items.find((i) => i.key === "ai_helper")!.status,
        "not_configured",
      );
      assert.ok(!text.includes("://"));
      assert.ok(!/password|secret/i.test(text));
      for (const value of [
        config.DATABASE_URL,
        config.OIDC_CLIENT_SECRET,
        config.OIDC_CLIENT_ID,
        config.PROFILE_DATA_KEY,
        config.RATE_LIMIT_URL,
        ...(config.PROFILE_DATA_KEYS ?? []).map((k) => k.hex),
      ])
        if (value) assert.ok(!text.includes(value));
      assert.ok(!/[a-f0-9]{32}/i.test(text));
    });
  } finally {
    // History is immutable by design, so test versions stay recorded; restore the values.
    const now = await store.branding(actor);
    if (
      JSON.stringify({ ...original, version: 0 }) !==
      JSON.stringify({ ...now, version: 0 })
    )
      await scoped(store.pool, { ...actor, role: "platform_admin" }, (c) =>
        c.query(
          "UPDATE branding SET platform_name=$1,employee_name=$2,organization_name=$3,theme=$4,version=version+1",
          [
            original.platformName,
            original.employeeName,
            original.organizationName,
            original.theme,
          ],
        ),
      );
    await store.pool.end();
    await admin.end();
    await app.close();
  }
});
