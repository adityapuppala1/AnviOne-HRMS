import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createCandidateApp } from "../apps/api/src/candidate-app";
import { readConfig } from "../apps/api/src/config";
import { makePool } from "../packages/database/src/index";
import { hash } from "../apps/api/src/platform.store";
if (process.env.NODE_ENV !== "development" || process.env.AUTH_MODE !== "demo")
  throw new Error("Synthetic development database required");
for (const name of [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "CANDIDATE_DATABASE_URL",
]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  )
    throw new Error("Local Compose database required");
}
await test("Isolated candidate onboarding", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4403" });
  const { app, store } = await createApp(config),
    candidate = await createCandidateApp(config, 4404),
    admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  await app.listen(4403, "127.0.0.1");
  await candidate.app.listen(4404, "127.0.0.1");
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let employeeToken = await store.createSession(actor, randomUUID()),
    employeeSession = await store.session(employeeToken);
  const hr = async (path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:4403/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: `anvi_dev_session=${employeeToken}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": employeeSession.csrfToken,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const switchRole = async (role: string) => {
    const r = await hr("/session/role-context", { role });
    assert.equal(r.status, 201);
    employeeToken = r.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    employeeSession = await store.session(employeeToken);
  };
  let cookie = "",
    csrf = "",
    id = "",
    version = 1,
    token = "";
  const api = async (
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:4404/api/candidate/${path}`, {
      method,
      headers: {
        Origin: config.CANDIDATE_ORIGIN,
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const reason = "Synthetic onboarding acceptance verification";
  const detail = async () => {
    const r = await hr(`/candidates/${id}`);
    assert.equal(r.status, 200);
    return r.json();
  };
  const invite = async () => {
    const r = await hr(`/candidates/${id}/invitation`, { version, reason });
    assert.equal(r.status, 201);
    version = (await r.json()).version;
    const delivery = await (
      await hr(`/candidates/${id}/delivery-preview`)
    ).json();
    token = new URL(delivery.invitationUrl).hash.slice(8);
  };
  const challenge = async () => {
    const r = await api("challenge", { token });
    assert.equal(r.status, 201);
    const challengeId = (await r.json()).challengeId;
    const delivery = await (
      await hr(`/candidates/${id}/delivery-preview`)
    ).json();
    return { challengeId, code: delivery.code };
  };
  const login = async () => {
    const input = await challenge();
    const r = await api("exchange", { token, ...input });
    assert.equal(r.status, 201);
    cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
    const me = await (await api("session")).json();
    csrf = me.csrfToken;
    version = me.candidate.version;
  };
  try {
    await t.test(
      "HR permission and synthetic address constraints",
      async () => {
        await switchRole("employee");
        assert.equal((await hr("/candidates")).status, 403);
        await switchRole("hr_admin");
        const options = await (await hr("/candidates/options")).json();
        const input = {
          name: "QA Candidate",
          email: `qa-${randomUUID()}@anvi.example`,
          title: "Synthetic designer",
          joinedOn: "2027-01-01",
          departmentId: options.departments[0].id,
          locationId: options.locations[0].id,
          managerId: options.managers[0].id,
        };
        assert.equal(
          (await hr("/candidates", { ...input, email: "real@example.com" }))
            .status,
          400,
        );
        const r = await hr("/candidates", input);
        assert.equal(r.status, 201);
        const c = await r.json();
        id = c.id;
        version = c.version;
        assert.equal(c.state, "draft");
        assert.equal(
          (await admin.query("SELECT id FROM employee WHERE id=$1", [id]))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "invitation GET cannot consume; credential storage is protected",
      async () => {
        await invite();
        assert.equal((await api("session")).status, 401);
        const row = (
          await admin.query(
            "SELECT invitation_hash,invitation_consumed_at FROM candidate_case WHERE id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(row.invitation_hash, hash(token));
        assert.equal(row.invitation_consumed_at, null);
        const tray = (
          await admin.query(
            "SELECT ciphertext FROM candidate_delivery_preview WHERE candidate_id=$1",
            [id],
          )
        ).rows[0];
        assert.ok(!tray.ciphertext.includes(token));
        assert.equal(
          (await candidate.store.pool.query("SELECT * FROM candidate_case"))
            .rowCount,
          0,
        );
        await assert.rejects(
          candidate.store.pool.query("SELECT * FROM employee"),
        );
        await assert.rejects(
          candidate.store.pool.query("SELECT * FROM person"),
        );
        assert.equal(
          (
            await api("challenge", { token }, "POST", {
              Origin: config.APP_ORIGIN,
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "expired challenges and invitations fail without exposing the case",
      async () => {
        const input = await challenge();
        await admin.query(
          "UPDATE candidate_challenge SET expires_at=now()-interval '1 minute' WHERE id=$1",
          [input.challengeId],
        );
        assert.equal((await api("exchange", { token, ...input })).status, 401);
        await admin.query(
          "UPDATE candidate_case SET invitation_expires_at=now()-interval '1 minute',otp_sent_at=now()-interval '2 minutes' WHERE id=$1",
          [id],
        );
        const expired = await api("challenge", { token });
        assert.equal(expired.status, 201);
        assert.equal(
          (
            await api("exchange", {
              token,
              challengeId: (await expired.json()).challengeId,
              code: "123456",
            })
          ).status,
          401,
        );
        await admin.query(
          "UPDATE candidate_case SET invitation_expires_at=now()+interval '72 hours' WHERE id=$1",
          [id],
        );
      },
    );
    await t.test(
      "wrong OTP attempts persist and exhaust the challenge",
      async () => {
        const input = await challenge();
        for (let n = 0; n < 5; n++)
          assert.equal(
            (
              await api("exchange", {
                token,
                challengeId: input.challengeId,
                code: input.code === "111111" ? "222222" : "111111",
              })
            ).status,
            401,
          );
        assert.equal((await api("exchange", { token, ...input })).status, 401);
        assert.equal(
          (
            await admin.query(
              "SELECT attempts FROM candidate_challenge WHERE id=$1",
              [input.challengeId],
            )
          ).rows[0].attempts,
          5,
        );
        await admin.query(
          "UPDATE candidate_case SET otp_sent_at=now()-interval '2 minutes' WHERE id=$1",
          [id],
        );
      },
    );
    await t.test(
      "single use exchange, independent cookie and CSRF boundary",
      async () => {
        await login();
        assert.equal(
          (
            await api("exchange", {
              token,
              challengeId: randomUUID(),
              code: "123456",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api("session", undefined, "GET", {
              Cookie: `anvi_dev_session=${employeeToken}`,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await fetch("http://127.0.0.1:4403/api/v1/me", {
              headers: { Cookie: cookie },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await api(
              "draft",
              {
                version,
                draft: {
                  preferredName: "QA",
                  introduction: "Fictional professional introduction.",
                  acknowledged: true,
                },
              },
              "PUT",
              { "X-CSRF-Token": "wrong" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "versioned autosave, immutable submission, corrections and form approval",
      async () => {
        const draft = {
          preferredName: "QA",
          introduction: "Fictional professional introduction for this test.",
          acknowledged: true,
        };
        let r = await api("draft", { version, draft }, "PUT");
        assert.equal(r.status, 200);
        const saved = await r.json();
        assert.equal(
          (await api("draft", { version, draft }, "PUT")).status,
          409,
        );
        version = saved.candidate.version;
        const candidateActor = await candidate.store.session(
          cookie.split("=")[1],
        );
        await assert.rejects(
          candidate.store.submit(
            candidateActor,
            version,
            "invalid-request-uuid",
          ),
        );
        assert.equal((await detail()).submissions.length, 0);
        assert.equal(
          (await candidate.store.me(candidateActor)).candidate.version,
          version,
        );
        const concurrent = await Promise.all([
          api("submit", { version }),
          api("submit", { version }),
        ]);
        assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
        let d = await detail();
        version = d.candidate.version;
        assert.equal(d.submissions.length, 1);
        r = await hr(`/candidates/${id}/review`, {
          version,
          reason,
          decision: "changes_requested",
        });
        assert.equal(r.status, 201);
        version = (await r.json()).version;
        r = await api(
          "draft",
          {
            version,
            draft: {
              ...draft,
              introduction:
                "Updated fictional professional introduction for correction.",
            },
          },
          "PUT",
        );
        assert.equal(r.status, 200);
        version = (await r.json()).candidate.version;
        assert.equal((await api("submit", { version })).status, 201);
        d = await detail();
        assert.equal(d.submissions.length, 2);
        assert.equal(d.submissions[1].payload.introduction, draft.introduction);
        version = d.candidate.version;
        r = await hr(`/candidates/${id}/review`, {
          version,
          reason,
          decision: "approved",
        });
        assert.equal(r.status, 201);
        version = (await r.json()).version;
        assert.equal(
          (await api("draft", { version, draft }, "PUT")).status,
          409,
        );
        assert.equal(
          (await admin.query("SELECT id FROM employee WHERE id=$1", [id]))
            .rowCount,
          0,
        );
        await assert.rejects(
          candidate.store.pool.query(
            "UPDATE candidate_submission SET payload='{}' WHERE candidate_id=$1",
            [id],
          ),
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM audit_event WHERE target=$1 AND action='candidate.submitted'",
              [id],
            )
          ).rowCount,
          2,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM outbox_event WHERE aggregate_id=$1 AND event_type='candidate.submitted.v1'",
              [id],
            )
          ).rowCount,
          2,
        );
      },
    );
    await t.test(
      "rotation revokes sessions and old invitations, cancellation closes access",
      async () => {
        const oldToken = token;
        await admin.query(
          "UPDATE candidate_case SET invitation_sent_at=now()-interval '2 minutes' WHERE id=$1",
          [id],
        );
        await invite();
        assert.notEqual(token, oldToken);
        assert.equal((await api("session")).status, 401);
        await login();
        const r = await hr(`/candidates/${id}/revoke`, { version, reason });
        assert.equal(r.status, 201);
        assert.equal((await api("session")).status, 401);
      },
    );
  } finally {
    if (id) {
      for (const table of [
        "candidate_delivery_preview",
        "candidate_challenge",
        "candidate_session",
        "candidate_submission",
      ])
        await admin.query(`DELETE FROM ${table} WHERE candidate_id=$1`, [id]);
      await admin.query("DELETE FROM candidate_case WHERE id=$1", [id]);
    }
    await candidate.store.pool.end();
    await candidate.app.close();
    await store.pool.end();
    await app.close();
    await admin.end();
  }
});
