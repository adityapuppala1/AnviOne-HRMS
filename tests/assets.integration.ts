import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import type {
  AssetDetail,
  AssetList,
  MyAssets,
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

await test("Company assets: issue, acknowledge, return, and the guards underneath", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4489" });
  const { app, store } = await createApp(config);
  await app.listen(4489, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const tag = (n: number) => `TST-${run}-${n}`;
  const created: string[] = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4489/api/v1${path}`, {
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
  async function register(n: number, extra: Record<string, unknown> = {}) {
    const response = await send("/assets", "POST", {
      tag: tag(n),
      category: "laptop",
      name: `Synthetic laptop ${n}`,
      serialNumber: `SN-${run}-${n}`,
      condition: "new",
      ...extra,
    });
    assert.equal(response.status, 201, await response.clone().text());
    const detail = (await response.json()) as AssetDetail;
    created.push(detail.asset.id);
    return detail;
  }
  const detail = async (id: string) =>
    (await (await request(`/assets/${id}`)).json()) as AssetDetail;
  const mine = async () =>
    (await (await request("/assets/mine")).json()) as MyAssets;
  const other = (
    await admin.query<{ id: string }>(
      "SELECT id FROM employee WHERE entity_id=$1 AND id<>$2 AND status IN ('active','notice') LIMIT 1",
      [actor.entityId, actor.employeeId],
    )
  ).rows[0]!.id;

  try {
    await t.test(
      "HR registers assets; tags are unique and validated",
      async () => {
        await changeRole("hr_admin");
        const first = await register(1);
        assert.equal(first.asset.status, "available");
        assert.equal(first.asset.version, 1);
        const again = await send("/assets", "POST", {
          tag: tag(1),
          category: "phone",
          name: "Duplicate",
          condition: "good",
        });
        assert.equal(again.status, 409);
        const bad = await send("/assets", "POST", {
          tag: "!! no",
          category: "phone",
          name: "Bad tag",
          condition: "good",
        });
        assert.equal(bad.status, 400);
        const wrong = await send("/assets", "POST", {
          tag: tag(9),
          category: "spaceship",
          name: "Bad category",
          condition: "good",
        });
        assert.equal(wrong.status, 400);
      },
    );

    await t.test("only HR manages the inventory", async () => {
      for (const role of [
        "employee",
        "manager",
        "auditor",
        "platform_admin",
      ] as const) {
        await changeRole(role);
        assert.equal((await request("/assets")).status, 403, role);
        const response = await send("/assets", "POST", {
          tag: tag(8),
          category: "phone",
          name: "Not allowed",
          condition: "good",
        });
        assert.equal(response.status, 403, role);
      }
    });

    await t.test(
      "issue, acknowledge and return keep one honest history",
      async () => {
        await changeRole("hr_admin");
        const asset = await register(2);
        const issued = await send(`/assets/${asset.asset.id}/issue`, "POST", {
          employeeId: actor.employeeId,
          version: asset.asset.version,
        });
        assert.equal(issued.status, 201);
        const afterIssue = (await issued.json()) as AssetDetail;
        assert.equal(afterIssue.asset.status, "assigned");
        assert.equal(afterIssue.asset.custodian?.id, actor.employeeId);
        assert.equal(afterIssue.asset.acknowledgedAt, null);
        assert.equal(afterIssue.history.length, 1);
        // A second issue with the old version is stale; with the new one the asset is not available.
        const stale = await send(`/assets/${asset.asset.id}/issue`, "POST", {
          employeeId: other,
          version: asset.asset.version,
        });
        assert.equal(stale.status, 409);
        const taken = await send(`/assets/${asset.asset.id}/issue`, "POST", {
          employeeId: other,
          version: afterIssue.asset.version,
        });
        assert.equal(taken.status, 409);

        await changeRole("employee");
        let holdings = await mine();
        const current = holdings.current.find((c) => c.tag === tag(2))!;
        assert.ok(current, "the holder sees it");
        assert.equal(current.acknowledgedAt, null);
        const ack = await send(
          `/assets/assignments/${current.assignmentId}/acknowledge`,
          "POST",
          { version: current.version },
        );
        assert.equal(ack.status, 201);
        holdings = (await ack.json()) as MyAssets;
        assert.ok(
          holdings.current.find((c) => c.tag === tag(2))!.acknowledgedAt,
        );
        const twice = await send(
          `/assets/assignments/${current.assignmentId}/acknowledge`,
          "POST",
          { version: current.version + 1 },
        );
        assert.equal(twice.status, 409);

        await changeRole("hr_admin");
        const view = await detail(asset.asset.id);
        assert.ok(view.history[0]!.acknowledgedAt);
        const damaged = await send(`/assets/${asset.asset.id}/return`, "POST", {
          condition: "damaged",
          version: view.asset.version,
        });
        assert.equal(damaged.status, 400, "damage needs a description");
        const back = await send(`/assets/${asset.asset.id}/return`, "POST", {
          condition: "damaged",
          note: "Cracked screen",
          version: view.asset.version,
        });
        assert.equal(back.status, 201);
        const returned = (await back.json()) as AssetDetail;
        assert.equal(returned.asset.status, "in_repair");
        assert.equal(returned.asset.condition, "damaged");
        assert.equal(returned.asset.custodian, null);
        assert.equal(returned.history[0]!.returnCondition, "damaged");
        assert.equal(returned.history[0]!.returnNote, "Cracked screen");

        await changeRole("employee");
        holdings = await mine();
        assert.ok(!holdings.current.some((c) => c.tag === tag(2)));
        const past = holdings.past.find((c) => c.tag === tag(2))!;
        assert.ok(past, "returned items stay visible to their past holder");
        assert.equal(past.returnCondition, "damaged");
      },
    );

    await t.test(
      "people see only their own assignments and cannot acknowledge another's",
      async () => {
        await changeRole("hr_admin");
        const asset = await register(3);
        const issued = (await (
          await send(`/assets/${asset.asset.id}/issue`, "POST", {
            employeeId: other,
            version: asset.asset.version,
          })
        ).json()) as AssetDetail;
        const assignment = issued.history[0]!.id;
        await changeRole("employee");
        assert.ok(!(await mine()).current.some((c) => c.tag === tag(3)));
        const steal = await send(
          `/assets/assignments/${assignment}/acknowledge`,
          "POST",
          { version: 1 },
        );
        assert.equal(steal.status, 404);
        await changeRole("hr_admin");
        // HR does not acknowledge on anyone's behalf.
        assert.equal(
          (
            await send(
              `/assets/assignments/${assignment}/acknowledge`,
              "POST",
              {
                version: 1,
              },
            )
          ).status,
          403,
        );
      },
    );

    await t.test("status changes follow the allowed paths", async () => {
      await changeRole("hr_admin");
      const asset = await register(4);
      const issued = (await (
        await send(`/assets/${asset.asset.id}/issue`, "POST", {
          employeeId: actor.employeeId,
          version: asset.asset.version,
        })
      ).json()) as AssetDetail;
      // An issued asset must come back before it can be repaired or retired.
      const refused = await send(`/assets/${asset.asset.id}/status`, "POST", {
        status: "in_repair",
        note: "Sent to repair",
        version: issued.asset.version,
      });
      assert.equal(refused.status, 409);
      // Marking it lost closes the assignment with a reason.
      const lost = await send(`/assets/${asset.asset.id}/status`, "POST", {
        status: "lost",
        note: "Left in a taxi",
        version: issued.asset.version,
      });
      assert.equal(lost.status, 201);
      const gone = (await lost.json()) as AssetDetail;
      assert.equal(gone.asset.status, "lost");
      assert.equal(gone.history[0]!.returnCondition, "lost");
      assert.equal(gone.history[0]!.returnNote, "Left in a taxi");
      const found = (await (
        await send(`/assets/${asset.asset.id}/status`, "POST", {
          status: "available",
          note: "Found and checked",
          version: gone.asset.version,
        })
      ).json()) as AssetDetail;
      assert.equal(found.asset.status, "available");
      const retired = (await (
        await send(`/assets/${asset.asset.id}/status`, "POST", {
          status: "retired",
          note: "End of life",
          version: found.asset.version,
        })
      ).json()) as AssetDetail;
      assert.equal(retired.asset.status, "retired");
      const revive = await send(`/assets/${asset.asset.id}/status`, "POST", {
        status: "available",
        note: "Try to revive",
        version: retired.asset.version,
      });
      assert.equal(revive.status, 409, "retired is final");
      const issueRetired = await send(
        `/assets/${asset.asset.id}/issue`,
        "POST",
        { employeeId: other, version: retired.asset.version },
      );
      assert.equal(issueRetired.status, 409);
      const editRetired = await send(`/assets/${asset.asset.id}`, "PUT", {
        name: "Renamed after retirement",
        condition: "good",
        reason: "Trying to edit a retired asset",
        version: retired.asset.version,
      });
      assert.equal(editRetired.status, 409, "a retired asset cannot be edited");
    });

    await t.test("issue dates stay inside the asset's own life", async () => {
      await changeRole("hr_admin");
      const asset = await register(5);
      const longAgo = await send(`/assets/${asset.asset.id}/issue`, "POST", {
        employeeId: other,
        issuedOn: "2001-01-01",
        version: asset.asset.version,
      });
      assert.equal(longAgo.status, 400, "before the asset existed");
      const future = await send(`/assets/${asset.asset.id}/issue`, "POST", {
        employeeId: other,
        issuedOn: "2999-01-01",
        version: asset.asset.version,
      });
      assert.equal(future.status, 400, "in the future");
      const issued = (await (
        await send(`/assets/${asset.asset.id}/issue`, "POST", {
          employeeId: other,
          version: asset.asset.version,
        })
      ).json()) as AssetDetail;
      const back = (await (
        await send(`/assets/${asset.asset.id}/return`, "POST", {
          condition: "good",
          version: issued.asset.version,
        })
      ).json()) as AssetDetail;
      const returnedOn = back.history[0]!.returnedOn!;
      const earlier = new Date(`${returnedOn}T00:00:00Z`);
      earlier.setUTCDate(earlier.getUTCDate() - 1);
      const overlap = await send(`/assets/${asset.asset.id}/issue`, "POST", {
        employeeId: actor.employeeId,
        issuedOn: earlier.toISOString().slice(0, 10),
        version: back.asset.version,
      });
      assert.equal(overlap.status, 400, "overlapping the previous holder");
    });

    await t.test(
      "the inventory can be searched, filtered and counted",
      async () => {
        await changeRole("hr_admin");
        const all = (await (
          await request(
            `/assets?q=${encodeURIComponent(`TST-${run}`)}&limit=50`,
          )
        ).json()) as AssetList;
        assert.ok(all.total >= 4);
        assert.ok(all.items.every((i) => i.tag.startsWith(`TST-${run}`)));
        const retired = (await (
          await request(
            `/assets?q=${encodeURIComponent(`TST-${run}`)}&status=retired`,
          )
        ).json()) as AssetList;
        assert.ok(retired.items.length >= 1);
        assert.ok(retired.items.every((i) => i.status === "retired"));
        const sum = Object.values(all.counts).reduce((n, c) => n + c, 0);
        assert.ok(sum >= all.total);
        assert.equal((await request("/assets?status=nonsense")).status, 400);
      },
    );

    await t.test(
      "every change leaves an audit record and an outbox event",
      async () => {
        const audit = await admin.query<{ action: string }>(
          "SELECT action FROM audit_event WHERE target LIKE 'asset:%' AND action LIKE 'asset.%' AND entity_id=$1",
          [actor.entityId],
        );
        const actions = new Set(audit.rows.map((r) => r.action));
        for (const action of [
          "asset.registered",
          "asset.issued",
          "asset.acknowledged",
          "asset.returned",
          "asset.status_changed",
        ])
          assert.ok(actions.has(action), action);
        const events = await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM outbox_event WHERE event_type LIKE 'asset.%' AND aggregate_id=ANY($1::uuid[])",
          [created],
        );
        assert.ok(events.rows[0]!.n >= 8);
      },
    );

    await t.test(
      "the database refuses what the API would never send",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const employee = { ...actor, role: "employee" as const };
          const hr = { ...actor, role: "hr_admin" as const };
          const target = created[0]!;
          // An employee cannot change or add assets, whatever statement reaches the table.
          const changed = await scoped(pool, employee, (client) =>
            client.query("UPDATE asset SET name='Hijacked asset' WHERE id=$1", [
              target,
            ]),
          );
          assert.equal(changed.rowCount, 0);
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(
                `INSERT INTO asset(id,tenant_id,entity_id,tag,category,name,condition,status,version)
                 VALUES ($1,$2,$3,$4,'phone','Sneaky','good','available',1)`,
                [randomUUID(), actor.tenantId, actor.entityId, tag(7)],
              ),
            ),
          );
          // HR cannot skip the lifecycle or delete history.
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE asset SET status='assigned', custodian_id=$2, version=version+1 WHERE id=$1",
                [target, other],
              ),
            ),
            /Issue the asset to someone first|not allowed/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query("DELETE FROM asset WHERE id=$1", [target]),
            ),
            /permission denied|never deleted/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "DELETE FROM asset_assignment WHERE asset_id=ANY($1::uuid[])",
                [created],
              ),
            ),
            /permission denied|never deleted/,
          );
          // The asset and its open assignment must agree at commit, whatever statements ran.
          const free = await scoped(pool, hr, (client) =>
            client.query<{ id: string }>(
              "SELECT id FROM asset WHERE status='available' AND tag LIKE $1 LIMIT 1",
              [`TST-${run}-%`],
            ),
          );
          if (free.rows[0])
            await assert.rejects(
              scoped(pool, hr, (client) =>
                client.query(
                  `INSERT INTO asset_assignment(id,tenant_id,entity_id,asset_id,employee_id,issued_on,issue_condition,issued_by_label,version)
                   VALUES ($1,$2,$3,$4,$5,current_date,'good','HR',1)`,
                  [
                    randomUUID(),
                    actor.tenantId,
                    actor.entityId,
                    free.rows[0]!.id,
                    other,
                  ],
                ),
              ),
              /open assignment/,
            );
          // Nobody may rewrite an assignment's fixed facts.
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE asset_assignment SET asset_name='Renamed', version=version+1 WHERE asset_id=$1",
                [created[1]],
              ),
            ),
            /permission denied|acknowledgement or return/,
          );
        } finally {
          await pool.end();
        }
      },
    );
  } finally {
    // Synthetic cleanup only: assets and their history are never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[]) OR aggregate_id IN (SELECT id FROM asset_assignment WHERE asset_id=ANY($1::uuid[]))",
        [created],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target ~ ANY($1::text[])",
        [created.map((id) => `^asset:${id}`)],
      );
      await client.query(
        "DELETE FROM asset_assignment WHERE asset_id=ANY($1::uuid[])",
        [created],
      );
      await client.query("DELETE FROM asset WHERE id=ANY($1::uuid[])", [
        created,
      ]);
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
