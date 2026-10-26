import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import { scopeFor, type Principal } from "@anvi/authz";
import {
  employeeDocumentSchema,
  type EmployeeDocument,
  type documentDecisionSchema,
  type documentUploadFieldsSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";
import {
  MAX_DOCUMENT_BYTES,
  detectType,
  hasActivePdfContent,
  sanitizeFileName,
} from "./document.validation";

const columns = `d.id, d.employee_id AS "employeeId", p.name AS "employeeName", p.initials,
  p.department, d.category, d.title, d.file_name AS "fileName", d.content_type AS "contentType",
  d.size_bytes AS "sizeBytes", d.status, d.version,
  to_char(d.uploaded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "uploadedAt",
  d.reviewer_label AS "reviewedBy", d.review_note AS "reviewNote",
  to_char(d.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "reviewedAt"`;
const from = `FROM employee_document d JOIN employee_directory p ON p.id=d.employee_id`;
type Row = Omit<EmployeeDocument, "canWithdraw" | "canReview">;

const ruleErrors: Record<string, (message: string) => Error> = {
  DC003: (m) => new BadRequestException(m),
  DC004: (m) => new ConflictException(m),
  DC005: (m) => new ForbiddenException(m),
  DC006: (m) => new ForbiddenException(m),
};

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

// Database guards bind uploads to their owner, keep content immutable and route
// verification through the shared workflow rule. Bytes are validated before storage.
export class DocumentStore {
  constructor(private readonly platform: PlatformStore) {}

  async mine(actor: Principal) {
    this.platform.require(actor, "document.self");
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT ${columns} ${from} WHERE d.employee_id=$1 ORDER BY d.uploaded_at DESC LIMIT 100`,
        [actor.employeeId],
      );
      return { items: rows.map((row) => this.present(actor, row)) };
    });
  }

  async review(actor: Principal) {
    this.platform.require(actor, "document.review");
    return scoped(this.platform.pool, actor, async (client) => ({
      pending: (await this.pendingRows(client, actor)).map((row) =>
        this.present(actor, row),
      ),
      recent: (
        await client.query<Row>(
          `SELECT ${columns} ${from} WHERE d.status<>'pending' AND d.employee_id<>$1
           ORDER BY d.reviewed_at DESC LIMIT 20`,
          [actor.employeeId],
        )
      ).rows.map((row) => this.present(actor, row)),
    }));
  }

  async pendingForInbox(actor: Principal): Promise<EmployeeDocument[]> {
    this.platform.require(actor, "document.review");
    return scoped(this.platform.pool, actor, async (client) =>
      (await this.pendingRows(client, actor)).map((row) =>
        this.present(actor, row),
      ),
    );
  }

  async upload(
    actor: Principal,
    fields: z.infer<typeof documentUploadFieldsSchema>,
    file: UploadedFile | undefined,
    requestId: string,
  ): Promise<EmployeeDocument> {
    this.platform.require(actor, "document.self");
    if (!file || file.size === 0)
      throw new BadRequestException("Choose a file to upload.");
    if (file.size > MAX_DOCUMENT_BYTES)
      throw new BadRequestException("Files can be up to 5 MB.");
    const type = detectType(file.buffer);
    if (!type) throw new BadRequestException("Upload a PDF, PNG or JPEG file.");
    if (type === "application/pdf" && hasActivePdfContent(file.buffer))
      throw new BadRequestException(
        "PDFs with scripts, automatic actions or embedded files are not accepted.",
      );
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const fileName = sanitizeFileName(file.originalname, type);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        // The guard binds owner, actor, status and version; placeholders are overwritten.
        await client.query(
          `INSERT INTO employee_document(id,tenant_id,entity_id,employee_id,category,title,file_name,
             content_type,size_bytes,sha256,status,version,uploaded_by_actor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',1,$11)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            fields.category,
            fields.title,
            fileName,
            type,
            file.size,
            sha256,
            actor.actorId,
          ],
        );
        await client.query(
          `INSERT INTO employee_document_content(document_id,tenant_id,entity_id,bytes)
           VALUES ($1,$2,$3,$4)`,
          [id, actor.tenantId, actor.entityId, file.buffer],
        );
        const item = await this.read(client, actor, id);
        await audit(
          client,
          actor,
          "document.uploaded",
          `document:${id}:v1`,
          requestId,
          {
            details: { after: this.snapshot(item), sha256 },
          },
        );
        await this.event(client, actor, id, 1, "document.uploaded.v1");
        return item;
      }),
    );
  }

  withdraw(actor: Principal, id: string, version: number, requestId: string) {
    this.platform.require(actor, "document.self");
    return this.transition(actor, id, version, requestId, "withdrawn", null);
  }

  decide(
    actor: Principal,
    id: string,
    input: z.infer<typeof documentDecisionSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "document.review");
    return this.transition(
      actor,
      id,
      input.version,
      requestId,
      input.decision === "verify" ? "verified" : "rejected",
      input.note,
    );
  }

  // An authorized, audited read of one document's bytes.
  async content(actor: Principal, id: string, requestId: string) {
    if (
      !scopeFor(actor, "document.self") &&
      !scopeFor(actor, "document.review")
    )
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<{
        bytes: Buffer;
        contentType: string;
        fileName: string;
        version: number;
      }>(
        `SELECT c.bytes, d.content_type AS "contentType", d.file_name AS "fileName", d.version
         FROM employee_document d JOIN employee_document_content c ON c.document_id=d.id
         WHERE d.id=$1`,
        [id],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException("This document is unavailable.");
      await audit(
        client,
        actor,
        "document.downloaded",
        `document:${id}:v${row.version}`,
        requestId,
      );
      return row;
    });
  }

  private transition(
    actor: Principal,
    id: string,
    version: number,
    requestId: string,
    status: "verified" | "rejected" | "withdrawn",
    note: string | null,
  ): Promise<EmployeeDocument> {
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const locked = await client.query(
          "SELECT id FROM employee_document WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!locked.rows[0])
          throw new NotFoundException("This document is unavailable.");
        const previous = await this.read(client, actor, id);
        if (previous.version !== version)
          throw new ConflictException(
            "This document changed. Reload it before trying again.",
          );
        await client.query(
          "UPDATE employee_document SET status=$2, version=version+1, review_note=$3 WHERE id=$1",
          [id, status, note],
        );
        const item = await this.read(client, actor, id);
        await audit(
          client,
          actor,
          `document.${status}`,
          `document:${id}:v${item.version}`,
          requestId,
          {
            reason: note ?? undefined,
            details: {
              before: this.snapshot(previous),
              after: this.snapshot(item),
            },
          },
        );
        await this.event(
          client,
          actor,
          id,
          item.version,
          `document.${status}.v1`,
        );
        return item;
      }),
    );
  }

  private async pendingRows(client: PoolClient, actor: Principal) {
    const { rows } = await client.query<Row>(
      `SELECT ${columns} ${from} WHERE d.status='pending' AND d.employee_id<>$1
       ORDER BY d.uploaded_at LIMIT 100`,
      [actor.employeeId],
    );
    return rows;
  }

  private async read(client: PoolClient, actor: Principal, id: string) {
    const { rows } = await client.query<Row>(
      `SELECT ${columns} ${from} WHERE d.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This document is unavailable.");
    return this.present(actor, rows[0]);
  }

  private present(actor: Principal, row: Row): EmployeeDocument {
    const mine = row.employeeId === actor.employeeId;
    return employeeDocumentSchema.parse({
      ...row,
      canWithdraw:
        mine &&
        row.status === "pending" &&
        Boolean(scopeFor(actor, "document.self")),
      canReview:
        !mine &&
        row.status === "pending" &&
        scopeFor(actor, "document.review") === "entity",
    });
  }

  private snapshot(item: EmployeeDocument) {
    const {
      id,
      employeeId,
      category,
      title,
      fileName,
      contentType,
      sizeBytes,
      status,
      version,
    } = item;
    return {
      id,
      employeeId,
      category,
      title,
      fileName,
      contentType,
      sizeBytes,
      status,
      version,
    };
  }

  private async event(
    client: PoolClient,
    actor: Principal,
    aggregateId: string,
    version: number,
    event: string,
  ) {
    await client.query(
      `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        event,
        aggregateId,
        version,
      ],
    );
  }

  private async rules<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "23505")
          throw new ConflictException("You have already uploaded this file.");
        if (
          typeof error.code === "string" &&
          error.code in ruleErrors &&
          "message" in error &&
          typeof error.message === "string"
        )
          throw ruleErrors[error.code]!(`${error.message}.`);
      }
      throw error;
    }
  }
}
