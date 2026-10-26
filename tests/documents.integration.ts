import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { makePool, transaction } from "../packages/database/src/index";
import type {
  ApprovalInbox,
  EmployeeDocument,
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
  ) {
    throw new Error("Integration tests require the local Compose database");
  }
}

const tenant = "10000000-0000-4000-8000-000000000001";
const entity = "20000000-0000-4000-8000-000000000001";
const arjun = "30000000-0000-4000-8000-000000000002";

// Small synthetic files; a unique comment keeps reruns from colliding as duplicates.
const nonce = () => randomUUID();
const pdf = (extra = "") =>
  Buffer.from(
    `%PDF-1.4\n% ${nonce()}\n1 0 obj << /Type /Catalog ${extra} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
    "latin1",
  );
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(nonce()),
  ]);

await test("Employee documents and HR verification", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4480" });
  const { app, store } = await createApp(config);
  await app.listen(4480, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const created: string[] = [];
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4480/api/v1${path}`, {
      ...init,
      headers: {
        Cookie: `anvi_dev_session=${token}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        ...(typeof init.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
  const post = (path: string, body: unknown) =>
    request(path, { method: "POST", body: JSON.stringify(body) });
  async function changeRole(role: Role) {
    const response = await post("/session/role-context", { role });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  function upload(
    bytes: Buffer,
    name: string,
    fields: Record<string, string> = {
      category: "identity",
      title: "Passport",
    },
  ) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
      name,
    );
    return request("/documents", { method: "POST", body: form });
  }
  async function uploaded(response: Response) {
    assert.equal(response.status, 201);
    const item = (await response.json()) as EmployeeDocument;
    created.push(item.id);
    return item;
  }
  // Simulates Arjun's own session at the database boundary.
  async function asArjun<T>(work: (client: PoolClient) => Promise<T>) {
    return transaction(admin, async (client) => {
      await client.query(
        `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
          set_config('app.employee_id',$3,true), set_config('app.document_scope','self',true),
          set_config('app.actor_id',$4,true), set_config('app.actor_label','Arjun Mehta',true)`,
        [tenant, entity, arjun, actor.actorId],
      );
      return work(client);
    });
  }
  let mine!: EmployeeDocument;
  let arjunDocument = "";
  try {
    await changeRole("employee");

    await t.test(
      "a PDF upload is typed from its bytes, named safely and pending",
      async () => {
        const bytes = pdf();
        mine = await uploaded(
          await upload(bytes, "../../secret/pass port.PDF"),
        );
        assert.equal(mine.status, "pending");
        assert.equal(mine.contentType, "application/pdf");
        assert.equal(mine.fileName, "pass port.pdf");
        assert.equal(mine.sizeBytes, bytes.length);
        assert.equal(mine.canWithdraw, true);
        assert.equal(mine.canReview, false);
        assert.equal((await upload(bytes, "copy.pdf")).status, 409);
        const misnamed = await uploaded(await upload(png(), "photo.pdf"));
        assert.equal(misnamed.contentType, "image/png");
        assert.equal(misnamed.fileName, "photo.png");
      },
    );

    await t.test(
      "unsafe, empty, oversized and malformed uploads are refused",
      async () => {
        const executable = Buffer.from(`MZ${nonce()}`);
        assert.equal((await upload(executable, "cv.pdf")).status, 400);
        for (const marker of [
          "/JavaScript",
          "/OpenAction",
          "/Launch",
          "/EmbeddedFile",
        ])
          assert.equal(
            (await upload(pdf(`${marker} (x)`), "active.pdf")).status,
            400,
            marker,
          );
        assert.equal((await upload(Buffer.alloc(0), "empty.pdf")).status, 400);
        const oversized = Buffer.concat([pdf(), Buffer.alloc(5 * 1024 * 1024)]);
        assert.ok(
          [400, 413].includes((await upload(oversized, "big.pdf")).status),
        );
        assert.equal(
          (await upload(pdf(), "x.pdf", { category: "secret", title: "Bad" }))
            .status,
          400,
        );
        assert.equal(
          (
            await upload(pdf(), "x.pdf", {
              category: "other",
              title: "Extra",
              employeeId: arjun,
            })
          ).status,
          400,
        );
      },
    );

    await t.test(
      "downloads are attachments of the stored bytes, and audited",
      async () => {
        const response = await request(`/documents/${mine.id}/content`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/pdf");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.match(
          response.headers.get("content-disposition") ?? "",
          /^attachment; filename="pass port\.pdf"/,
        );
        const body = Buffer.from(await response.arrayBuffer());
        const row = await admin.query<{ sha256: string }>(
          "SELECT sha256 FROM employee_document WHERE id=$1",
          [mine.id],
        );
        assert.equal(
          createHash("sha256").update(body).digest("hex"),
          row.rows[0]!.sha256,
        );
        const audited = await admin.query(
          "SELECT 1 FROM audit_event WHERE action='document.downloaded' AND target LIKE $1",
          [`document:${mine.id}:%`],
        );
        assert.equal(audited.rowCount, 1);
      },
    );

    await t.test(
      "managers cannot see their reports' documents; content stays immutable",
      async () => {
        arjunDocument = await asArjun(async (client) => {
          const id = randomUUID();
          const bytes = pdf();
          await client.query(
            `INSERT INTO employee_document(id,tenant_id,entity_id,employee_id,category,title,file_name,content_type,size_bytes,sha256,status,version,uploaded_by_actor)
             VALUES ($1,$2,$3,$4,'education','Degree certificate','degree.pdf','application/pdf',$5,$6,'pending',1,$7)`,
            [
              id,
              tenant,
              entity,
              arjun,
              bytes.length,
              createHash("sha256").update(bytes).digest("hex"),
              actor.actorId,
            ],
          );
          await client.query(
            "INSERT INTO employee_document_content(document_id,tenant_id,entity_id,bytes) VALUES ($1,$2,$3,$4)",
            [id, tenant, entity, bytes],
          );
          return id;
        });
        created.push(arjunDocument);
        await changeRole("manager");
        const list = (await (await request("/documents")).json()) as {
          items: EmployeeDocument[];
        };
        assert.ok(list.items.every((d) => d.employeeId === actor.employeeId));
        assert.equal(
          (await request(`/documents/${arjunDocument}/content`)).status,
          404,
        );
        const denied = await admin.query(
          "SELECT role FROM audit_event WHERE action='document.download_denied' AND target=$1",
          [`document:${arjunDocument}`],
        );
        assert.deepEqual(
          denied.rows.map((r: { role: string }) => r.role),
          ["manager"],
        );
        assert.equal((await request("/documents/review")).status, 403);
        await assert.rejects(
          transaction(store.pool, (client) =>
            client.query(
              "UPDATE employee_document_content SET bytes='x' WHERE document_id=$1",
              [mine.id],
            ),
          ),
          /permission denied/,
        );
        await assert.rejects(
          asArjun((client) =>
            client.query(
              "INSERT INTO employee_document_content(document_id,tenant_id,entity_id,bytes) VALUES ($1,$2,$3,'tampered')",
              [arjunDocument, tenant, entity],
            ),
          ),
        );
      },
    );

    await t.test(
      "HR verifies others' documents, never their own, with versions",
      async () => {
        await changeRole("hr_admin");
        const queue = (await (await request("/documents/review")).json()) as {
          pending: EmployeeDocument[];
        };
        const item = queue.pending.find((d) => d.id === arjunDocument)!;
        assert.equal(item.canReview, true);
        assert.ok(!queue.pending.some((d) => d.id === mine.id));
        const own = await post(`/documents/${mine.id}/decision`, {
          version: mine.version,
          decision: "verify",
          note: null,
        });
        assert.equal(own.status, 403);
        const inbox = (await (
          await request("/approvals")
        ).json()) as ApprovalInbox;
        assert.ok(
          inbox.items.some(
            (i) =>
              i.kind === "document_review" &&
              i.id === arjunDocument &&
              i.canDecide,
          ),
        );
        const noNote = await post(`/documents/${arjunDocument}/decision`, {
          version: 1,
          decision: "reject",
          note: null,
        });
        assert.equal(noNote.status, 400);
        const verified = await post(`/documents/${arjunDocument}/decision`, {
          version: 1,
          decision: "verify",
          note: null,
        });
        assert.equal(verified.status, 201);
        const result = (await verified.json()) as EmployeeDocument;
        assert.equal(result.status, "verified");
        assert.equal(result.reviewedBy, "Maya Iyer");
        const stale = await post(`/documents/${arjunDocument}/decision`, {
          version: 1,
          decision: "reject",
          note: "Second opinion",
        });
        assert.equal(stale.status, 409);
      },
    );

    await t.test(
      "per-person caps bound how many documents wait for HR",
      async () => {
        const insert = (client: PoolClient) => {
          const id = randomUUID();
          const bytes = pdf();
          created.push(id);
          return client.query(
            `INSERT INTO employee_document(id,tenant_id,entity_id,employee_id,category,title,file_name,content_type,size_bytes,sha256,status,version,uploaded_by_actor)
             VALUES ($1,$2,$3,$4,'other','Cap probe','cap.pdf','application/pdf',$5,$6,'pending',1,$7)`,
            [
              id,
              tenant,
              entity,
              arjun,
              bytes.length,
              createHash("sha256").update(bytes).digest("hex"),
              actor.actorId,
            ],
          );
        };
        const pending = Number(
          (
            await admin.query<{ n: string }>(
              "SELECT count(*) AS n FROM employee_document WHERE employee_id=$1 AND status='pending'",
              [arjun],
            )
          ).rows[0]!.n,
        );
        await asArjun(async (client) => {
          for (let i = pending; i < 10; i += 1) await insert(client);
        });
        await assert.rejects(
          asArjun((client) => insert(client)),
          /10 documents waiting for HR/,
        );
      },
    );

    await t.test(
      "owners withdraw pending documents once; events are recorded",
      async () => {
        await changeRole("employee");
        const withdrawn = await post(`/documents/${mine.id}/withdraw`, {
          version: mine.version,
        });
        assert.equal(withdrawn.status, 201);
        assert.equal(
          ((await withdrawn.json()) as EmployeeDocument).status,
          "withdrawn",
        );
        const again = await post(`/documents/${mine.id}/withdraw`, {
          version: mine.version + 1,
        });
        assert.equal(again.status, 409);
        const events = await admin.query(
          "SELECT event_type FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
          [created],
        );
        const kinds = new Set(
          events.rows.map((r: { event_type: string }) => r.event_type),
        );
        for (const kind of [
          "document.uploaded.v1",
          "document.verified.v1",
          "document.withdrawn.v1",
        ])
          assert.ok(kinds.has(kind), kind);
      },
    );
  } finally {
    // Synthetic cleanup only: documents are append-only at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [created],
      );
      await client.query(
        "DELETE FROM employee_document_content WHERE document_id=ANY($1::uuid[])",
        [created],
      );
      await client.query(
        "DELETE FROM employee_document WHERE id=ANY($1::uuid[])",
        [created],
      );
    });
    await admin.end();
    await app.close();
  }
});
