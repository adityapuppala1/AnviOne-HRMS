import { test } from "node:test";
import assert from "node:assert/strict";
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
for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  )
    throw new Error("Integration tests require the local Compose database");
}

// Run `pnpm demo:personas` first (db:seed runs it). Expected roles per persona.
const expected = {
  maya: {
    name: "Maya Iyer",
    roles: ["hr_admin", "employee", "manager", "platform_admin", "auditor"],
  },
  employee: { name: "Aarav Shah", roles: ["employee"] },
  manager: { name: "Neel Rao", roles: ["manager"] },
  hr: { name: "Kabir Sethi", roles: ["hr_admin"] },
  auditor: { name: "Diya Kapoor", roles: ["auditor"] },
  platform: { name: "Ishaan Roy", roles: ["platform_admin"] },
} as const;
const hrOnly = [
  "organization.read",
  "organization.write",
  "onboarding.manage",
  "report.run",
  "report.export",
  "profile.review",
  "exit.manage",
];

await test("Demo personas sign in with exactly their own roles", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4514" });
  const { app } = await createApp(config);
  await app.listen(4514, "127.0.0.1");
  const base = "http://127.0.0.1:4514/api/v1";
  const signIn = (body?: unknown) =>
    fetch(`${base}/auth/demo`, {
      method: "POST",
      headers: {
        Origin: config.APP_ORIGIN,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const me = async (response: Response) => {
    assert.equal(response.status, 201);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    return (await (
      await fetch(`${base}/me`, { headers: { Cookie: cookie } })
    ).json()) as { name: string; roles: string[]; permissions: string[] };
  };
  try {
    await t.test("the personas list carries names and roles only", async () => {
      const response = await fetch(`${base}/auth/demo/personas`);
      assert.equal(response.status, 200);
      const list = (await response.json()) as Record<string, unknown>[];
      assert.deepEqual(
        list.map((p) => p.key),
        Object.keys(expected),
      );
      for (const item of list) {
        assert.deepEqual(Object.keys(item).sort(), [
          "key",
          "name",
          "roles",
          "summary",
          "title",
        ]);
        const want = expected[item.key as keyof typeof expected];
        assert.equal(item.name, want.name);
        assert.deepEqual(item.roles, want.roles);
      }
    });
    await t.test("no body still signs in as Maya", async () => {
      const profile = await me(await signIn());
      assert.equal(profile.name, "Maya Iyer");
      assert.equal(profile.roles.length, 5);
    });
    for (const [key, want] of Object.entries(expected))
      await t.test(`${key} sees only its roles and permissions`, async () => {
        const profile = await me(await signIn({ persona: key }));
        assert.equal(profile.name, want.name);
        assert.deepEqual(profile.roles, want.roles);
        const p = profile.permissions;
        if (key === "employee") {
          assert.ok(p.includes("leave.request"));
          for (const hr of [...hrOnly, "leave.approve", "audit.read"])
            assert.ok(!p.includes(hr), hr);
        }
        if (key === "manager") {
          assert.ok(p.includes("leave.approve") && p.includes("report.run"));
          for (const hr of hrOnly.filter((x) => x !== "report.run"))
            assert.ok(!p.includes(hr), hr);
        }
        if (key === "hr")
          for (const hr of hrOnly) assert.ok(p.includes(hr), hr);
        if (key === "auditor")
          assert.deepEqual([...p].sort(), ["admin.read", "audit.read"]);
        if (key === "platform")
          assert.deepEqual([...p].sort(), ["admin.read", "branding.write"]);
      });
    await t.test("unknown personas and extra fields are refused", async () => {
      assert.equal((await signIn({ persona: "ceo" })).status, 400);
      assert.equal(
        (await signIn({ persona: "employee", role: "hr_admin" })).status,
        400,
      );
    });
  } finally {
    await app.close();
  }
});

await test("Demo personas do not exist outside demo mode", async () => {
  const config = readConfig({
    ...process.env,
    API_PORT: "4515",
    AUTH_MODE: "oidc",
    OIDC_ISSUER: "https://login.example.com/tenant-id/v2.0",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    OIDC_REDIRECT_URI: "http://127.0.0.1:5173/api/v1/auth/callback",
  });
  const { app } = await createApp(config);
  await app.listen(4515, "127.0.0.1");
  try {
    const base = "http://127.0.0.1:4515/api/v1";
    assert.equal((await fetch(`${base}/auth/demo/personas`)).status, 404);
    const post = await fetch(`${base}/auth/demo`, {
      method: "POST",
      headers: {
        Origin: config.APP_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ persona: "hr" }),
    });
    assert.equal(post.status, 403);
  } finally {
    await app.close();
  }
});
