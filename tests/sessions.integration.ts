import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makePool, purgeStaleSessions } from "../packages/database/src/index";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.AUTH_MODE !== "demo"
) {
  throw new Error(
    "Integration tests require the synthetic development/demo database",
  );
}
for (const name of ["MIGRATION_DATABASE_URL", "WORKER_DATABASE_URL"]) {
  const url = new URL(process.env[name] ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "55432")
    throw new Error("Integration tests require the local Compose database");
}

const binding = "40000000-0000-4000-8000-000000000001";

await test("Stale session cleanup", async (t) => {
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const worker = makePool(process.env.WORKER_DATABASE_URL!);
  const prefix = `cleanup-${randomUUID()}`;
  const hash = (name: string) => `${prefix}-${name}`;
  try {
    // Fresh, expired, idle employee (31 min) and idle HR (16 min) sessions.
    for (const [name, role, expires, seen] of [
      ["fresh", "employee", "1 hour", "0 minutes"],
      ["expired", "employee", "-1 minute", "0 minutes"],
      ["idle-employee", "employee", "1 hour", "31 minutes"],
      ["idle-hr", "hr_admin", "1 hour", "16 minutes"],
      ["active-hr", "hr_admin", "1 hour", "5 minutes"],
    ] as const)
      await admin.query(
        `INSERT INTO app_session(token_hash,actor_id,role,csrf_token,expires_at,last_seen_at)
         VALUES ($1,$2,$3,'csrf',now()+$4::interval,now()-$5::interval)`,
        [hash(name), binding, role, expires, seen],
      );
    await admin.query(
      `INSERT INTO oidc_attempt(token_hash,verifier,state,nonce,expires_at)
       VALUES ($1,'v','s','n',now()-interval '1 minute')`,
      [hash("attempt")],
    );

    await t.test(
      "the worker purges only sessions sign-in would refuse",
      async () => {
        const purged = await purgeStaleSessions(worker);
        assert.ok(purged.sessions >= 3);
        assert.ok(purged.attempts >= 1);
        const left = await admin.query<{ token_hash: string }>(
          "SELECT token_hash FROM app_session WHERE token_hash LIKE $1 ORDER BY token_hash",
          [`${prefix}%`],
        );
        assert.deepEqual(
          left.rows.map((r) => r.token_hash),
          [hash("active-hr"), hash("fresh")],
        );
      },
    );

    await t.test("the worker has no direct access to sessions", async () => {
      await assert.rejects(
        worker.query("DELETE FROM app_session WHERE token_hash=$1", [
          hash("fresh"),
        ]),
        /permission denied/,
      );
    });
  } finally {
    await admin.query("DELETE FROM app_session WHERE token_hash LIKE $1", [
      `${prefix}%`,
    ]);
    await admin.query("DELETE FROM oidc_attempt WHERE token_hash LIKE $1", [
      `${prefix}%`,
    ]);
    await Promise.all([admin.end(), worker.end()]);
  }
});
