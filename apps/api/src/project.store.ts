import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import { scopeFor, type Principal } from "@anvi/authz";
import {
  myTimeSchema,
  projectListSchema,
  projectMemberListSchema,
  projectSchema,
  projectTaskListSchema,
  projectTaskSchema,
  timeEntrySchema,
  timeReviewSchema,
  type MyTime,
  type Project,
  type ProjectList,
  type ProjectMemberList,
  type ProjectTask,
  type ProjectTaskList,
  type TimeEntry,
  type TimeReview,
  type myTimeQuerySchema,
  type projectCreateSchema,
  type projectMemberAddSchema,
  type projectMemberRemoveSchema,
  type projectQuerySchema,
  type projectStatusChangeSchema,
  type projectTaskCreateSchema,
  type projectTaskStatusChangeSchema,
  type projectTaskUpdateSchema,
  type projectUpdateSchema,
  type timeEntryApproveSchema,
  type timeEntryCreateSchema,
  type timeEntryRejectSchema,
  type timeEntryWithdrawSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const LIMIT = 200;
const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const day = (column: string) => `to_char(${column},'YYYY-MM-DD')`;
const projectColumns = `p.id, p.code, p.name, p.description, p.owner_employee_id AS "ownerEmployeeId",
  p.owner_name AS "ownerName", p.status, ${day("p.start_date")} AS "startDate", ${day("p.end_date")} AS "endDate",
  (SELECT count(*)::int FROM project_member m WHERE m.project_id=p.id AND m.removed_at IS NULL) AS "memberCount",
  (SELECT count(*)::int FROM project_task t WHERE t.project_id=p.id AND t.status<>'done') AS "openTaskCount",
  p.version, p.created_by_label AS "createdBy", ${stamp("p.created_at")} AS "createdAt",
  p.updated_by_label AS "updatedBy", ${stamp("p.updated_at")} AS "updatedAt",
  EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.removed_at IS NULL AND m.employee_id=$1) AS "isMember"`;
const memberColumns = `m.id, m.employee_id AS "employeeId", m.employee_name AS "employeeName",
  m.employee_code AS "employeeCode", m.role, m.added_by_label AS "addedBy", ${stamp("m.added_at")} AS "addedAt",
  ${stamp("m.removed_at")} AS "removedAt", m.removed_by_label AS "removedBy", m.version`;
const taskColumns = `t.id, t.project_id AS "projectId", t.title, t.description,
  t.assignee_employee_id AS "assigneeEmployeeId",
  (SELECT m.employee_name FROM project_member m WHERE m.project_id=t.project_id
    AND m.employee_id=t.assignee_employee_id ORDER BY m.added_at DESC LIMIT 1) AS "assigneeName",
  t.status, t.priority, ${day("t.due_date")} AS "dueDate", t.version, t.created_by_label AS "createdBy",
  ${stamp("t.created_at")} AS "createdAt", t.updated_by_label AS "updatedBy", ${stamp("t.updated_at")} AS "updatedAt"`;
const entryColumns = `e.id, e.employee_id AS "employeeId", e.employee_name AS "employeeName",
  e.project_id AS "projectId", e.project_code AS "projectCode", p.name AS "projectName",
  p.owner_employee_id AS "ownerId", e.task_id AS "taskId", t.title AS "taskTitle",
  ${day("e.work_date")} AS "workDate", e.minutes, e.note, e.status, e.decision_note AS "decisionNote",
  ${stamp("e.decided_at")} AS "decidedAt", e.approved_by_label AS "approvedBy",
  ${stamp("e.withdrawn_at")} AS "withdrawnAt", e.version, ${stamp("e.created_at")} AS "createdAt"`;
const entryFrom = `FROM time_entry e LEFT JOIN project p ON p.id=e.project_id
  LEFT JOIN project_task t ON t.id=e.task_id`;

const ruleErrors: Record<string, (message: string) => Error> = {
  PJ003: (m) => new BadRequestException(m),
  PJ004: (m) => new ConflictException(m),
  PJ005: (m) => new ForbiddenException(m),
};
// Lock contention and serialization failures are retryable conflicts, not server errors.
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  project_tenant_id_entity_id_code_key:
    "A project with this code already exists.",
  project_member_active_key: "This person is already on the project.",
};

type ProjectRow = Omit<Project, "canManage" | "canLogTime" | "canReopen"> & {
  isMember: boolean;
};
type TaskRow = Omit<ProjectTask, "canEdit" | "canChangeStatus">;
type EntryRow = Omit<TimeEntry, "canWithdraw" | "canDecide"> & {
  ownerId: string | null;
};
type Locked = { version: number; [key: string]: unknown };

// Who may do what, the order of steps, the time limits and the daily cap all live in the
// database guards; the store shapes requests and replies and takes locks in one order:
// the project's advisory lock first, then the row.
export class ProjectStore {
  constructor(private readonly platform: PlatformStore) {}

  private see(actor: Principal) {
    if (!scopeFor(actor, "project.manage"))
      this.platform.require(actor, "project.self");
  }
  private manages(actor: Principal, ownerId: string) {
    const scope = scopeFor(actor, "project.manage");
    return (
      scope === "entity" || (scope === "team" && ownerId === actor.employeeId)
    );
  }

  async list(
    actor: Principal,
    query: z.infer<typeof projectQuerySchema>,
  ): Promise<ProjectList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await client.query<ProjectRow>(
        `SELECT ${projectColumns} FROM project p
         WHERE ($2='%%' OR p.name ILIKE $2 OR p.code ILIKE $2) AND ($3::text IS NULL OR p.status=$3)
         ORDER BY (p.status IN ('active','planned','on_hold')) DESC, p.name LIMIT ${LIMIT}`,
        [actor.employeeId, term, query.status ?? null],
      );
      const counts = {
        planned: 0,
        active: 0,
        on_hold: 0,
        completed: 0,
        cancelled: 0,
      };
      for (const row of (
        await client.query<{ status: keyof typeof counts; count: number }>(
          "SELECT status, count(*)::int AS count FROM project GROUP BY status",
        )
      ).rows)
        counts[row.status] = row.count;
      return projectListSchema.parse({
        items: rows.map((row) => this.projectFlags(actor, row)),
        counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        limit: LIMIT,
        canCreate: Boolean(scopeFor(actor, "project.manage")),
      });
    });
  }

  async detail(actor: Principal, id: string): Promise<Project> {
    this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.project(client, actor, id),
    );
  }

  async create(
    actor: Principal,
    input: z.infer<typeof projectCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        const owner = input.ownerEmployeeId ?? actor.employeeId;
        await client.query(
          `INSERT INTO project(id,tenant_id,entity_id,code,name,description,owner_employee_id,status,start_date,end_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.code,
            input.name,
            input.description ?? null,
            owner,
            input.status,
            input.startDate,
            input.endDate ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "project.created",
          `project:${id}`,
          id,
          1,
          {
            code: input.code,
            ownerEmployeeId: owner,
            status: input.status,
          },
        );
        return this.project(client, actor, id);
      }),
    );
  }

  async update(
    actor: Principal,
    id: string,
    input: z.infer<typeof projectUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockProject(client, id, input.version);
        await client.query(
          `UPDATE project SET name=$2, description=$3, owner_employee_id=$4, start_date=$5, end_date=$6,
             version=version+1 WHERE id=$1`,
          [
            id,
            input.name,
            input.description ?? null,
            input.ownerEmployeeId,
            input.startDate,
            input.endDate ?? null,
          ],
        );
        const details: Record<string, unknown> = { ...input };
        delete details.version;
        await this.record(
          client,
          actor,
          requestId,
          "project.updated",
          `project:${id}`,
          id,
          row.version + 1,
          details,
        );
        return this.project(client, actor, id);
      }),
    );
  }

  async changeStatus(
    actor: Principal,
    id: string,
    input: z.infer<typeof projectStatusChangeSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockProject(client, id, input.version);
        await client.query(
          "UPDATE project SET status=$2, version=version+1 WHERE id=$1",
          [id, input.status],
        );
        await this.record(
          client,
          actor,
          requestId,
          "project.status_changed",
          `project:${id}`,
          id,
          row.version + 1,
          {
            from: row.status,
            to: input.status,
          },
        );
        return this.project(client, actor, id);
      }),
    );
  }

  async members(actor: Principal, id: string): Promise<ProjectMemberList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.memberList(client, actor, id),
    );
  }

  async addMember(
    actor: Principal,
    id: string,
    input: z.infer<typeof projectMemberAddSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.project(client, actor, id);
        const memberId = randomUUID();
        await client.query(
          `INSERT INTO project_member(id,tenant_id,entity_id,project_id,employee_id,role) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            memberId,
            actor.tenantId,
            actor.entityId,
            id,
            input.employeeId,
            input.role,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "project.member_added",
          `project-member:${memberId}`,
          memberId,
          1,
          {
            projectId: id,
            employeeId: input.employeeId,
            role: input.role,
          },
        );
        return this.memberList(client, actor, id);
      }),
    );
  }

  async removeMember(
    actor: Principal,
    id: string,
    employeeId: string,
    input: z.infer<typeof projectMemberRemoveSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.projectLock(client, id);
        const found = await client.query<{ id: string; version: number }>(
          `SELECT id, version FROM project_member WHERE project_id=$1 AND employee_id=$2 AND removed_at IS NULL FOR UPDATE`,
          [id, employeeId],
        );
        const row = found.rows[0];
        if (!row)
          throw new NotFoundException("This person is not on the project.");
        if (row.version !== input.version)
          throw new ConflictException(
            "This membership changed. Reload it before trying again.",
          );
        await client.query(
          "UPDATE project_member SET removed_at=now(), version=version+1 WHERE id=$1",
          [row.id],
        );
        await this.record(
          client,
          actor,
          requestId,
          "project.member_removed",
          `project-member:${row.id}`,
          row.id,
          row.version + 1,
          {
            projectId: id,
            employeeId,
          },
        );
        return this.memberList(client, actor, id);
      }),
    );
  }

  async tasks(actor: Principal, id: string): Promise<ProjectTaskList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const project = await this.project(client, actor, id);
      const { rows } = await client.query<TaskRow>(
        `SELECT ${taskColumns} FROM project_task t WHERE t.project_id=$1
         ORDER BY (t.status='done'), CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           t.due_date NULLS LAST, t.created_at LIMIT ${LIMIT}`,
        [id],
      );
      const counts = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
      for (const row of (
        await client.query<{ status: keyof typeof counts; count: number }>(
          "SELECT status, count(*)::int AS count FROM project_task WHERE project_id=$1 GROUP BY status",
          [id],
        )
      ).rows)
        counts[row.status] = row.count;
      return projectTaskListSchema.parse({
        items: rows.map((row) => this.taskFlags(actor, project, row)),
        counts,
        limit: LIMIT,
        canAdd: project.canManage,
      });
    });
  }

  async createTask(
    actor: Principal,
    id: string,
    input: z.infer<typeof projectTaskCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const project = await this.project(client, actor, id);
        const taskId = randomUUID();
        await client.query(
          `INSERT INTO project_task(id,tenant_id,entity_id,project_id,title,description,assignee_employee_id,priority,due_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            taskId,
            actor.tenantId,
            actor.entityId,
            id,
            input.title,
            input.description ?? null,
            input.assigneeEmployeeId ?? null,
            input.priority,
            input.dueDate ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "project.task_created",
          `project-task:${taskId}`,
          taskId,
          1,
          {
            projectId: id,
            assigneeEmployeeId: input.assigneeEmployeeId ?? null,
            priority: input.priority,
          },
        );
        return this.task(client, actor, project, taskId);
      }),
    );
  }

  async updateTask(
    actor: Principal,
    id: string,
    taskId: string,
    input: z.infer<typeof projectTaskUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockTask(client, id, taskId, input.version);
        await client.query(
          `UPDATE project_task SET title=$2, description=$3, assignee_employee_id=$4, priority=$5, due_date=$6,
             version=version+1 WHERE id=$1`,
          [
            taskId,
            input.title,
            input.description ?? null,
            input.assigneeEmployeeId ?? null,
            input.priority,
            input.dueDate ?? null,
          ],
        );
        const details: Record<string, unknown> = { ...input };
        delete details.version;
        await this.record(
          client,
          actor,
          requestId,
          "project.task_updated",
          `project-task:${taskId}`,
          taskId,
          row.version + 1,
          {
            projectId: id,
            ...details,
          },
        );
        return this.task(
          client,
          actor,
          await this.project(client, actor, id),
          taskId,
        );
      }),
    );
  }

  async changeTaskStatus(
    actor: Principal,
    id: string,
    taskId: string,
    input: z.infer<typeof projectTaskStatusChangeSchema>,
    requestId: string,
  ) {
    // Owners and HR move any task; an assignee moves their own.
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockTask(client, id, taskId, input.version);
        await client.query(
          "UPDATE project_task SET status=$2, version=version+1 WHERE id=$1",
          [taskId, input.status],
        );
        await this.record(
          client,
          actor,
          requestId,
          "project.task_status_changed",
          `project-task:${taskId}`,
          taskId,
          row.version + 1,
          {
            projectId: id,
            from: row.status,
            to: input.status,
          },
        );
        return this.task(
          client,
          actor,
          await this.project(client, actor, id),
          taskId,
        );
      }),
    );
  }

  async myTime(
    actor: Principal,
    query: z.infer<typeof myTimeQuerySchema>,
  ): Promise<MyTime> {
    this.platform.require(actor, "project.self");
    return scoped(this.platform.pool, actor, (client) =>
      this.ownTime(client, actor, query.weekOf ?? null),
    );
  }

  async logTime(
    actor: Principal,
    input: z.infer<typeof timeEntryCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO time_entry(id,tenant_id,entity_id,employee_id,project_id,task_id,work_date,minutes,note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            input.projectId,
            input.taskId ?? null,
            input.workDate,
            input.minutes,
            input.note ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "time.logged",
          `time:${id}`,
          id,
          1,
          {
            projectId: input.projectId,
            taskId: input.taskId ?? null,
            workDate: input.workDate,
            minutes: input.minutes,
          },
        );
        return this.ownTime(client, actor, input.workDate);
      }),
    );
  }

  async withdraw(
    actor: Principal,
    id: string,
    input: z.infer<typeof timeEntryWithdrawSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "project.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockEntry(client, id, input.version);
        if (row.employeeId !== actor.employeeId)
          throw new NotFoundException("This time entry is unavailable.");
        await this.moveEntry(
          client,
          actor,
          id,
          row,
          requestId,
          "withdrawn",
          null,
        );
        return this.ownTime(client, actor, null);
      }),
    );
  }

  async review(actor: Principal): Promise<TimeReview> {
    this.platform.require(actor, "project.manage");
    return scoped(this.platform.pool, actor, async (client) => {
      // Row security already limits a manager to their own projects' time and their own.
      const where = `e.status='submitted' AND e.employee_id<>$1
        AND ($2 OR p.owner_employee_id=$1)`;
      const hr = scopeFor(actor, "project.manage") === "entity";
      const { rows } = await client.query<EntryRow>(
        `SELECT ${entryColumns} ${entryFrom} WHERE ${where}
         ORDER BY e.work_date, e.created_at LIMIT ${LIMIT}`,
        [actor.employeeId, hr],
      );
      const totals = (
        await client.query<{ total: number; minutes: number }>(
          `SELECT count(*)::int AS total, coalesce(sum(e.minutes),0)::int AS minutes ${entryFrom} WHERE ${where}`,
          [actor.employeeId, hr],
        )
      ).rows[0]!;
      return timeReviewSchema.parse({
        items: rows.map((row) => this.entryFlags(actor, row)),
        total: totals.total,
        awaitingMinutes: totals.minutes,
        limit: LIMIT,
      });
    });
  }

  async approve(
    actor: Principal,
    id: string,
    input: z.infer<typeof timeEntryApproveSchema>,
    requestId: string,
  ) {
    return this.decide(
      actor,
      id,
      input.version,
      requestId,
      "approved",
      input.note ?? null,
    );
  }

  async reject(
    actor: Principal,
    id: string,
    input: z.infer<typeof timeEntryRejectSchema>,
    requestId: string,
  ) {
    return this.decide(
      actor,
      id,
      input.version,
      requestId,
      "rejected",
      input.note,
    );
  }

  private async decide(
    actor: Principal,
    id: string,
    version: number,
    requestId: string,
    status: "approved" | "rejected",
    note: string | null,
  ) {
    this.platform.require(actor, "project.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockEntry(client, id, version);
        await this.moveEntry(client, actor, id, row, requestId, status, note);
        return this.entry(client, actor, id);
      }),
    );
  }

  private async moveEntry(
    client: PoolClient,
    actor: Principal,
    id: string,
    row: Locked,
    requestId: string,
    status: "approved" | "rejected" | "withdrawn",
    note: string | null,
  ) {
    await client.query(
      "UPDATE time_entry SET status=$2, decision_note=$3, version=version+1 WHERE id=$1",
      [id, status, note],
    );
    await this.record(
      client,
      actor,
      requestId,
      `time.${status}`,
      `time:${id}`,
      id,
      row.version + 1,
      {
        employeeId: row.employeeId,
        projectId: row.projectId,
        minutes: row.minutes,
        from: row.status,
      },
      note ?? undefined,
    );
  }

  private async ownTime(
    client: PoolClient,
    actor: Principal,
    weekOf: string | null,
  ): Promise<MyTime> {
    const { rows } = await client.query<EntryRow>(
      `SELECT ${entryColumns} ${entryFrom} WHERE e.employee_id=$1
       ORDER BY e.work_date DESC, e.created_at DESC LIMIT ${LIMIT}`,
      [actor.employeeId],
    );
    const counts = { submitted: 0, approved: 0, rejected: 0, withdrawn: 0 };
    for (const row of (
      await client.query<{ status: keyof typeof counts; count: number }>(
        "SELECT status, count(*)::int AS count FROM time_entry WHERE employee_id=$1 GROUP BY status",
        [actor.employeeId],
      )
    ).rows)
      counts[row.status] = row.count;
    const range = (
      await client.query<{ start: string; end: string }>(
        `SELECT to_char(w,'YYYY-MM-DD') AS start, to_char(w+6,'YYYY-MM-DD') AS "end"
         FROM (SELECT date_trunc('week',coalesce($1::date,leave_entity_today()))::date AS w) x`,
        [weekOf],
      )
    ).rows[0]!;
    const week = await client.query<{
      projectId: string;
      projectCode: string;
      projectName: string | null;
      minutes: number;
    }>(
      `SELECT e.project_id AS "projectId", e.project_code AS "projectCode", max(p.name) AS "projectName",
         sum(e.minutes)::int AS minutes
       FROM time_entry e LEFT JOIN project p ON p.id=e.project_id
       WHERE e.employee_id=$1 AND e.status IN ('submitted','approved') AND e.work_date BETWEEN $2::date AND $3::date
       GROUP BY e.project_id, e.project_code ORDER BY e.project_code`,
      [actor.employeeId, range.start, range.end],
    );
    const projects = await client.query(
      `SELECT p.id, p.code, p.name FROM project p WHERE p.status='active'
         AND (p.owner_employee_id=$1 OR EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=p.id
           AND m.employee_id=$1 AND m.removed_at IS NULL))
       ORDER BY p.name LIMIT ${LIMIT}`,
      [actor.employeeId],
    );
    return myTimeSchema.parse({
      items: rows.map((row) => this.entryFlags(actor, row)),
      limit: LIMIT,
      week: {
        ...range,
        totalMinutes: week.rows.reduce((sum, row) => sum + row.minutes, 0),
        projects: week.rows,
      },
      counts,
      projects: projects.rows,
    });
  }

  private async memberList(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<ProjectMemberList> {
    const project = await this.project(client, actor, id);
    const { rows } = await client.query(
      `SELECT ${memberColumns} FROM project_member m WHERE m.project_id=$1
       ORDER BY (m.removed_at IS NULL) DESC, m.role DESC, m.employee_name LIMIT ${LIMIT}`,
      [id],
    );
    const counts = (
      await client.query<{ active: number; removed: number }>(
        `SELECT count(*) FILTER (WHERE removed_at IS NULL)::int AS active,
           count(*) FILTER (WHERE removed_at IS NOT NULL)::int AS removed
         FROM project_member WHERE project_id=$1`,
        [id],
      )
    ).rows[0]!;
    return projectMemberListSchema.parse({
      items: rows.map((row: { removedAt: string | null }) => ({
        ...row,
        canRemove: project.canManage && row.removedAt === null,
      })),
      counts,
      limit: LIMIT,
      canAdd: project.canManage,
    });
  }

  private projectFlags(actor: Principal, row: ProjectRow): Project {
    const { isMember, ...rest } = row;
    const closed = row.status === "completed" || row.status === "cancelled";
    return projectSchema.parse({
      ...rest,
      canManage: !closed && this.manages(actor, row.ownerEmployeeId),
      canLogTime:
        row.status === "active" &&
        Boolean(scopeFor(actor, "project.self")) &&
        (isMember || row.ownerEmployeeId === actor.employeeId),
      canReopen: closed && scopeFor(actor, "project.manage") === "entity",
    });
  }

  private taskFlags(
    actor: Principal,
    project: Project,
    row: TaskRow,
  ): ProjectTask {
    const closed =
      project.status === "completed" || project.status === "cancelled";
    return projectTaskSchema.parse({
      ...row,
      canEdit: project.canManage,
      canChangeStatus:
        project.canManage ||
        (!closed &&
          row.assigneeEmployeeId === actor.employeeId &&
          Boolean(scopeFor(actor, "project.self"))),
    });
  }

  private entryFlags(actor: Principal, row: EntryRow): TimeEntry {
    const { ownerId, ...rest } = row;
    const own = row.employeeId === actor.employeeId;
    const scope = scopeFor(actor, "project.manage");
    return timeEntrySchema.parse({
      ...rest,
      canWithdraw:
        row.status === "submitted" &&
        own &&
        Boolean(scopeFor(actor, "project.self")),
      canDecide:
        row.status === "submitted" &&
        !own &&
        (scope === "entity" ||
          (scope === "team" && ownerId === actor.employeeId)),
    });
  }

  private async project(client: PoolClient, actor: Principal, id: string) {
    const found = await client.query<ProjectRow>(
      `SELECT ${projectColumns} FROM project p WHERE p.id=$2`,
      [actor.employeeId, id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This project is unavailable.");
    return this.projectFlags(actor, found.rows[0]);
  }

  private async task(
    client: PoolClient,
    actor: Principal,
    project: Project,
    id: string,
  ) {
    const found = await client.query<TaskRow>(
      `SELECT ${taskColumns} FROM project_task t WHERE t.id=$1`,
      [id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This task is unavailable.");
    return this.taskFlags(actor, project, found.rows[0]);
  }

  private async entry(client: PoolClient, actor: Principal, id: string) {
    const found = await client.query<EntryRow>(
      `SELECT ${entryColumns} ${entryFrom} WHERE e.id=$1`,
      [id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This time entry is unavailable.");
    return this.entryFlags(actor, found.rows[0]);
  }

  private async projectLock(client: PoolClient, id: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('project:'||$1::text,0))",
      [id],
    );
  }

  // Lock order everywhere: the project's advisory lock, then the row.
  private async lockProject(client: PoolClient, id: string, version: number) {
    await this.projectLock(client, id);
    const found = await client.query<Locked>(
      "SELECT status, version FROM project WHERE id=$1 FOR UPDATE",
      [id],
    );
    return this.fresh(found.rows[0], version, "project");
  }

  private async lockTask(
    client: PoolClient,
    projectId: string,
    id: string,
    version: number,
  ) {
    await this.projectLock(client, projectId);
    const found = await client.query<Locked>(
      "SELECT status, version FROM project_task WHERE id=$1 AND project_id=$2 FOR UPDATE",
      [id, projectId],
    );
    return this.fresh(found.rows[0], version, "task");
  }

  private async lockEntry(client: PoolClient, id: string, version: number) {
    // The project's advisory lock first (same as an ownership transfer), then the row.
    const project = await client.query<{ projectId: string }>(
      `SELECT project_id AS "projectId" FROM time_entry WHERE id=$1`,
      [id],
    );
    if (project.rows[0])
      await this.projectLock(client, project.rows[0].projectId);
    const found = await client.query<Locked>(
      `SELECT employee_id AS "employeeId", project_id AS "projectId", minutes, status, version
       FROM time_entry WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return this.fresh(found.rows[0], version, "time entry");
  }

  private fresh(row: Locked | undefined, version: number, what: string) {
    if (!row) throw new NotFoundException(`This ${what} is unavailable.`);
    if (row.version !== version)
      throw new ConflictException(
        `This ${what} changed. Reload it before trying again.`,
      );
    return row;
  }

  // Audit and outbox in the same transaction as the change.
  private async record(
    client: PoolClient,
    actor: Principal,
    requestId: string,
    action: string,
    target: string,
    aggregateId: string,
    version: number,
    details: Record<string, unknown>,
    reason?: string,
  ) {
    await audit(client, actor, action, target, requestId, { reason, details });
    await client.query(
      `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        `${action}.v1`,
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
        const code = error.code;
        if (typeof code === "string" && conflictCodes.has(code))
          throw new ConflictException(retry);
        if (code === "23503")
          throw new BadRequestException(
            "A referenced person, project or task is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "23505") {
          const constraint =
            "constraint" in error ? String(error.constraint) : "";
          const message = uniqueMessages[constraint];
          if (message) throw new ConflictException(message);
          throw error;
        }
        if (
          typeof code === "string" &&
          code in ruleErrors &&
          "message" in error &&
          typeof error.message === "string"
        )
          throw ruleErrors[code]!(`${error.message}.`);
      }
      throw error;
    }
  }
}
