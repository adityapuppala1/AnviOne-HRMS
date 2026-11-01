import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { ProfileStore } from "../apps/api/src/profile.store";
import { makePool, scoped, transaction } from "../packages/database/src/index";
import type {
  MyProfile,
  ProfileChangeRequest,
  ProfileEmployee,
  ProfileRequestList,
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

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);

await test("Profile edits: approval, effective dates, history and the guards underneath", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4497" });
  const { app, store } = await createApp(config);
  await app.listen(4497, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const profiles = new ProfileStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const requests: string[] = [];
  const touched = new Set<string>([actor.employeeId]);
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4497/api/v1${path}`, {
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
  const as = (employeeId: string, name: string) => ({
    ...actor,
    employeeId,
    role: "employee" as const,
    name,
  });
  const today = (
    await admin.query<{ today: string }>(
      `SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS today FROM legal_entity WHERE id=$1`,
      [actor.entityId],
    )
  ).rows[0]!.today;
  // Colleagues with no profile record yet, so every row this test creates can be removed.
  const colleagues = (
    await admin.query<{ id: string; name: string }>(
      `SELECT e.id, e.name FROM employee_directory e WHERE e.entity_id=$1 AND e.id<>$2 AND e.status='active'
        AND NOT EXISTS(SELECT 1 FROM employee_profile p WHERE p.employee_id=e.id)
        AND NOT EXISTS(SELECT 1 FROM profile_change_request r WHERE r.employee_id=e.id)
       ORDER BY e.code LIMIT 3`,
      [actor.entityId, actor.employeeId],
    )
  ).rows;
  assert.equal(colleagues.length, 3, "three synthetic colleagues");
  const [asha, ben, chen] = colleagues as [
    { id: string; name: string },
    { id: string; name: string },
    { id: string; name: string },
  ];
  for (const c of colleagues) touched.add(c.id);
  const mayaHadProfile = Boolean(
    (
      await admin.query("SELECT 1 FROM employee_profile WHERE employee_id=$1", [
        actor.employeeId,
      ])
    ).rowCount,
  );
  const phone = "+91 98765 43210";
  const email = `synthetic.${run.toLowerCase()}@example.com`;
  const submitAs = async (
    who: { id: string; name: string },
    body: Record<string, unknown>,
  ) => {
    const mine = await profiles.submit(
      as(who.id, who.name),
      body as never,
      randomUUID(),
    );
    assert.ok(mine.open);
    requests.push(mine.open!.id);
    return mine.open!;
  };
  const decide = (id: string, action: string, body: unknown) =>
    send(`/profile/requests/${id}/${action}`, "POST", body);

  try {
    await t.test(
      "permissions: only HR reviews; auditors and admins see nothing",
      async () => {
        for (const role of ["auditor", "platform_admin"] as const) {
          await changeRole(role);
          assert.equal((await request("/profile/mine")).status, 403, role);
          assert.equal((await request("/profile/requests")).status, 403, role);
          assert.equal(
            (await request(`/profile/employees/${asha.id}`)).status,
            403,
            role,
          );
        }
        for (const role of ["employee", "manager"] as const) {
          await changeRole(role);
          assert.equal((await request("/profile/mine")).status, 200, role);
          assert.equal(
            (await request("/profile/mine/history")).status,
            200,
            role,
          );
          assert.equal((await request("/profile/requests")).status, 403, role);
          assert.equal(
            (await request(`/profile/employees/${asha.id}`)).status,
            403,
            `${role} cannot read another person's profile`,
          );
          assert.equal(
            (await send("/profile/apply-due", "POST", {})).status,
            403,
          );
        }
        await changeRole("hr_admin");
        assert.equal((await request("/profile/mine")).status, 403);
        assert.equal(
          (
            await send("/profile/mine/requests", "POST", {
              changes: [{ field: "city", value: "Pune" }],
              reason: "Moved",
              effectiveOn: today,
            })
          ).status,
          403,
        );
      },
    );

    await t.test("validation: whitelist, formats, dates", async () => {
      await changeRole("employee");
      const bad = [
        {
          changes: [{ field: "name", value: "New Name" }],
          reason: "Typo fix",
          effectiveOn: today,
        },
        {
          changes: [{ field: "personalPhone", value: "call me" }],
          reason: "New phone",
          effectiveOn: today,
        },
        {
          changes: [{ field: "personalEmail", value: "not-an-email" }],
          reason: "New mail",
          effectiveOn: today,
        },
        { changes: [], reason: "Nothing", effectiveOn: today },
        {
          changes: [
            { field: "city", value: "Pune" },
            { field: "city", value: "Delhi" },
          ],
          reason: "Twice",
          effectiveOn: today,
        },
        {
          changes: [{ field: "city", value: "Pune" }],
          reason: "x",
          effectiveOn: today,
        },
        {
          changes: [{ field: "city", value: "Pune" }],
          reason: "Moved",
          effectiveOn: today,
          extra: 1,
        },
      ];
      for (const body of bad)
        assert.equal(
          (await send("/profile/mine/requests", "POST", body)).status,
          400,
          JSON.stringify(body),
        );
      for (const effectiveOn of [addDays(today, -1), addDays(today, 91)])
        assert.equal(
          (
            await send("/profile/mine/requests", "POST", {
              changes: [{ field: "city", value: "Pune" }],
              reason: "Moved house",
              effectiveOn,
            })
          ).status,
          400,
          effectiveOn,
        );
    });

    await t.test(
      "submit, one open request, withdraw, stale versions",
      async () => {
        await changeRole("employee");
        const first = await send("/profile/mine/requests", "POST", {
          changes: [
            { field: "personalPhone", value: phone },
            { field: "city", value: "Pune" },
          ],
          reason: `Moved house ${run}`,
          effectiveOn: today,
        });
        assert.equal(first.status, 201, await first.clone().text());
        const mine = (await first.json()) as MyProfile;
        assert.ok(mine.open);
        requests.push(mine.open!.id);
        assert.equal(mine.open!.status, "submitted");
        assert.deepEqual(mine.open!.fields, ["personalPhone", "city"]);
        assert.equal(
          mine.open!.changes!.find((c) => c.field === "personalPhone")!.value,
          phone,
          "the owner sees their own requested values",
        );
        assert.ok(mine.open!.canWithdraw);
        const twice = await send("/profile/mine/requests", "POST", {
          changes: [{ field: "city", value: "Delhi" }],
          reason: "Another change",
          effectiveOn: today,
        });
        assert.equal(twice.status, 409, "one open request per employee");

        // HR (the same person) cannot decide their own request.
        await changeRole("hr_admin");
        const own = await decide(mine.open!.id, "approve", { version: 1 });
        assert.equal(own.status, 403, await own.clone().text());

        await changeRole("employee");
        assert.equal(
          (
            await send(
              `/profile/mine/requests/${mine.open!.id}/withdraw`,
              "POST",
              {
                version: 7,
              },
            )
          ).status,
          409,
          "stale version",
        );
        const back = await send(
          `/profile/mine/requests/${mine.open!.id}/withdraw`,
          "POST",
          { version: 1 },
        );
        assert.equal(back.status, 201, await back.clone().text());
        const after = (await back.json()) as MyProfile;
        assert.equal(after.open, null);
        assert.equal(after.requests[0]!.status, "withdrawn");
        assert.equal(
          (
            await send(
              `/profile/mine/requests/${mine.open!.id}/withdraw`,
              "POST",
              {
                version: 2,
              },
            )
          ).status,
          409,
          "withdraw only while submitted",
        );
      },
    );

    await t.test(
      "HR approves a change due today: applied with history",
      async () => {
        const open = await submitAs(asha, {
          changes: [
            { field: "personalPhone", value: phone },
            { field: "personalEmail", value: email },
            { field: "emergencyName", value: "Synthetic Contact" },
            { field: "addressLine2", value: "B" },
          ],
          reason: `Contact update ${run}`,
          effectiveOn: today,
        });
        await changeRole("hr_admin");
        const list = (await (
          await request(
            `/profile/requests?status=submitted&q=${encodeURIComponent(asha.name)}`,
          )
        ).json()) as ProfileRequestList;
        const listed = list.items.find((item) => item.id === open.id)!;
        assert.ok(listed, "listed for HR");
        assert.equal(listed.changes, null, "lists never carry values");
        assert.equal(listed.reason, null);
        assert.ok(listed.canDecide);
        assert.ok(list.counts.submitted >= 1);
        assert.ok(!JSON.stringify(list).includes(phone));

        const seen = (await (
          await request(`/profile/requests/${open.id}`)
        ).json()) as ProfileChangeRequest;
        assert.equal(
          seen.changes!.find((c) => c.field === "personalEmail")!.value,
          email,
        );
        assert.equal(
          (await decide(open.id, "approve", { version: 9 })).status,
          409,
          "stale version",
        );
        const approved = await decide(open.id, "approve", {
          version: 1,
          note: "Checked",
        });
        assert.equal(approved.status, 201, await approved.clone().text());
        const decided = (await approved.json()) as ProfileChangeRequest;
        assert.equal(decided.status, "applied");
        assert.ok(decided.appliedAt);
        assert.equal(decided.changes, null);

        const person = (await (
          await request(`/profile/employees/${asha.id}`)
        ).json()) as ProfileEmployee;
        assert.equal(person.profile.personalPhone, phone);
        assert.equal(person.profile.personalEmail, email);
        assert.equal(person.profile.addressLine2, "B");
        assert.equal(person.profile.city, null);
        assert.equal(person.profile.version, 2);
        assert.equal(person.open, null);
        assert.equal(person.history.length, 4);
        const phoneChange = person.history.find(
          (h) => h.field === "personalPhone",
        )!;
        assert.equal(phoneChange.oldValue, null);
        assert.equal(phoneChange.newValue, phone);
        assert.equal(phoneChange.effectiveOn, today);

        // The owner sees their own values and history; nobody else's.
        const owner = await profiles.mine(as(asha.id, asha.name), randomUUID());
        assert.equal(owner.profile.personalEmail, email);
        assert.equal(owner.history.length, 4);
        const other = await profiles.mine(as(ben.id, ben.name), randomUUID());
        assert.equal(other.profile.personalEmail, null);
        assert.equal(other.history.length, 0);

        // The HR read of personal data is audited.
        const viewed = await admin.query(
          "SELECT 1 FROM audit_event WHERE action='profile.viewed' AND target=$1",
          [`employee:${asha.id}`],
        );
        assert.ok(viewed.rowCount! >= 1);
        // Values are sealed at rest.
        const raw = await admin.query<{ personal_phone: string }>(
          "SELECT personal_phone FROM employee_profile WHERE employee_id=$1",
          [asha.id],
        );
        assert.ok(!raw.rows[0]!.personal_phone.includes("98765"));
      },
    );

    await t.test(
      "reject needs a note; a rejected request is final",
      async () => {
        const open = await submitAs(ben, {
          changes: [{ field: "city", value: "Chennai" }],
          reason: `Relocated ${run}`,
          effectiveOn: today,
        });
        await changeRole("hr_admin");
        assert.equal(
          (await decide(open.id, "reject", { version: 1 })).status,
          400,
        );
        assert.equal(
          (await decide(open.id, "reject", { version: 1, note: "no" })).status,
          400,
        );
        const rejected = await decide(open.id, "reject", {
          version: 1,
          note: "Please attach proof of address",
        });
        assert.equal(rejected.status, 201, await rejected.clone().text());
        assert.equal(
          ((await rejected.json()) as ProfileChangeRequest).status,
          "rejected",
        );
        assert.equal(
          (await decide(open.id, "approve", { version: 2 })).status,
          409,
          "final",
        );
        const unchanged = await profiles.mine(
          as(ben.id, ben.name),
          randomUUID(),
        );
        assert.equal(unchanged.profile.city, null);
        assert.equal(unchanged.profile.version, 0);
      },
    );

    await t.test(
      "a future-dated approval applies when due (on read and via apply-due)",
      async () => {
        const later = await submitAs(ben, {
          changes: [{ field: "emergencyPhone", value: "+91 90000 11111" }],
          reason: `New emergency number ${run}`,
          effectiveOn: addDays(today, 5),
        });
        const laterToo = await submitAs(chen, {
          changes: [{ field: "postalCode", value: "560001" }],
          reason: `New postcode ${run}`,
          effectiveOn: addDays(today, 10),
        });
        await changeRole("hr_admin");
        for (const id of [later.id, laterToo.id]) {
          const approved = await decide(id, "approve", { version: 1 });
          assert.equal(approved.status, 201, await approved.clone().text());
          assert.equal(
            ((await approved.json()) as ProfileChangeRequest).status,
            "approved",
          );
        }
        // Not due yet: reading and apply-due change nothing.
        const early = await profiles.mine(as(ben.id, ben.name), randomUUID());
        assert.equal(early.profile.emergencyPhone, null);
        assert.equal(early.open!.status, "approved");
        assert.equal(
          (await profiles
            .submit(
              as(ben.id, ben.name),
              {
                changes: [{ field: "city", value: "Goa" }],
                reason: "Something else",
                effectiveOn: today,
              } as never,
              randomUUID(),
            )
            .catch((e: Error) => e)) instanceof Error,
          true,
          "an approved, not yet applied change still counts as open",
        );
        const none = await send("/profile/apply-due", "POST", {});
        assert.equal(none.status, 201);
        // Simulate the passing of time: move the effective dates to today (synthetic rows only).
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "UPDATE profile_change_request SET effective_on=$2 WHERE id=ANY($1::uuid[])",
            [[later.id, laterToo.id], today],
          );
        });
        // Ben reads his profile: the change applies on read.
        const due = await profiles.mine(as(ben.id, ben.name), randomUUID());
        assert.equal(due.profile.emergencyPhone, "+91 90000 11111");
        assert.equal(due.open, null);
        assert.equal(due.history[0]!.field, "emergencyPhone");
        // HR applies the rest; running it again is a no-op.
        const first = (await (
          await send("/profile/apply-due", "POST", {})
        ).json()) as {
          applied: number;
        };
        assert.ok(first.applied >= 1);
        const second = (await (
          await send("/profile/apply-due", "POST", {})
        ).json()) as {
          applied: number;
        };
        assert.equal(second.applied, 0, "idempotent");
        const chenNow = await profiles.mine(
          as(chen.id, chen.name),
          randomUUID(),
        );
        assert.equal(chenNow.profile.postalCode, "560001");
        // Concurrent apply-on-read for one change applies it exactly once.
        const again = await submitAs(chen, {
          changes: [{ field: "city", value: "Bengaluru" }],
          reason: `Concurrent ${run}`,
          effectiveOn: addDays(today, 3),
        });
        assert.equal(
          (await decide(again.id, "approve", { version: 1 })).status,
          201,
        );
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "UPDATE profile_change_request SET effective_on=$2 WHERE id=$1",
            [again.id, today],
          );
        });
        const results = await Promise.allSettled([
          profiles.mine(as(chen.id, chen.name), randomUUID()),
          profiles.mine(as(chen.id, chen.name), randomUUID()),
          profiles.applyDueAll({ ...actor, role: "hr_admin" }, randomUUID()),
        ]);
        for (const result of results)
          assert.ok(
            result.status === "fulfilled" ||
              /same time/.test(String(result.reason)),
            String(result.status === "rejected" ? result.reason : ""),
          );
        const history = await admin.query(
          "SELECT 1 FROM profile_change_history WHERE request_id=$1",
          [again.id],
        );
        assert.equal(history.rowCount, 1, "applied exactly once");
      },
    );

    await t.test(
      "an approved change not yet due can be withdrawn or cancelled; races with apply settle once",
      async () => {
        const moveToToday = (id: string) =>
          transaction(admin, async (client) => {
            await client.query("SET LOCAL session_replication_role = replica");
            await client.query(
              "UPDATE profile_change_request SET effective_on=$2 WHERE id=$1",
              [id, today],
            );
          });
        await changeRole("hr_admin");
        // The employee withdraws an approved, not yet due change; it stops blocking new requests.
        const first = await submitAs(asha, {
          changes: [{ field: "city", value: "Hubli" }],
          reason: `Withdraw after approval ${run}`,
          effectiveOn: addDays(today, 7),
        });
        assert.equal(
          (
            await decide(first.id, "approve", {
              version: 1,
              note: "Fine by HR",
            })
          ).status,
          201,
        );
        const mineBefore = await profiles.mine(
          as(asha.id, asha.name),
          randomUUID(),
        );
        assert.equal(mineBefore.open!.status, "approved");
        assert.ok(mineBefore.open!.canWithdraw);
        assert.ok(!mineBefore.open!.canCancel);
        const back = await profiles.withdraw(
          as(asha.id, asha.name),
          first.id,
          { version: 2 },
          randomUUID(),
        );
        assert.equal(back.open, null);
        assert.equal(back.requests[0]!.status, "withdrawn");
        assert.equal(back.profile.city, null);

        // HR cancels an approved change: needs a note, never their own, not once due.
        const second = await submitAs(asha, {
          changes: [{ field: "city", value: "Udupi" }],
          reason: `HR cancel ${run}`,
          effectiveOn: addDays(today, 7),
        });
        assert.equal(
          (await decide(second.id, "approve", { version: 1 })).status,
          201,
        );
        const listed = (await (
          await request(`/profile/requests?status=approved`)
        ).json()) as ProfileRequestList;
        const row = listed.items.find((item) => item.id === second.id)!;
        assert.ok(row.canCancel);
        assert.equal(row.decisionNote, null, "lists never carry notes");
        assert.equal(
          (await decide(second.id, "cancel", { version: 2 })).status,
          400,
        );
        assert.equal(
          (await decide(second.id, "cancel", { version: 2, note: "ok" }))
            .status,
          400,
        );
        assert.equal(
          (
            await decide(second.id, "cancel", {
              version: 9,
              note: "Duplicate request",
            })
          ).status,
          409,
        );
        const cancelled = await decide(second.id, "cancel", {
          version: 2,
          note: "Duplicate request",
        });
        assert.equal(cancelled.status, 201, await cancelled.clone().text());
        const done = (await cancelled.json()) as ProfileChangeRequest;
        assert.equal(done.status, "withdrawn");
        assert.ok(done.withdrawnBy);
        assert.equal(done.decisionNote, null);
        const cancelEvent = await admin.query(
          "SELECT 1 FROM outbox_event WHERE aggregate_id=$1 AND event_type='profile.change_cancelled.v1'",
          [second.id],
        );
        assert.equal(cancelEvent.rowCount, 1);

        // HR cannot cancel their own approved change (a direct write, since HR cannot approve it).
        const own = await send(
          "/profile/requests/" + second.id + "/cancel",
          "POST",
          {
            version: 3,
            note: "Again please",
          },
        );
        assert.equal(own.status, 409, "a withdrawn request is final");

        // A due change can no longer be withdrawn or cancelled; it applies.
        const third = await submitAs(asha, {
          changes: [{ field: "city", value: "Mangaluru" }],
          reason: `Due race ${run}`,
          effectiveOn: addDays(today, 4),
        });
        assert.equal(
          (await decide(third.id, "approve", { version: 1 })).status,
          201,
        );
        await moveToToday(third.id);
        const results = await Promise.allSettled([
          profiles.cancel(
            { ...actor, role: "hr_admin" },
            third.id,
            { version: 2, note: "Race cancel" },
            randomUUID(),
          ),
          profiles.applyDueAll({ ...actor, role: "hr_admin" }, randomUUID()),
          profiles.withdraw(
            as(asha.id, asha.name),
            third.id,
            { version: 2 },
            randomUUID(),
          ),
        ]);
        for (const result of results)
          if (result.status === "rejected")
            assert.match(
              String(result.reason),
              /already due|changed|same time/,
            );
        const final = await admin.query<{ status: string }>(
          "SELECT status FROM profile_change_request WHERE id=$1",
          [third.id],
        );
        const history = await admin.query(
          "SELECT 1 FROM profile_change_history WHERE request_id=$1",
          [third.id],
        );
        assert.equal(final.rows[0]!.status, "applied");
        assert.equal(
          history.rowCount,
          1,
          "applied exactly once, never cancelled after",
        );

        // A race between HR cancel and the owner's withdraw on a not-yet-due change ends once.
        const fourth = await submitAs(asha, {
          changes: [{ field: "city", value: "Karwar" }],
          reason: `Cancel race ${run}`,
          effectiveOn: addDays(today, 4),
        });
        assert.equal(
          (await decide(fourth.id, "approve", { version: 1 })).status,
          201,
        );
        const raced = await Promise.allSettled([
          profiles.cancel(
            { ...actor, role: "hr_admin" },
            fourth.id,
            { version: 2, note: "Race cancel" },
            randomUUID(),
          ),
          profiles.withdraw(
            as(asha.id, asha.name),
            fourth.id,
            { version: 2 },
            randomUUID(),
          ),
        ]);
        assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
        const events = await admin.query(
          "SELECT 1 FROM outbox_event WHERE aggregate_id=$1 AND event_type IN ('profile.change_cancelled.v1','profile.change_withdrawn.v1')",
          [fourth.id],
        );
        assert.equal(events.rowCount, 1);
      },
    );

    await t.test(
      "a value that cannot be opened is reported, not a server error",
      async () => {
        await changeRole("hr_admin");
        await transaction(admin, async (client) => {
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(
            "UPDATE employee_profile SET personal_phone=$2 WHERE employee_id=$1",
            [asha.id, "A".repeat(60)],
          );
        });
        const response = await request(`/profile/employees/${asha.id}`);
        assert.equal(response.status, 200, await response.clone().text());
        const person = (await response.json()) as ProfileEmployee;
        assert.equal(person.profile.personalPhone, null);
        assert.deepEqual(person.profile.unavailable, ["personalPhone"]);
        assert.equal(person.profile.personalEmail, email);
        const mine = await profiles.mine(as(asha.id, asha.name), randomUUID());
        assert.deepEqual(mine.profile.unavailable, ["personalPhone"]);
      },
    );

    await t.test(
      "direct writes are refused and history is immutable",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const employeeActor = as(asha.id, asha.name);
          const hr = { ...actor, role: "hr_admin" as const };
          const manager = { ...actor, role: "manager" as const };
          const sealed = "A".repeat(60);
          // Nobody writes the profile or its history except the approved path.
          for (const who of [employeeActor, hr]) {
            await assert.rejects(
              scoped(pool, who, (client) =>
                client.query(
                  "UPDATE employee_profile SET personal_phone=$2, version=version+1 WHERE employee_id=$1",
                  [asha.id, sealed],
                ),
              ),
              /permission denied/,
            );
            await assert.rejects(
              scoped(pool, who, (client) =>
                client.query(
                  "INSERT INTO employee_profile(tenant_id,entity_id,employee_id,version,updated_by_label) VALUES ($1,$2,$3,1,'x')",
                  [actor.tenantId, actor.entityId, ben.id],
                ),
              ),
              /permission denied/,
            );
            await assert.rejects(
              scoped(pool, who, (client) =>
                client.query(
                  "UPDATE profile_change_history SET new_value=$2 WHERE employee_id=$1",
                  [asha.id, sealed],
                ),
              ),
              /permission denied/,
            );
            for (const table of [
              "employee_profile",
              "profile_change_history",
              "profile_change_request",
            ])
              await assert.rejects(
                scoped(pool, who, (client) =>
                  client.query(`DELETE FROM ${table} WHERE employee_id=$1`, [
                    asha.id,
                  ]),
                ),
                /permission denied/,
              );
          }
          // Even the migration owner cannot rewrite or delete history or profiles.
          await assert.rejects(
            admin.query(
              "UPDATE profile_change_history SET new_value=NULL WHERE employee_id=$1",
              [asha.id],
            ),
            /never deleted or rewritten/,
          );
          await assert.rejects(
            admin.query("DELETE FROM employee_profile WHERE employee_id=$1", [
              asha.id,
            ]),
            /never deleted or rewritten/,
          );
          await assert.rejects(
            admin.query(
              "UPDATE employee_profile SET version=version+1 WHERE employee_id=$1",
              [asha.id],
            ),
            /only through an approved request/,
          );
          // An employee cannot insert a request for someone else, nor approve their own.
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "INSERT INTO profile_change_request(id,tenant_id,entity_id,employee_id,changes,reason,effective_on) VALUES ($1,$2,$3,$4,$5::jsonb,'Not mine',leave_entity_today())",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  ben.id,
                  JSON.stringify([{ field: "address_city", value: sealed }]),
                ],
              ),
            ),
          );
          await assert.rejects(
            scoped(pool, employeeActor, (client) =>
              client.query(
                "INSERT INTO profile_change_request(id,tenant_id,entity_id,employee_id,changes,reason,effective_on) VALUES ($1,$2,$3,$4,$5::jsonb,'Bad field',leave_entity_today())",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  asha.id,
                  JSON.stringify([{ field: "salary", value: sealed }]),
                ],
              ),
            ),
            /profile_changes_ok|check constraint/,
          );
          const pending = await submitAs(asha, {
            changes: [{ field: "city", value: "Mysuru" }],
            reason: `Self approval attempt ${run}`,
            effectiveOn: today,
          });
          const selfApprove = await scoped(pool, employeeActor, (client) =>
            client
              .query(
                "UPDATE profile_change_request SET status='approved', version=version+1 WHERE id=$1",
                [pending.id],
              )
              .catch((error: Error) => error),
          );
          assert.ok(
            selfApprove instanceof Error && /Only HR/.test(selfApprove.message),
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE profile_change_request SET reason='Rewritten', version=version+1 WHERE id=$1",
                [pending.id],
              ),
            ),
            /permission denied/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE profile_change_request SET status='applied', version=version+1 WHERE id=$1",
                [pending.id],
              ),
            ),
            /not allowed/,
          );
          // A manager sees no one else's profile, request or history rows.
          for (const table of [
            "employee_profile",
            "profile_change_history",
            "profile_change_request",
          ]) {
            const seen = await scoped(pool, manager, (client) =>
              client.query(
                `SELECT 1 FROM ${table} WHERE employee_id=ANY($1::uuid[])`,
                [[asha.id, ben.id, chen.id]],
              ),
            );
            assert.equal(seen.rowCount, 0, table);
          }
          const auditorSeen = await scoped(
            pool,
            { ...actor, role: "auditor" },
            (client) => client.query("SELECT 1 FROM employee_profile"),
          );
          assert.equal(auditorSeen.rowCount, 0);
          // Withdraw so cleanup sees a closed request.
          await profiles.withdraw(
            employeeActor,
            pending.id,
            { version: 1 },
            randomUUID(),
          );
        } finally {
          await pool.end();
        }
      },
    );

    await t.test("no personal values in audit or outbox rows", async () => {
      const audits = await admin.query<{
        details: unknown;
        reason: string | null;
      }>(
        `SELECT details, reason FROM audit_event WHERE target=ANY($1::text[]) OR (action='profile.viewed' AND target=ANY($2::text[]))`,
        [
          requests.map((id) => `profile-change:${id}`),
          [...touched].map((id) => `employee:${id}`),
        ],
      );
      assert.ok(audits.rowCount! > 5);
      const text = JSON.stringify(audits.rows);
      for (const secret of [
        phone,
        "98765",
        email,
        "Synthetic Contact",
        "Chennai",
        "560001",
        "Bengaluru",
        "proof of address",
        "Moved house",
      ])
        assert.ok(!text.includes(secret), secret);
      const events = await admin.query(
        "SELECT to_jsonb(o) AS row FROM outbox_event o WHERE aggregate_id=ANY($1::uuid[])",
        [requests],
      );
      assert.ok(events.rowCount! > 5);
      const eventText = JSON.stringify(events.rows);
      for (const secret of [phone, email, "560001"])
        assert.ok(!eventText.includes(secret));
    });
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
          [...touched].map((id) => `employee:${id}`),
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
      const created = colleagues.map((c) => c.id);
      if (!mayaHadProfile) created.push(actor.employeeId);
      await client.query(
        "DELETE FROM employee_profile WHERE employee_id=ANY($1::uuid[])",
        [created],
      );
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
