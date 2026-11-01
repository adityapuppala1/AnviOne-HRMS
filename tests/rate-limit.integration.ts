import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "redis";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.AUTH_MODE !== "demo"
) {
  throw new Error(
    "Integration tests require the synthetic development/demo database",
  );
}
const url = new URL(process.env.RATE_LIMIT_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "56379")
  throw new Error("Integration tests require the local Compose Valkey");

// Counters are keyed by client address; every local test shares 127.0.0.1.
async function clearCounters() {
  const client = createClient({ url: process.env.RATE_LIMIT_URL });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({ MATCH: "anvione:rl:*" }))
      if (keys.length) await client.del(keys);
  } finally {
    await client.quit();
  }
}

await test("Rate limits are shared across API replicas", async (t) => {
  await clearCounters();
  const replicas = await Promise.all(
    [4482, 4483].map(async (port) => {
      const { app } = await createApp(
        readConfig({ ...process.env, API_PORT: String(port) }),
      );
      await app.listen(port, "127.0.0.1");
      return { app, port };
    }),
  );
  const call = (port: number) =>
    fetch(`http://127.0.0.1:${port}/api/v1/auth/config`).then((r) => r.status);
  try {
    await t.test("the auth budget of 20 spans both replicas", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 10; i++)
        for (const { port } of replicas) statuses.push(await call(port));
      assert.deepEqual(new Set(statuses), new Set([200]));
      assert.equal(await call(4482), 429);
      assert.equal(await call(4483), 429);
    });

    await t.test(
      "an unresponsive store fails sign-in closed and ordinary calls open",
      async () => {
        await clearCounters();
        execFileSync("docker", ["pause", "anvione-dev-valkey-1"]);
        try {
          const signIn = await fetch(
            "http://127.0.0.1:4482/api/v1/auth/config",
          );
          assert.equal(signIn.status, 503);
          assert.equal(signIn.headers.get("retry-after"), "30");
          assert.match(
            signIn.headers.get("content-type") ?? "",
            /problem\+json/,
          );
          assert.equal(
            (await fetch("http://127.0.0.1:4482/healthz")).status,
            200,
          );
        } finally {
          execFileSync("docker", ["unpause", "anvione-dev-valkey-1"]);
        }
      },
    );

    await t.test("a startup with an unusable store is refused", async () => {
      const wrong = new URL(process.env.RATE_LIMIT_URL!);
      wrong.password = "not-the-password";
      await assert.rejects(
        createApp(
          readConfig({
            ...process.env,
            API_PORT: "4484",
            RATE_LIMIT_URL: wrong.href,
          }),
        ),
      );
    });
  } finally {
    await Promise.all(replicas.map(({ app }) => app.close()));
    // Leave the budget clean so later suites can sign in.
    await clearCounters();
  }
});
