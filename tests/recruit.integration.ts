import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { RecruitStore } from "../apps/api/src/recruit.store";
import {
  makePool,
  scoped,
  transaction,
  type PoolClient,
} from "../packages/database/src/index";
import { rehashCandidates } from "../scripts/recruit-rehash";
import { profileKeys } from "../apps/api/src/profile.crypto";
import type {
  RecruitApplication,
  RecruitApplicationList,
  RecruitCandidate,
  RecruitRequisition,
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

const PORT = Number(process.env.RECRUIT_TEST_PORT ?? 4513);
const arjun = "30000000-0000-4000-8000-000000000002";
const rohan = "30000000-0000-4000-8000-000000000006";
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
const message = async (work: Promise<unknown>) => {
  try {
    await work;
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};
const hoursFromNow = (hours: number) => {
  const at = new Date(Date.now() + hours * 3600000);
  at.setUTCMinutes(0, 0, 0);
  return at.toISOString();
};

await test("Recruitment: requisitions, candidates, applications, interviews, scorecards and offers", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: String(PORT) });
  const { app, store } = await createApp(config);
  await app.listen(PORT, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const pool = makePool(process.env.DATABASE_URL!);
  const recruit = new RecruitStore(store);
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
  const [{ id: other }, { id: bystander }] = (
    await admin.query<{ id: string }>(
      `SELECT id FROM employee WHERE tenant_id=$1 AND entity_id=$2 AND status='active' AND id<>ALL($3::uuid[])
       ORDER BY id LIMIT 2`,
      [actor.tenantId, actor.entityId, [maya, arjun, rohan]],
    )
  ).rows as [{ id: string }, { id: string }];
  const units = (
    await admin.query<{ id: string; kind: string }>(
      `SELECT DISTINCT ON (kind) id, kind FROM org_unit WHERE tenant_id=$1 AND entity_id=$2
       AND kind IN ('department','location') AND active AND merged_into_id IS NULL
       AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY kind, id`,
      [actor.tenantId, actor.entityId],
    )
  ).rows;
  const dept = units.find((u) => u.kind === "department")!.id;
  const loc = units.find((u) => u.kind === "location")!.id;
  const hrMaya = as(maya, "Maya (synthetic HR)", "hr_admin");
  const mgrMaya = as(maya, "Maya (synthetic manager)", "manager");
  const hrRohan = as(rohan, "Rohan (synthetic HR)", "hr_admin");
  const mgrRohan = as(rohan, "Rohan (synthetic manager)", "manager");
  const arjunE = as(arjun, "Arjun (synthetic)", "employee");
  const rohanE = as(rohan, "Rohan (synthetic)", "employee");
  const otherE = as(other, "Other (synthetic)", "employee");
  const auditor = as(maya, "Maya (auditor)", "auditor");
  const ids = {
    requisitions: [] as string[],
    candidates: [] as string[],
    cases: [] as string[],
  };
  // Rohan gets a synthetic HR and manager binding for four-eyes steps; removed in cleanup.
  const rohanBinding = randomUUID();
  await admin.query(
    `INSERT INTO identity_binding(id,tenant_id,entity_id,employee_id,issuer,subject,active,roles)
     VALUES ($1,$2,$3,$4,'urn:anvione:recruit-test',$5,true,ARRAY['employee','manager','hr_admin'])`,
    [rohanBinding, actor.tenantId, actor.entityId, rohan, `recruit-${run}`],
  );
  const requisitionBody = {
    title: `Synthetic engineer ${run}`,
    departmentId: dept,
    locationId: loc,
    headcount: 1,
    employmentType: "full_time" as const,
  };
  const newRequisition = async (who = mgrMaya, extra = {}) => {
    const created = await recruit.createRequisition(
      who,
      { ...requisitionBody, ...extra },
      randomUUID(),
    );
    ids.requisitions.push(created.id);
    return created;
  };
  const step = (
    who: typeof hrMaya,
    r: RecruitRequisition,
    s: Parameters<RecruitStore["requisitionStep"]>[2],
    note?: string,
  ) =>
    recruit.requisitionStep(
      who,
      r.id,
      s,
      { version: r.version, note },
      randomUUID(),
    );
  const emails: string[] = [];
  const names: string[] = [];
  const newCandidate = async (n: number, extra = {}) => {
    const email = `cand${n}-${run}@example.test`;
    const name = `Candidate ${n} ${run}`;
    emails.push(email);
    names.push(name);
    const c = await recruit.createCandidate(
      hrMaya,
      {
        name,
        email,
        phone: `+91 98${run.replace(/\D/g, "1").padEnd(6, "1").slice(0, 6)}${n}0`,
        currentCompany: "Synthetic Co",
        totalExperienceMonths: 36,
        source: "portal",
        consentGiven: true,
        ...extra,
      },
      randomUUID(),
    );
    ids.candidates.push(c.id);
    return c;
  };
  const apply = (c: RecruitCandidate, r: RecruitRequisition) =>
    recruit.createApplication(
      hrMaya,
      { candidateId: c.id, requisitionId: r.id },
      randomUUID(),
    );
  const move = (
    who: typeof hrMaya,
    a: RecruitApplication,
    stage: RecruitApplication["stage"],
    extra: { reason?: string; rejectionReason?: "experience" } = {},
  ) =>
    recruit.changeStage(
      who,
      a.id,
      { version: a.version, stage, ...extra },
      randomUUID(),
    );
  // Recruitment guards fire ALWAYS (even in replica sessions); synthetic setup and cleanup
  // switch them off inside their own transaction and switch them back on before commit.
  const alwaysOff = async (client: PoolClient) => {
    const { rows } = await client.query<{ t: string; name: string }>(
      `SELECT tgrelid::regclass::text AS t, tgname AS name FROM pg_trigger
       WHERE tgenabled='A' AND tgrelid::regclass::text LIKE ANY(ARRAY['job_requisition','ats_candidate','recruit_%'])`,
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
  const toPast = (interviewId: string) =>
    transaction(admin, async (client) => {
      const restore = await alwaysOff(client);
      await client.query(
        "UPDATE recruit_interview SET scheduled_at=now()-interval '2 hours', ends_at=now()-interval '1 hour' WHERE id=$1",
        [interviewId],
      );
      await restore();
    });

  let r1: RecruitRequisition;
  let c1: RecruitCandidate;
  let c2: RecruitCandidate;
  let c3: RecruitCandidate;
  let c4: RecruitCandidate;
  let a1: RecruitApplication;
  let a2: RecruitApplication;
  let a3: RecruitApplication;
  let a4: RecruitApplication;
  let interviewId = "";

  try {
    await t.test("access follows the recruit permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/recruit/requisitions",
          "/recruit/candidates",
          "/recruit/applications",
          "/recruit/interviews/mine",
          "/recruit/funnel",
          "/recruit/lookups",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      await changeRole("employee");
      assert.equal((await request("/recruit/interviews/mine")).status, 200);
      for (const path of [
        "/recruit/requisitions",
        "/recruit/candidates",
        "/recruit/applications",
        "/recruit/offers",
        "/recruit/funnel",
        "/recruit/lookups",
      ])
        assert.equal((await request(path)).status, 403, `employee ${path}`);
      await changeRole("manager");
      assert.equal((await request("/recruit/requisitions")).status, 200);
      assert.equal((await request("/recruit/funnel")).status, 200);
      assert.equal((await request("/recruit/candidates")).status, 403);
      assert.equal((await request("/recruit/offers")).status, 403);
      await changeRole("hr_admin");
      for (const path of [
        "/recruit/requisitions",
        "/recruit/candidates",
        "/recruit/applications",
        "/recruit/offers",
        "/recruit/interviews",
        "/recruit/funnel",
      ])
        assert.equal((await request(path)).status, 200, `hr ${path}`);
    });

    await t.test(
      "lookups give requesters id, code and name of in-effect units only",
      async () => {
        await changeRole("manager");
        const response = await request("/recruit/lookups");
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<
          string,
          Array<Record<string, unknown>>
        >;
        assert.deepEqual(Object.keys(body).sort(), [
          "departments",
          "designations",
          "locations",
        ]);
        const kinds = {
          departments: "department",
          locations: "location",
          designations: "designation",
        } as const;
        for (const [key, kind] of Object.entries(kinds)) {
          for (const item of body[key]!)
            assert.deepEqual(Object.keys(item).sort(), ["code", "id", "name"]);
          const expected = (
            await admin.query<{ id: string }>(
              `SELECT id FROM org_unit WHERE tenant_id=$1 AND entity_id=$2 AND kind=$3
               AND active AND merged_into_id IS NULL AND effective_from<=org_entity_today($1,$2)
               AND (effective_to IS NULL OR effective_to>=org_entity_today($1,$2))`,
              [actor.tenantId, actor.entityId, kind],
            )
          ).rows.map((row) => row.id);
          assert.deepEqual(
            body[key]!.map((item) => item.id).sort(),
            expected.sort(),
            key,
          );
        }
        assert.ok(body.departments!.some((item) => item.id === dept));
        // Tenant isolation: no unit from any other tenant or entity leaks through.
        const foreign = new Set(
          (
            await admin.query<{ id: string }>(
              "SELECT id FROM org_unit WHERE tenant_id<>$1 OR entity_id<>$2",
              [actor.tenantId, actor.entityId],
            )
          ).rows.map((row) => row.id),
        );
        for (const key of Object.keys(kinds))
          for (const item of body[key]!)
            assert.ok(!foreign.has(item.id as string), `foreign ${key}`);
        // A requester in another tenant sees nothing of this one.
        const elsewhere = await recruit.lookups({
          ...mgrMaya,
          tenantId: randomUUID(),
          entityId: randomUUID(),
        });
        assert.deepEqual(elsewhere, {
          departments: [],
          locations: [],
          designations: [],
        });
        // HR may use it too; employees and auditors may not.
        assert.equal(await status(recruit.lookups(hrMaya)), 200);
        assert.equal(await status(recruit.lookups(arjunE)), 403);
        assert.equal(await status(recruit.lookups(auditor)), 403);
      },
    );

    await t.test("requisition lifecycle and four-eyes approval", async () => {
      assert.equal(
        await status(
          recruit.createRequisition(
            mgrMaya,
            { ...requisitionBody, hiringManagerId: rohan },
            randomUUID(),
          ),
        ),
        403,
        "a manager raises only for themselves",
      );
      let r = await newRequisition();
      assert.match(r.code, /^REQ-\d{6}$/);
      assert.equal(r.status, "draft");
      assert.equal(r.canSubmit, true);
      assert.equal(await status(step(hrMaya, r, "open")), 409);
      r = await step(mgrMaya, r, "submit");
      assert.equal(r.status, "pending_approval");
      assert.equal(
        await status(step(hrMaya, r, "approve")),
        403,
        "HR who is the hiring manager cannot approve",
      );
      assert.equal(await status(step(mgrMaya, r, "approve")), 403);
      // HR raising for someone else still cannot approve their own request.
      let own = await newRequisition(hrRohan, { hiringManagerId: rohan });
      own = await step(hrRohan, own, "submit");
      assert.equal(await status(step(hrRohan, own, "approve")), 403);
      assert.equal(
        (await step(hrMaya, own, "reject", "Budget moved to next quarter"))
          .status,
        "rejected",
      );
      r = await step(hrRohan, r, "approve");
      assert.equal(r.status, "approved");
      assert.equal(r.approvedBy, "Rohan (synthetic HR)");
      assert.equal(await status(step(mgrMaya, r, "open")), 403);
      r = await step(hrMaya, r, "open");
      assert.equal(r.canAddCandidates, true);
      assert.equal(
        await status(step(hrMaya, r, "close")),
        400,
        "closing needs a reason",
      );
      r = await step(hrMaya, r, "hold");
      r = await step(hrMaya, r, "open");
      r1 = r;
      // The other manager does not see Maya's requisition.
      const others = await recruit.listRequisitions(mgrRohan, {
        page: 1,
        limit: 100,
        q: run,
      });
      assert.ok(!others.items.some((i) => i.id === r1.id));
      // Edits after approval are HR's; the code never changes.
      const edited = await recruit.updateRequisition(
        hrMaya,
        r1.id,
        {
          ...requisitionBody,
          version: r1.version,
          headcount: 1,
          hiringManagerId: maya,
          description: "Synthetic description",
        },
        randomUUID(),
      );
      assert.equal(edited.code, r1.code);
      r1 = edited;
      // A material edit after approval needs a fresh approval by someone else.
      let again = await newRequisition(hrRohan, { hiringManagerId: rohan });
      again = await step(hrRohan, again, "submit");
      again = await step(hrMaya, again, "approve");
      again = await recruit.updateRequisition(
        hrRohan,
        again.id,
        {
          ...requisitionBody,
          version: again.version,
          headcount: 3,
          hiringManagerId: rohan,
        },
        randomUUID(),
      );
      assert.equal(again.status, "pending_approval");
      assert.equal(again.needsReapproval, true);
      assert.equal(again.canDecide, false);
      assert.equal(await status(step(hrRohan, again, "approve")), 403);
      again = await step(hrMaya, again, "approve");
      assert.equal(again.status, "approved");
      assert.equal(again.needsReapproval, false);
    });

    await t.test(
      "candidates: consent, sealing, duplicates and who sees contact details",
      async () => {
        assert.equal(
          await status(
            recruit.createCandidate(
              hrMaya,
              {
                name: "No consent",
                email: `noconsent-${run}@example.test`,
                totalExperienceMonths: 0,
                source: "direct",
                consentGiven: false,
              },
              randomUUID(),
            ),
          ),
          400,
        );
        c1 = await newCandidate(1);
        assert.equal(c1.email, emails[0]);
        assert.ok(c1.phone);
        assert.equal(c1.contactVisible, true);
        assert.ok(c1.retentionUntil);
        // Lists mask contact details; the full read is audited with ids only.
        const listed = (
          await recruit.listCandidates(hrMaya, { page: 1, limit: 100, q: run })
        ).items.find((c) => c.id === c1.id)!;
        assert.equal(listed.contactMasked, true);
        assert.match(listed.email!, /^c\*\*\*@e\*\*\*\.test$/);
        assert.match(listed.phone!, /^\*{6}\d{4}$/);
        const viewRequest = randomUUID();
        const full = await recruit.candidateDetail(hrMaya, c1.id, viewRequest);
        assert.equal(full.email, emails[0]);
        const viewed = await admin.query<{ row: string }>(
          "SELECT row_to_json(e)::text AS row FROM audit_event e WHERE action='recruit.candidate_viewed' AND request_id=$1",
          [viewRequest],
        );
        assert.equal(viewed.rows.length, 1);
        assert.ok(!viewed.rows[0]!.row.includes(emails[0]!));
        c2 = await newCandidate(2);
        c3 = await newCandidate(3);
        c4 = await newCandidate(4);
        const duplicate = message(
          recruit.createCandidate(
            hrMaya,
            {
              name: "Someone else",
              email: emails[0]!.toUpperCase(),
              totalExperienceMonths: 1,
              source: "agency",
              consentGiven: true,
            },
            randomUUID(),
          ),
        );
        assert.match(await duplicate, new RegExp(c1.id));
        // Non-HR cannot create (so never learns who the duplicate is).
        assert.equal(
          await status(
            recruit.createCandidate(
              mgrMaya,
              {
                name: "x",
                email: emails[0]!,
                totalExperienceMonths: 1,
                source: "agency",
                consentGiven: true,
              },
              randomUUID(),
            ),
          ),
          403,
        );
        const stored = await admin.query<{ e: string; p: string }>(
          "SELECT email_sealed AS e, phone_sealed AS p FROM ats_candidate WHERE id=$1",
          [c1.id],
        );
        assert.ok(!stored.rows[0]!.e.includes("@"));
        assert.ok(!stored.rows[0]!.e.includes(run));
        const extended = await recruit.extendRetention(
          hrMaya,
          c1.id,
          { version: c1.version, retentionUntil: "2031-01-01" },
          randomUUID(),
        );
        assert.equal(extended.retentionUntil, "2031-01-01");
        c1 = extended;
        assert.equal(
          await status(
            recruit.extendRetention(
              hrMaya,
              c1.id,
              { version: c1.version, retentionUntil: "2030-01-01" },
              randomUUID(),
            ),
          ),
          400,
          "retention only extends",
        );
      },
    );

    await t.test("applications and the stage matrix", async () => {
      a1 = await apply(c1, r1);
      a2 = await apply(c2, r1);
      a3 = await apply(c3, r1);
      a4 = await apply(c4, r1);
      assert.equal(a1.stage, "applied");
      assert.equal(await status(apply(c1, r1)), 409);
      assert.equal(
        await status(
          recruit.createApplication(
            mgrMaya,
            { candidateId: c1.id, requisitionId: r1.id },
            randomUUID(),
          ),
        ),
        403,
      );
      // The hiring manager sees a limited candidate card, never contact details.
      const card = await recruit.candidateDetail(mgrMaya, c1.id);
      assert.equal(card.contactVisible, false);
      assert.equal(card.email, null);
      assert.equal(card.phone, null);
      assert.equal(card.currentCompany, "Synthetic Co");
      assert.equal(await status(recruit.candidateDetail(mgrRohan, c1.id)), 404);
      assert.ok(a1.allowedStages.includes("screening"));
      a1 = await move(mgrMaya, a1, "screening");
      assert.equal(
        await status(move(mgrMaya, a1, "applied", { reason: "Mistake made" })),
        403,
        "only HR moves back",
      );
      assert.equal(await status(move(mgrMaya, a1, "withdrawn")), 403);
      assert.equal(await status(move(hrMaya, a1, "applied")), 400, "reason");
      assert.equal(
        await status(move(hrMaya, a1, "offer")),
        400,
        "offers move the stage",
      );
      assert.equal(await status(move(mgrMaya, a3, "rejected")), 400);
      a3 = await move(mgrMaya, a3, "rejected", {
        rejectionReason: "experience",
      });
      assert.equal(a3.rejectionReason, "experience");
      assert.equal(
        await status(move(mgrMaya, a3, "applied", { reason: "Reconsidered" })),
        403,
      );
      assert.equal(
        await status(move(hrMaya, a3, "screening", { reason: "Reconsidered" })),
        409,
      );
      assert.equal(await status(move(hrMaya, a3, "applied")), 400);
      a3 = await move(hrMaya, a3, "applied", { reason: "Reconsidered" });
      assert.equal(a3.stage, "applied");
      a1 = await move(mgrMaya, a1, "interview");
      a2 = await move(hrMaya, a2, "interview");
      const detail = await recruit.applicationDetail(mgrMaya, a1.id);
      assert.deepEqual(
        detail.history.map((h) => h.toStage),
        ["applied", "screening", "interview"],
      );
      assert.deepEqual(detail.offers, []);
      // History is immutable, even for the owner role.
      await assert.rejects(
        admin.query(
          "UPDATE recruit_stage_history SET reason='rewritten' WHERE application_id=$1",
          [a1.id],
        ),
        /final/,
      );
    });

    await t.test(
      "interviews: panel conflicts, candidate conflicts and rescheduling",
      async () => {
        const at = hoursFromNow(48);
        const i1 = await recruit.createInterview(
          mgrMaya,
          {
            applicationId: a1.id,
            roundName: "Technical round",
            scheduledAt: at,
            durationMinutes: 60,
            mode: "video",
            locationOrLink: "https://meet.example.test/x",
            panel: [arjun, rohan],
          },
          randomUUID(),
        );
        interviewId = i1.id;
        assert.equal(i1.panel.length, 2);
        assert.equal(i1.canReschedule, true);
        const overlap = new Date(Date.parse(at) + 30 * 60000).toISOString();
        const base = {
          roundName: "Second round",
          scheduledAt: overlap,
          durationMinutes: 60,
          mode: "phone" as const,
        };
        assert.match(
          await message(
            recruit.createInterview(
              hrMaya,
              { ...base, applicationId: a2.id, panel: [arjun] },
              randomUUID(),
            ),
          ),
          /interviewer is already booked/,
        );
        assert.match(
          await message(
            recruit.createInterview(
              hrMaya,
              { ...base, applicationId: a1.id, panel: [other] },
              randomUUID(),
            ),
          ),
          /candidate already has an interview/,
        );
        assert.equal(
          await status(
            recruit.createInterview(
              hrMaya,
              {
                ...base,
                scheduledAt: hoursFromNow(-5),
                applicationId: a2.id,
                panel: [other],
              },
              randomUUID(),
            ),
          ),
          400,
        );
        assert.equal(
          await status(
            recruit.createInterview(
              mgrRohan,
              { ...base, applicationId: a2.id, panel: [other] },
              randomUUID(),
            ),
          ),
          404,
          "another manager cannot see the application",
        );
        const moved = await recruit.rescheduleInterview(
          mgrMaya,
          i1.id,
          {
            version: i1.version,
            scheduledAt: hoursFromNow(72),
            durationMinutes: 45,
            mode: "onsite",
          },
          randomUUID(),
        );
        assert.equal(moved.version, 2);
        // The old slot is free again.
        const freed = await recruit.createInterview(
          hrMaya,
          { ...base, applicationId: a2.id, panel: [arjun] },
          randomUUID(),
        );
        assert.equal(freed.status, "scheduled");
        // Interviewers see their own interviews only.
        const mine = await recruit.listInterviews(
          arjunE,
          { page: 1, limit: 25, q: run },
          true,
        );
        assert.ok(mine.items.some((i) => i.id === i1.id));
        const otherMine = await recruit.listInterviews(
          otherE,
          { page: 1, limit: 25, q: "" },
          true,
        );
        assert.ok(!otherMine.items.some((i) => i.id === i1.id));
        assert.equal(await status(recruit.interviewDetail(otherE, i1.id)), 404);
        assert.equal(
          await status(
            recruit.submitScorecard(
              arjunE,
              i1.id,
              { ratings: { skills: 4 }, recommendation: "yes" },
              randomUUID(),
            ),
          ),
          409,
          "not before the interview starts",
        );
      },
    );

    await t.test("blind scorecards, submitted once", async () => {
      await toPast(interviewId);
      assert.equal(
        await status(
          recruit.submitScorecard(
            otherE,
            interviewId,
            { ratings: { skills: 4 }, recommendation: "yes" },
            randomUUID(),
          ),
        ),
        404,
        "not on the panel",
      );
      const first = await recruit.submitScorecard(
        arjunE,
        interviewId,
        {
          ratings: { skills: 4, communication: 5 },
          recommendation: "strong_yes",
          comment: "Synthetic note",
        },
        randomUUID(),
      );
      assert.equal(first.items.length, 1);
      assert.equal(first.items[0]!.overall, 4.5);
      // Rohan has not submitted: Arjun's scorecard stays hidden from him.
      const blind = await recruit.scorecards(rohanE, interviewId);
      assert.equal(blind.items.length, 0);
      assert.equal(blind.blind, true);
      const second = await recruit.submitScorecard(
        rohanE,
        interviewId,
        { ratings: { skills: 2 }, recommendation: "no" },
        randomUUID(),
      );
      assert.equal(second.items.length, 2);
      assert.equal(second.blind, false);
      assert.equal(
        await status(
          recruit.submitScorecard(
            arjunE,
            interviewId,
            { ratings: { skills: 1 }, recommendation: "no" },
            randomUUID(),
          ),
        ),
        409,
      );
      const hm = await recruit.applicationDetail(mgrMaya, a1.id);
      assert.equal(hm.scorecards.items.length, 2);
      assert.equal(hm.application.ratingAverage, 3.25);
      assert.equal(hm.application.scorecardCount, 2);
      const done = await recruit.interviewDetail(mgrMaya, interviewId);
      await recruit.interviewStatus(
        mgrMaya,
        interviewId,
        { version: done.version, status: "completed" },
        randomUUID(),
      );
      await assert.rejects(
        admin.query(
          "UPDATE recruit_scorecard SET recommendation='yes' WHERE interview_id=$1",
          [interviewId],
        ),
        /final/,
      );
    });

    await t.test(
      "offers: four-eyes, one hire for the last headcount, pre-boarding hand-off",
      async () => {
        assert.equal(
          await status(
            recruit.createOffer(
              mgrMaya,
              { applicationId: a1.id, proposedJoiningDate: "2031-01-05" },
              randomUUID(),
            ),
          ),
          403,
        );
        const sent = [];
        for (const a of [a1, a2]) {
          let o = await recruit.createOffer(
            hrMaya,
            { applicationId: a.id, proposedJoiningDate: "2031-01-05" },
            randomUUID(),
          );
          assert.equal(o.managerId, maya, "prefilled from the requisition");
          assert.equal(
            await status(
              recruit.createOffer(
                hrMaya,
                { applicationId: a.id, proposedJoiningDate: "2031-01-05" },
                randomUUID(),
              ),
            ),
            409,
          );
          o = await recruit.offerStep(
            hrMaya,
            o.id,
            "pending_approval",
            { version: o.version },
            randomUUID(),
          );
          assert.equal(o.canApprove, false);
          assert.equal(
            await status(
              recruit.offerStep(
                hrMaya,
                o.id,
                "approved",
                { version: o.version },
                randomUUID(),
              ),
            ),
            403,
          );
          o = await recruit.offerStep(
            hrRohan,
            o.id,
            "approved",
            { version: o.version },
            randomUUID(),
          );
          o = await recruit.offerStep(
            hrMaya,
            o.id,
            "sent",
            { version: o.version },
            randomUUID(),
          );
          assert.ok(o.sentAt);
          sent.push(o);
        }
        const today = new Date().toISOString().slice(0, 10);
        const results = await Promise.allSettled(
          sent.map((o, n) =>
            recruit.acceptOffer(
              hrMaya,
              o.id,
              {
                version: o.version,
                respondedOn: today,
                preboardingEmail: `preboard${n}-${run}@anvi.example`,
              },
              randomUUID(),
            ),
          ),
        );
        const won = results.filter((r) => r.status === "fulfilled");
        assert.equal(won.length, 1, "only one hire fits the last headcount");
        const lost = results.find((r) => r.status === "rejected")!;
        assert.equal(
          (
            (lost as PromiseRejectedResult).reason as { getStatus(): number }
          ).getStatus(),
          409,
        );
        const accepted = (
          won[0] as PromiseFulfilledResult<
            Awaited<ReturnType<RecruitStore["acceptOffer"]>>
          >
        ).value;
        ids.cases.push(accepted.candidateCaseId);
        assert.equal(accepted.application.stage, "hired");
        assert.equal(accepted.offer.status, "accepted");
        assert.match(accepted.preboarding, /No email has been sent/);
        const cases = await admin.query<{ state: string; manager_id: string }>(
          "SELECT state, manager_id FROM candidate_case WHERE id IN (SELECT candidate_case_id FROM recruit_offer WHERE requisition_id=$1 AND candidate_case_id IS NOT NULL)",
          [r1.id],
        );
        assert.equal(cases.rows.length, 1);
        assert.equal(cases.rows[0]!.state, "draft");
        assert.equal(cases.rows[0]!.manager_id, maya);
        const req = await recruit.requisitionDetail(hrMaya, r1.id);
        assert.equal(req.filledCount, 1);
        assert.equal(
          await status(
            recruit.acceptOffer(
              hrMaya,
              sent[0]!.id,
              {
                version: 99,
                respondedOn: today,
                preboardingEmail: `x-${run}@anvi.example`,
              },
              randomUUID(),
            ),
          ),
          409,
        );
        // The losing offer can be withdrawn and its application closed.
        const loser = sent.find((o) => o.id !== accepted.offer.id)!;
        const fresh = (
          await recruit.listOffers(hrMaya, {
            page: 1,
            limit: 100,
            q: "",
            requisitionId: r1.id,
          })
        ).items.find((o) => o.id === loser.id)!;
        assert.equal(fresh.status, "sent");
        await recruit.offerStep(
          hrMaya,
          loser.id,
          "withdrawn",
          { version: fresh.version, note: "Position filled" },
          randomUUID(),
        );
      },
    );

    await t.test(
      "concurrency: two stage moves, double-booking race",
      async () => {
        const moves = await Promise.allSettled([
          move(hrMaya, a3, "screening"),
          move(mgrMaya, a3, "interview"),
        ]);
        assert.equal(moves.filter((m) => m.status === "fulfilled").length, 1);
        const list = await recruit.listApplications(hrMaya, {
          page: 1,
          limit: 100,
          q: "",
          requisitionId: r1.id,
        });
        a3 = list.items.find((i) => i.id === a3.id)!;
        a4 = await move(hrMaya, a4, "screening");
        const at = hoursFromNow(200);
        const race = await Promise.allSettled(
          [a3, a4].map((a) =>
            recruit.createInterview(
              hrMaya,
              {
                applicationId: a.id,
                roundName: "Race round",
                scheduledAt: at,
                durationMinutes: 30,
                mode: "video",
                panel: [other],
              },
              randomUUID(),
            ),
          ),
        );
        assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
      },
    );

    await t.test(
      "pagination, funnel and no personal data in audit or outbox",
      async () => {
        await changeRole("hr_admin");
        const page = await request(
          `/recruit/applications?requisitionId=${r1.id}&limit=3&page=2`,
        );
        const body = (await page.json()) as RecruitApplicationList;
        assert.equal(body.total, 4);
        assert.equal(body.page, 2);
        assert.equal(body.limit, 3);
        assert.equal(body.items.length, 1);
        assert.equal(body.counts.hired, 1);
        assert.equal(
          (await request(`/recruit/applications?limit=101`)).status,
          400,
        );
        const defaults = (await (
          await request(`/recruit/requisitions`)
        ).json()) as { limit: number; page: number };
        assert.deepEqual([defaults.page, defaults.limit], [1, 25]);
        const funnel = await recruit.funnel(mgrMaya, { requisitionId: r1.id });
        assert.equal(funnel.totalApplications, 4);
        const hired = funnel.stages.find((s) => s.stage === "hired")!;
        assert.equal(hired.current, 1);
        assert.equal(hired.conversionPercent, 25);
        const text = JSON.stringify(funnel);
        for (const n of names) assert.ok(!text.includes(n));
        assert.equal(await status(recruit.funnel(arjunE, {})), 403);
        const appIds = (
          await admin.query<{ id: string }>(
            "SELECT id FROM recruit_application WHERE requisition_id=ANY($1::uuid[])",
            [ids.requisitions],
          )
        ).rows.map((r) => r.id);
        const rows = await admin.query<{ row: string }>(
          `SELECT row_to_json(e)::text AS row FROM audit_event e WHERE target LIKE 'recruit-%' AND (
           target=ANY($1::text[]) OR details::text LIKE ANY($2::text[]))
         UNION ALL SELECT row_to_json(o)::text FROM outbox_event o WHERE aggregate_id=ANY($3::uuid[])`,
          [
            [
              ...ids.candidates.map((id) => `recruit-candidate:${id}`),
              ...appIds.map((id) => `recruit-application:${id}`),
            ],
            ids.requisitions.map((id) => `%${id}%`),
            [...ids.candidates, ...appIds, ...ids.requisitions],
          ],
        );
        assert.ok(rows.rows.length > 5);
        for (const { row } of rows.rows) {
          for (const e of emails) assert.ok(!row.includes(e), "no email");
          for (const n of names) assert.ok(!row.includes(n), "no name");
          assert.ok(!row.includes("+91"), "no phone");
        }
      },
    );

    await t.test(
      "consent withdrawal, anonymisation and re-hashing",
      async () => {
        const c5 = await newCandidate(5);
        assert.equal(c5.canAnonymise, false);
        assert.equal(
          await status(
            recruit.anonymise(
              hrMaya,
              c5.id,
              { reason: "Requested by the candidate" },
              randomUUID(),
            ),
          ),
          409,
          "not before consent is withdrawn or retention passes",
        );
        assert.equal(
          await status(
            recruit.withdrawConsent(
              hrMaya,
              c5.id,
              { version: c5.version, reason: "short" },
              randomUUID(),
            ),
          ),
          400,
        );
        const withdrawn = await recruit.withdrawConsent(
          hrMaya,
          c5.id,
          { version: c5.version, reason: "Candidate asked us to stop" },
          randomUUID(),
        );
        assert.ok(withdrawn.consentWithdrawnAt);
        assert.equal(withdrawn.purgeEligible, true);
        assert.equal(withdrawn.canAnonymise, true);
        assert.equal(
          await status(apply(withdrawn, r1)),
          409,
          "no new applications",
        );
        // A candidate with an open application cannot be anonymised.
        const c4w = await recruit.withdrawConsent(
          hrMaya,
          c4.id,
          {
            version: (await recruit.candidateDetail(hrMaya, c4.id)).version,
            reason: "Candidate asked us to stop",
          },
          randomUUID(),
        );
        assert.equal(c4w.canAnonymise, false);
        assert.equal(
          await status(
            recruit.anonymise(
              hrMaya,
              c4.id,
              { reason: "Requested by the candidate" },
              randomUUID(),
            ),
          ),
          409,
        );
        assert.equal(
          await status(
            recruit.anonymise(
              mgrMaya,
              c5.id,
              { reason: "Requested by the candidate" },
              randomUUID(),
            ),
          ),
          403,
        );
        const gone = await recruit.anonymise(
          hrMaya,
          c5.id,
          { reason: "Requested by the candidate" },
          randomUUID(),
        );
        assert.equal(gone.anonymised, true);
        assert.equal(gone.name, "Anonymised candidate");
        assert.equal(gone.email, null);
        const stored = await admin.query(
          "SELECT email_sealed, phone_sealed, email_hash, hash_key_id, notes, current_company FROM ats_candidate WHERE id=$1",
          [c5.id],
        );
        assert.deepEqual(Object.values(stored.rows[0]!), [
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
        assert.equal(
          await status(
            recruit.anonymise(
              hrMaya,
              c5.id,
              { reason: "Requested by the candidate" },
              randomUUID(),
            ),
          ),
          409,
          "irreversible and once only",
        );
        // The hash is cleared, so the same email can be recorded again with fresh consent.
        const back = await recruit.createCandidate(
          hrMaya,
          {
            name: `Returning ${run}`,
            email: emails[4]!,
            totalExperienceMonths: 1,
            source: "direct",
            consentGiven: true,
          },
          randomUUID(),
        );
        ids.candidates.push(back.id);
        // Every live candidate already uses the pinned key: nothing to re-hash.
        const report = await rehashCandidates(
          admin,
          profileKeys(config),
          0,
          true,
          ids.candidates,
        );
        assert.equal(report.needsRehash, 0);
        assert.ok((report.before["0"] ?? 0) >= 4);
      },
    );

    await t.test("direct statements as the app role are refused", async () => {
      const app1 = a1.id;
      await assert.rejects(
        scoped(pool, hrMaya, (client) =>
          client.query(
            `INSERT INTO recruit_stage_history(tenant_id,entity_id,application_id,to_stage,by_label) VALUES ($1,$2,$3,'hired','x')`,
            [actor.tenantId, actor.entityId, app1],
          ),
        ),
        /permission denied/,
      );
      await assert.rejects(
        scoped(pool, hrMaya, (client) =>
          client.query(
            "UPDATE recruit_application SET rating_average=5 WHERE id=$1",
            [app1],
          ),
        ),
        /permission denied/,
      );
      await assert.rejects(
        scoped(pool, hrMaya, (client) =>
          client.query(
            "UPDATE recruit_scorecard SET recommendation='no' WHERE application_id=$1",
            [app1],
          ),
        ),
        /permission denied/,
      );
      for (const table of [
        "job_requisition",
        "ats_candidate",
        "recruit_application",
        "recruit_offer",
      ])
        await assert.rejects(
          scoped(pool, hrMaya, (client) =>
            client.query(`DELETE FROM ${table} WHERE true`),
          ),
          /permission denied/,
        );
      await assert.rejects(
        admin.query("DELETE FROM job_requisition WHERE id=$1", [r1.id]),
        /never deleted/,
      );
      // HR reads only ciphertext from the sealed columns.
      const sealed = await scoped(pool, hrMaya, (client) =>
        client.query<{ e: string }>(
          "SELECT email_sealed AS e FROM ats_candidate WHERE id=$1",
          [c1.id],
        ),
      );
      assert.ok(!sealed.rows[0]!.e.includes("@"));
      // Managers, employees and other entities read no candidates; outsiders read nothing.
      for (const who of [
        mgrMaya,
        arjunE,
        { ...hrMaya, entityId: randomUUID() },
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM ats_candidate WHERE id=ANY($1::uuid[])",
            [ids.candidates],
          ),
        );
        assert.equal(seen.rows[0]!.n, 0);
      }
      for (const who of [
        as(bystander, "Bystander (synthetic)", "employee"),
        auditor,
      ]) {
        const seen = await scoped(pool, who, (client) =>
          client.query<{ n: number }>(
            `SELECT (SELECT count(*) FROM job_requisition WHERE id=ANY($1::uuid[]))+(SELECT count(*) FROM recruit_application WHERE requisition_id=ANY($1::uuid[]))
              +(SELECT count(*) FROM recruit_interview WHERE requisition_id=ANY($1::uuid[])) AS n`,
            [ids.requisitions],
          ),
        );
        assert.equal(Number(seen.rows[0]!.n), 0);
      }
      // A hiring manager cannot jump an application to hired directly.
      const fresh = await recruit.applicationDetail(hrMaya, a4.id);
      await assert.rejects(
        scoped(pool, mgrMaya, (client) =>
          client.query(
            "UPDATE recruit_application SET stage='hired', version=version+1 WHERE id=$1",
            [a4.id],
          ),
        ),
        /HR|offer/,
      );
      assert.equal(fresh.application.stage, "screening");
    });
  } finally {
    // Synthetic cleanup only: recruitment history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const restore = await alwaysOff(client);
      await client.query("DELETE FROM identity_binding WHERE id=$1", [
        rohanBinding,
      ]);
      const q = async (sql: string) =>
        (await client.query<{ id: string }>(sql, [ids.requisitions])).rows.map(
          (r) => r.id,
        );
      const apps = await q(
        "SELECT id FROM recruit_application WHERE requisition_id=ANY($1::uuid[])",
      );
      const interviews = await q(
        "SELECT id FROM recruit_interview WHERE requisition_id=ANY($1::uuid[])",
      );
      const offers = await q(
        "SELECT id FROM recruit_offer WHERE requisition_id=ANY($1::uuid[])",
      );
      const cases = (
        await client.query<{ id: string }>(
          "SELECT candidate_case_id AS id FROM recruit_offer WHERE requisition_id=ANY($1::uuid[]) AND candidate_case_id IS NOT NULL",
          [ids.requisitions],
        )
      ).rows.map((r) => r.id);
      const scorecards = (
        await client.query<{ id: string }>(
          "SELECT id FROM recruit_scorecard WHERE application_id=ANY($1::uuid[])",
          [apps],
        )
      ).rows.map((r) => r.id);
      const all = [
        ...ids.requisitions,
        ...ids.candidates,
        ...apps,
        ...interviews,
        ...offers,
        ...cases,
        ...scorecards,
      ];
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [all],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[]) OR target=ANY($2::text[])",
        [
          [
            ...ids.requisitions.map((id) => `recruit-requisition:${id}`),
            ...ids.candidates.map((id) => `recruit-candidate:${id}`),
            ...apps.map((id) => `recruit-application:${id}`),
            ...interviews.map((id) => `recruit-interview:${id}`),
            ...offers.map((id) => `recruit-offer:${id}`),
            ...scorecards.map((id) => `recruit-scorecard:${id}`),
          ],
          cases,
        ],
      );
      await client.query(
        "DELETE FROM recruit_scorecard WHERE application_id=ANY($1::uuid[])",
        [apps],
      );
      await client.query(
        "DELETE FROM recruit_interview_panel WHERE interview_id=ANY($1::uuid[])",
        [interviews],
      );
      await client.query(
        "DELETE FROM recruit_interview WHERE id=ANY($1::uuid[])",
        [interviews],
      );
      await client.query("DELETE FROM recruit_offer WHERE id=ANY($1::uuid[])", [
        offers,
      ]);
      await client.query(
        "DELETE FROM candidate_case WHERE id=ANY($1::uuid[])",
        [cases],
      );
      await client.query(
        "DELETE FROM recruit_stage_history WHERE application_id=ANY($1::uuid[])",
        [apps],
      );
      await client.query(
        "DELETE FROM recruit_application WHERE id=ANY($1::uuid[])",
        [apps],
      );
      await client.query("DELETE FROM ats_candidate WHERE id=ANY($1::uuid[])", [
        ids.candidates,
      ]);
      await client.query(
        "DELETE FROM job_requisition WHERE id=ANY($1::uuid[])",
        [ids.requisitions],
      );
      await restore();
    });
    await Promise.all([admin.end(), pool.end(), app.close()]);
    await store.pool.end();
  }
});
