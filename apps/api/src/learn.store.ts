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
  LRN_RENEWAL_WINDOW_DAYS,
  lrnAssignResultSchema,
  lrnAssignmentDetailSchema,
  lrnAssignmentListSchema,
  lrnComplianceSchema,
  lrnCourseListSchema,
  lrnCourseSchema,
  lrnCourseStatusSchema,
  type LrnAssignResult,
  type LrnAssignment,
  type LrnAssignmentDetail,
  type LrnAssignmentList,
  type LrnCompliance,
  type LrnCourse,
  type LrnCourseList,
  type lrnAssignSchema,
  type lrnAssignmentQuerySchema,
  type lrnCompleteSchema,
  type lrnComplianceQuerySchema,
  type lrnCourseCreateSchema,
  type lrnCourseQuerySchema,
  type lrnCourseUpdateSchema,
  type lrnReasonSchema,
  type lrnVersionSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const day = (column: string) => `to_char(${column},'YYYY-MM-DD')`;

const ruleErrors: Record<string, (message: string) => Error> = {
  LN003: (m) => new BadRequestException(m),
  LN004: (m) => new ConflictException(m),
  LN005: (m) => new ForbiddenException(m),
};
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  lrn_assignment_open_key:
    "This person already has an open assignment for this course.",
  lrn_completion_once_key: "This assignment already has a completion record.",
  lrn_course_code_key: retry,
};
const LRN_MAX_AUDIENCE = 1000;
const COURSE_STATUSES = lrnCourseStatusSchema.options;
const courseUnavailable = "This course is unavailable.";
const assignmentUnavailable = "This assignment is unavailable.";
const OPEN = "a.status IN ('assigned','in_progress')";
const OVERDUE = `(${OPEN} AND a.due_on IS NOT NULL AND a.due_on<CURRENT_DATE)`;
const RENEWAL = `CASE WHEN a.status='completed' AND a.expires_on IS NOT NULL THEN
  CASE WHEN a.expires_on<CURRENT_DATE THEN 'expired'
   WHEN a.expires_on<=CURRENT_DATE+${LRN_RENEWAL_WINDOW_DAYS} THEN 'due' ELSE 'current' END END`;

// $1 is always the caller's employee id.
const courseColumns = `c.id, c.code, c.title, c.description, c.category, c.delivery_mode AS "deliveryMode",
  c.duration_minutes AS "durationMinutes", c.external_url AS "externalUrl", c.status, c.mandatory,
  c.validity_months AS "validityMonths", ${stamp("c.published_at")} AS "publishedAt",
  ${stamp("c.archived_at")} AS "archivedAt",
  (SELECT a.id FROM lrn_assignment a WHERE a.course_id=c.id AND a.employee_id=$1 AND ${OPEN}) AS "myOpenAssignmentId",
  c.version, c.updated_by_label AS "updatedBy", ${stamp("c.updated_at")} AS "updatedAt"`;
const assignmentColumns = `a.id, a.course_id AS "courseId", c.code AS "courseCode", c.title AS "courseTitle",
  c.status AS "courseStatus", a.employee_id AS "employeeId", a.employee_name AS "employeeName", a.source,
  a.audience, a.batch_id AS "batchId", ${day("a.due_on")} AS "dueOn", a.mandatory, a.status,
  ${stamp("a.started_at")} AS "startedAt", ${stamp("a.completed_at")} AS "completedAt",
  ${stamp("a.waived_at")} AS "waivedAt", ${day("a.expires_on")} AS "expiresOn", ${OVERDUE} AS overdue,
  ${RENEWAL} AS renewal, (a.employee_id=$1) AS mine, a.assigned_by_label AS "assignedBy",
  ${stamp("a.created_at")} AS "createdAt", a.version`;
const assignmentFrom = "lrn_assignment a JOIN lrn_course c ON c.id=a.course_id";

type Scope = "manage" | "team" | "self";
type CourseRow = Omit<
  LrnCourse,
  "canEnrol" | "canEdit" | "canPublish" | "canArchive" | "canAssign"
>;
type AssignmentRow = Omit<
  LrnAssignment,
  "canStart" | "canComplete" | "canRecord" | "canWaive"
>;
type Locked = { version: number; [key: string]: unknown };
const courseSteps = {
  publish: { to: "published", event: "learn.course_published" },
  archive: { to: "archived", event: "learn.course_archived" },
} as const;
export type CourseStep = keyof typeof courseSteps;
export type RecordKind = "complete" | "waive";

// Who may do what, the state machine, four-eyes, the one-open-assignment rule, audience snapshots,
// course status rules and visibility all live in the database guards and policies (065). The store
// shapes replies, takes the same advisory locks first, and writes audit and outbox rows with ids,
// statuses and counts only: never titles, descriptions, notes or reasons.
export class LearnStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal): Scope | undefined {
    if (scopeFor(actor, "learn.manage")) return "manage";
    if (scopeFor(actor, "learn.team")) return "team";
    if (scopeFor(actor, "learn.self")) return "self";
    return undefined;
  }
  private see(actor: Principal) {
    const scope = this.scope(actor);
    if (!scope)
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
    return scope;
  }
  private manage(actor: Principal) {
    if (this.see(actor) !== "manage")
      throw new ForbiddenException(
        "Only HR manages courses, assignments and records.",
      );
  }

  // ---- Courses ----
  async listCourses(
    actor: Principal,
    query: z.infer<typeof lrnCourseQuerySchema>,
  ): Promise<LrnCourseList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const manage = scope === "manage";
      const like = query.q
        ? `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
        : null;
      const where = `($2::text IS NULL OR c.status=$2) AND ($3::text IS NULL OR lower(c.category)=lower($3))
        AND ($4::text IS NULL OR c.title ILIKE $4 OR c.code ILIKE $4 OR c.category ILIKE $4)`;
      const filters = [query.status ?? null, query.category ?? null, like];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM lrn_course c WHERE $1::uuid IS NOT NULL AND ${where}`,
          [actor.employeeId, ...filters],
        )
      ).rows[0]!.n;
      const { rows } = await client.query<CourseRow>(
        `SELECT ${courseColumns} FROM lrn_course c WHERE ${where}
         ORDER BY lower(c.title), c.id LIMIT $5 OFFSET $6`,
        [
          actor.employeeId,
          ...filters,
          query.limit,
          (query.page - 1) * query.limit,
        ],
      );
      const counts: Record<string, number> = Object.fromEntries(
        COURSE_STATUSES.map((k) => [k, 0]),
      );
      for (const r of (
        await client.query<{ key: string; n: number }>(
          "SELECT c.status AS key, count(*)::int AS n FROM lrn_course c GROUP BY c.status",
        )
      ).rows)
        counts[r.key] = r.n;
      return lrnCourseListSchema.parse({
        items: rows.map((r) => this.courseShape(r, manage)),
        total,
        page: query.page,
        limit: query.limit,
        counts,
        canManage: manage,
      });
    });
  }
  async courseDetail(actor: Principal, id: string): Promise<LrnCourse> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.course(client, actor, id, scope === "manage"),
    );
  }
  async createCourse(
    actor: Principal,
    input: z.infer<typeof lrnCourseCreateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO lrn_course(id,tenant_id,entity_id,title,description,category,delivery_mode,
            duration_minutes,external_url,mandatory,validity_months) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, actor.tenantId, actor.entityId, ...this.courseValues(input)],
        );
        await this.record(
          client,
          actor,
          requestId,
          "learn.course_created",
          `lrn-course:${id}`,
          id,
          1,
          { mandatory: input.mandatory },
        );
        return this.course(client, actor, id, true);
      }),
    );
  }
  async updateCourse(
    actor: Principal,
    id: string,
    input: z.infer<typeof lrnCourseUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCourse(client, id, input.version);
        if (row.status === "archived")
          throw new ConflictException("An archived course cannot be changed.");
        await client.query(
          `UPDATE lrn_course SET title=$2, description=$3, category=$4, delivery_mode=$5, duration_minutes=$6,
            external_url=$7, mandatory=$8, validity_months=$9, version=version+1 WHERE id=$1`,
          [id, ...this.courseValues(input)],
        );
        await this.record(
          client,
          actor,
          requestId,
          "learn.course_updated",
          `lrn-course:${id}`,
          id,
          row.version + 1,
          { mandatory: input.mandatory },
        );
        return this.course(client, actor, id, true);
      }),
    );
  }
  async courseStep(
    actor: Principal,
    id: string,
    step: CourseStep,
    input: z.infer<typeof lrnVersionSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    const { to, event } = courseSteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCourse(client, id, input.version);
        await client.query(
          "UPDATE lrn_course SET status=$2, version=version+1 WHERE id=$1",
          [id, to],
        );
        await this.record(
          client,
          actor,
          requestId,
          event,
          `lrn-course:${id}`,
          id,
          row.version + 1,
          { from: row.status, to },
        );
        return this.course(client, actor, id, true);
      }),
    );
  }
  private courseValues(input: z.infer<typeof lrnCourseCreateSchema>) {
    return [
      input.title,
      input.description,
      input.category,
      input.deliveryMode,
      input.durationMinutes,
      input.externalUrl,
      input.mandatory,
      input.validityMonths,
    ];
  }
  private async lockCourse(client: PoolClient, id: string, version: number) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('lrn-course:'||$1::text,0))",
      [id],
    );
    const found = await client.query<Locked>(
      "SELECT version, status FROM lrn_course WHERE id=$1 FOR UPDATE",
      [id],
    );
    return this.fresh(found.rows[0], version, "course");
  }
  private async course(
    client: PoolClient,
    actor: Principal,
    id: string,
    manage: boolean,
  ): Promise<LrnCourse> {
    const { rows } = await client.query<CourseRow>(
      `SELECT ${courseColumns} FROM lrn_course c WHERE c.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw new NotFoundException(courseUnavailable);
    return lrnCourseSchema.parse(this.courseShape(rows[0], manage));
  }
  private courseShape(row: CourseRow, manage: boolean): LrnCourse {
    return {
      ...row,
      canEnrol:
        row.status === "published" && !row.mandatory && !row.myOpenAssignmentId,
      canEdit: manage && row.status !== "archived",
      canPublish: manage && row.status === "draft",
      canArchive: manage && row.status !== "archived",
      canAssign: manage && row.status === "published",
    };
  }

  // ---- Assigning and enrolling ----
  async assign(
    actor: Principal,
    courseId: string,
    input: z.infer<typeof lrnAssignSchema>,
    requestId: string,
  ): Promise<LrnAssignResult> {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const course = await client.query<{ status: string }>(
          "SELECT status FROM lrn_course WHERE id=$1",
          [courseId],
        );
        if (!course.rows[0]) throw new NotFoundException(courseUnavailable);
        if (course.rows[0].status !== "published")
          throw new ConflictException(
            "Only published courses can be assigned or enrolled in.",
          );
        const mandatory = input.mandatory ?? null;
        const { target } = input;
        if (target.kind === "employee") {
          const id = randomUUID();
          await client.query(
            `INSERT INTO lrn_assignment(id,tenant_id,entity_id,course_id,employee_id,source,audience,due_on,mandatory)
             VALUES ($1,$2,$3,$4,$5,'assigned','employee',$6,$7)`,
            [
              id,
              actor.tenantId,
              actor.entityId,
              courseId,
              target.employeeId,
              input.dueOn,
              mandatory,
            ],
          );
          await this.record(
            client,
            actor,
            requestId,
            "learn.assigned",
            `lrn-assignment:${id}`,
            id,
            1,
            { courseId, audience: "employee" },
          );
          return lrnAssignResultSchema.parse({
            batchId: null,
            assigned: 1,
            skipped: 0,
            assignmentIds: [id],
          });
        }
        // Snapshot: the unit's current employees now; later joiners are not added.
        const audience = (
          await client.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM lrn_audience($1,$2)",
            [target.kind, target.unitId],
          )
        ).rows[0]!.n;
        if (audience === 0)
          throw new BadRequestException(
            `There are no current employees in that ${target.kind}.`,
          );
        // lrn_audience (067) also refuses more than this.
        if (audience > LRN_MAX_AUDIENCE)
          throw new BadRequestException(
            `Assign to at most ${LRN_MAX_AUDIENCE} people at a time.`,
          );
        const batchId = randomUUID();
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO lrn_assignment(id,tenant_id,entity_id,course_id,employee_id,source,audience,batch_id,due_on,
            mandatory,audience_unit_id)
           SELECT gen_random_uuid(),$1,$2,$3,x.employee_id,'assigned',$4,$5,$6,$7,$8 FROM lrn_audience($4,$8) x
           WHERE NOT EXISTS(SELECT 1 FROM lrn_assignment a WHERE a.course_id=$3 AND a.employee_id=x.employee_id
             AND ${OPEN})
           ORDER BY x.employee_id RETURNING id`,
          [
            actor.tenantId,
            actor.entityId,
            courseId,
            target.kind,
            batchId,
            input.dueOn,
            mandatory,
            target.unitId,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "learn.audience_assigned",
          `lrn-course:${courseId}`,
          batchId,
          1,
          {
            courseId,
            audience: target.kind,
            assigned: rows.length,
            skipped: audience - rows.length,
          },
        );
        return lrnAssignResultSchema.parse({
          batchId,
          assigned: rows.length,
          skipped: audience - rows.length,
          assignmentIds: rows.map((r) => r.id),
        });
      }),
    );
  }
  async enrol(
    actor: Principal,
    courseId: string,
    requestId: string,
  ): Promise<LrnAssignmentDetail> {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const course = await client.query(
          "SELECT 1 FROM lrn_course WHERE id=$1",
          [courseId],
        );
        if (!course.rows[0]) throw new NotFoundException(courseUnavailable);
        const id = randomUUID();
        await client.query(
          `INSERT INTO lrn_assignment(id,tenant_id,entity_id,course_id,employee_id,source,audience)
           VALUES ($1,$2,$3,$4,$5,'self_enrolled','self')`,
          [id, actor.tenantId, actor.entityId, courseId, actor.employeeId],
        );
        await this.record(
          client,
          actor,
          requestId,
          "learn.enrolled",
          `lrn-assignment:${id}`,
          id,
          1,
          { courseId },
        );
        return this.assignment(client, actor, id, scope);
      }),
    );
  }

  // ---- Assignments ----
  async listAssignments(
    actor: Principal,
    query: z.infer<typeof lrnAssignmentQuerySchema>,
  ): Promise<LrnAssignmentList> {
    const scope = this.see(actor);
    if (query.view === "team" && scope !== "team")
      throw new ForbiddenException(
        scope === "manage"
          ? "HR sees everyone in the all view."
          : "Only managers see their team's assignments.",
      );
    if (query.view === "all" && scope !== "manage")
      throw new ForbiddenException("Only HR sees every assignment.");
    return scoped(this.platform.pool, actor, async (client) => {
      const view = {
        mine: "a.employee_id=$1",
        team: "a.employee_id<>$1",
        all: "true",
      }[query.view];
      const where = `$1::uuid IS NOT NULL AND ${view} AND ($2::text IS NULL OR a.status=$2)
        AND ($3::uuid IS NULL OR a.course_id=$3) AND ($4::uuid IS NULL OR a.employee_id=$4)
        AND ($5::boolean IS NULL OR ${OVERDUE}=$5) AND ($6::text IS NULL OR ${RENEWAL}=$6)`;
      const base = [
        actor.employeeId,
        query.status ?? null,
        query.courseId ?? null,
        query.employeeId ?? null,
        query.overdue ?? null,
        query.renewal ?? null,
      ];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${assignmentFrom} WHERE ${where}`,
          base,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<AssignmentRow>(
        `SELECT ${assignmentColumns} FROM ${assignmentFrom} WHERE ${where}
         ORDER BY ${OVERDUE} DESC, a.due_on NULLS LAST, a.created_at DESC, a.id LIMIT $7 OFFSET $8`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return lrnAssignmentListSchema.parse({
        items: rows.map((r) => this.assignmentShape(r, scope)),
        total,
        page: query.page,
        limit: query.limit,
        view: query.view,
        canManage: scope === "manage",
        canSeeTeam: scope === "team",
      });
    });
  }
  async assignmentDetail(
    actor: Principal,
    id: string,
  ): Promise<LrnAssignmentDetail> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.assignment(client, actor, id, scope),
    );
  }
  async start(
    actor: Principal,
    id: string,
    input: z.infer<typeof lrnVersionSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockAssignment(client, id, input.version);
        if (row.employee_id !== actor.employeeId)
          throw new ForbiddenException(
            "Only the learner starts their own assignment.",
          );
        await client.query(
          "UPDATE lrn_assignment SET status='in_progress', version=version+1 WHERE id=$1",
          [id],
        );
        await this.record(
          client,
          actor,
          requestId,
          "learn.started",
          `lrn-assignment:${id}`,
          id,
          row.version + 1,
          { from: row.status, to: "in_progress" },
        );
        return this.assignment(client, actor, id, scope);
      }),
    );
  }
  async complete(
    actor: Principal,
    id: string,
    input: z.infer<typeof lrnCompleteSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockAssignment(client, id, input.version);
        if (row.employee_id !== actor.employeeId)
          throw new ForbiddenException(
            "Learners complete only their own assignments; HR records on their behalf.",
          );
        await this.insertCompletion(
          client,
          actor,
          id,
          "completed",
          "self",
          input.note?.trim() ? input.note.trim() : null,
        );
        await this.record(
          client,
          actor,
          requestId,
          "learn.completed",
          `lrn-assignment:${id}`,
          id,
          row.version + 1,
          { from: row.status, to: "completed" },
        );
        return this.assignment(client, actor, id, scope);
      }),
    );
  }
  // HR on someone else's behalf: record a completion or waive, with a reason. Never their own.
  async recordOnBehalf(
    actor: Principal,
    id: string,
    kind: RecordKind,
    input: z.infer<typeof lrnReasonSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    const outcome = kind === "complete" ? "completed" : "waived";
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockAssignment(client, id, input.version);
        if (row.employee_id === actor.employeeId)
          throw new ForbiddenException(
            "Someone else in HR must record or waive your own assignment.",
          );
        await this.insertCompletion(
          client,
          actor,
          id,
          outcome,
          "hr",
          input.reason,
        );
        await this.record(
          client,
          actor,
          requestId,
          kind === "complete" ? "learn.completion_recorded" : "learn.waived",
          `lrn-assignment:${id}`,
          id,
          row.version + 1,
          { from: row.status, to: outcome },
        );
        return this.assignment(client, actor, id, "manage");
      }),
    );
  }
  private async insertCompletion(
    client: PoolClient,
    actor: Principal,
    assignmentId: string,
    outcome: "completed" | "waived",
    recordedBy: "self" | "hr",
    note: string | null,
  ) {
    await client.query(
      `INSERT INTO lrn_completion(id,tenant_id,entity_id,assignment_id,outcome,recorded_by,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        assignmentId,
        outcome,
        recordedBy,
        note,
      ],
    );
  }
  private async lockAssignment(
    client: PoolClient,
    id: string,
    version: number,
  ) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('lrn-assignment:'||$1::text,0))",
      [id],
    );
    // No FOR UPDATE: it would apply the update policy (own rows only) and hide rows HR and
    // managers may read. The advisory lock is shared with the completion guard.
    const found = await client.query<Locked>(
      "SELECT version, status, employee_id FROM lrn_assignment WHERE id=$1",
      [id],
    );
    const row = this.fresh(found.rows[0], version, "assignment");
    if (row.status !== "assigned" && row.status !== "in_progress")
      throw new ConflictException(
        `This assignment is already ${String(row.status).replace("_", " ")}.`,
      );
    return row;
  }
  private async assignment(
    client: PoolClient,
    actor: Principal,
    id: string,
    scope: Scope,
  ): Promise<LrnAssignmentDetail> {
    const { rows } = await client.query<AssignmentRow>(
      `SELECT ${assignmentColumns} FROM ${assignmentFrom} WHERE a.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw new NotFoundException(assignmentUnavailable);
    const history = await client.query(
      `SELECT h.id, h.outcome, h.recorded_by AS "recordedBy", h.note, h.by_label AS "byLabel",
        ${stamp("h.at")} AS at, ${day("h.expires_on")} AS "expiresOn"
       FROM lrn_completion h WHERE h.assignment_id=$1 ORDER BY h.at, h.id`,
      [id],
    );
    return lrnAssignmentDetailSchema.parse({
      assignment: this.assignmentShape(rows[0], scope),
      history: history.rows,
    });
  }
  private assignmentShape(row: AssignmentRow, scope: Scope): LrnAssignment {
    const open = row.status === "assigned" || row.status === "in_progress";
    const onBehalf = scope === "manage" && !row.mine && open;
    return {
      ...row,
      canStart: row.mine && row.status === "assigned",
      canComplete: row.mine && open,
      canRecord: onBehalf,
      canWaive: onBehalf,
    };
  }

  // ---- Compliance report (HR; counts only) ----
  async compliance(
    actor: Principal,
    query: z.infer<typeof lrnComplianceQuerySchema>,
  ): Promise<LrnCompliance> {
    this.manage(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const status = query.status ?? null;
      const total = (
        await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM lrn_course c WHERE ($1::text IS NULL OR c.status=$1)",
          [status],
        )
      ).rows[0]!.n;
      const { rows } = await client.query(
        `SELECT c.id AS "courseId", c.code AS "courseCode", c.title AS "courseTitle", c.status AS "courseStatus",
          c.mandatory,
          count(a.id) FILTER (WHERE a.status='assigned' AND NOT ${OVERDUE})::int AS "notStarted",
          count(a.id) FILTER (WHERE a.status='in_progress' AND NOT ${OVERDUE})::int AS "inProgress",
          count(a.id) FILTER (WHERE ${OVERDUE})::int AS overdue,
          count(a.id) FILTER (WHERE a.status='completed')::int AS completed,
          count(a.id) FILTER (WHERE a.status='waived')::int AS waived,
          count(a.id) FILTER (WHERE ${RENEWAL}='due')::int AS "dueForRenewal",
          count(a.id) FILTER (WHERE ${RENEWAL}='expired')::int AS expired
         FROM lrn_course c LEFT JOIN lrn_assignment a ON a.course_id=c.id
         WHERE ($1::text IS NULL OR c.status=$1)
         GROUP BY c.id ORDER BY lower(c.title), c.id LIMIT $2 OFFSET $3`,
        [status, query.limit, (query.page - 1) * query.limit],
      );
      const asOf = (
        await client.query<{ d: string }>(
          "SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS d",
        )
      ).rows[0]!.d;
      return lrnComplianceSchema.parse({
        items: rows,
        total,
        page: query.page,
        limit: query.limit,
        asOf,
      });
    });
  }

  private fresh(row: Locked | undefined, version: number, what: string) {
    if (!row) throw new NotFoundException(`This ${what} is unavailable.`);
    if (row.version !== version)
      throw new ConflictException(
        `This ${what} changed. Reload it before trying again.`,
      );
    return row;
  }
  private async record(
    client: PoolClient,
    actor: Principal,
    requestId: string,
    action: string,
    target: string,
    aggregateId: string,
    version: number,
    details: Record<string, unknown>,
  ) {
    await audit(client, actor, action, target, requestId, { details });
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
            "A referenced course or person is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "23505") {
          const constraint =
            "constraint" in error ? String(error.constraint) : "";
          throw new ConflictException(
            uniqueMessages[constraint] ?? "This already exists.",
          );
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
