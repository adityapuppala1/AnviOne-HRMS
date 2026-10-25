import { randomUUID } from "node:crypto";
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { scoped, audit, type PoolClient } from "@anvi/database";
import {
  candidateSchema,
  candidateSubmissionSchema,
  candidateDeliverySchema,
  activationReadiness,
  type candidateCreateSchema,
  type candidateActionSchema,
  type candidateReviewSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { Principal } from "@anvi/authz";
import { hash, opaque, type PlatformStore } from "./platform.store";
import { previewKey, seal, unseal } from "./onboarding.crypto";
import { readTasks, changeTask } from "./checklist";
import {
  onboardingStarter,
  type candidateTaskCreateSchema,
  type candidateTaskUpdateSchema,
} from "@anvi/contracts";
const columns = `c.id,c.name,c.email,c.title,c.joined_on::text AS "joinedOn",c.state,c.version,c.invitation_expires_at AS "invitationExpiresAt",c.review_note AS "reviewNote",c.draft,d.name AS department,l.name AS location,p.name AS manager`;
const joins = `candidate_case c JOIN org_unit d ON d.id=c.department_id JOIN org_unit l ON l.id=c.location_id JOIN employee e ON e.id=c.manager_id JOIN person p ON p.id=e.person_id`;
export class OnboardingStore {
  constructor(private readonly platform: PlatformStore) {}
  private allow(actor: Principal) {
    this.platform.require(actor, "onboarding.manage");
    return previewKey(this.platform.config);
  }
  private async record(client: PoolClient, id: string, lock = false) {
    if (
      lock &&
      !(
        await client.query(
          "SELECT id FROM candidate_case WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0]
    )
      throw new NotFoundException("This intake record is unavailable.");
    const { rows } = await client.query(
      `SELECT ${columns} FROM ${joins} WHERE c.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This intake record is unavailable.");
    const row = rows[0];
    return candidateSchema.parse({
      ...row,
      invitationExpiresAt: row.invitationExpiresAt?.toISOString() ?? null,
    });
  }
  async list(actor: Principal, q: string) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await client.query(
        `SELECT ${columns} FROM ${joins} WHERE c.name ILIKE $1 OR c.email ILIKE $1 ORDER BY c.created_at DESC,c.id LIMIT 50`,
        [term],
      );
      return {
        items: rows.map((row) =>
          candidateSchema.parse({
            ...row,
            invitationExpiresAt: row.invitationExpiresAt?.toISOString() ?? null,
          }),
        ),
      };
    });
  }
  async options(actor: Principal) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT u.id,u.kind,u.code,u.name,u.active,u.version,0::int AS "employeeCount" FROM org_unit u WHERE active ORDER BY name LIMIT 500`,
      );
      const managers = await client.query(
        "SELECT id,name FROM employee_directory WHERE status='active' ORDER BY name LIMIT 100",
      );
      return {
        departments: rows.filter((r) => r.kind === "department"),
        locations: rows.filter((r) => r.kind === "location"),
        managers: managers.rows,
      };
    });
  }
  async detail(actor: Principal, id: string) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const candidate = await this.record(client, id);
      const { rows } = await client.query(
        `SELECT version,payload,submitted_at AS "submittedAt" FROM candidate_submission WHERE candidate_id=$1 ORDER BY version DESC`,
        [id],
      );
      const tasks = await readTasks(client, id);
      return {
        candidate,
        tasks,
        readiness: activationReadiness(candidate.state, tasks),
        submissions: rows.map((r) =>
          candidateSubmissionSchema.parse({
            ...r,
            submittedAt: r.submittedAt.toISOString(),
          }),
        ),
      };
    });
  }
  async create(
    actor: Principal,
    input: z.infer<typeof candidateCreateSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const masters = await client.query(
        "SELECT id,kind FROM org_unit WHERE active AND id=ANY($1::uuid[]) FOR SHARE",
        [[input.departmentId, input.locationId]],
      );
      const manager = await client.query(
        "SELECT id FROM employee WHERE id=$1 AND status='active'",
        [input.managerId],
      );
      if (
        !masters.rows.some(
          (r) => r.id === input.departmentId && r.kind === "department",
        ) ||
        !masters.rows.some(
          (r) => r.id === input.locationId && r.kind === "location",
        ) ||
        !manager.rows[0]
      )
        throw new BadRequestException(
          "Choose active assignments from your current entity.",
        );
      const id = randomUUID();
      await client.query(
        `INSERT INTO candidate_case(id,tenant_id,entity_id,name,email,title,department_id,location_id,manager_id,joined_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          actor.tenantId,
          actor.entityId,
          input.name,
          input.email,
          input.title,
          input.departmentId,
          input.locationId,
          input.managerId,
          input.joinedOn,
        ],
      );
      await this.event(
        client,
        actor,
        id,
        1,
        "candidate.created",
        requestId,
        "Created synthetic intake record",
      );
      return this.record(client, id);
    });
  }
  async action(
    actor: Principal,
    id: string,
    input: z.infer<typeof candidateActionSchema>,
    requestId: string,
    action: "invite" | "revoke" | "review",
    decision?: z.infer<typeof candidateReviewSchema>["decision"],
  ) {
    const key = this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const before = await this.record(client, id, true);
      if (before.version !== input.version)
        throw new ConflictException(
          "This intake record changed. Reload it before saving.",
        );
      if (before.state === "cancelled")
        throw new ConflictException("This intake record is cancelled.");
      let event = "candidate.reviewed";
      if (action === "invite") {
        const recent = await client.query(
          "SELECT 1 FROM candidate_case WHERE id=$1 AND invitation_sent_at>now()-interval '60 seconds'",
          [id],
        );
        if (recent.rows[0])
          throw new ConflictException(
            "Wait one minute before sending another invitation preview.",
          );
        const token = opaque();
        await client.query(
          `UPDATE candidate_case SET invitation_hash=$2,invitation_generation=invitation_generation+1,invitation_expires_at=now()+interval '72 hours',invitation_consumed_at=NULL,invitation_sent_at=now(),otp_sent_at=NULL,otp_count=0,otp_window=now(),state=CASE WHEN state='draft' THEN 'invited' ELSE state END,version=version+1 WHERE id=$1`,
          [id, hash(token)],
        );
        await this.clearCredentials(client, id);
        await client.query(
          `INSERT INTO candidate_delivery_preview VALUES($1,'invitation',$2,now()+interval '72 hours')`,
          [
            id,
            seal(key, {
              invitationUrl: `${this.platform.config.CANDIDATE_ORIGIN}/#invite=${token}`,
            }),
          ],
        );
        event = "candidate.invited";
      } else if (action === "revoke") {
        await client.query(
          "UPDATE candidate_case SET state='cancelled',invitation_hash=NULL,invitation_expires_at=now(),version=version+1 WHERE id=$1",
          [id],
        );
        await this.clearCredentials(client, id);
        event = "candidate.revoked";
      } else {
        if (before.state !== "submitted" || !decision)
          throw new ConflictException("Only a submitted form can be reviewed.");
        await client.query(
          "UPDATE candidate_case SET state=$2,review_note=$3,version=version+1 WHERE id=$1",
          [id, decision, input.reason],
        );
      }
      const result = await this.record(client, id);
      await this.event(
        client,
        actor,
        id,
        result.version,
        event,
        requestId,
        input.reason,
      );
      return result;
    });
  }
  async delivery(actor: Principal, id: string, requestId: string) {
    const key = this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      await this.record(client, id);
      const { rows } = await client.query(
        "SELECT ciphertext,expires_at FROM candidate_delivery_preview WHERE candidate_id=$1 AND expires_at>now()",
        [id],
      );
      let content: Record<string, unknown> = {
        previewOnly: true,
        expiresAt: null,
      };
      for (const row of rows)
        content = {
          ...content,
          ...(unseal(key, row.ciphertext) as object),
          expiresAt: row.expires_at.toISOString(),
        };
      await audit(client, actor, "candidate.delivery_previewed", id, requestId);
      return candidateDeliverySchema.parse(content);
    });
  }
  private async clearCredentials(client: PoolClient, id: string) {
    for (const table of [
      "candidate_challenge",
      "candidate_session",
      "candidate_delivery_preview",
    ])
      await client.query(`DELETE FROM ${table} WHERE candidate_id=$1`, [id]);
  }
  async startChecklist(
    actor: Principal,
    id: string,
    input: z.infer<typeof candidateActionSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      await this.checklistCase(client, id, input.version);
      if ((await readTasks(client, id)).length)
        throw new ConflictException(
          "The starter checklist can only be applied to an empty checklist.",
        );
      const ids = onboardingStarter.map(() => randomUUID());
      for (const [i, task] of onboardingStarter.entries()) {
        await client.query(
          "INSERT INTO candidate_task(id,candidate_id,label,owner,required,due_on,depends_on,template_code) SELECT $1,id,$3,$4,$5,joined_on+$6::integer,$7,'starter_v1' FROM candidate_case WHERE id=$2",
          [
            ids[i],
            id,
            task.label,
            task.owner,
            task.required,
            task.dueOffsetDays,
            task.prerequisite === null ? null : ids[task.prerequisite],
          ],
        );
      }
      await this.checklistEvent(
        client,
        actor,
        id,
        "candidate.checklist_started",
        requestId,
        input.reason,
      );
      return { changed: true };
    });
  }
  async createTask(
    actor: Principal,
    id: string,
    input: z.infer<typeof candidateTaskCreateSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      await this.checklistCase(client, id, input.caseVersion);
      const tasks = await readTasks(client, id);
      if (tasks.length >= 30)
        throw new ConflictException(
          "This checklist has reached its 30-task limit.",
        );
      if (input.dependsOn && !tasks.some((t) => t.id === input.dependsOn))
        throw new BadRequestException(
          "Choose a prerequisite from this intake.",
        );
      await client.query(
        "INSERT INTO candidate_task(id,candidate_id,label,owner,required,due_on,depends_on) SELECT $1,id,$3,$4,$5,joined_on+$6::integer,$7 FROM candidate_case WHERE id=$2",
        [
          randomUUID(),
          id,
          input.label,
          input.owner,
          input.required,
          input.dueOffsetDays,
          input.dependsOn,
        ],
      );
      await this.checklistEvent(
        client,
        actor,
        id,
        "candidate.task_created",
        requestId,
        "Added synthetic checklist task",
      );
      return { changed: true };
    });
  }
  async updateTask(
    actor: Principal,
    id: string,
    taskId: string,
    input: z.infer<typeof candidateTaskUpdateSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      await this.checklistCase(client, id, input.caseVersion);
      await changeTask(client, id, taskId, input);
      await this.checklistEvent(
        client,
        actor,
        id,
        "candidate.task_updated",
        requestId,
        input.reason,
        { taskId, state: input.state },
      );
      return { changed: true };
    });
  }
  private async checklistCase(client: PoolClient, id: string, version: number) {
    const c = await this.record(client, id, true);
    if (c.state === "cancelled")
      throw new ConflictException("This intake is cancelled.");
    if (c.version !== version)
      throw new ConflictException(
        "This intake changed. Reload before updating the checklist.",
      );
    return c;
  }
  private async checklistEvent(
    client: PoolClient,
    actor: Principal,
    id: string,
    action: string,
    requestId: string,
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    const result = await client.query(
      "UPDATE candidate_case SET version=version+1 WHERE id=$1 RETURNING version",
      [id],
    );
    await audit(client, actor, action, id, requestId, { reason, details });
    await client.query(
      "INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        `${action}.v1`,
        id,
        result.rows[0].version,
      ],
    );
  }
  private async event(
    client: PoolClient,
    actor: Principal,
    id: string,
    version: number,
    action: string,
    requestId: string,
    reason: string,
  ) {
    await audit(client, actor, action, id, requestId, { reason });
    await client.query(
      "INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        `${action}.v1`,
        id,
        version,
      ],
    );
  }
}
