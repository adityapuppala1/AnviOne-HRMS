import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createCandidateApp } from "../apps/api/src/candidate-app";
import { readConfig } from "../apps/api/src/config";
import { makePool } from "../packages/database/src/index";
import type {
  CandidateDocument,
  CandidatePortal,
  CandidateTask,
} from "../packages/contracts/src/index";

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

await test("Candidate document intake, verification, rejection, and readiness integration", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4488" });
  const { app, store } = await createApp(config);
  const candidate = await createCandidateApp(config, 4487);
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);

  await app.listen(4488, "127.0.0.1");
  await candidate.app.listen(4487, "127.0.0.1");

  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  const employeeToken = await store.createSession(actor, randomUUID());
  const employeeSession = await store.session(employeeToken);

  const hr = async (path: string, body?: unknown, method?: string) =>
    fetch(`http://127.0.0.1:4488/api/v1${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        Cookie: `anvi_dev_session=${employeeToken}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": employeeSession.csrfToken,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  let cookie = "";
  let csrf = "";
  let id = "";
  let version = 1;
  let token: string;

  const candidateFetch = async (
    path: string,
    body?: BodyInit,
    headers: Record<string, string> = {},
    method?: string,
  ) =>
    fetch(`http://127.0.0.1:4487/api/candidate/${path}`, {
      method: method ?? (body ? "POST" : "GET"),
      headers: {
        Origin: config.CANDIDATE_ORIGIN,
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        ...headers,
      },
      ...(body ? { body } : {}),
    });

  const upload = async (
    category: string,
    fileName: string,
    fileBuffer: Buffer,
    title = "Test Document",
  ) => {
    const boundary = `----WebKitFormBoundary${randomUUID().replace(/-/g, "")}`;
    const headCategory = `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`;
    const headTitle = `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`;
    const headFile = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const foot = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(headCategory, "utf8"),
      Buffer.from(headTitle, "utf8"),
      Buffer.from(headFile, "utf8"),
      fileBuffer,
      Buffer.from(foot, "utf8"),
    ]);

    return candidateFetch("documents", body, {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    });
  };

  const reason = "Candidate document intake acceptance test";
  const dummyPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000098 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n",
  );
  const activePdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction<</S/JavaScript/JS(app.alert('evil'))>>>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000098 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n",
  );
  const dummyPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  try {
    // 1. Create intake case
    const options = await (await hr("/candidates/options")).json();
    const createRes = await hr("/candidates", {
      name: "Acceptance Candidate",
      email: "acceptance.candidate@anvi.example",
      title: "Software Engineer",
      joinedOn: "2026-12-01",
      departmentId: options.departments[0].id,
      locationId: options.locations[0].id,
      managerId: options.managers[0].id,
    });
    assert.equal(createRes.status, 201);
    const cCase = await createRes.json();
    id = cCase.id;

    // 2. Invite and login candidate
    const inviteRes = await hr(`/candidates/${id}/invitation`, {
      version: cCase.version,
      reason,
    });
    assert.equal(inviteRes.status, 201);
    const delivery = await (await hr(`/candidates/${id}/delivery-preview`)).json();
    token = new URL(delivery.invitationUrl).hash.slice(8);

    const challengeRes = await fetch("http://127.0.0.1:4487/api/candidate/challenge", {
      method: "POST",
      headers: {
        Origin: config.CANDIDATE_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    assert.equal(challengeRes.status, 201);
    const { challengeId } = (await challengeRes.json()) as { challengeId: string };

    const freshDelivery = await (await hr(`/candidates/${id}/delivery-preview`)).json();

    const exchangeRes = await fetch("http://127.0.0.1:4487/api/candidate/exchange", {
      method: "POST",
      headers: {
        Origin: config.CANDIDATE_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token, challengeId, code: freshDelivery.code }),
    });
    assert.equal(exchangeRes.status, 201);
    cookie = exchangeRes.headers.get("set-cookie")!.split(";")[0]!;

    const sessionRes = await candidateFetch("session");
    assert.equal(sessionRes.status, 200);
    const sessionData = (await sessionRes.json()) as CandidatePortal;
    csrf = sessionData.csrfToken;
    version = sessionData.candidate.version;
    assert.equal(sessionData.documents.length, 0);

    await t.test("File upload validations (size, active content, mime)", async () => {
      // 1. Active content PDF should be rejected
      const activeRes = await upload("government_id", "active.pdf", activePdf);
      assert.equal(activeRes.status, 400);
      const activeErr = await activeRes.json();
      assert.match(activeErr.title, /active content/i);

      // 2. Non-supported MIME (plain text) should be rejected
      const textRes = await upload(
        "government_id",
        "notes.txt",
        Buffer.from("Hello world, this is a plain text file."),
      );
      assert.equal(textRes.status, 400);

      // 3. Valid PDF should succeed
      const validRes = await upload("government_id", "passport.pdf", dummyPdf, "Passport ID");
      if (validRes.status !== 201) {
        console.error("VALID RES ERROR:", await validRes.json());
      }
      assert.equal(validRes.status, 201);
      const doc = await validRes.json();
      assert.equal(doc.category, "government_id");
      assert.equal(doc.status, "pending");
      assert.equal(doc.fileName, "passport.pdf");
      assert.equal(doc.version, 1);

      // 4. Double upload for pending category should be rejected
      const dupRes = await upload("government_id", "another.pdf", dummyPdf);
      assert.equal(dupRes.status, 409);
    });

    await t.test("HR document retrieval and content download", async () => {
      // HR retrieves candidate documents list
      const hrDocsRes = await hr(`/candidates/${id}/documents`);
      assert.equal(hrDocsRes.status, 200);
      const docs = await hrDocsRes.json();
      assert.equal(docs.length, 1);
      const docId = docs[0].id;

      // HR downloads document content
      const contentRes = await hr(`/candidates/${id}/documents/${docId}/content`);
      assert.equal(contentRes.status, 200);
      assert.equal(contentRes.headers.get("content-type"), "application/pdf");
      assert.equal(contentRes.headers.get("x-content-type-options"), "nosniff");
      const contentBytes = Buffer.from(await contentRes.arrayBuffer());
      assert.equal(contentBytes.length, dummyPdf.length);
    });

    await t.test("HR rejection requires reason >= 10 chars, candidate re-upload", async () => {
      const docs = await (await hr(`/candidates/${id}/documents`)).json();
      const docId = docs[0].id;

      // Rejection with short reason (< 10 chars) should be rejected
      const shortRes = await hr(`/candidates/${id}/documents/${docId}/review`, {
        decision: "rejected",
        version: docs[0].version,
        reason: "Blurry",
      });
      assert.equal(shortRes.status, 400);

      // Rejection with valid reason (>= 10 chars)
      const rejectRes = await hr(`/candidates/${id}/documents/${docId}/review`, {
        decision: "rejected",
        version: docs[0].version,
        reason: "The passport image is cropped and expiry date is cut off.",
      });
      assert.equal(rejectRes.status, 201);

      // Check candidate sees rejection
      const cSession = (await (await candidateFetch("session")).json()) as CandidatePortal;
      const rejectedDoc = cSession.documents.find((d: CandidateDocument) => d.id === docId);
      assert.ok(rejectedDoc);
      assert.equal(rejectedDoc.status, "rejected");
      assert.equal(
        rejectedDoc.reviewNote,
        "The passport image is cropped and expiry date is cut off.",
      );

      // Candidate can now re-upload for government_id
      const reuploadRes = await upload(
        "government_id",
        "passport_full.png",
        dummyPng,
        "Passport ID",
      );
      assert.equal(reuploadRes.status, 201);
      const newDoc = (await reuploadRes.json()) as CandidateDocument;
      assert.equal(newDoc.status, "pending");
      assert.equal(newDoc.fileName, "passport_full.png");
    });

    await t.test("HR verification locks document immutably", async () => {
      const docs = (await (await hr(`/candidates/${id}/documents`)).json()) as CandidateDocument[];
      const activeDoc = docs.find(
        (d: CandidateDocument) => d.category === "government_id" && d.status === "pending",
      );
      assert.ok(activeDoc);

      // Verify the document
      const verifyRes = await hr(
        `/candidates/${id}/documents/${activeDoc.id}/review`,
        {
          decision: "verified",
          version: activeDoc.version,
          reason: "Clear passport copy verified against official records.",
        },
      );
      assert.equal(verifyRes.status, 201);

      // Candidate attempts to re-upload verified category -> 409 Conflict
      const replaceRes = await upload(
        "government_id",
        "new_passport.png",
        dummyPng,
      );
      assert.equal(replaceRes.status, 409);
      assert.match(
        (await replaceRes.json()).title,
        /already verified and locked/i,
      );
    });

    await t.test("Readiness proposal is gated by mandatory documents", async () => {
      // 1. Upload proof_of_address and education_certificate while intake is open
      const addrRes = await upload(
        "proof_of_address",
        "utility_bill.pdf",
        dummyPdf,
        "Utility Bill",
      );
      assert.equal(addrRes.status, 201);
      const addrDoc = await addrRes.json();

      const eduRes = await upload(
        "education_certificate",
        "degree.pdf",
        dummyPdf,
        "Bachelor Degree",
      );
      assert.equal(eduRes.status, 201);
      const eduDoc = await eduRes.json();

      // Refresh current candidate version
      const currentSession = await (await candidateFetch("session")).json();
      version = currentSession.candidate.version;

      // 2. Complete candidate introduction draft & submit
      const draftRes = await candidateFetch(
        "draft",
        JSON.stringify({
          version,
          draft: {
            preferredName: "Ace",
            introduction:
              "Excited to join the engineering team and build reliable systems.",
            acknowledged: true,
          },
        }),
        { "Content-Type": "application/json" },
        "PUT",
      );
      assert.equal(draftRes.status, 200);

      const submitRes = await candidateFetch(
        "submit",
        JSON.stringify({ version: (await draftRes.json()).candidate.version }),
        { "Content-Type": "application/json" },
      );
      assert.equal(submitRes.status, 201);

      // Verify that candidate can upload documents while in 'submitted' state
      const postSubmitDocRes = await upload(
        "previous_employment",
        "relieving_letter.pdf",
        dummyPdf,
        "Relieving Letter",
      );
      assert.equal(postSubmitDocRes.status, 201);
      const postSubmitDoc = await postSubmitDocRes.json();
      assert.equal(postSubmitDoc.category, "previous_employment");
      assert.equal(postSubmitDoc.status, "pending");

      // 3. HR approves candidate form
      const detailBefore = await (await hr(`/candidates/${id}`)).json();
      const approveRes = await hr(`/candidates/${id}/review`, {
        version: detailBefore.candidate.version,
        reason: "Introduction form reviewed and accepted.",
        decision: "approved",
      });
      assert.equal(approveRes.status, 201);

      // 4. Apply starter checklist and complete all required tasks
      const currentDetail = await (await hr(`/candidates/${id}`)).json();
      const checklistRes = await hr(`/candidates/${id}/checklist`, {
        version: currentDetail.candidate.version,
        reason: "Initialize starter checklist tasks",
      });
      assert.equal(checklistRes.status, 201);

      const detailWithTasks = await (await hr(`/candidates/${id}`)).json();
      for (const task of detailWithTasks.tasks.filter((t: CandidateTask) => t.required)) {
        const tRes = await hr(
          `/candidates/${id}/tasks/${task.id}`,
          {
            caseVersion: (await (await hr(`/candidates/${id}`)).json()).candidate.version,
            version: task.version,
            state: "completed",
            reason: "Completed prerequisite checklist task for acceptance test.",
          },
          "POST",
        );
        assert.equal(tRes.status, 201);
      }

      // At this point, government_id is verified, but proof_of_address and education_certificate are pending!
      // Local readiness review proposal MUST be rejected with 409
      const earlyPropose = await hr(`/candidates/${id}/local-reviews`, {
        caseVersion: (await (await hr(`/candidates/${id}`)).json()).candidate.version,
        reason: "Attempting readiness review before all mandatory documents.",
      });
      assert.equal(earlyPropose.status, 409);
      assert.match(
        (await earlyPropose.json()).title,
        /mandatory documents/i,
      );

      // 5. Verify proof_of_address
      const vAddr = await hr(`/candidates/${id}/documents/${addrDoc.id}/review`, {
        decision: "verified",
        version: addrDoc.version,
        reason: "Valid address proof within 3 months.",
      });
      assert.equal(vAddr.status, 201);

      // Still missing education_certificate verification -> still rejected with 409
      const midPropose = await hr(`/candidates/${id}/local-reviews`, {
        caseVersion: (await (await hr(`/candidates/${id}`)).json()).candidate.version,
        reason: "Attempting readiness review before education certificate.",
      });
      assert.equal(midPropose.status, 409);

      // 6. Verify education_certificate
      const vEdu = await hr(`/candidates/${id}/documents/${eduDoc.id}/review`, {
        decision: "verified",
        version: eduDoc.version,
        reason: "Accredited university degree verified.",
      });
      assert.equal(vEdu.status, 201);

      // 7. Now all 3 mandatory documents are verified! (previous_employment is optional so missing it doesn't block)
      const validPropose = await hr(`/candidates/${id}/local-reviews`, {
        caseVersion: (await (await hr(`/candidates/${id}`)).json()).candidate.version,
        reason: "All requirements met and all mandatory documents verified.",
      });
      assert.equal(validPropose.status, 201);
      assert.equal((await validPropose.json()).changed, true);

      // 8. Verify candidate details reflect passed controls
      const finalDetail = await (await hr(`/candidates/${id}`)).json();
      const docControl = finalDetail.readiness.controls.find(
        (c: { id: string }) => c.id === "documents",
      );
      assert.equal(docControl.status, "passed");
    });
  } finally {
    if (id) {
      await admin.query(
        "DELETE FROM candidate_task_assignment WHERE task_id IN (SELECT id FROM candidate_task WHERE candidate_id=$1)",
        [id],
      );
      for (const table of [
        "candidate_document_content",
        "candidate_document",
        "candidate_local_review",
        "candidate_task",
        "candidate_delivery_preview",
        "candidate_challenge",
        "candidate_session",
        "candidate_submission",
      ]) {
        await admin.query(`DELETE FROM ${table} WHERE candidate_id=$1`, [id]);
      }
      await admin.query("DELETE FROM candidate_case WHERE id=$1", [id]);
    }

    await candidate.store.pool.end();
    await candidate.app.close();
    await store.pool.end();
    await app.close();
    await admin.end();
  }
});
