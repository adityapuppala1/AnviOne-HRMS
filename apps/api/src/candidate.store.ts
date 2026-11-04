import { randomUUID, randomInt, createHash } from "node:crypto";
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { makePool, transaction, type PoolClient } from "@anvi/database";
import {
  candidatePortalSchema,
  candidateDraftSchema,
  type CandidateDraft,
  candidateOwnTaskSchema,
  candidateDocumentSchema,
  type CandidateDocument,
  type CandidateDocumentCategory,
  type candidateTaskUpdateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import { readTasks, changeTask } from "./checklist";
import { hash, opaque } from "./platform.store";
import { otpHash, seal, previewKey } from "./onboarding.crypto";
import type { Config } from "./config";
import {
  MAX_DOCUMENT_BYTES,
  detectType,
  hasActivePdfContent,
  sanitizeFileName,
} from "./document.validation";
import type { UploadedFile } from "./document.store";

export type CandidateActor = {
  id: string;
  csrfToken: string;
  tokenHash: string;
};

const docColumns = `d.id, d.candidate_id AS "candidateId", d.category, d.title, d.file_name AS "fileName",
  d.content_type AS "contentType", d.size_bytes AS "sizeBytes", d.sha256, d.status, d.version,
  d.review_note AS "reviewNote", d.reviewer_label AS "reviewedBy",
  to_char(d.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "reviewedAt",
  to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
  to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"`;
export class CandidateStore {
  readonly pool;
  private readonly key;
  constructor(config: Config) {
    this.key = previewKey(config);
    if (!config.CANDIDATE_DATABASE_URL)
      throw new Error("A dedicated candidate database connection is required");
    this.pool = makePool(config.CANDIDATE_DATABASE_URL);
    this.pool.on("error", () =>
      console.error(
        JSON.stringify({ event: "candidate.database_unavailable" }),
      ),
    );
  }
  async verifyRole() {
    const { rows } = await this.pool.query(
      "SELECT current_user AS role,rolsuper OR rolbypassrls AS unsafe FROM pg_roles WHERE rolname=current_user",
    );
    if (rows[0]?.role !== "anvione_candidate" || rows[0].unsafe)
      throw new Error("The restricted candidate database role is required");
  }
  async challenge(token: string) {
    const challengeId = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await this.pool.query("SELECT candidate_begin($1,$2,$3,$4)", [
      hash(token),
      challengeId,
      otpHash(this.key, challengeId, code),
      seal(this.key, { code }),
    ]);
    // Unknown, expired and throttled invitations have the same public response.
    return { challengeId };
  }
  async exchange(token: string, challengeId: string, code: string) {
    const session = opaque(),
      csrf = opaque();
    const { rows } = await this.pool.query<{ ok: boolean }>(
      "SELECT candidate_exchange($1,$2,$3,$4,$5) AS ok",
      [
        hash(token),
        challengeId,
        otpHash(this.key, challengeId, code),
        hash(session),
        csrf,
      ],
    );
    if (!rows[0]?.ok)
      throw new UnauthorizedException(
        "This verification could not be completed. Reopen your latest invitation or contact HR.",
      );
    return session;
  }
  async session(token: unknown): Promise<CandidateActor> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Reopen your invitation to continue.");
    const { rows } = await this.pool.query<{ actor: CandidateActor | null }>(
      "SELECT resolve_candidate_session($1) AS actor",
      [hash(token)],
    );
    if (!rows[0]?.actor)
      throw new UnauthorizedException(
        "Your candidate session ended. Contact HR for a fresh invitation.",
      );
    return { ...rows[0].actor, tokenHash: hash(token) };
  }
  private scoped<T>(
    actor: CandidateActor,
    work: (client: PoolClient) => Promise<T>,
  ) {
    return transaction(this.pool, async (client) => {
      const check = await client.query(
        "SELECT resolve_candidate_session($1) AS actor",
        [actor.tokenHash],
      );
      if (!check.rows[0]?.actor)
        throw new UnauthorizedException(
          "Your candidate session ended. Reopen your latest invitation.",
        );
      await client.query("SELECT set_config('candidate.id',$1,true)", [
        actor.id,
      ]);
      return work(client);
    });
  }
  async readDocuments(
    client: PoolClient,
    candidateId: string,
  ): Promise<CandidateDocument[]> {
    const { rows } = await client.query(
      `SELECT ${docColumns} FROM candidate_document d
       WHERE d.candidate_id = $1
       ORDER BY d.created_at DESC, d.id`,
      [candidateId],
    );
    return rows.map((r) => candidateDocumentSchema.parse(r));
  }
  private async record(client: PoolClient, actor: CandidateActor) {
    const { rows } = await client.query(
      `SELECT id,name,title,joined_on::text AS "joinedOn",state,version,review_note AS "reviewNote",draft FROM candidate_case WHERE id=$1`,
      [actor.id],
    );
    if (!rows[0])
      throw new UnauthorizedException("Your candidate record is unavailable.");
    const documents = await this.readDocuments(client, actor.id);
    return candidatePortalSchema.parse({
      tasks: (await readTasks(client, actor.id, true)).map((t) =>
        candidateOwnTaskSchema.parse(t),
      ),
      candidate: rows[0],
      csrfToken: actor.csrfToken,
      documents,
    });
  }
  async me(actor: CandidateActor) {
    return this.scoped(actor, (client) => this.record(client, actor));
  }
  async save(actor: CandidateActor, version: number, draft: CandidateDraft) {
    return this.scoped(actor, async (client) => {
      const result = await client.query(
        "UPDATE candidate_case SET draft=$3,version=version+1,state='in_progress' WHERE id=$1 AND version=$2 AND state IN ('invited','in_progress','changes_requested') RETURNING id",
        [actor.id, version, JSON.stringify(draft)],
      );
      if (!result.rows[0])
        throw new ConflictException(
          "This form changed or is already submitted. Reload before continuing.",
        );
      return this.record(client, actor);
    });
  }
  async submit(actor: CandidateActor, version: number, requestId: string) {
    return this.scoped(actor, async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM candidate_case WHERE id=$1 FOR UPDATE",
        [actor.id],
      );
      const current = rows[0];
      if (
        !current ||
        current.version !== version ||
        !["invited", "in_progress", "changes_requested"].includes(current.state)
      )
        throw new ConflictException(
          "This form changed or is already submitted. Reload before continuing.",
        );
      const draft = candidateDraftSchema.parse(current.draft);
      if (
        draft.preferredName.length < 2 ||
        draft.introduction.length < 20 ||
        !draft.acknowledged
      )
        throw new BadRequestException(
          "Add your preferred name, an introduction of at least 20 characters and acknowledge the preview notice.",
        );
      await client.query(
        "INSERT INTO candidate_submission(candidate_id,version,payload) VALUES($1,$2,$3)",
        [actor.id, version, JSON.stringify(draft)],
      );
      await client.query(
        "UPDATE candidate_case SET state='submitted',version=version+1 WHERE id=$1",
        [actor.id],
      );
      await client.query(
        "INSERT INTO audit_event(id,tenant_id,entity_id,actor_id,actor_label,role,action,target,request_id) VALUES($1,$2,$3,$4,'Candidate','candidate','candidate.submitted',$6,$5)",
        [
          randomUUID(),
          current.tenant_id,
          current.entity_id,
          actor.id,
          requestId,
          actor.id,
        ],
      );
      await client.query(
        "INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES($1,$2,$3,'candidate.submitted.v1',$4,$5)",
        [
          randomUUID(),
          current.tenant_id,
          current.entity_id,
          actor.id,
          version + 1,
        ],
      );
      return this.record(client, actor);
    });
  }
  async logout(token: string) {
    await this.pool.query("SELECT end_candidate_session($1)", [hash(token)]);
  }
  async updateTask(
    actor: CandidateActor,
    taskId: string,
    input: z.infer<typeof candidateTaskUpdateSchema>,
    requestId: string,
  ) {
    return this.scoped(actor, async (client) => {
      const before = await this.record(client, actor);
      if (before.candidate.version !== input.caseVersion)
        throw new ConflictException(
          "Your onboarding changed. Reload before updating the checklist.",
        );
      await changeTask(client, actor.id, taskId, input, true);
      await client.query(
        "SELECT set_config('candidate.operation','task',true)",
      );
      const { rows } = await client.query(
        "UPDATE candidate_case SET version=version+1 WHERE id=$1 RETURNING tenant_id,entity_id,version",
        [actor.id],
      );
      const c = rows[0];
      await client.query(
        "INSERT INTO audit_event(id,tenant_id,entity_id,actor_id,actor_label,role,action,target,request_id,reason,details) VALUES($1,$2,$3,$4,'Candidate','candidate','candidate.task_updated',$5,$6,$7,$8)",
        [
          randomUUID(),
          c.tenant_id,
          c.entity_id,
          actor.id,
          actor.id,
          requestId,
          input.reason,
          JSON.stringify({ taskId, state: input.state }),
        ],
      );
      await client.query(
        "INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES($1,$2,$3,'candidate.task_updated.v1',$4,$5)",
        [randomUUID(), c.tenant_id, c.entity_id, actor.id, c.version],
      );
      return this.record(client, actor);
    });
  }

  async documents(actor: CandidateActor): Promise<CandidateDocument[]> {
    return this.scoped(actor, (client) => this.readDocuments(client, actor.id));
  }

  async uploadDocument(
    actor: CandidateActor,
    input: { category: CandidateDocumentCategory; title: string },
    file: UploadedFile | undefined,
    requestId: string,
  ): Promise<CandidateDocument> {
    if (!file || !file.buffer || !file.buffer.length) {
      throw new BadRequestException("A document file is required.");
    }
    if (file.size > MAX_DOCUMENT_BYTES || file.buffer.length > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException("Files must be 5 MB or smaller.");
    }

    const detected = detectType(file.buffer);
    if (!detected) {
      throw new BadRequestException("Upload a PDF, PNG or JPEG file.");
    }
    if (detected === "application/pdf" && hasActivePdfContent(file.buffer)) {
      throw new BadRequestException(
        "This PDF contains active content (scripts, launch actions or embedded files) and cannot be accepted.",
      );
    }

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const fileName = sanitizeFileName(file.originalname || "document", detected);

    return this.scoped(actor, async (client) => {
      await client.query(
        "SELECT set_config('candidate.operation', 'document', true)",
      );
      const { rows: caseRows } = await client.query(
        "SELECT id, tenant_id, entity_id, state, version FROM candidate_case WHERE id=$1 FOR UPDATE",
        [actor.id],
      );
      const c = caseRows[0];
      if (!c) throw new NotFoundException("Your candidate record is unavailable.");
      if (c.state === "cancelled") {
        throw new ConflictException("Cancelled intake cannot accept documents.");
      }
      if (c.state === "approved") {
        throw new ConflictException("Approved intake cannot accept documents.");
      }

      const { rows: existingRows } = await client.query(
        "SELECT id, status, version FROM candidate_document WHERE candidate_id=$1 AND category=$2 ORDER BY created_at DESC",
        [actor.id, input.category],
      );
      const verified = existingRows.find((r) => r.status === "verified");
      if (verified) {
        throw new ConflictException(
          "This document category is already verified and locked.",
        );
      }
      const pending = existingRows.find((r) => r.status === "pending");
      if (pending) {
        throw new ConflictException(
          "A document for this category is already pending review.",
        );
      }

      const docId = randomUUID();
      await client.query(
        `INSERT INTO candidate_document(
          id, candidate_id, category, title, file_name, content_type, size_bytes, sha256, status, version
        ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 1)`,
        [
          docId,
          actor.id,
          input.category,
          input.title.trim(),
          fileName,
          detected,
          file.buffer.length,
          sha256,
        ],
      );

      await client.query(
        "INSERT INTO candidate_document_content(document_id, candidate_id, bytes) VALUES($1, $2, $3)",
        [docId, actor.id, file.buffer],
      );

      await client.query(
        "SELECT set_config('candidate.operation', 'document', true)",
      );
      await client.query(
        "UPDATE candidate_case SET version=version+1 WHERE id=$1",
        [actor.id],
      );

      await client.query(
        `INSERT INTO audit_event(id, tenant_id, entity_id, actor_id, actor_label, role, action, target, request_id, details)
         VALUES($1, $2, $3, $4, 'Candidate', 'candidate', 'candidate.document_uploaded', $5, $6, $7)`,
        [
          randomUUID(),
          c.tenant_id,
          c.entity_id,
          actor.id,
          docId,
          requestId,
          JSON.stringify({ category: input.category, docId }),
        ],
      );

      await client.query(
        `INSERT INTO outbox_event(id, tenant_id, entity_id, event_type, aggregate_id, aggregate_version)
         VALUES($1, $2, $3, 'candidate.document_uploaded.v1', $4, $5)`,
        [randomUUID(), c.tenant_id, c.entity_id, actor.id, c.version + 1],
      );

      const { rows: newDocRows } = await client.query(
        `SELECT ${docColumns} FROM candidate_document d WHERE d.id=$1`,
        [docId],
      );
      return candidateDocumentSchema.parse(newDocRows[0]);
    });
  }

  async documentContent(
    actor: CandidateActor,
    documentId: string,
  ): Promise<{ fileName: string; contentType: string; bytes: Buffer }> {
    return this.scoped(actor, async (client) => {
      const { rows } = await client.query(
        `SELECT d.file_name AS "fileName", d.content_type AS "contentType", c.bytes
         FROM candidate_document d
         JOIN candidate_document_content c ON c.document_id = d.id
         WHERE d.id = $1 AND d.candidate_id = $2`,
        [documentId, actor.id],
      );
      if (!rows[0]) throw new NotFoundException("This document is unavailable.");
      return {
        fileName: rows[0].fileName,
        contentType: rows[0].contentType,
        bytes: rows[0].bytes,
      };
    });
  }
}
