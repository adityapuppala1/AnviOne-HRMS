import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { EngageStore } from "../apps/api/src/engage.store";
import {
  makePool,
  scoped,
  transaction,
  type PoolClient,
} from "../packages/database/src/index";
import type {
  EngKudosList,
  EngSurveyDetail,
  EngValueList,
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

const PORT = Number(process.env.ENGAGE_TEST_PORT ?? 4521);
// Synthetic demo people: Maya (HR) manages Arjun, Zara and Neel; Neel manages Rohan;
// Kabir is a second HR user.
const arjun = "30000000-0000-4000-8000-000000000002";
const zara = "30000000-0000-4000-8000-000000000003";
const neel = "30000000-0000-4000-8000-000000000004";
const rohan = "30000000-0000-4000-8000-000000000006";
const kabir = "30000000-0000-4000-8000-000000000012";
const status = async (work: Promise<unknown>) => {
  try {
    await work;
    return 200;
  } catch (error) {
    const code = (error as { getStatus?: () => number }).getStatus?.();
    if (code === undefined) throw error;
    return code;
  }
};
// SQLSTATE of a direct statement, or "ok".
const sqlState = async (work: Promise<unknown>) => {
  try {
    await work;
    return "ok";
  } catch (error) {
    return String((error as { code?: string }).code);
  }
};
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const DAY = 24 * 3600 * 1000;

await test("Engagement: recognition, reactions, moderation and anonymous pulse surveys", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const pool = makePool(process.env.DATABASE_URL!);
  const eng = new EngageStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toLowerCase();
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
  const send = (path: string, method: string, body: unknown) =>
    request(path, { method, body: JSON.stringify(body) });
  async function changeRole(role: Role) {
    const response = await send("/session/role-context", "POST", { role });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  const as = (employeeId: string, name: string, role: Role) => ({
    ...actor,
    employeeId,
    role,
    name,
  });
  const maya = actor.employeeId;
  const hrMaya = as(maya, "Maya (synthetic HR)", "hr_admin");
  const arjunE = as(arjun, "Arjun (synthetic)", "employee");
  const zaraE = as(zara, "Zara (synthetic)", "employee");
  const neelM = as(neel, "Neel (synthetic manager)", "manager");
  const rohanE = as(rohan, "Rohan (synthetic)", "employee");
  const kabirE = as(kabir, "Kabir (synthetic)", "employee");
  const auditor = as(maya, "Maya (auditor)", "auditor");
  // Markers that must never reach audit or outbox rows.
  const secret = `secret-${run}`;
  const ids = {
    kudos: [] as string[],
    surveys: [] as string[],
    values: [] as string[],
  };
  let values: EngValueList;
  const valueId = () => values.items.find((v) => v.active)!.id;
  const give = async (
    who: typeof arjunE,
    to: string,
    message = `Thanks for the help ${secret}`,
  ) => {
    const created = await eng.giveKudos(
      who,
      { recipientEmployeeId: to, valueId: valueId(), message },
      randomUUID(),
    );
    ids.kudos.push(created.kudos.id);
    return created;
  };
  const surveyInput = (title: string, opensAt = iso(-60000)) => ({
    title: `${title} ${secret}`,
    opensAt,
    closesAt: iso(7 * DAY),
    questions: [
      {
        kind: "rating" as const,
        prompt: `How supported do you feel ${secret}`,
      },
      {
        kind: "choice" as const,
        prompt: `Best part of the week ${secret}`,
        options: ["Team", "Work", "Learning"],
      },
      { kind: "text" as const, prompt: `Anything else ${secret}` },
    ],
  });
  const newSurvey = async (title: string, opensAt?: string) => {
    const created = await eng.createSurvey(
      hrMaya,
      surveyInput(title, opensAt),
      randomUUID(),
    );
    ids.surveys.push(created.survey.id);
    return created;
  };
  const answers = (
    d: EngSurveyDetail,
    rating: number,
    choice: number,
    text?: string,
  ) =>
    d.questions.map((q) =>
      q.kind === "rating"
        ? { questionId: q.id, rating }
        : q.kind === "choice"
          ? { questionId: q.id, choice }
          : { questionId: q.id, ...(text ? { text } : {}) },
    );
  const alwaysOff = async (client: PoolClient) => {
    const { rows } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE 'eng\\_%'`,
    );
    for (const row of rows)
      await client.query(`ALTER TABLE ${row.t} DISABLE TRIGGER ${row.name}`);
    return async () => {
      for (const row of rows)
        await client.query(
          `ALTER TABLE ${row.t} ENABLE ALWAYS TRIGGER ${row.name}`,
        );
    };
  };

  try {
    await t.test("access follows the engagement permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/engage/kudos",
          "/engage/values",
          "/engage/surveys",
          "/engage/colleagues",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      for (const role of ["employee", "manager", "hr_admin"] as const) {
        await changeRole(role);
        assert.equal((await request("/engage/kudos")).status, 200, role);
        assert.equal((await request("/engage/surveys")).status, 200, role);
        assert.equal(
          (await request("/engage/kudos?view=hidden")).status,
          role === "hr_admin" ? 200 : 403,
          role,
        );
        assert.equal(
          (await send("/engage/values", "POST", { name: `V ${run} ${role}` }))
            .status,
          role === "hr_admin" ? 201 : 403,
          role,
        );
      }
      const hrValues = (await (
        await request("/engage/values")
      ).json()) as EngValueList;
      for (const v of hrValues.items)
        if (v.name.startsWith(`V ${run}`)) ids.values.push(v.id);
      assert.equal(
        await status(
          eng.listKudos(auditor, { page: 1, limit: 25, view: "feed" }),
        ),
        403,
      );
    });

    await t.test(
      "company values are seeded and HR-managed with versions",
      async () => {
        values = await eng.values(arjunE);
        assert.ok(values.items.length >= 6);
        assert.equal(values.canManage, false);
        for (const name of [
          "Customer first",
          "Ownership",
          "Teamwork",
          "Integrity",
          "Learning",
          "Excellence",
        ])
          assert.ok(
            values.items.some((v) => v.name === name),
            name,
          );
        const created = await eng.createValue(
          hrMaya,
          { name: `Courage ${run}`, sort: 5 },
          randomUUID(),
        );
        ids.values.push(created.id);
        assert.equal(
          await status(
            eng.createValue(
              hrMaya,
              { name: `courage ${run}`, sort: 5 },
              randomUUID(),
            ),
          ),
          409,
        );
        const retired = await eng.updateValue(
          hrMaya,
          created.id,
          { name: created.name, active: false, sort: 5, version: 1 },
          randomUUID(),
        );
        assert.equal(retired.version, 2);
        assert.equal(
          await status(
            eng.updateValue(
              hrMaya,
              created.id,
              { name: created.name, active: true, sort: 5, version: 1 },
              randomUUID(),
            ),
          ),
          409,
        );
        assert.equal(
          await status(
            eng.createValue(
              arjunE,
              { name: `X ${run}`, sort: 5 },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(
          await sqlState(
            scoped(pool, arjunE, (c) =>
              c.query(
                "INSERT INTO eng_value(id,tenant_id,entity_id,name) VALUES ($1,$2,$3,'Forged')",
                [randomUUID(), actor.tenantId, actor.entityId],
              ),
            ),
          ),
          "EG005",
        );
        // Employees see active values only; a retired value cannot be used.
        assert.ok(
          !(await eng.values(arjunE)).items.some((v) => v.id === created.id),
        );
        assert.equal(
          await status(
            eng.giveKudos(
              arjunE,
              {
                recipientEmployeeId: zara,
                valueId: created.id,
                message: "Thanks",
              },
              randomUUID(),
            ),
          ),
          400,
        );
      },
    );

    let first: Awaited<ReturnType<typeof give>>;
    await t.test(
      "recognition: colleagues only, never yourself, visible to the entity",
      async () => {
        const colleagues = await eng.colleagues(arjunE, { q: "" });
        assert.ok(colleagues.items.length > 0);
        assert.ok(
          !colleagues.items.some((c) => c.employeeId === arjun),
          "never yourself",
        );
        first = await give(arjunE, zara);
        assert.equal(first.kudos.giverEmployeeId, arjun);
        assert.equal(first.kudos.recipientEmployeeId, zara);
        assert.equal(first.kudos.givenByMe, true);
        assert.equal(first.kudos.hidden, false);
        assert.deepEqual(Object.values(first.kudos.reactions), [0, 0, 0, 0, 0]);
        // Self-recognition: refused by the store, the guard and the check constraint.
        assert.equal(
          await status(
            eng.giveKudos(
              arjunE,
              { recipientEmployeeId: arjun, valueId: valueId(), message: "Me" },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await sqlState(
            scoped(pool, arjunE, (c) =>
              c.query(
                "INSERT INTO eng_kudos(id,tenant_id,entity_id,recipient_employee_id,value_id,message) VALUES ($1,$2,$3,$4,$5,'Me')",
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  arjun,
                  valueId(),
                ],
              ),
            ),
          ),
          "EG003",
        );
        assert.equal(
          await sqlState(
            transaction(admin, (c) =>
              c.query(
                `INSERT INTO eng_kudos(id,tenant_id,entity_id,giver_employee_id,giver_name,recipient_employee_id,recipient_name,
                value_id,message,given_on,version) SELECT $1,$2,$3,$4,'x',$4,'x',$5,'x',current_date,1`,
                [
                  randomUUID(),
                  actor.tenantId,
                  actor.entityId,
                  arjun,
                  valueId(),
                ],
              ),
            ),
          ),
          // The migrator has no app context, so the guard refuses first; the check backs it up.
          "EG005",
        );
        // An unknown or other-entity recipient answers the same as a non-colleague.
        assert.equal(
          await status(
            eng.giveKudos(
              arjunE,
              {
                recipientEmployeeId: randomUUID(),
                valueId: valueId(),
                message: "Hi",
              },
              randomUUID(),
            ),
          ),
          400,
        );
        const longMessage = await send("/engage/kudos", "POST", {
          recipientEmployeeId: zara,
          valueId: valueId(),
          message: "x".repeat(281),
        });
        assert.equal(longMessage.status, 400);
        // Everyone in the entity sees it; received and given views follow the people.
        const feed = await eng.listKudos(rohanE, {
          page: 1,
          limit: 100,
          view: "feed",
        });
        assert.ok(feed.items.some((k) => k.id === first.kudos.id));
        const received = await eng.listKudos(zaraE, {
          page: 1,
          limit: 100,
          view: "received",
        });
        assert.ok(
          received.items.some((k) => k.id === first.kudos.id && k.toMe),
        );
        assert.ok(received.items.every((k) => k.recipientEmployeeId === zara));
        const given = await eng.listKudos(arjunE, {
          page: 1,
          limit: 100,
          view: "given",
        });
        assert.ok(given.items.every((k) => k.giverEmployeeId === arjun));
        assert.ok(given.items.some((k) => k.id === first.kudos.id));
        assert.equal(given.dailyLimit, 10);
      },
    );

    await t.test(
      "daily cap of 10 is enforced in the database, even in parallel",
      async () => {
        const before = (
          await eng.listKudos(neelM, { page: 1, limit: 1, view: "feed" })
        ).givenToday;
        const attempts = 12 - before;
        const results = await Promise.all(
          Array.from({ length: attempts }, (_, i) =>
            status(give(neelM, i % 2 ? arjun : zara, `Cap ${i} ${secret}`)),
          ),
        );
        assert.equal(results.filter((s) => s === 200).length, 10 - before);
        assert.equal(results.filter((s) => s === 409).length, 2);
        assert.equal(
          (await eng.listKudos(neelM, { page: 1, limit: 1, view: "feed" }))
            .givenToday,
          10,
        );
        const n = await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM eng_kudos WHERE giver_employee_id=$1 AND given_on=(now() AT TIME ZONE 'UTC')::date",
          [neel],
        );
        assert.equal(n.rows[0]!.n, 10);
        // Failed attempts left no ids behind to clean up; keep only real ones.
        const real = await admin.query<{ id: string }>(
          "SELECT id FROM eng_kudos WHERE id=ANY($1::uuid[])",
          [ids.kudos],
        );
        ids.kudos = real.rows.map((r) => r.id);
      },
    );

    await t.test(
      "reactions: one per person per post, removable, fixed codes",
      async () => {
        const id = first.kudos.id;
        const reacted = await eng.react(
          rohanE,
          id,
          { code: "applause" },
          randomUUID(),
        );
        assert.equal(reacted.kudos.reactions.applause, 1);
        assert.equal(reacted.kudos.myReaction, "applause");
        assert.equal(
          await status(eng.react(rohanE, id, { code: "thanks" }, randomUUID())),
          409,
        );
        assert.equal(
          await sqlState(
            scoped(pool, rohanE, (c) =>
              c.query(
                "INSERT INTO eng_reaction(id,tenant_id,entity_id,kudos_id,code) VALUES ($1,$2,$3,$4,'thanks')",
                [randomUUID(), actor.tenantId, actor.entityId, id],
              ),
            ),
          ),
          "23505",
        );
        await eng.react(zaraE, id, { code: "thanks" }, randomUUID());
        const removed = await eng.unreact(rohanE, id, randomUUID());
        assert.equal(removed.kudos.reactions.applause, 0);
        assert.equal(removed.kudos.reactions.thanks, 1);
        assert.equal(removed.kudos.myReaction, null);
        assert.equal(await status(eng.unreact(rohanE, id, randomUUID())), 404);
        const bad = await send(`/engage/kudos/${id}/reactions`, "POST", {
          code: "heart_eyes",
        });
        assert.equal(bad.status, 400);
        // Nobody removes someone else's reaction: the delete policy only matches one's own row.
        const gone = await scoped(pool, rohanE, (c) =>
          c.query("DELETE FROM eng_reaction WHERE kudos_id=$1", [id]),
        );
        assert.equal(gone.rowCount, 0);
        assert.equal(
          await sqlState(
            scoped(pool, zaraE, (c) =>
              c.query(
                "UPDATE eng_reaction SET code='helpful' WHERE kudos_id=$1",
                [id],
              ),
            ),
          ),
          "42501",
        );
      },
    );

    await t.test(
      "moderation: HR hides with a reason, history is append-only",
      async () => {
        const id = first.kudos.id;
        assert.equal(
          await status(
            eng.moderate(
              arjunE,
              id,
              "hide",
              { version: 1, reason: "Not allowed" },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(
          await status(
            eng.moderate(
              hrMaya,
              id,
              "hide",
              { version: 7, reason: `Off topic ${secret}` },
              randomUUID(),
            ),
          ),
          409,
        );
        const givenBefore = (
          await eng.listKudos(arjunE, { page: 1, limit: 1, view: "given" })
        ).givenToday;
        const hidden = await eng.moderate(
          hrMaya,
          id,
          "hide",
          { version: 1, reason: `Off topic ${secret}` },
          randomUUID(),
        );
        // The giver's daily count still includes the hidden post, as the cap does (063).
        assert.equal(
          (await eng.listKudos(arjunE, { page: 1, limit: 1, view: "given" }))
            .givenToday,
          givenBefore,
        );
        assert.equal(hidden.kudos.hidden, true);
        assert.equal(hidden.kudos.version, 2);
        assert.equal(hidden.moderation.length, 1);
        assert.equal(hidden.moderation[0]!.action, "hide");
        assert.equal(
          await status(
            eng.moderate(
              hrMaya,
              id,
              "hide",
              { version: 2, reason: "Again" },
              randomUUID(),
            ),
          ),
          409,
        );
        // Gone from every non-HR view, including for the giver and recipient; HR still sees it.
        for (const [who, view] of [
          [rohanE, "feed"],
          [zaraE, "received"],
          [arjunE, "given"],
        ] as const)
          assert.ok(
            !(
              await eng.listKudos(who, { page: 1, limit: 100, view })
            ).items.some((k) => k.id === id),
            view,
          );
        assert.equal(await status(eng.kudosDetail(zaraE, id)), 404);
        assert.equal(
          await status(eng.react(rohanE, id, { code: "thanks" }, randomUUID())),
          404,
        );
        assert.ok(
          !(
            await eng.listKudos(hrMaya, { page: 1, limit: 100, view: "feed" })
          ).items.some((k) => k.id === id),
        );
        assert.ok(
          (
            await eng.listKudos(hrMaya, { page: 1, limit: 100, view: "hidden" })
          ).items.some((k) => k.id === id),
        );
        // Non-HR never reads the moderation history, even directly.
        const history = await scoped(pool, zaraE, (c) =>
          c.query("SELECT * FROM eng_kudos_moderation WHERE kudos_id=$1", [id]),
        );
        assert.equal(history.rowCount, 0);
        const restored = await eng.moderate(
          hrMaya,
          id,
          "restore",
          { version: 2, reason: "Reviewed again" },
          randomUUID(),
        );
        assert.equal(restored.kudos.hidden, false);
        assert.equal(restored.moderation.length, 2);
        assert.ok(
          (
            await eng.listKudos(rohanE, { page: 1, limit: 100, view: "feed" })
          ).items.some((k) => k.id === id),
        );
        // History and posts are immutable, even for the migrator.
        for (const sql of [
          "UPDATE eng_kudos_moderation SET reason='changed' WHERE kudos_id=$1",
          "UPDATE eng_kudos SET message='changed' WHERE id=$1",
          "UPDATE eng_kudos SET hidden=true, hidden_at=now(), version=version+1 WHERE id=$1",
        ])
          assert.equal(await sqlState(admin.query(sql, [id])), "EG004", sql);
        for (const sql of [
          "DELETE FROM eng_kudos_moderation WHERE kudos_id=$1",
          "DELETE FROM eng_kudos WHERE id=$1",
        ])
          assert.equal(await sqlState(admin.query(sql, [id])), "23514", sql);
      },
    );

    let open: EngSurveyDetail;
    let small: EngSurveyDetail;
    await t.test(
      "surveys: draft, edit, publish, eligibility snapshot",
      async () => {
        open = await newSurvey("Pulse");
        assert.equal(open.survey.status, "draft");
        assert.equal(open.questions.length, 3);
        assert.deepEqual(
          open.questions.map((q) => q.required),
          [true, true, false],
        );
        assert.equal(
          await status(eng.surveyDetail(arjunE, open.survey.id)),
          404,
          "drafts are HR-only",
        );
        assert.equal(
          await status(
            eng.createSurvey(arjunE, surveyInput("Nope"), randomUUID()),
          ),
          403,
        );
        const tooMany = await send("/engage/surveys", "POST", {
          ...surveyInput("Too many"),
          questions: Array.from({ length: 13 }, (_, i) => ({
            kind: "rating",
            prompt: `Question ${i}`,
          })),
        });
        assert.equal(tooMany.status, 400);
        const edited = await eng.updateSurvey(
          hrMaya,
          open.survey.id,
          { ...surveyInput("Pulse edited"), version: 1 },
          randomUUID(),
        );
        assert.equal(edited.survey.version, 2);
        assert.equal(
          await status(
            eng.updateSurvey(
              hrMaya,
              open.survey.id,
              { ...surveyInput("Stale"), version: 1 },
              randomUUID(),
            ),
          ),
          409,
        );
        // The guard allows at most 12 questions even for direct statements.
        open = await eng.surveyStep(
          hrMaya,
          open.survey.id,
          "publish",
          { version: 2 },
          randomUUID(),
        );
        assert.equal(open.survey.status, "published");
        assert.equal(open.survey.acceptingAnswers, true);
        assert.ok(open.survey.eligibleCount! >= 6);
        assert.equal(open.survey.responseCount, 0);
        assert.equal(
          await status(
            eng.updateSurvey(
              hrMaya,
              open.survey.id,
              { ...surveyInput("Late"), version: 3 },
              randomUUID(),
            ),
          ),
          409,
        );
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query("DELETE FROM eng_survey_question WHERE survey_id=$1", [
                open.survey.id,
              ]),
            ),
          ),
          "EG004",
        );
        const seen = await eng.surveyDetail(arjunE, open.survey.id);
        assert.equal(seen.survey.canRespond, true);
        assert.equal(seen.survey.responded, false);
        assert.equal(seen.survey.responseCount, null, "counts are HR-only");
        assert.ok(
          (await eng.listSurveys(arjunE, { page: 1, limit: 100 })).items.some(
            (s) => s.id === open.survey.id,
          ),
        );
        small = await newSurvey("Small");
        small = await eng.surveyStep(
          hrMaya,
          small.survey.id,
          "publish",
          { version: 1 },
          randomUUID(),
        );
      },
    );

    await t.test(
      "answers: once per person, validated, never before the window",
      async () => {
        const people = [arjunE, zaraE, neelM, rohanE, kabirE];
        for (const [i, who] of people.entries())
          await eng.respond(
            who,
            open.survey.id,
            { answers: answers(open, i + 1, i % 3, `Answer ${i} ${secret}`) },
            randomUUID(),
          );
        assert.equal(
          await status(
            eng.respond(
              arjunE,
              open.survey.id,
              { answers: answers(open, 3, 0) },
              randomUUID(),
            ),
          ),
          409,
          "double answer",
        );
        assert.equal(
          await sqlState(
            scoped(pool, arjunE, (c) =>
              c.query("SELECT eng_submit_response($1,'[]'::jsonb)", [
                open.survey.id,
              ]),
            ),
          ),
          "EG004",
        );
        // Missing a required question, an out-of-range option, or a foreign question.
        assert.equal(
          await status(
            eng.respond(
              hrMaya,
              open.survey.id,
              { answers: answers(open, 3, 0).slice(1) },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await status(
            eng.respond(
              hrMaya,
              open.survey.id,
              { answers: answers(open, 3, 7) },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await status(
            eng.respond(
              hrMaya,
              open.survey.id,
              {
                answers: [
                  ...answers(open, 3, 0),
                  { questionId: randomUUID(), rating: 3 },
                ],
              },
              randomUUID(),
            ),
          ),
          400,
        );
        const after = await eng.surveyDetail(arjunE, open.survey.id);
        assert.equal(after.survey.responded, true);
        assert.equal(after.survey.canRespond, false);
        assert.equal(
          (await eng.surveyDetail(hrMaya, open.survey.id)).survey.responseCount,
          5,
        );
        // Not yet open: answers are refused.
        const later = await newSurvey("Later", iso(2 * DAY));
        await eng.surveyStep(
          hrMaya,
          later.survey.id,
          "publish",
          { version: 1 },
          randomUUID(),
        );
        assert.equal(
          await status(
            eng.respond(
              arjunE,
              later.survey.id,
              { answers: answers(later, 3, 0) },
              randomUUID(),
            ),
          ),
          409,
        );
        // A survey that does not exist answers like one that is not yours.
        assert.equal(
          await status(
            eng.respond(arjunE, randomUUID(), { answers: [] }, randomUUID()),
          ),
          404,
        );
        for (const [i, who] of [arjunE, zaraE, neelM, rohanE].entries())
          await eng.respond(
            who,
            small.survey.id,
            { answers: answers(small, 4, i % 2) },
            randomUUID(),
          );
      },
    );

    await t.test(
      "results: HR only, aggregates only, after close and with at least 5 answers",
      async () => {
        assert.equal(await status(eng.results(arjunE, open.survey.id)), 403);
        assert.equal(
          await sqlState(
            scoped(pool, arjunE, (c) =>
              c.query("SELECT eng_survey_results($1)", [open.survey.id]),
            ),
          ),
          "EG005",
        );
        const whileOpen = await eng.results(hrMaya, open.survey.id);
        assert.equal(whileOpen.released, false);
        assert.equal(whileOpen.withheld, "open");
        assert.equal(whileOpen.responses, 5);
        assert.deepEqual(whileOpen.questions, []);
        assert.equal(
          await status(
            eng.surveyStep(
              hrMaya,
              open.survey.id,
              "close",
              { version: 99 },
              randomUUID(),
            ),
          ),
          409,
        );
        await eng.surveyStep(
          hrMaya,
          open.survey.id,
          "close",
          { version: 3 },
          randomUUID(),
        );
        assert.equal(
          await status(
            eng.respond(
              hrMaya,
              open.survey.id,
              { answers: answers(open, 3, 0) },
              randomUUID(),
            ),
          ),
          409,
          "closed",
        );
        const released = await eng.results(hrMaya, open.survey.id);
        assert.equal(released.released, true);
        assert.equal(released.responses, 5);
        const [rating, choice, text] = released.questions;
        assert.deepEqual(rating!.counts, [1, 1, 1, 1, 1]);
        assert.equal(rating!.average, 3);
        assert.deepEqual(choice!.counts, [2, 2, 1]);
        assert.deepEqual(choice!.options, ["Team", "Work", "Learning"]);
        assert.equal(text!.answered, 5);
        assert.deepEqual(
          [...text!.texts!].sort(),
          [0, 1, 2, 3, 4].map((i) => `Answer ${i} ${secret}`).sort(),
        );
        // Below the threshold: the count only, even once closed.
        await eng.surveyStep(
          hrMaya,
          small.survey.id,
          "close",
          { version: 2 },
          randomUUID(),
        );
        const few = await eng.results(hrMaya, small.survey.id);
        assert.equal(few.released, false);
        assert.equal(few.withheld, "too_few_responses");
        assert.equal(few.responses, 4);
        assert.deepEqual(few.questions, []);
      },
    );

    await t.test(
      "anonymity: no column, privilege or join links an answer to a person",
      async () => {
        const columns = await admin.query<{
          column_name: string;
          data_type: string;
          column_default: string | null;
          is_identity: string;
        }>(
          `SELECT column_name, data_type, column_default, is_identity FROM information_schema.columns
         WHERE table_schema='public' AND table_name='eng_survey_answer' ORDER BY column_name`,
        );
        assert.deepEqual(
          columns.rows.map((c) => c.column_name),
          [
            "choice",
            "entity_id",
            "id",
            "question_id",
            "rating",
            "survey_id",
            "tenant_id",
            "text_value",
          ],
        );
        for (const c of columns.rows) {
          assert.ok(
            !/time|date/.test(c.data_type),
            `${c.column_name} ${c.data_type}`,
          );
          assert.equal(c.is_identity, "NO");
          assert.ok(!/nextval/.test(c.column_default ?? ""), c.column_name);
        }
        const participation = await admin.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public'
         AND table_name='eng_survey_participation' ORDER BY column_name`,
        );
        assert.deepEqual(
          participation.rows.map((c) => c.column_name),
          ["employee_id", "entity_id", "survey_id", "tenant_id"],
        );
        // Foreign keys from answers reach questions only, never participation or employees.
        const fks = await admin.query<{ ref: string }>(
          `SELECT confrelid::regclass::text AS ref FROM pg_constraint WHERE conrelid='eng_survey_answer'::regclass AND contype='f'`,
        );
        assert.deepEqual(
          fks.rows.map((r) => r.ref),
          ["eng_survey_question"],
        );
        // Privileges: the app role (HR included) cannot touch answers; no role reads both tables.
        const priv = await admin.query<Record<string, boolean>>(
          `SELECT has_table_privilege('anvione_app','eng_survey_answer','SELECT') AS app_answers,
           has_table_privilege('anvione_app','eng_survey_answer','INSERT') AS app_insert_answers,
           has_table_privilege('anvione_app','eng_survey_participation','INSERT') AS app_insert_participation,
           has_table_privilege('anvione_engage_keeper','eng_survey_participation','SELECT') AS keeper_participation,
           has_table_privilege('anvione_engage_writer','eng_survey_answer','SELECT') AS writer_answers,
           has_table_privilege('anvione_engage_writer','eng_survey_participation','SELECT') AS writer_participation,
           has_table_privilege('anvione_engage_keeper','eng_survey_answer','SELECT') AS keeper_answers`,
        );
        assert.deepEqual(priv.rows[0], {
          app_answers: false,
          app_insert_answers: false,
          app_insert_participation: false,
          keeper_participation: false,
          writer_answers: false,
          writer_participation: false,
          keeper_answers: true,
        });
        for (const who of [hrMaya, arjunE])
          assert.equal(
            await sqlState(
              scoped(pool, who, (c) =>
                c.query("SELECT * FROM eng_survey_answer"),
              ),
            ),
            "42501",
          );
        // Participation-only queries: HR sees only their own row, never who answered.
        const hrSees = await scoped(pool, hrMaya, (c) =>
          c.query(
            "SELECT employee_id FROM eng_survey_participation WHERE survey_id=$1",
            [open.survey.id],
          ),
        );
        assert.equal(
          hrSees.rowCount,
          0,
          "HR did not answer and sees nobody else",
        );
        const arjunSees = await scoped(pool, arjunE, (c) =>
          c.query<{ employee_id: string }>(
            "SELECT employee_id FROM eng_survey_participation WHERE survey_id=$1",
            [open.survey.id],
          ),
        );
        assert.deepEqual(
          arjunSees.rows.map((r) => r.employee_id),
          [arjun],
        );
        // Direct writes into either table are refused for the app role.
        for (const sql of [
          "INSERT INTO eng_survey_participation(tenant_id,entity_id,survey_id,employee_id) VALUES ($1,$2,$3,$4)",
          "INSERT INTO eng_survey_answer(tenant_id,entity_id,survey_id,question_id,rating) VALUES ($1,$2,$3,$4,5)",
        ])
          assert.equal(
            await sqlState(
              scoped(pool, hrMaya, (c) =>
                c.query(sql, [
                  actor.tenantId,
                  actor.entityId,
                  open.survey.id,
                  sql.includes("answer") ? open.questions[0]!.id : maya,
                ]),
              ),
            ),
            "42501",
            sql,
          );
        // The counter changes only through the writer.
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query("UPDATE eng_survey SET response_count=0 WHERE id=$1", [
                open.survey.id,
              ]),
            ),
          ),
          "42501",
        );
        // Answers, participation and eligibility are final, even for the migrator.
        for (const table of [
          "eng_survey_answer",
          "eng_survey_participation",
          "eng_survey_eligible",
        ]) {
          assert.equal(
            await sqlState(
              admin.query(`DELETE FROM ${table} WHERE survey_id=$1`, [
                open.survey.id,
              ]),
            ),
            "23514",
            table,
          );
          assert.equal(
            await sqlState(
              admin.query(
                `UPDATE ${table} SET survey_id=survey_id WHERE survey_id=$1`,
                [open.survey.id],
              ),
            ),
            "EG004",
            table,
          );
          assert.equal(
            await sqlState(admin.query(`TRUNCATE ${table} CASCADE`)),
            "23514",
            table,
          );
        }
        assert.equal(
          await sqlState(
            admin.query(
              "INSERT INTO eng_survey_answer(tenant_id,entity_id,survey_id,question_id,rating) VALUES ($1,$2,$3,$4,5)",
              [
                actor.tenantId,
                actor.entityId,
                open.survey.id,
                open.questions[0]!.id,
              ],
            ),
          ),
          "EG005",
        );
        for (const table of [
          "eng_value",
          "eng_kudos",
          "eng_kudos_moderation",
          "eng_reaction",
          "eng_survey",
          "eng_survey_question",
        ])
          assert.equal(
            await sqlState(admin.query(`TRUNCATE ${table} CASCADE`)),
            "23514",
            table,
          );
      },
    );

    await t.test("direct statements as the app role are refused", async () => {
      const id = first.kudos.id;
      for (const sql of [
        "UPDATE eng_kudos SET message='changed' WHERE id=$1",
        "UPDATE eng_kudos SET hidden=true WHERE id=$1",
        "DELETE FROM eng_kudos WHERE id=$1",
        "DELETE FROM eng_kudos_moderation WHERE kudos_id=$1",
        "TRUNCATE eng_reaction",
      ])
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query(sql, sql.includes("$1") ? [id] : []),
            ),
          ),
          "42501",
          sql,
        );
      assert.equal(
        await sqlState(
          scoped(pool, arjunE, (c) =>
            c.query(
              "INSERT INTO eng_kudos_moderation(id,tenant_id,entity_id,kudos_id,action,reason) VALUES ($1,$2,$3,$4,'hide','Because')",
              [randomUUID(), actor.tenantId, actor.entityId, id],
            ),
          ),
        ),
        "EG005",
      );
      assert.equal(
        await sqlState(
          scoped(pool, arjunE, (c) =>
            c.query(
              "UPDATE eng_survey SET status='closed', version=version+1 WHERE id=$1",
              [small.survey.id],
            ),
          ),
        ),
        "ok",
        "RLS: an employee's update matches no rows",
      );
      assert.equal(
        (await eng.surveyDetail(hrMaya, small.survey.id)).survey.version,
        3,
      );
      // A forged giver is replaced by the caller.
      const forged = randomUUID();
      await scoped(pool, zaraE, (c) =>
        c.query(
          "INSERT INTO eng_kudos(id,tenant_id,entity_id,recipient_employee_id,value_id,message) VALUES ($1,$2,$3,$4,$5,'Forged giver')",
          [forged, actor.tenantId, actor.entityId, rohan, valueId()],
        ),
      );
      ids.kudos.push(forged);
      assert.equal(
        (await eng.kudosDetail(rohanE, forged)).kudos.giverEmployeeId,
        zara,
      );
    });

    await t.test("tenant and entity isolation", async () => {
      for (const who of [
        { ...hrMaya, tenantId: randomUUID() },
        { ...hrMaya, entityId: randomUUID() },
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM eng_kudos)+(SELECT count(*) FROM eng_value)+(SELECT count(*) FROM eng_reaction)
              +(SELECT count(*) FROM eng_kudos_moderation)+(SELECT count(*) FROM eng_survey)
              +(SELECT count(*) FROM eng_survey_question)+(SELECT count(*) FROM eng_survey_eligible)
              +(SELECT count(*) FROM eng_survey_participation)+(SELECT count(*) FROM eng_colleagues('')) AS n`,
          ),
        );
        assert.equal(Number(seen.rows[0]!.n), 0);
        assert.equal(await status(eng.kudosDetail(who, first.kudos.id)), 404);
        assert.equal(await status(eng.surveyDetail(who, open.survey.id)), 404);
        assert.equal(await status(eng.results(who, open.survey.id)), 404);
      }
    });

    await t.test(
      "064: HR never moderates their own recognition; late answers never follow a release",
      async () => {
        const toMaya = await give(rohanE, maya, `For Maya ${secret}`);
        const id = toMaya.kudos.id;
        assert.equal(
          await status(
            eng.moderate(
              hrMaya,
              id,
              "hide",
              { version: 1, reason: "Self serving" },
              randomUUID(),
            ),
          ),
          403,
        );
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query(
                "INSERT INTO eng_kudos_moderation(id,tenant_id,entity_id,kudos_id,action,reason) VALUES ($1,$2,$3,$4,'hide','Because')",
                [randomUUID(), actor.tenantId, actor.entityId, id],
              ),
            ),
          ),
          "EG005",
        );
        // Another HR colleague can.
        const hrKabir = as(kabir, "Kabir (synthetic HR)", "hr_admin");
        const hidden = await eng.moderate(
          hrKabir,
          id,
          "hide",
          { version: 1, reason: "Reviewed by a colleague" },
          randomUUID(),
        );
        assert.equal(hidden.kudos.hidden, true);

        // A survey closed by time is released only after a grace period, so an answer that
        // began before the close time cannot land after HR has read results.
        const timed = await newSurvey("Timed");
        await eng.surveyStep(
          hrMaya,
          timed.survey.id,
          "publish",
          { version: 1 },
          randomUUID(),
        );
        for (const [i, who] of [arjunE, zaraE, neelM, rohanE, kabirE].entries())
          await eng.respond(
            who,
            timed.survey.id,
            { answers: answers(timed, (i % 5) + 1, 0) },
            randomUUID(),
          );
        const shift = (closesAt: string) =>
          transaction(admin, async (client) => {
            await client.query("SET LOCAL session_replication_role = replica");
            const restore = await alwaysOff(client);
            await client.query(
              "UPDATE eng_survey SET opens_at=$2::timestamptz-interval '1 hour', closes_at=$2 WHERE id=$1",
              [timed.survey.id, closesAt],
            );
            await restore();
          });
        await shift(iso(-30000));
        const early = await eng.results(hrMaya, timed.survey.id);
        assert.equal(early.released, false);
        assert.equal(early.withheld, "open");
        // Past the close time, even a direct call is refused (wall clock, not transaction start).
        assert.equal(
          await sqlState(
            scoped(pool, hrMaya, (c) =>
              c.query("SELECT eng_submit_response($1,$2::jsonb)", [
                timed.survey.id,
                JSON.stringify(answers(timed, 3, 0)),
              ]),
            ),
          ),
          "EG004",
        );
        await shift(iso(-5 * 60000));
        const late = await eng.results(hrMaya, timed.survey.id);
        assert.equal(late.released, true);
        assert.equal(late.responses, 5);
      },
    );

    await t.test(
      "pagination, and no free text in audit or outbox",
      async () => {
        const page1 = await eng.listKudos(rohanE, {
          page: 1,
          limit: 2,
          view: "feed",
        });
        const page2 = await eng.listKudos(rohanE, {
          page: 2,
          limit: 2,
          view: "feed",
        });
        assert.equal(page1.items.length, 2);
        assert.ok(page1.total >= 11);
        assert.ok(
          page2.items.every((k) => !page1.items.some((p) => p.id === k.id)),
        );
        const surveys = await eng.listSurveys(hrMaya, { page: 1, limit: 1 });
        assert.equal(surveys.items.length, 1);
        assert.equal(
          Object.values(surveys.counts).reduce((a, b) => a + b, 0),
          surveys.total,
        );
        const httpFeed = (await (
          await request("/engage/kudos?limit=2&page=1")
        ).json()) as EngKudosList;
        assert.equal(httpFeed.limit, 2);
        const auditRows = await admin.query<{
          action: string;
          details: unknown;
          reason: string | null;
        }>(
          "SELECT action, details, reason FROM audit_event WHERE action LIKE 'engage.%' AND target=ANY($1::text[])",
          [
            [
              ...ids.kudos.map((i) => `eng-kudos:${i}`),
              ...ids.surveys.map((i) => `eng-survey:${i}`),
              ...ids.values.map((i) => `eng-value:${i}`),
            ],
          ],
        );
        assert.ok(auditRows.rows.length > 20);
        for (const row of auditRows.rows) {
          const text = JSON.stringify(row);
          for (const marker of [
            secret,
            "Off topic",
            "Reviewed again",
            "Answer ",
            "Courage",
          ])
            assert.ok(!text.includes(marker), `${row.action} ${text}`);
          assert.ok(
            !/message|reason"|prompt|title|text|rating|choice/.test(
              JSON.stringify(row.details),
            ),
            text,
          );
        }
        // 064: answering writes no audit row (it would name who answered which survey, and when).
        assert.equal(
          auditRows.rows.filter((r) => r.action === "engage.survey_responded")
            .length,
          0,
        );
        const outbox = await admin.query<{ t: string }>(
          "SELECT DISTINCT event_type AS t FROM outbox_event WHERE event_type LIKE 'engage.%'",
        );
        for (const type of [
          "engage.value_created.v1",
          "engage.value_updated.v1",
          "engage.kudos_given.v1",
          "engage.kudos_hidden.v1",
          "engage.kudos_restored.v1",
          "engage.reaction_added.v1",
          "engage.reaction_removed.v1",
          "engage.survey_created.v1",
          "engage.survey_updated.v1",
          "engage.survey_published.v1",
          "engage.survey_closed.v1",
          "engage.survey_responded.v1",
        ])
          assert.ok(
            outbox.rows.some((r) => r.t === type),
            type,
          );
      },
    );
  } finally {
    // Synthetic cleanup only: recognition and survey records are never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      const reactions = (
        await client.query<{ id: string }>(
          "SELECT id FROM eng_reaction WHERE kudos_id=ANY($1::uuid[])",
          [ids.kudos],
        )
      ).rows.map((r) => r.id);
      await client.query(
        "DELETE FROM outbox_event WHERE event_type LIKE 'engage.%' AND (aggregate_id=ANY($1::uuid[]) OR event_type LIKE 'engage.reaction_%')",
        [[...ids.kudos, ...ids.surveys, ...ids.values, ...reactions]],
      );
      await client.query(
        "DELETE FROM audit_event WHERE action LIKE 'engage.%' AND target=ANY($1::text[])",
        [
          [
            ...ids.kudos.map((i) => `eng-kudos:${i}`),
            ...ids.surveys.map((i) => `eng-survey:${i}`),
            ...ids.values.map((i) => `eng-value:${i}`),
          ],
        ],
      );
      await client.query(
        "DELETE FROM eng_survey_answer WHERE survey_id=ANY($1::uuid[])",
        [ids.surveys],
      );
      await client.query(
        "DELETE FROM eng_survey_participation WHERE survey_id=ANY($1::uuid[])",
        [ids.surveys],
      );
      await client.query(
        "DELETE FROM eng_survey_eligible WHERE survey_id=ANY($1::uuid[])",
        [ids.surveys],
      );
      await client.query(
        "DELETE FROM eng_survey_question WHERE survey_id=ANY($1::uuid[])",
        [ids.surveys],
      );
      await client.query("DELETE FROM eng_survey WHERE id=ANY($1::uuid[])", [
        ids.surveys,
      ]);
      await client.query(
        "DELETE FROM eng_reaction WHERE kudos_id=ANY($1::uuid[])",
        [ids.kudos],
      );
      await client.query(
        "DELETE FROM eng_kudos_moderation WHERE kudos_id=ANY($1::uuid[])",
        [ids.kudos],
      );
      await client.query("DELETE FROM eng_kudos WHERE id=ANY($1::uuid[])", [
        ids.kudos,
      ]);
      await client.query("DELETE FROM eng_value WHERE id=ANY($1::uuid[])", [
        ids.values,
      ]);
      await restore();
    });
    await Promise.all([admin.end(), pool.end(), app.close()]);
    await store.pool.end();
  }
});
