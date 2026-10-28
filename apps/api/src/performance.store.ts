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
  perfAlignableSchema,
  perfCycleListSchema,
  perfCycleOpenedSchema,
  perfCycleSchema,
  perfCycleStatusSchema,
  perfObjectiveDetailSchema,
  perfObjectiveListSchema,
  perfObjectiveSchema,
  perfObjectiveStatusSchema,
  perfProgressListSchema,
  perfReviewDetailSchema,
  perfReviewListSchema,
  perfReviewSchema,
  perfReviewStatusSchema,
  type PerfAlignable,
  type PerfCycle,
  type PerfCycleList,
  type PerfCycleOpened,
  type PerfKeyResult,
  type PerfObjective,
  type PerfObjectiveDetail,
  type PerfObjectiveList,
  type PerfProgressList,
  type PerfReview,
  type PerfReviewDetail,
  type PerfReviewList,
  type perfAlignableQuerySchema,
  type perfCycleActionSchema,
  type perfCycleCreateSchema,
  type perfCycleQuerySchema,
  type perfCycleUpdateSchema,
  type perfKeyResultCreateSchema,
  type perfKeyResultUpdateSchema,
  type perfObjectiveActionSchema,
  type perfObjectiveCreateSchema,
  type perfObjectiveQuerySchema,
  type perfObjectiveUpdateSchema,
  type perfProgressCreateSchema,
  type perfProgressQuerySchema,
  type perfReviewFinaliseSchema,
  type perfReviewQuerySchema,
  type perfReviewSubmitSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const day = (column: string) => `to_char(${column},'YYYY-MM-DD')`;
const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// $1 is always the caller's employee id.
const objectiveColumns = `o.id, o.owner_employee_id AS "ownerEmployeeId", o.owner_name AS "ownerName", o.title,
  o.description, ${day("o.period_start")} AS "periodStart", ${day("o.period_end")} AS "periodEnd",
  o.parent_objective_id AS "parentObjectiveId",
  (SELECT p.title FROM perf_objective p WHERE p.id=o.parent_objective_id) AS "parentTitle",
  o.status, o.status_note AS "statusNote", o.progress::float8 AS progress,
  (SELECT count(*)::int FROM perf_key_result k WHERE k.objective_id=o.id) AS "keyResultCount",
  (o.owner_employee_id=$1) AS mine, o.version, o.created_by_label AS "createdBy", ${stamp("o.created_at")} AS "createdAt",
  o.updated_by_label AS "updatedBy", ${stamp("o.updated_at")} AS "updatedAt"`;
const keyResultColumns = `k.id, k.objective_id AS "objectiveId", k.title, k.unit, k.start_value::float8 AS "startValue",
  k.target_value::float8 AS "targetValue", k.current_value::float8 AS "currentValue", k.progress::float8 AS progress,
  (SELECT count(*)::int FROM perf_kr_update u WHERE u.key_result_id=k.id) AS "updateCount", k.version,
  k.updated_by_label AS "updatedBy", ${stamp("k.updated_at")} AS "updatedAt"`;
const cycleColumns = `c.id, c.name, ${day("c.period_start")} AS "periodStart", ${day("c.period_end")} AS "periodEnd",
  ${day("c.self_due")} AS "selfDue", ${day("c.manager_due")} AS "managerDue", c.department_id AS "departmentId",
  (SELECT d.name FROM org_unit d WHERE d.id=c.department_id) AS "departmentName", c.status, c.status_note AS "statusNote",
  ${stamp("c.opened_at")} AS "openedAt", ${stamp("c.closed_at")} AS "closedAt",
  coalesce((SELECT json_object_agg(x.status,x.n) FROM (SELECT r.status, count(*)::int AS n FROM perf_review r
    WHERE r.cycle_id=c.id GROUP BY r.status) x),'{}'::json) AS "reviewCounts",
  c.version, c.created_by_label AS "createdBy", ${stamp("c.created_at")} AS "createdAt",
  c.updated_by_label AS "updatedBy", ${stamp("c.updated_at")} AS "updatedAt"`;
const reviewColumns = `r.id, r.cycle_id AS "cycleId", c.name AS "cycleName", c.status AS "cycleStatus",
  ${day("c.self_due")} AS "selfDue", ${day("c.manager_due")} AS "managerDue", r.employee_id AS "employeeId",
  r.employee_name AS "employeeName", r.manager_id AS "managerId", r.manager_name AS "managerName", r.status,
  ${stamp("r.self_submitted_at")} AS "selfSubmittedAt", ${stamp("r.manager_submitted_at")} AS "managerSubmittedAt",
  r.final_rating AS "finalRating", r.final_reason AS "finalReason", r.finalised_by_label AS "finalisedBy",
  ${stamp("r.finalised_at")} AS "finalisedAt", (r.employee_id=$1) AS mine, (r.manager_id=$1) AS "iAmManager",
  r.version, ${stamp("r.updated_at")} AS "updatedAt"`;
const reviewFrom = `FROM perf_review r JOIN perf_cycle c ON c.id=r.cycle_id`;

const ruleErrors: Record<string, (message: string) => Error> = {
  PF003: (m) => new BadRequestException(m),
  PF004: (m) => new ConflictException(m),
  PF005: (m) => new ForbiddenException(m),
};
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  perf_cycle_name_key: "A review cycle with this name already exists.",
  perf_review_once_key: "This person already has a review in this cycle.",
  perf_review_entry_once_key: "This review is already submitted.",
};
const OBJECTIVE_STATUSES = perfObjectiveStatusSchema.options;
const CYCLE_STATUSES = perfCycleStatusSchema.options;
const REVIEW_STATUSES = perfReviewStatusSchema.options;

type ObjectiveRow = Omit<
  PerfObjective,
  "canEdit" | "canActivate" | "canComplete" | "canCancel" | "canAddKeyResult"
>;
type KeyResultRow = Omit<PerfKeyResult, "canEdit" | "canRecordProgress">;
type CycleRow = Omit<
  PerfCycle,
  "canEdit" | "canOpen" | "canClose" | "canCancel" | "reviewCounts"
> & { reviewCounts: Record<string, number> };
type ReviewRow = Omit<
  PerfReview,
  "canSubmitSelf" | "canSubmitManager" | "canFinalise"
>;
type Locked = { version: number; [key: string]: unknown };

const objectiveSteps = {
  activate: "active",
  complete: "completed",
  cancel: "cancelled",
} as const;
export type ObjectiveStep = keyof typeof objectiveSteps;
const cycleSteps = { open: "active", close: "closed", cancel: "cancelled" };
export type CycleStep = keyof typeof cycleSteps;

// Who may do what, the status matrices, blind reviews, four-eyes finalisation and derived
// progress all live in the database guards (056); the store shapes replies, takes locks in
// one order (goal or cycle or review first, then the row) and writes audit and outbox rows that
// carry ids, statuses and counts but never titles, names, comments, reasons, ratings or values.
export class PerformanceStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal) {
    return (
      scopeFor(actor, "performance.manage") ??
      scopeFor(actor, "performance.review") ??
      scopeFor(actor, "performance.self")
    );
  }
  private hr(actor: Principal) {
    return scopeFor(actor, "performance.manage") === "entity";
  }
  private see(actor: Principal) {
    if (!this.scope(actor))
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
  }

  // ---- Goals ----
  async listObjectives(
    actor: Principal,
    query: z.infer<typeof perfObjectiveQuerySchema>,
  ): Promise<PerfObjectiveList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($2='%%' OR o.title ILIKE $2 OR o.owner_name ILIKE $2)
        AND ($3::text IS NULL OR o.status=$3) AND ($4::uuid IS NULL OR o.owner_employee_id=$4)
        AND ($5='all' OR ($5='mine' AND o.owner_employee_id=$1)
          OR ($5='team' AND EXISTS(SELECT 1 FROM employee e WHERE e.id=o.owner_employee_id AND e.manager_id=$1)))`;
      const base = [
        actor.employeeId,
        escapeLike(query.q),
        query.status ?? null,
        query.ownerId ?? null,
        query.view,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM perf_objective o WHERE ${where}`,
        base,
      );
      const { rows } = await client.query<ObjectiveRow>(
        `SELECT ${objectiveColumns} FROM perf_objective o WHERE ${where}
         ORDER BY (o.status IN ('draft','active')) DESC, o.period_end DESC, o.created_at DESC, o.id
         LIMIT $6 OFFSET $7`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return perfObjectiveListSchema.parse({
        items: rows.map((row) => this.objectiveFlags(row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT o.status AS key, count(*)::int AS count FROM perf_objective o WHERE ${where} GROUP BY o.status`,
          OBJECTIVE_STATUSES,
          [base[0], base[1], null, base[3], base[4]],
        ),
      });
    });
  }

  async objectiveDetail(actor: Principal, id: string) {
    this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.objective(client, actor, id),
    );
  }

  // Goals someone may align to: their own and their manager's draft or active goals.
  async alignable(
    actor: Principal,
    query: z.infer<typeof perfAlignableQuerySchema>,
  ): Promise<PerfAlignable> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT id, title, owner_employee_id AS "ownerEmployeeId", owner_name AS "ownerName", status
         FROM perf_alignable($1)`,
        [query.ownerId ?? actor.employeeId],
      );
      return perfAlignableSchema.parse({ items: rows });
    });
  }

  async createObjective(
    actor: Principal,
    input: z.infer<typeof perfObjectiveCreateSchema>,
    requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        const owner = input.ownerEmployeeId ?? actor.employeeId;
        await client.query(
          `INSERT INTO perf_objective(id,tenant_id,entity_id,owner_employee_id,title,description,period_start,period_end,
             parent_objective_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            owner,
            input.title,
            input.description ?? null,
            input.periodStart,
            input.periodEnd,
            input.parentObjectiveId ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.objective_created",
          `perf-objective:${id}`,
          id,
          1,
          {
            ownerEmployeeId: owner,
            aligned: Boolean(input.parentObjectiveId),
          },
        );
        return this.objective(client, actor, id);
      }),
    );
  }

  async updateObjective(
    actor: Principal,
    id: string,
    input: z.infer<typeof perfObjectiveUpdateSchema>,
    requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockObjective(client, id, input.version);
        await client.query(
          `UPDATE perf_objective SET title=$2, description=$3, period_start=$4, period_end=$5, parent_objective_id=$6,
             version=version+1 WHERE id=$1`,
          [
            id,
            input.title,
            input.description ?? null,
            input.periodStart,
            input.periodEnd,
            input.parentObjectiveId ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.objective_updated",
          `perf-objective:${id}`,
          id,
          row.version + 1,
          {
            fields: Object.keys(input).filter((k) => k !== "version"),
            aligned: Boolean(input.parentObjectiveId),
          },
        );
        return this.objective(client, actor, id);
      }),
    );
  }

  async objectiveStep(
    actor: Principal,
    id: string,
    step: ObjectiveStep,
    input: z.infer<typeof perfObjectiveActionSchema>,
    requestId: string,
  ) {
    this.see(actor);
    const to = objectiveSteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockObjective(client, id, input.version);
        await client.query(
          "UPDATE perf_objective SET status=$2, status_note=$3, version=version+1 WHERE id=$1",
          [id, to, input.note ?? row.statusNote ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.objective_status_changed",
          `perf-objective:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, noteGiven: Boolean(input.note) },
        );
        return this.objective(client, actor, id);
      }),
    );
  }

  async addKeyResult(
    actor: Principal,
    objectiveId: string,
    input: z.infer<typeof perfKeyResultCreateSchema>,
    requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.objectiveLock(client, objectiveId);
        // Same 404 as reading the goal, so the guard's messages never reveal a hidden goal.
        const visible = await client.query(
          "SELECT 1 FROM perf_objective WHERE id=$1",
          [objectiveId],
        );
        if (!visible.rowCount)
          throw new NotFoundException("This goal is unavailable.");
        const id = randomUUID();
        await client.query(
          `INSERT INTO perf_key_result(id,tenant_id,entity_id,objective_id,title,unit,start_value,target_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            objectiveId,
            input.title,
            input.unit,
            input.startValue,
            input.targetValue,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.key_result_added",
          `perf-key-result:${id}`,
          id,
          1,
          { objectiveId, unit: input.unit },
        );
        return this.objective(client, actor, objectiveId);
      }),
    );
  }

  async updateKeyResult(
    actor: Principal,
    id: string,
    input: z.infer<typeof perfKeyResultUpdateSchema>,
    requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockKeyResult(client, id, input.version);
        await client.query(
          `UPDATE perf_key_result SET title=$2, unit=$3, start_value=$4, target_value=$5, version=version+1 WHERE id=$1`,
          [id, input.title, input.unit, input.startValue, input.targetValue],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.key_result_updated",
          `perf-key-result:${id}`,
          id,
          row.version + 1,
          {
            objectiveId: row.objectiveId,
            fields: Object.keys(input).filter((k) => k !== "version"),
          },
        );
        return this.objective(client, actor, row.objectiveId as string);
      }),
    );
  }

  // Append-only: the key result's current value becomes the recorded value.
  async recordProgress(
    actor: Principal,
    id: string,
    input: z.infer<typeof perfProgressCreateSchema>,
    requestId: string,
  ) {
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockKeyResult(client, id, input.version);
        const updateId = randomUUID();
        await client.query(
          `INSERT INTO perf_kr_update(id,tenant_id,entity_id,key_result_id,value,note) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            updateId,
            actor.tenantId,
            actor.entityId,
            id,
            input.value,
            input.note ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.progress_recorded",
          `perf-key-result:${id}`,
          id,
          row.version + 1,
          {
            objectiveId: row.objectiveId,
            updateId,
            noteGiven: Boolean(input.note),
          },
        );
        return this.objective(client, actor, row.objectiveId as string);
      }),
    );
  }

  async progressHistory(
    actor: Principal,
    id: string,
    query: z.infer<typeof perfProgressQuerySchema>,
  ): Promise<PerfProgressList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const found = await client.query(
        "SELECT 1 FROM perf_key_result WHERE id=$1",
        [id],
      );
      if (!found.rowCount)
        throw new NotFoundException("This key result is unavailable.");
      const total = await this.count(
        client,
        "SELECT count(*)::int AS count FROM perf_kr_update WHERE key_result_id=$1",
        [id],
      );
      const { rows } = await client.query(
        `SELECT u.id, u.key_result_id AS "keyResultId", u.value::float8 AS value,
           u.previous_value::float8 AS "previousValue", u.note, u.by_label AS by, ${stamp("u.at")} AS at
         FROM perf_kr_update u WHERE u.key_result_id=$1 ORDER BY u.seq DESC LIMIT $2 OFFSET $3`,
        [id, query.limit, (query.page - 1) * query.limit],
      );
      return perfProgressListSchema.parse({
        items: rows,
        total,
        page: query.page,
        limit: query.limit,
      });
    });
  }

  // ---- Review cycles ----
  async listCycles(
    actor: Principal,
    query: z.infer<typeof perfCycleQuerySchema>,
  ): Promise<PerfCycleList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($1='%%' OR c.name ILIKE $1) AND ($2::text IS NULL OR c.status=$2)`;
      const params = [escapeLike(query.q), query.status ?? null];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM perf_cycle c WHERE ${where}`,
        params,
      );
      const { rows } = await client.query<CycleRow>(
        `SELECT ${cycleColumns} FROM perf_cycle c WHERE ${where}
         ORDER BY (c.status IN ('draft','active')) DESC, c.period_end DESC, c.created_at DESC, c.id
         LIMIT $3 OFFSET $4`,
        [...params, query.limit, (query.page - 1) * query.limit],
      );
      return perfCycleListSchema.parse({
        items: rows.map((row) => this.cycleFlags(actor, row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT c.status AS key, count(*)::int AS count FROM perf_cycle c WHERE ${where} GROUP BY c.status`,
          CYCLE_STATUSES,
          [params[0], null],
        ),
        canCreate: this.hr(actor),
      });
    });
  }

  async cycleDetail(actor: Principal, id: string) {
    this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.cycle(client, actor, id),
    );
  }

  async createCycle(
    actor: Principal,
    input: z.infer<typeof perfCycleCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "performance.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO perf_cycle(id,tenant_id,entity_id,name,period_start,period_end,self_due,manager_due,department_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.name,
            input.periodStart,
            input.periodEnd,
            input.selfDue,
            input.managerDue,
            input.departmentId ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.cycle_created",
          `perf-cycle:${id}`,
          id,
          1,
          { departmentId: input.departmentId ?? null },
        );
        return this.cycle(client, actor, id);
      }),
    );
  }

  async updateCycle(
    actor: Principal,
    id: string,
    input: z.infer<typeof perfCycleUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "performance.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCycle(client, id, input.version);
        await client.query(
          `UPDATE perf_cycle SET name=$2, period_start=$3, period_end=$4, self_due=$5, manager_due=$6, department_id=$7,
             version=version+1 WHERE id=$1`,
          [
            id,
            input.name,
            input.periodStart,
            input.periodEnd,
            input.selfDue,
            input.managerDue,
            input.departmentId ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.cycle_updated",
          `perf-cycle:${id}`,
          id,
          row.version + 1,
          {
            fields: Object.keys(input).filter((k) => k !== "version"),
            departmentId: input.departmentId ?? null,
          },
        );
        return this.cycle(client, actor, id);
      }),
    );
  }

  // Opening generates one review per active or notice-period employee in scope with a current
  // manager; people without one are skipped and counted.
  async openCycle(
    actor: Principal,
    id: string,
    input: z.infer<typeof perfCycleActionSchema>,
    requestId: string,
  ): Promise<PerfCycleOpened> {
    this.platform.require(actor, "performance.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCycle(client, id, input.version);
        await client.query(
          "UPDATE perf_cycle SET status='active', status_note=$2, version=version+1 WHERE id=$1",
          [id, input.note ?? null],
        );
        const inScope = `FROM employee e WHERE e.tenant_id=$2 AND e.entity_id=$3 AND e.status IN ('active','notice')
          AND ($4::uuid IS NULL OR e.department_id=$4)`;
        const managed = `e.manager_id IS NOT NULL AND EXISTS(SELECT 1 FROM employee m WHERE m.id=e.manager_id
          AND m.tenant_id=e.tenant_id AND m.entity_id=e.entity_id AND m.status IN ('active','notice'))`;
        const params = [
          id,
          actor.tenantId,
          actor.entityId,
          row.departmentId ?? null,
        ];
        const generated =
          (
            await client.query(
              `INSERT INTO perf_review(id,tenant_id,entity_id,cycle_id,employee_id)
               SELECT gen_random_uuid(), $2, $3, $1, e.id ${inScope} AND ${managed} ORDER BY e.id`,
              params,
            )
          ).rowCount ?? 0;
        const skippedNoManager = await this.count(
          client,
          `SELECT count(*)::int AS count ${inScope} AND NOT (${managed}) AND $1::uuid IS NOT NULL`,
          params,
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.cycle_status_changed",
          `perf-cycle:${id}`,
          id,
          row.version + 1,
          { from: row.status, to: "active", generated, skippedNoManager },
        );
        return perfCycleOpenedSchema.parse({
          cycle: await this.cycle(client, actor, id),
          generated,
          skippedNoManager,
        });
      }),
    );
  }

  async cycleStep(
    actor: Principal,
    id: string,
    step: "close" | "cancel",
    input: z.infer<typeof perfCycleActionSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "performance.manage");
    const to = cycleSteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCycle(client, id, input.version);
        await client.query(
          "UPDATE perf_cycle SET status=$2, status_note=$3, version=version+1 WHERE id=$1",
          [id, to, input.note ?? row.statusNote ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.cycle_status_changed",
          `perf-cycle:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, noteGiven: Boolean(input.note) },
        );
        return this.cycle(client, actor, id);
      }),
    );
  }

  // ---- Reviews ----
  async listReviews(
    actor: Principal,
    query: z.infer<typeof perfReviewQuerySchema>,
  ): Promise<PerfReviewList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($2='%%' OR r.employee_name ILIKE $2 OR r.manager_name ILIKE $2)
        AND ($3::text IS NULL OR r.status=$3) AND ($4::uuid IS NULL OR r.cycle_id=$4)
        AND ($5='all' OR ($5='mine' AND r.employee_id=$1) OR ($5='team' AND r.manager_id=$1))`;
      const base = [
        actor.employeeId,
        escapeLike(query.q),
        query.status ?? null,
        query.cycleId ?? null,
        query.view,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count ${reviewFrom} WHERE ${where}`,
        base,
      );
      const { rows } = await client.query<ReviewRow>(
        `SELECT ${reviewColumns} ${reviewFrom} WHERE ${where}
         ORDER BY (r.status<>'finalised') DESC, c.period_end DESC, r.employee_name, r.id LIMIT $6 OFFSET $7`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return perfReviewListSchema.parse({
        items: rows.map((row) => this.reviewFlags(actor, row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT r.status AS key, count(*)::int AS count ${reviewFrom} WHERE ${where} GROUP BY r.status`,
          REVIEW_STATUSES,
          [base[0], base[1], null, base[3], base[4]],
        ),
      });
    });
  }

  async reviewDetail(actor: Principal, id: string) {
    this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.review(client, actor, id),
    );
  }

  async submitReview(
    actor: Principal,
    id: string,
    kind: "self" | "manager",
    input: z.infer<typeof perfReviewSubmitSchema>,
    requestId: string,
  ) {
    if (kind === "manager" && !scopeFor(actor, "performance.manage"))
      this.platform.require(actor, "performance.review");
    this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockReview(client, id, input.version);
        await client.query(
          `INSERT INTO perf_review_entry(id,tenant_id,entity_id,review_id,kind,ratings,comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            id,
            kind,
            JSON.stringify(input.ratings),
            input.comment ?? null,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          kind === "self"
            ? "performance.review_self_submitted"
            : "performance.review_manager_submitted",
          `perf-review:${id}`,
          id,
          row.version + 1,
          { cycleId: row.cycleId, commentGiven: Boolean(input.comment) },
        );
        return this.review(client, actor, id);
      }),
    );
  }

  async finaliseReview(
    actor: Principal,
    id: string,
    input: z.infer<typeof perfReviewFinaliseSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "performance.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockReview(client, id, input.version);
        await client.query(
          "UPDATE perf_review SET final_rating=$2, final_reason=$3, version=version+1 WHERE id=$1",
          [id, input.finalRating, input.reason],
        );
        await this.record(
          client,
          actor,
          requestId,
          "performance.review_finalised",
          `perf-review:${id}`,
          id,
          row.version + 1,
          { cycleId: row.cycleId, from: row.status, to: "finalised" },
        );
        return this.review(client, actor, id);
      }),
    );
  }

  // ---- Shaping ----
  private objectiveFlags(row: ObjectiveRow): PerfObjective {
    const open = row.status === "draft" || row.status === "active";
    return {
      ...row,
      canEdit: open,
      canActivate: row.status === "draft" && row.keyResultCount > 0,
      canComplete: row.status === "active",
      canCancel: open,
      canAddKeyResult: open && row.keyResultCount < 10,
    };
  }
  private async objective(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<PerfObjectiveDetail> {
    const { rows } = await client.query<ObjectiveRow>(
      `SELECT ${objectiveColumns} FROM perf_objective o WHERE o.id=$2`,
      [actor.employeeId, id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException("This goal is unavailable.");
    const objective = this.objectiveFlags(row);
    const keyResults = (
      await client.query<KeyResultRow>(
        `SELECT ${keyResultColumns} FROM perf_key_result k WHERE k.objective_id=$1 ORDER BY k.created_at, k.id`,
        [id],
      )
    ).rows.map((kr) => ({
      ...kr,
      canEdit: objective.status === "draft",
      canRecordProgress: objective.status === "active",
    }));
    const children = (
      await client.query(
        `SELECT o.id, o.title, o.owner_name AS "ownerName", o.status, o.progress::float8 AS progress
         FROM perf_objective o WHERE o.parent_objective_id=$1 ORDER BY o.created_at, o.id LIMIT 100`,
        [id],
      )
    ).rows;
    return perfObjectiveDetailSchema.parse({
      objective: perfObjectiveSchema.parse(objective),
      keyResults,
      children,
    });
  }
  private cycleFlags(actor: Principal, row: CycleRow): PerfCycle {
    const hr = this.hr(actor);
    const reviewCounts = Object.fromEntries(
      REVIEW_STATUSES.map((s) => [s, row.reviewCounts[s] ?? 0]),
    ) as PerfCycle["reviewCounts"];
    const open = REVIEW_STATUSES.filter((s) => s !== "finalised").reduce(
      (n, s) => n + reviewCounts[s],
      0,
    );
    return {
      ...row,
      reviewCounts,
      canEdit: hr && row.status === "draft",
      canOpen: hr && row.status === "draft",
      canClose: hr && row.status === "active" && open === 0,
      canCancel: hr && row.status === "draft",
    };
  }
  private async cycle(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<PerfCycle> {
    const { rows } = await client.query<CycleRow>(
      `SELECT ${cycleColumns} FROM perf_cycle c WHERE c.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This review cycle is unavailable.");
    return perfCycleSchema.parse(this.cycleFlags(actor, rows[0]));
  }
  private reviewFlags(actor: Principal, row: ReviewRow): PerfReview {
    const open = row.cycleStatus === "active";
    const reviewer = Boolean(
      scopeFor(actor, "performance.manage") ??
      scopeFor(actor, "performance.review"),
    );
    return {
      ...row,
      canSubmitSelf: open && row.mine && row.status === "self_pending",
      canSubmitManager:
        open && reviewer && row.iAmManager && row.status === "manager_pending",
      canFinalise:
        open &&
        this.hr(actor) &&
        !row.mine &&
        !row.iAmManager &&
        row.status === "calibration",
    };
  }
  private async review(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<PerfReviewDetail> {
    const { rows } = await client.query<ReviewRow>(
      `SELECT ${reviewColumns} ${reviewFrom} WHERE r.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw new NotFoundException("This review is unavailable.");
    const review = this.reviewFlags(actor, rows[0]);
    // Row-level security returns only the entries the caller may see (blind rules).
    const entries = (
      await client.query(
        `SELECT x.id, x.kind, x.author_employee_id AS "authorEmployeeId", x.author_name AS "authorName", x.ratings,
           x.overall::float8 AS overall, x.comment, ${stamp("x.submitted_at")} AS "submittedAt"
         FROM perf_review_entry x WHERE x.review_id=$1 ORDER BY x.submitted_at, x.id`,
        [id],
      )
    ).rows;
    return perfReviewDetailSchema.parse({
      review: perfReviewSchema.parse(review),
      entries,
      blind: review.iAmManager && review.status === "manager_pending",
    });
  }

  // ---- Locks: the advisory lock first (same key as the guards), then the row ----
  private async objectiveLock(client: PoolClient, id: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('perf-objective:'||$1::text,0))",
      [id],
    );
  }
  private async lockObjective(client: PoolClient, id: string, version: number) {
    await this.objectiveLock(client, id);
    const found = await client.query<Locked>(
      `SELECT status, status_note AS "statusNote", version FROM perf_objective WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return this.fresh(found.rows[0], version, "goal");
  }
  private async lockKeyResult(client: PoolClient, id: string, version: number) {
    const parent = await client.query<{ objectiveId: string }>(
      `SELECT objective_id AS "objectiveId" FROM perf_key_result WHERE id=$1`,
      [id],
    );
    if (parent.rows[0])
      await this.objectiveLock(client, parent.rows[0].objectiveId);
    const found = await client.query<Locked>(
      `SELECT objective_id AS "objectiveId", version FROM perf_key_result WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return this.fresh(found.rows[0], version, "key result");
  }
  private async lockCycle(client: PoolClient, id: string, version: number) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('perf-cycle:'||$1::text,0))",
      [id],
    );
    const found = await client.query<Locked>(
      `SELECT status, status_note AS "statusNote", department_id AS "departmentId", version
       FROM perf_cycle WHERE id=$1 FOR UPDATE`,
      [id],
    );
    return this.fresh(found.rows[0], version, "review cycle");
  }
  // Reviews are written by the employee and the manager too, who hold no UPDATE grant on the
  // row; the advisory lock (shared with the guards) serialises every writer instead.
  private async lockReview(client: PoolClient, id: string, version: number) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('perf-review:'||$1::text,0))",
      [id],
    );
    const found = await client.query<Locked>(
      `SELECT status, cycle_id AS "cycleId", version FROM perf_review WHERE id=$1`,
      [id],
    );
    return this.fresh(found.rows[0], version, "review");
  }
  private fresh(row: Locked | undefined, version: number, what: string) {
    if (!row) throw new NotFoundException(`This ${what} is unavailable.`);
    if (row.version !== version)
      throw new ConflictException(
        `This ${what} changed. Reload it before trying again.`,
      );
    return row;
  }
  private async count(client: PoolClient, sql: string, params: unknown[]) {
    const { rows } = await client.query<{ count: number }>(sql, params);
    return rows[0]?.count ?? 0;
  }
  private async counts(
    client: PoolClient,
    sql: string,
    keys: readonly string[],
    params: unknown[] = [],
  ) {
    const counts: Record<string, number> = Object.fromEntries(
      keys.map((k) => [k, 0]),
    );
    for (const row of (
      await client.query<{ key: string; count: number }>(sql, params)
    ).rows)
      counts[row.key] = row.count;
    return counts;
  }

  // Audit and outbox carry ids, statuses and counts only: never titles, names, comments,
  // reasons, ratings or key-result values.
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
            "A referenced person, goal, cycle or department is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "22003")
          throw new BadRequestException("That number is too large.");
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
