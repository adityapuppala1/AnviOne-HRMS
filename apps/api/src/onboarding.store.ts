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
  localReviewSchema,
  assignedTaskListSchema,
  type candidateCreateSchema,
  type candidateActionSchema,
  type candidateReviewSchema,
  type localReviewProposalSchema,
  type localReviewDecisionSchema,
  type candidateTaskAssignmentSchema,
  type assignedTaskUpdateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { Principal } from "@anvi/authz";
import { hash, opaque, type PlatformStore } from "./platform.store";
import { previewKey, seal, unseal } from "./onboarding.crypto";
import { readTasks, changeTask } from "./checklist";
import { organizationUnitColumns } from "./organization.store";
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
        `SELECT ${organizationUnitColumns} FROM org_unit u
         WHERE u.kind IN ('department','location') AND u.active AND u.merged_into_id IS NULL
           AND u.effective_from<=leave_entity_today()
           AND (u.effective_to IS NULL OR u.effective_to>=leave_entity_today())
         ORDER BY u.name LIMIT 500`,
      );
      const managers = await client.query(
        "SELECT id,name FROM employee_directory WHERE status='active' ORDER BY name LIMIT 100",
      );
      const assignees = await client.query(
        "SELECT id,name,title FROM employee_directory WHERE status IN ('active','notice') ORDER BY name,id LIMIT 500",
      );
      return {
        departments: rows.filter((r) => r.kind === "department"),
        locations: rows.filter((r) => r.kind === "location"),
        managers: managers.rows,
        assignees: assignees.rows,
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
      const reviews = await client.query(
        `SELECT id,state,version,proposed_by AS "proposedBy",proposer_label AS "proposerLabel",
         proposal_note AS "proposalNote",proposed_at AS "proposedAt",decided_by AS "decidedBy",
         decider_label AS "deciderLabel",decision_note AS "decisionNote",decided_at AS "decidedAt"
         FROM candidate_local_review WHERE candidate_id=$1 ORDER BY proposed_at DESC,id`,
        [id],
      );
      return {
        candidate,
        tasks,
        readiness: activationReadiness(candidate.state, tasks),
        localReviews: reviews.rows.map((row) =>
          localReviewSchema.parse({
            ...row,
            proposedAt: row.proposedAt.toISOString(),
            decidedAt: row.decidedAt?.toISOString() ?? null,
          }),
        ),
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
        `SELECT id,kind FROM org_unit WHERE active AND merged_into_id IS NULL AND id=ANY($1::uuid[])
         AND effective_from<=leave_entity_today()
         AND (effective_to IS NULL OR effective_to>=leave_entity_today()) FOR SHARE`,
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
          "Choose departments and locations that are in effect in your current entity.",
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
  async assignTask(
    actor: Principal,
    id: string,
    taskId: string,
    input: z.infer<typeof candidateTaskAssignmentSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      await this.checklistCase(client, id, input.caseVersion);
      const task = (await readTasks(client, id)).find(
        (item) => item.id === taskId,
      );
      if (!task)
        throw new NotFoundException("This checklist task is unavailable.");
      if (task.owner === "candidate")
        throw new BadRequestException(
          "Candidate-owned tasks cannot be assigned internally.",
        );
      const current = await client.query(
        'SELECT version,employee_id AS "employeeId" FROM candidate_task_assignment WHERE task_id=$1 FOR UPDATE',
        [taskId],
      );
      const assignment = current.rows[0];
      if ((assignment?.version ?? null) !== input.assignmentVersion)
        throw new ConflictException(
          "This assignment changed. Reload before assigning it.",
        );
      if (assignment?.employeeId === input.employeeId)
        throw new ConflictException(
          "This task is already assigned to that employee.",
        );
      try {
        if (assignment)
          await client.query(
            `UPDATE candidate_task_assignment SET employee_id=$2,version=version+1,
             assigned_by=$3,assigner_label=$4,updated_at=now() WHERE task_id=$1`,
            [taskId, input.employeeId, actor.actorId, actor.name],
          );
        else
          await client.query(
            `INSERT INTO candidate_task_assignment(task_id,employee_id,version,assigned_by,assigner_label)
             VALUES($1,$2,1,$3,$4)`,
            [taskId, input.employeeId, actor.actorId, actor.name],
          );
      } catch (error) {
        if ((error as { code?: string }).code === "23514")
          throw new ConflictException(
            "Choose an active employee in this legal entity for an internal task.",
          );
        throw error;
      }
      await this.checklistEvent(
        client,
        actor,
        id,
        "candidate.task_assigned",
        requestId,
        input.reason,
        { taskId, employeeId: input.employeeId },
      );
      return { changed: true };
    });
  }
  async assignedTasks(actor: Principal) {
    this.platform.require(actor, "onboarding.task.update");
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT t.id,t.label,t.owner,t.required,t.due_on::text AS "dueOn",t.state,t.version,t.note,
         (t.depends_on IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_task d WHERE d.id=t.depends_on AND d.state='completed')) AS "waitingOn",
         (t.state<>'completed' AND t.due_on<(now() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue,
         c.name AS "candidateName",c.title AS "candidateTitle",c.joined_on::text AS "joinedOn",
         a.version AS "assignmentVersion",a.assigned_at AS "assignedAt",a.assigner_label AS "assignerLabel"
         FROM candidate_task_assignment a JOIN candidate_task t ON t.id=a.task_id
         JOIN candidate_case c ON c.id=t.candidate_id
         WHERE c.state<>'cancelled'
         ORDER BY (t.state='completed'),t.due_on,t.id`,
      );
      return assignedTaskListSchema.parse({
        items: rows.map((row) => ({
          ...row,
          assignedAt: row.assignedAt.toISOString(),
        })),
      });
    });
  }
  async updateAssignedTask(
    actor: Principal,
    taskId: string,
    input: z.infer<typeof assignedTaskUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "onboarding.task.update");
    return scoped(this.platform.pool, actor, async (client) => {
      const assigned = await client.query(
        `SELECT t.candidate_id AS "candidateId" FROM candidate_task t
         JOIN candidate_task_assignment a ON a.task_id=t.id WHERE t.id=$1`,
        [taskId],
      );
      const candidateId = assigned.rows[0]?.candidateId as string | undefined;
      if (!candidateId)
        throw new NotFoundException("This assigned task is unavailable.");
      const candidate = await client.query(
        "SELECT id,state FROM candidate_case WHERE id=$1 FOR UPDATE",
        [candidateId],
      );
      if (!candidate.rows[0] || candidate.rows[0].state === "cancelled")
        throw new ConflictException(
          "This intake is no longer open for task changes.",
        );
      const task = (await this.assignedTaskRows(client, taskId))[0];
      if (!task)
        throw new NotFoundException("This assigned task is unavailable.");
      if (task.version !== input.taskVersion)
        throw new ConflictException(
          "This task changed. Reload before updating it.",
        );
      if (task.state === input.state)
        throw new ConflictException("This task already has that status.");
      if (input.state === "completed" && task.waitingOn)
        throw new ConflictException(
          "Complete the prerequisite before this task.",
        );
      try {
        await client.query(
          `UPDATE candidate_task SET state=$2,note=$3,version=version+1,updated_at=now()
           WHERE id=$1`,
          [taskId, input.state, input.reason],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23514")
          throw new ConflictException(
            "This change conflicts with a prerequisite or completed dependent. Ask HR for help.",
          );
        throw error;
      }
      await this.checklistEvent(
        client,
        actor,
        candidateId,
        "candidate.assigned_task_updated",
        requestId,
        input.reason,
        { taskId, state: input.state },
      );
      return { changed: true };
    });
  }
  private async assignedTaskRows(client: PoolClient, taskId?: string) {
    const result = await client.query(
      `SELECT t.id,t.state,t.version,
       (t.depends_on IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_task d WHERE d.id=t.depends_on AND d.state='completed')) AS "waitingOn"
       FROM candidate_task_assignment a JOIN candidate_task t ON t.id=a.task_id
       WHERE ($1::uuid IS NULL OR t.id=$1)`,
      [taskId ?? null],
    );
    return result.rows;
  }
  async proposeLocalReview(
    actor: Principal,
    id: string,
    input: z.infer<typeof localReviewProposalSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const candidate = await this.checklistCase(client, id, input.caseVersion);
      const required = (await readTasks(client, id)).filter(
        (task) => task.required,
      );
      if (
        candidate.state !== "approved" ||
        !required.length ||
        required.some((task) => task.state !== "completed")
      )
        throw new ConflictException(
          "Approve the form and complete every required task before requesting review.",
        );
      try {
        await client.query(
          `INSERT INTO candidate_local_review(id,candidate_id,proposed_by,proposer_label,proposal_note)
           VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), id, actor.actorId, actor.name, input.reason],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw new ConflictException(
            "An independent review is already pending.",
          );
        throw error;
      }
      await this.checklistEvent(
        client,
        actor,
        id,
        "candidate.local_review_proposed",
        requestId,
        input.reason,
      );
      return { changed: true };
    });
  }
  // Pending readiness reviews for the approvals inbox. The maker never checks
  // their own proposal; approval also needs complete local evidence.
  async pendingReviews(actor: Principal) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<{
        id: string;
        version: number;
        caseId: string;
        caseVersion: number;
        candidateName: string;
        candidateTitle: string;
        department: string;
        proposerLabel: string;
        reason: string;
        submittedAt: string;
        proposedBy: string;
        evidenceReady: boolean;
      }>(
        `SELECT r.id, r.version, c.id AS "caseId", c.version AS "caseVersion",
           c.name AS "candidateName", c.title AS "candidateTitle", d.name AS department,
           r.proposer_label AS "proposerLabel", r.proposal_note AS reason,
           to_char(r.proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "submittedAt",
           r.proposed_by AS "proposedBy",
           (c.state='approved'
             AND EXISTS(SELECT 1 FROM candidate_task t WHERE t.candidate_id=c.id AND t.required)
             AND NOT EXISTS(SELECT 1 FROM candidate_task t WHERE t.candidate_id=c.id
               AND t.required AND t.state<>'completed')) AS "evidenceReady"
         FROM candidate_local_review r
         JOIN candidate_case c ON c.id=r.candidate_id
         JOIN org_unit d ON d.id=c.department_id
         WHERE r.state='pending' AND c.state<>'cancelled'
         ORDER BY r.proposed_at LIMIT 100`,
      );
      return rows.map(({ proposedBy, ...row }) => ({
        ...row,
        initials: row.candidateName
          .split(/\s+/)
          .map((part) => part[0] ?? "")
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        canDecide: proposedBy !== actor.actorId,
      }));
    });
  }
  async decideLocalReview(
    actor: Principal,
    id: string,
    reviewId: string,
    input: z.infer<typeof localReviewDecisionSchema>,
    requestId: string,
  ) {
    this.allow(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const candidate = await this.checklistCase(client, id, input.caseVersion);
      if (input.decision === "approved") {
        const required = (await readTasks(client, id)).filter(
          (task) => task.required,
        );
        if (
          candidate.state !== "approved" ||
          !required.length ||
          required.some((task) => task.state !== "completed")
        )
          throw new ConflictException(
            "Local evidence changed. Approve the form and complete every required task before deciding.",
          );
      }
      try {
        const result = await client.query(
          `UPDATE candidate_local_review SET state=$3,version=version+1,decided_by=$4,
           decider_label=$5,decision_note=$6,decided_at=now()
           WHERE id=$1 AND candidate_id=$2 AND version=$7 RETURNING id`,
          [
            reviewId,
            id,
            input.decision,
            actor.actorId,
            actor.name,
            input.reason,
            input.reviewVersion,
          ],
        );
        if (!result.rowCount)
          throw new ConflictException(
            "This review changed. Reload before deciding.",
          );
      } catch (error) {
        if ((error as { code?: string }).code === "23514")
          throw new ConflictException(
            "This decision is not allowed. Maker and checker must be different identities.",
          );
        throw error;
      }
      await this.checklistEvent(
        client,
        actor,
        id,
        input.decision === "withdrawn"
          ? "candidate.local_review_withdrawn"
          : "candidate.local_review_decided",
        requestId,
        input.reason,
        { reviewId, decision: input.decision },
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
