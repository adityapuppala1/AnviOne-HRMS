import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { ProfileStore } from "../apps/api/src/profile.store";
import {
  openValue,
  profileKeys,
  sealedKeyId,
} from "../apps/api/src/profile.crypto";
import {
  applyDueProfileChanges,
  makePool,
  transaction,
} from "../packages/database/src/index";
import { rekeyProfiles } from "../scripts/profile-rekey";

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

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);

await test("Profile operations: scheduled apply-due and key rotation", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4507" });
  const { app, store } = await createApp(config);
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const worker = makePool(process.env.WORKER_DATABASE_URL!);
  const profiles = new ProfileStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  const hr = { ...actor, role: "hr_admin" as const };
  const requests: string[] = [];
  const today = (
    await admin.query<{ today: string }>(
      `SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS today FROM legal_entity WHERE id=$1`,
      [actor.entityId],
    )
  ).rows[0]!.today;
  const colleagues = (
    await admin.query<{ id: string; name: string }>(
      `SELECT e.id, e.name FROM employee_directory e WHERE e.entity_id=$1 AND e.id<>$2 AND e.status='active'
        AND NOT EXISTS(SELECT 1 FROM employee_profile p WHERE p.employee_id=e.id)
        AND NOT EXISTS(SELECT 1 FROM profile_change_request r WHERE r.employee_id=e.id)
       ORDER BY e.code LIMIT 4`,
      [actor.entityId, actor.employeeId],
    )
  ).rows;
  assert.equal(colleagues.length, 4, "four synthetic colleagues");
  const [asha, ben, chen, dan] = colleagues as [
    { id: string; name: string },
    { id: string; name: string },
    { id: string; name: string },
    { id: string; name: string },
  ];
  const as = (who: { id: string; name: string }) => ({
    ...actor,
    employeeId: who.id,
    role: "employee" as const,
    name: who.name,
  });
  const submitAndApprove = async (
    who: { id: string; name: string },
    city: string,
    days: number,
  ) => {
    const mine = await profiles.submit(
      as(who),
      {
        changes: [{ field: "city", value: city }],
        reason: "Moved house",
        effectiveOn: addDays(today, days),
      } as never,
      randomUUID(),
    );
    const id = mine.open!.id;
    requests.push(id);
    await profiles.approve(hr, id, { version: 1 } as never, randomUUID());
    return id;
  };
  const makeDue = (id: string) =>
    transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "UPDATE profile_change_request SET effective_on=$2 WHERE id=$1",
        [id, today],
      );
    });
  const statusOf = async (id: string) =>
    (
      await admin.query<{ status: string }>(
        "SELECT status FROM profile_change_request WHERE id=$1",
        [id],
      )
    ).rows[0]!.status;
  const historyOf = async (id: string) =>
    (
      await admin.query(
        "SELECT 1 FROM profile_change_history WHERE request_id=$1",
        [id],
      )
    ).rowCount;

  try {
    let ashaRequest = "";
    await t.test(
      "the scheduler applies due changes once and leaves later ones",
      async () => {
        ashaRequest = await submitAndApprove(asha, "Mysuru", 3);
        const later = await submitAndApprove(ben, "Hubballi", 5);
        const poisoned = await submitAndApprove(dan, "Udupi", 4);
        await makeDue(ashaRequest);
        await makeDue(poisoned);
        // A not-yet-due row (tomorrow) must not take the only slot of a batch of one.
        const tomorrow = await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "UPDATE profile_change_request SET effective_on=$2 WHERE id=$1",
            [later, addDays(today, 1)],
          );
        });
        void tomorrow;
        // Poison dan's request: a pre-existing history row makes its apply fail.
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            `INSERT INTO profile_change_history(tenant_id,entity_id,employee_id,request_id,field,effective_on,approved_by_label)
             SELECT tenant_id,entity_id,employee_id,id,'address_city',effective_on,'Test' FROM profile_change_request WHERE id=$1`,
            [poisoned],
          );
        });
        const first = await applyDueProfileChanges(worker, 1);
        assert.equal(first.applied + first.skipped, 1);
        const result = await applyDueProfileChanges(worker);
        assert.ok(first.applied + result.applied >= 1);
        assert.ok(
          [...first.skippedIds, ...result.skippedIds].includes(poisoned),
          "the poisoned row is skipped by id",
        );
        assert.equal(await statusOf(poisoned), "approved");
        assert.equal(await statusOf(later), "approved", "tomorrow is not due");
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "DELETE FROM profile_change_history WHERE request_id=$1",
            [poisoned],
          );
        });
        assert.equal((await applyDueProfileChanges(worker)).skipped, 0);
        assert.equal(await statusOf(poisoned), "applied");
        assert.equal(await statusOf(ashaRequest), "applied");
        assert.equal(await statusOf(later), "approved", "not yet due");
        assert.equal(await historyOf(ashaRequest), 1);
        await applyDueProfileChanges(worker);
        assert.equal(await historyOf(ashaRequest), 1, "second run is a no-op");
        const mine = await profiles.mine(as(asha), randomUUID());
        assert.equal(mine.profile.city, "Mysuru");
        const audit = await admin.query<{ details: Record<string, unknown> }>(
          "SELECT details FROM audit_event WHERE target=$1 AND action='profile.change_applied'",
          [`profile-change:${ashaRequest}`],
        );
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0]!.details.via, "scheduler");
        assert.deepEqual(audit.rows[0]!.details.fields, ["address_city"]);
        assert.ok(!JSON.stringify(audit.rows).includes("Mysuru"));
        const events = await admin.query(
          "SELECT 1 FROM outbox_event WHERE aggregate_id=$1 AND event_type='profile.change_applied.v1'",
          [ashaRequest],
        );
        assert.equal(events.rowCount, 1);
        // The worker still has no direct access to profile data.
        await assert.rejects(
          worker.query("SELECT 1 FROM profile_change_request LIMIT 1"),
          /permission denied/,
        );
        await assert.rejects(
          worker.query("SELECT profile_reseal_request($1,'[]','[]')", [
            ashaRequest,
          ]),
          /permission denied/,
        );
        await assert.rejects(
          worker.query("SELECT profile_apply_due_scheduled(0,$1)", [
            randomUUID(),
          ]),
          /1-500/,
        );
        // Make ben's change due and race the scheduler against HR apply-due.
        await makeDue(later);
        const results = await Promise.allSettled([
          applyDueProfileChanges(worker),
          profiles.applyDueAll(hr, randomUUID()),
          applyDueProfileChanges(worker),
        ]);
        for (const result of results)
          assert.ok(
            result.status === "fulfilled" ||
              /same time|deadlock|serializ/.test(String(result.reason)),
            String(result.status === "rejected" ? result.reason : ""),
          );
        assert.equal(await statusOf(later), "applied");
        assert.equal(await historyOf(later), 1, "one history row");
      },
    );

    await t.test(
      "rotation re-seals current and open values with the newest key and keeps history readable",
      async () => {
        // Chen's request stays open (submitted) so it is re-sealed too.
        const open = await profiles.submit(
          as(chen),
          {
            changes: [{ field: "city", value: "Mangaluru" }],
            reason: "Moved house",
            effectiveOn: addDays(today, 10),
          } as never,
          randomUUID(),
        );
        requests.push(open.open!.id);
        const scope = [asha.id, ben.id, chen.id];
        const legacy = profileKeys(config);
        const rotated = profileKeys({
          ...config,
          PROFILE_DATA_KEYS: [{ id: 7, hex: randomBytes(32).toString("hex") }],
        });
        const snapshot = async () =>
          (
            await admin.query<{ v: string }>(
              `SELECT address_city AS v FROM employee_profile WHERE employee_id=ANY($1)
               UNION ALL SELECT changes::text FROM profile_change_request WHERE employee_id=ANY($1)`,
              [scope],
            )
          ).rows.map((r) => r.v);
        const before = await snapshot();
        // A role that cannot bypass row-level security is refused, not given an empty report.
        await assert.rejects(
          rekeyProfiles(worker, rotated, true, scope),
          /BYPASSRLS/,
        );
        const dry = await rekeyProfiles(admin, rotated, true, scope);
        assert.equal(dry.needsReseal.profiles, 2);
        assert.equal(dry.needsReseal.openRequests, 1);
        assert.equal(dry.resealed.profiles, 0);
        assert.deepEqual(await snapshot(), before, "dry run writes nothing");
        assert.ok(!JSON.stringify(dry).includes("Mysuru"));

        const real = await rekeyProfiles(admin, rotated, false, scope);
        assert.equal(real.resealed.profiles, 2);
        assert.equal(real.resealed.openRequests, 1);
        assert.equal(real.after!.current["7"], 2);
        assert.equal(real.after!.openRequests["7"], 1);
        assert.equal(real.after!.current["0"], undefined);
        assert.ok(
          (real.after!.history["0"] ?? 0) >= 2,
          "history keeps its key",
        );
        const row = (
          await admin.query<{ v: string }>(
            "SELECT address_city AS v FROM employee_profile WHERE employee_id=$1",
            [asha.id],
          )
        ).rows[0]!.v;
        assert.equal(sealedKeyId(row), 7);
        assert.equal(
          openValue(rotated, asha.id, "address_city", row),
          "Mysuru",
        );
        const again = await rekeyProfiles(admin, rotated, false, scope);
        assert.equal(
          again.needsReseal.profiles + again.needsReseal.openRequests,
          0,
        );

        // The API without key 7 reports the value unavailable instead of failing.
        assert.ok(!legacy.keys.has(7));
        const mine = await profiles.mine(as(asha), randomUUID());
        assert.equal(mine.profile.city, null);
        assert.deepEqual(mine.profile.unavailable, ["city"]);
        // The request guard still refuses anything but a value-only re-seal.
        await assert.rejects(
          admin.query("SELECT profile_reseal_request($1,$2,$3)", [
            open.open!.id,
            (
              await admin.query<{ c: string }>(
                "SELECT changes::text AS c FROM profile_change_request WHERE id=$1",
                [open.open!.id],
              )
            ).rows[0]!.c,
            JSON.stringify([{ field: "address_line1", value: row }]),
          ]),
          /re-seal replaces values only/,
        );
      },
    );
  } finally {
    // Synthetic cleanup only: profile history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [requests],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[]) OR (action='profile.viewed' AND target=ANY($2::text[]))",
        [
          requests.map((id) => `profile-change:${id}`),
          colleagues.map((c) => `employee:${c.id}`),
        ],
      );
      await client.query(
        "DELETE FROM profile_change_history WHERE request_id=ANY($1::uuid[])",
        [requests],
      );
      await client.query(
        "DELETE FROM profile_change_request WHERE id=ANY($1::uuid[])",
        [requests],
      );
      await client.query(
        "DELETE FROM employee_profile WHERE employee_id=ANY($1::uuid[])",
        [colleagues.map((c) => c.id)],
      );
    });
    await Promise.all([admin.end(), worker.end(), app.close()]);
    await store.pool.end();
  }
});
