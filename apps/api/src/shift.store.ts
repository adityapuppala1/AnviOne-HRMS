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
  SHF_DEFAULT_MIN_REST_HOURS,
  SHF_MAX_RANGE_DAYS,
  shfAssignResultSchema,
  shfAssignmentDetailSchema,
  shfClaimListSchema,
  shfClaimSchema,
  shfHoursSchema,
  shfOpenListSchema,
  shfOpenShiftDetailSchema,
  shfRosterSchema,
  shfSettingsSchema,
  shfSwapListSchema,
  shfSwapSchema,
  shfTemplateListSchema,
  shfTemplateSchema,
  shfWeekListSchema,
  shfWeekSchema,
  type ShfAssignResult,
  type ShfAssignment,
  type ShfAssignmentDetail,
  type ShfClaim,
  type ShfClaimList,
  type ShfHours,
  type ShfOpenList,
  type ShfOpenShift,
  type ShfOpenShiftDetail,
  type ShfRoster,
  type ShfSettings,
  type ShfSwap,
  type ShfSwapList,
  type ShfTemplate,
  type ShfTemplateList,
  type ShfWeek,
  type ShfWeekList,
  type shfAssignSchema,
  type shfCancelSchema,
  type shfClaimQuerySchema,
  type shfDecisionSchema,
  type shfHoursQuerySchema,
  type shfOpenCreateSchema,
  type shfOpenQuerySchema,
  type shfRosterQuerySchema,
  type shfSettingsUpdateSchema,
  type shfSwapCreateSchema,
  type shfSwapQuerySchema,
  type shfTemplateCreateSchema,
  type shfTemplateQuerySchema,
  type shfTemplateUpdateSchema,
  type shfVersionSchema,
  type shfWeekQuerySchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const day = (column: string) => `to_char(${column},'YYYY-MM-DD')`;
// Local wall-clock timestamps in the entity's time zone.
const local = (column: string) => `to_char(${column},'YYYY-MM-DD"T"HH24:MI')`;
const hhmm = (column: string) => `to_char(${column},'HH24:MI')`;
const minutes = (alias: string) =>
  `((extract(epoch FROM ${alias}.end_at-${alias}.start_at)/60)::integer-${alias}.break_minutes)`;

const ruleErrors: Record<string, (message: string) => Error> = {
  SF003: (m) => new BadRequestException(m),
  SF004: (m) => new ConflictException(m),
  SF005: (m) => new ForbiddenException(m),
};
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  shf_template_code_key: "A template with this code already exists.",
  shf_week_key: "This week is already published.",
  shf_claim_pending_key: "You already claimed this open shift.",
  shf_claim_approved_key: "This open shift is already filled.",
  shf_assignment_open_key: "This open shift is already filled.",
  shf_swap_open_requester_key:
    "One of these shifts is already in an open swap.",
  shf_swap_open_target_key: "One of these shifts is already in an open swap.",
  shf_setting_pkey: retry,
};
const unavailable = (what: string) =>
  new NotFoundException(`This ${what} is unavailable.`);

// $1 is always the caller's employee id.
const templateColumns = `t.id, t.code, t.name, ${hhmm("t.start_time")} AS "startTime", ${hhmm("t.end_time")} AS "endTime",
  t.crosses_midnight AS "crossesMidnight", t.break_minutes AS "breakMinutes",
  shf_span(t.start_time,t.end_time)-t.break_minutes AS "paidMinutes", t.colour, t.active, t.version,
  t.updated_by_label AS "updatedBy", ${stamp("t.updated_at")} AS "updatedAt"`;
const assignmentColumns = `a.id, a.employee_id AS "employeeId", a.employee_name AS "employeeName",
  a.template_id AS "templateId", t.code AS "templateCode", t.name AS "templateName", t.colour,
  ${day("a.work_date")} AS "workDate", ${local("a.start_at")} AS "startAt", ${local("a.end_at")} AS "endAt",
  (a.end_at::date>a.work_date) AS "crossesMidnight", a.break_minutes AS "breakMinutes",
  ${minutes("a")} AS "plannedMinutes", a.status, a.source, a.batch_id AS "batchId",
  shf_published(a.work_date) AS published, a.after_publish AS "afterPublish",
  shf_on_leave(a.employee_id,a.work_date) AS "onLeave",
  (SELECT ${hhmm("r.check_in")} FROM attendance_record r WHERE r.tenant_id=a.tenant_id
    AND r.employee_id=a.employee_id AND r.work_date=a.work_date) AS "attendanceCheckIn",
  (SELECT ${hhmm("r.check_out")} FROM attendance_record r WHERE r.tenant_id=a.tenant_id
    AND r.employee_id=a.employee_id AND r.work_date=a.work_date) AS "attendanceCheckOut",
  (a.employee_id=$1) AS mine, a.assigned_by_label AS "assignedBy", ${stamp("a.created_at")} AS "createdAt",
  ${stamp("a.cancelled_at")} AS "cancelledAt", a.version,
  (a.work_date>=shf_today()) AS upcoming, shf_is_report(a.employee_id) AS report`;
const assignmentFrom =
  "shf_assignment a JOIN shf_template t ON t.id=a.template_id";
const swapColumns = `s.id, ${day("s.work_date")} AS "workDate", s.status, s.version,
  (s.status IN ('proposed','accepted') AND s.work_date<shf_today()) AS expired,
  s.decision_reason AS "decisionReason", s.decided_by_label AS "decidedBy", ${stamp("s.decided_at")} AS "decidedAt",
  ${stamp("s.created_at")} AS "createdAt",
  s.requester_id AS "rId", s.requester_name AS "rName", s.requester_assignment_id AS "rAssignment",
  rt.code AS "rCode", rt.name AS "rTemplate", ${hhmm("rt.start_time")} AS "rStart", ${hhmm("rt.end_time")} AS "rEnd",
  s.target_id AS "tId", s.target_name AS "tName", s.target_assignment_id AS "tAssignment",
  tt.code AS "tCode", tt.name AS "tTemplate", ${hhmm("tt.start_time")} AS "tStart", ${hhmm("tt.end_time")} AS "tEnd",
  (shf_is_report(s.requester_id) AND shf_is_report(s.target_id)) AS "teamApprover"`;
const swapFrom = `shf_swap s JOIN shf_template rt ON rt.id=s.requester_template_id
  JOIN shf_template tt ON tt.id=s.target_template_id`;
const openColumns = `o.id, o.template_id AS "templateId", t.code AS "templateCode", t.name AS "templateName", t.colour,
  ${day("o.work_date")} AS "workDate", ${local("o.start_at")} AS "startAt", ${local("o.end_at")} AS "endAt",
  o.break_minutes AS "breakMinutes", ${minutes("o")} AS "plannedMinutes", o.audience, o.status,
  o.posted_by_label AS "postedBy",
  (SELECT c.id FROM shf_claim c WHERE c.open_shift_id=o.id AND c.employee_id=$1 ORDER BY c.created_at DESC, c.id LIMIT 1) AS "myClaimId",
  (SELECT c.status FROM shf_claim c WHERE c.open_shift_id=o.id AND c.employee_id=$1 ORDER BY c.created_at DESC, c.id LIMIT 1) AS "myClaimStatus",
  (SELECT count(*)::int FROM shf_claim c WHERE c.open_shift_id=o.id AND c.status='pending') AS "pendingClaims",
  ${stamp("o.created_at")} AS "createdAt", o.version,
  (o.work_date>=shf_today()) AS upcoming, COALESCE(o.manager_id=$1, false) AS posted,
  (o.audience='entity' OR o.manager_id IS NOT DISTINCT FROM shf_my_manager()) AS eligible`;
const openFrom = "shf_open_shift o JOIN shf_template t ON t.id=o.template_id";
const claimColumns = `c.id, c.open_shift_id AS "openShiftId", ${day("o.work_date")} AS "workDate", t.code AS "templateCode",
  c.employee_id AS "employeeId", c.employee_name AS "employeeName", c.status,
  c.decision_reason AS "decisionReason", c.decided_by_label AS "decidedBy", ${stamp("c.decided_at")} AS "decidedAt",
  ${stamp("c.created_at")} AS "createdAt", (c.employee_id=$1) AS mine, c.version,
  o.status AS "openStatus", COALESCE(o.manager_id=$1, false) AS posted`;
const claimFrom = `shf_claim c JOIN shf_open_shift o ON o.id=c.open_shift_id
  JOIN shf_template t ON t.id=o.template_id`;

type Scope = "manage" | "team" | "self";
type AssignmentRow = Omit<ShfAssignment, "canCancel" | "canSwap"> & {
  upcoming: boolean;
  report: boolean;
};
type SwapRow = {
  id: string;
  workDate: string;
  status: ShfSwap["status"];
  version: number;
  expired: boolean;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  teamApprover: boolean;
} & Record<
  | "rId"
  | "rName"
  | "rAssignment"
  | "rCode"
  | "rTemplate"
  | "rStart"
  | "rEnd"
  | "tId"
  | "tName"
  | "tAssignment"
  | "tCode"
  | "tTemplate"
  | "tStart"
  | "tEnd",
  string
>;
type OpenRow = Omit<ShfOpenShift, "canClaim" | "canWithdraw" | "canDecide"> & {
  upcoming: boolean;
  posted: boolean;
  eligible: boolean;
};
type ClaimRow = Omit<ShfClaim, "canWithdraw" | "canApprove" | "canReject"> & {
  openStatus: string;
  posted: boolean;
};
type Locked = { version: number; [key: string]: unknown };
const swapSteps = {
  accept: { to: "accepted", event: "shift.swap_accepted" },
  decline: { to: "declined", event: "shift.swap_declined" },
  cancel: { to: "cancelled", event: "shift.swap_cancelled" },
  approve: { to: "approved", event: "shift.swap_approved" },
  reject: { to: "rejected", event: "shift.swap_rejected" },
} as const;
export type SwapStep = keyof typeof swapSteps;
const claimSteps = {
  approve: { to: "approved", event: "shift.claim_approved" },
  reject: { to: "rejected", event: "shift.claim_rejected" },
  withdraw: { to: "withdrawn", event: "shift.claim_withdrawn" },
} as const;
export type ClaimStep = keyof typeof claimSteps;

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isMonday = (iso: string) => new Date(dayMs(iso)).getUTCDay() === 1;

// Who may do what, conflicts (overlap, rest, leave), the publish lock, four-eyes, swap and claim
// state machines and visibility all live in the database guards and policies (068). The store
// shapes replies, takes the same advisory locks first, and writes audit and outbox rows with ids,
// statuses, counts and flags only: never names or reasons.
export class ShiftStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal): Scope | undefined {
    if (scopeFor(actor, "shift.manage")) return "manage";
    if (scopeFor(actor, "shift.team")) return "team";
    if (scopeFor(actor, "shift.self")) return "self";
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
        "Only HR manages shift templates, settings and roster weeks.",
      );
  }
  private plan(actor: Principal) {
    const scope = this.see(actor);
    if (scope === "self")
      throw new ForbiddenException("Only HR and managers plan shifts.");
    return scope;
  }
  private view(scope: Scope, view: "mine" | "team" | "all") {
    if (view === "team" && scope !== "team")
      throw new ForbiddenException(
        scope === "manage"
          ? "HR sees everyone in the all view."
          : "Only managers see their team's shifts.",
      );
    if (view === "all" && scope !== "manage")
      throw new ForbiddenException("Only HR sees every shift.");
    return { mine: "a.employee_id=$1", team: "a.employee_id<>$1", all: "true" }[
      view
    ];
  }

  // ---- Settings ----
  async settings(actor: Principal): Promise<ShfSettings> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.settingsRow(client, scope === "manage"),
    );
  }
  async updateSettings(
    actor: Principal,
    input: z.infer<typeof shfSettingsUpdateSchema>,
    requestId: string,
  ): Promise<ShfSettings> {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('shf-setting:'||$1::text,0))",
          [actor.entityId],
        );
        const current = await this.settingsRow(client, true);
        if (current.version !== input.version)
          throw new ConflictException(
            "These settings changed. Reload them before trying again.",
          );
        if (input.version === 0)
          await client.query(
            "INSERT INTO shf_setting(tenant_id,entity_id,min_rest_hours) VALUES ($1,$2,$3)",
            [actor.tenantId, actor.entityId, input.minRestHours],
          );
        else
          await client.query(
            "UPDATE shf_setting SET min_rest_hours=$1, version=$2 WHERE tenant_id=$3 AND entity_id=$4",
            [
              input.minRestHours,
              input.version + 1,
              actor.tenantId,
              actor.entityId,
            ],
          );
        await this.record(
          client,
          actor,
          requestId,
          "shift.settings_updated",
          `shf-setting:${actor.entityId}`,
          actor.entityId,
          input.version + 1,
          { minRestHours: input.minRestHours },
        );
        return this.settingsRow(client, true);
      }),
    );
  }
  private async settingsRow(
    client: PoolClient,
    manage: boolean,
  ): Promise<ShfSettings> {
    const { rows } = await client.query<{
      minRestHours: number;
      version: number;
      updatedBy: string;
      updatedAt: string;
    }>(
      `SELECT min_rest_hours AS "minRestHours", version, updated_by_label AS "updatedBy",
        ${stamp("updated_at")} AS "updatedAt" FROM shf_setting`,
    );
    const row = rows[0];
    return shfSettingsSchema.parse({
      minRestHours: row?.minRestHours ?? SHF_DEFAULT_MIN_REST_HOURS,
      version: row?.version ?? 0,
      canManage: manage,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  }

  // ---- Templates ----
  async listTemplates(
    actor: Principal,
    query: z.infer<typeof shfTemplateQuerySchema>,
  ): Promise<ShfTemplateList> {
    const manage = this.see(actor) === "manage";
    return scoped(this.platform.pool, actor, async (client) => {
      const like = query.q
        ? `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
        : null;
      const where = `($1::boolean IS NULL OR t.active=$1) AND ($2::text IS NULL OR t.name ILIKE $2 OR t.code ILIKE $2)`;
      const filters = [query.active ?? null, like];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM shf_template t WHERE ${where}`,
          filters,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<Omit<ShfTemplate, "canEdit">>(
        `SELECT ${templateColumns} FROM shf_template t WHERE ${where}
         ORDER BY t.active DESC, t.start_time, t.code, t.id LIMIT $3 OFFSET $4`,
        [...filters, query.limit, (query.page - 1) * query.limit],
      );
      return shfTemplateListSchema.parse({
        items: rows.map((r) => ({ ...r, canEdit: manage })),
        total,
        page: query.page,
        limit: query.limit,
        canManage: manage,
      });
    });
  }
  async templateDetail(actor: Principal, id: string): Promise<ShfTemplate> {
    const manage = this.see(actor) === "manage";
    return scoped(this.platform.pool, actor, (client) =>
      this.template(client, id, manage),
    );
  }
  async createTemplate(
    actor: Principal,
    input: z.infer<typeof shfTemplateCreateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO shf_template(id,tenant_id,entity_id,code,name,start_time,end_time,break_minutes,colour)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.code,
            input.name,
            input.startTime,
            input.endTime,
            input.breakMinutes,
            input.colour,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "shift.template_created",
          `shf-template:${id}`,
          id,
          1,
          { active: true },
        );
        return this.template(client, id, true);
      }),
    );
  }
  async updateTemplate(
    actor: Principal,
    id: string,
    input: z.infer<typeof shfTemplateUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.lock(client, "shf-template", id);
        const row = await this.read(
          client,
          "SELECT version FROM shf_template WHERE id=$1",
          id,
          input.version,
          "template",
        );
        await client.query(
          `UPDATE shf_template SET name=$2, start_time=$3, end_time=$4, break_minutes=$5, colour=$6, active=$7,
            version=$8 WHERE id=$1`,
          [
            id,
            input.name,
            input.startTime,
            input.endTime,
            input.breakMinutes,
            input.colour,
            input.active,
            row.version + 1,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "shift.template_updated",
          `shf-template:${id}`,
          id,
          row.version + 1,
          { active: input.active },
        );
        return this.template(client, id, true);
      }),
    );
  }
  private async template(
    client: PoolClient,
    id: string,
    manage: boolean,
  ): Promise<ShfTemplate> {
    const { rows } = await client.query<Omit<ShfTemplate, "canEdit">>(
      `SELECT ${templateColumns} FROM shf_template t WHERE t.id=$1`,
      [id],
    );
    if (!rows[0]) throw unavailable("template");
    return shfTemplateSchema.parse({ ...rows[0], canEdit: manage });
  }

  // ---- Roster ----
  async roster(
    actor: Principal,
    query: z.infer<typeof shfRosterQuerySchema>,
  ): Promise<ShfRoster> {
    const scope = this.see(actor);
    const view = this.view(scope, query.view);
    return scoped(this.platform.pool, actor, async (client) => {
      const monday = await this.thisMonday(client);
      const from = query.from ?? monday;
      const to = query.to ?? isoDay(dayMs(from) + 6 * DAY_MS);
      this.range(from, to);
      const where = `$1::uuid IS NOT NULL AND ${view} AND a.status=$2 AND a.work_date BETWEEN $3::date AND $4::date
        AND ($5::uuid IS NULL OR a.employee_id=$5)`;
      const base = [
        actor.employeeId,
        query.status,
        from,
        to,
        query.employeeId ?? null,
      ];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM shf_assignment a WHERE ${where}`,
          base,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<AssignmentRow>(
        `SELECT ${assignmentColumns} FROM ${assignmentFrom} WHERE ${where}
         ORDER BY a.start_at, a.employee_name, a.id LIMIT $6 OFFSET $7`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return shfRosterSchema.parse({
        items: rows.map((r) => this.assignmentShape(r, scope)),
        total,
        page: query.page,
        limit: query.limit,
        view: query.view,
        from,
        to,
        canPlan: scope !== "self",
        canPublish: scope === "manage",
      });
    });
  }
  async assignmentDetail(
    actor: Principal,
    id: string,
  ): Promise<ShfAssignmentDetail> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.assignment(client, actor, id, scope),
    );
  }
  async assign(
    actor: Principal,
    input: z.infer<typeof shfAssignSchema>,
    requestId: string,
  ): Promise<ShfAssignResult> {
    this.plan(actor);
    const to = input.to ?? input.from;
    this.range(input.from, to);
    const weekdays = new Set(input.weekdays ?? [1, 2, 3, 4, 5, 6, 7]);
    const dates: string[] = [];
    for (let ms = dayMs(input.from); ms <= dayMs(to); ms += DAY_MS) {
      const iso = new Date(ms).getUTCDay() || 7;
      if (weekdays.has(iso)) dates.push(isoDay(ms));
    }
    if (dates.length === 0)
      throw new BadRequestException("No dates in that range match the days.");
    const ids = dates.map(() => randomUUID());
    const batchId = dates.length > 1 ? randomUUID() : null;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        // Every shift in the request is checked; any refusal refuses the whole request.
        await client.query(
          `INSERT INTO shf_assignment(id,tenant_id,entity_id,employee_id,template_id,work_date,source,batch_id,change_reason)
           SELECT x.id,$1,$2,$3,$4,x.d,'assigned',$5,$6 FROM unnest($7::uuid[],$8::date[]) AS x(id,d)`,
          [
            actor.tenantId,
            actor.entityId,
            input.employeeId,
            input.templateId,
            batchId,
            input.reason ?? null,
            ids,
            dates,
          ],
        );
        const flagged = (
          await client.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM shf_assignment WHERE id=ANY($1::uuid[]) AND after_publish",
            [ids],
          )
        ).rows[0]!.n;
        await this.record(
          client,
          actor,
          requestId,
          "shift.assigned",
          batchId ? `shf-batch:${batchId}` : `shf-assignment:${ids[0]}`,
          batchId ?? ids[0]!,
          1,
          {
            templateId: input.templateId,
            created: ids.length,
            afterPublish: flagged,
          },
        );
        return shfAssignResultSchema.parse({
          batchId,
          created: ids.length,
          assignmentIds: ids,
        });
      }),
    );
  }
  async cancel(
    actor: Principal,
    id: string,
    input: z.infer<typeof shfCancelSchema>,
    requestId: string,
  ): Promise<ShfAssignmentDetail> {
    const scope = this.plan(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.lock(client, "shf-assignment", id);
        const row = await this.read(
          client,
          "SELECT version, status FROM shf_assignment WHERE id=$1",
          id,
          input.version,
          "shift",
        );
        if (row.status !== "active")
          throw new ConflictException("This shift is already cancelled.");
        const changed = await client.query(
          "UPDATE shf_assignment SET status='cancelled', change_reason=$2, version=$3 WHERE id=$1",
          [id, input.reason ?? null, row.version + 1],
        );
        if (changed.rowCount !== 1)
          throw new ForbiddenException(
            "Only HR or the person's manager cancels a shift.",
          );
        const after = (
          await client.query<{ f: boolean }>(
            "SELECT after_publish AS f FROM shf_assignment WHERE id=$1",
            [id],
          )
        ).rows[0]!.f;
        await this.record(
          client,
          actor,
          requestId,
          "shift.cancelled",
          `shf-assignment:${id}`,
          id,
          row.version + 1,
          { from: "active", to: "cancelled", afterPublish: after },
        );
        return this.assignment(client, actor, id, scope);
      }),
    );
  }
  private async assignment(
    client: PoolClient,
    actor: Principal,
    id: string,
    scope: Scope,
  ): Promise<ShfAssignmentDetail> {
    const { rows } = await client.query<AssignmentRow>(
      `SELECT ${assignmentColumns} FROM ${assignmentFrom} WHERE a.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw unavailable("shift");
    const history = await client.query(
      `SELECT h.id, h.kind, h.employee_id AS "employeeId", h.after_publish AS "afterPublish", h.reason,
        h.swap_id AS "swapId", h.by_label AS "byLabel", ${stamp("h.at")} AS at
       FROM shf_change h WHERE h.assignment_id=$1 ORDER BY h.at, h.id`,
      [id],
    );
    return shfAssignmentDetailSchema.parse({
      assignment: this.assignmentShape(rows[0], scope),
      history: history.rows,
    });
  }
  private assignmentShape(row: AssignmentRow, scope: Scope): ShfAssignment {
    const { upcoming, report, ...rest } = row;
    const live = row.status === "active" && upcoming;
    return {
      ...rest,
      canCancel: live && (scope === "manage" || (scope === "team" && report)),
      canSwap: live && row.mine && row.published,
    };
  }

  // ---- Weeks and planned hours ----
  async weeks(
    actor: Principal,
    query: z.infer<typeof shfWeekQuerySchema>,
  ): Promise<ShfWeekList> {
    this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const total = (
        await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM shf_week",
        )
      ).rows[0]!.n;
      const { rows } = await client.query(
        `SELECT ${day("w.week_start")} AS "weekStart", true AS published, ${stamp("w.published_at")} AS "publishedAt",
          w.published_by_label AS "publishedBy", false AS "canPublish"
         FROM shf_week w ORDER BY w.week_start DESC LIMIT $1 OFFSET $2`,
        [query.limit, (query.page - 1) * query.limit],
      );
      return shfWeekListSchema.parse({
        items: rows,
        total,
        page: query.page,
        limit: query.limit,
      });
    });
  }
  async week(actor: Principal, weekStart: string): Promise<ShfWeek> {
    const manage = this.see(actor) === "manage";
    this.monday(weekStart);
    return scoped(this.platform.pool, actor, (client) =>
      this.weekRow(client, weekStart, manage),
    );
  }
  async publish(
    actor: Principal,
    weekStart: string,
    requestId: string,
  ): Promise<ShfWeek> {
    this.manage(actor);
    this.monday(weekStart);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await client.query(
          "INSERT INTO shf_week(tenant_id,entity_id,week_start) VALUES ($1,$2,$3)",
          [actor.tenantId, actor.entityId, weekStart],
        );
        const shifts = (
          await client.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM shf_assignment WHERE status='active' AND work_date BETWEEN $1::date AND $1::date+6",
            [weekStart],
          )
        ).rows[0]!.n;
        await this.record(
          client,
          actor,
          requestId,
          "shift.week_published",
          `shf-week:${weekStart}`,
          randomUUID(),
          1,
          { weekStart, shifts },
        );
        return this.weekRow(client, weekStart, true);
      }),
    );
  }
  private async weekRow(
    client: PoolClient,
    weekStart: string,
    manage: boolean,
  ): Promise<ShfWeek> {
    const { rows } = await client.query<{
      publishedAt: string;
      publishedBy: string;
    }>(
      `SELECT ${stamp("w.published_at")} AS "publishedAt", w.published_by_label AS "publishedBy"
       FROM shf_week w WHERE w.week_start=$1`,
      [weekStart],
    );
    const row = rows[0];
    return shfWeekSchema.parse({
      weekStart,
      published: !!row,
      publishedAt: row?.publishedAt ?? null,
      publishedBy: row?.publishedBy ?? null,
      canPublish: manage && !row,
    });
  }
  async hours(
    actor: Principal,
    query: z.infer<typeof shfHoursQuerySchema>,
  ): Promise<ShfHours> {
    const scope = this.see(actor);
    const view = this.view(scope, query.view);
    if (query.weekStart) this.monday(query.weekStart);
    return scoped(this.platform.pool, actor, async (client) => {
      const weekStart = query.weekStart ?? (await this.thisMonday(client));
      const where = `$1::uuid IS NOT NULL AND ${view} AND a.status='active'
        AND a.work_date BETWEEN $2::date AND $2::date+6`;
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(DISTINCT a.employee_id)::int AS n FROM shf_assignment a WHERE ${where}`,
          [actor.employeeId, weekStart],
        )
      ).rows[0]!.n;
      const { rows } = await client.query(
        `SELECT a.employee_id AS "employeeId", min(a.employee_name) AS "employeeName", count(*)::int AS shifts,
          sum(${minutes("a")})::int AS "plannedMinutes", sum(a.break_minutes)::int AS "breakMinutes"
         FROM shf_assignment a WHERE ${where}
         GROUP BY a.employee_id ORDER BY min(a.employee_name), a.employee_id LIMIT $3 OFFSET $4`,
        [
          actor.employeeId,
          weekStart,
          query.limit,
          (query.page - 1) * query.limit,
        ],
      );
      return shfHoursSchema.parse({
        items: rows,
        total,
        page: query.page,
        limit: query.limit,
        weekStart,
        view: query.view,
      });
    });
  }

  // ---- Swaps ----
  async listSwaps(
    actor: Principal,
    query: z.infer<typeof shfSwapQuerySchema>,
  ): Promise<ShfSwapList> {
    const scope = this.see(actor);
    if (query.view === "approvals" && scope === "self")
      throw new ForbiddenException("Only HR and managers decide swaps.");
    return scoped(this.platform.pool, actor, async (client) => {
      const view =
        query.view === "mine"
          ? "(s.requester_id=$1 OR s.target_id=$1)"
          : "(s.requester_id<>$1 AND s.target_id<>$1)";
      const where = `$1::uuid IS NOT NULL AND ${view} AND ($2::text IS NULL OR s.status=$2)`;
      const base = [actor.employeeId, query.status ?? null];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM shf_swap s WHERE ${where}`,
          base,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<SwapRow>(
        `SELECT ${swapColumns} FROM ${swapFrom} WHERE ${where}
         ORDER BY s.work_date DESC, s.created_at DESC, s.id LIMIT $3 OFFSET $4`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return shfSwapListSchema.parse({
        items: rows.map((r) => this.swapShape(r, actor, scope)),
        total,
        page: query.page,
        limit: query.limit,
        view: query.view,
      });
    });
  }
  async swapDetail(actor: Principal, id: string): Promise<ShfSwap> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.swap(client, actor, id, scope),
    );
  }
  async proposeSwap(
    actor: Principal,
    input: z.infer<typeof shfSwapCreateSchema>,
    requestId: string,
  ): Promise<ShfSwap> {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO shf_swap(id,tenant_id,entity_id,requester_assignment_id,target_id) VALUES ($1,$2,$3,$4,$5)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.assignmentId,
            input.colleagueId,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "shift.swap_proposed",
          `shf-swap:${id}`,
          id,
          1,
          { status: "proposed" },
        );
        return this.swap(client, actor, id, scope);
      }),
    );
  }
  async swapStep(
    actor: Principal,
    id: string,
    step: SwapStep,
    input: z.infer<typeof shfDecisionSchema>,
    requestId: string,
  ): Promise<ShfSwap> {
    const scope = this.see(actor);
    const { to, event } = swapSteps[step];
    if (step === "reject" && !input.reason)
      throw new BadRequestException("Give a reason of 3 to 300 characters.");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.lock(client, "shf-swap", id);
        const row = await this.read(
          client,
          "SELECT version, status FROM shf_swap WHERE id=$1",
          id,
          input.version,
          "swap",
        );
        await client.query(
          "UPDATE shf_swap SET status=$2, decision_reason=$3, version=$4 WHERE id=$1",
          [id, to, step === "reject" ? input.reason : null, row.version + 1],
        );
        await this.record(
          client,
          actor,
          requestId,
          event,
          `shf-swap:${id}`,
          id,
          row.version + 1,
          { from: row.status, to },
        );
        return this.swap(client, actor, id, scope);
      }),
    );
  }
  private async swap(
    client: PoolClient,
    actor: Principal,
    id: string,
    scope: Scope,
  ): Promise<ShfSwap> {
    const { rows } = await client.query<SwapRow>(
      `SELECT ${swapColumns} FROM ${swapFrom} WHERE s.id=$2 AND $1::uuid IS NOT NULL`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw unavailable("swap");
    return shfSwapSchema.parse(this.swapShape(rows[0], actor, scope));
  }
  private swapShape(row: SwapRow, actor: Principal, scope: Scope): ShfSwap {
    const me = actor.employeeId;
    const party = me === row.rId || me === row.tId;
    const open = row.status === "proposed" || row.status === "accepted";
    const decide =
      row.status === "accepted" &&
      !row.expired &&
      !party &&
      (scope === "manage" || (scope === "team" && row.teamApprover));
    return {
      id: row.id,
      workDate: row.workDate,
      requester: {
        employeeId: row.rId,
        employeeName: row.rName,
        assignmentId: row.rAssignment,
        templateCode: row.rCode,
        templateName: row.rTemplate,
        startTime: row.rStart,
        endTime: row.rEnd,
      },
      colleague: {
        employeeId: row.tId,
        employeeName: row.tName,
        assignmentId: row.tAssignment,
        templateCode: row.tCode,
        templateName: row.tTemplate,
        startTime: row.tStart,
        endTime: row.tEnd,
      },
      status: row.status,
      expired: row.expired,
      decisionReason: row.decisionReason,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
      canAccept: row.status === "proposed" && !row.expired && me === row.tId,
      canDecline: row.status === "proposed" && !row.expired && me === row.tId,
      canCancel: open && me === row.rId,
      canApprove: decide,
      canReject: decide,
      version: row.version,
    };
  }

  // ---- Open shifts and claims ----
  async listOpen(
    actor: Principal,
    query: z.infer<typeof shfOpenQuerySchema>,
  ): Promise<ShfOpenList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `$1::uuid IS NOT NULL AND ($2::text IS NULL OR o.status=$2)
        AND ($3::date IS NULL OR o.work_date>=$3) AND ($4::date IS NULL OR o.work_date<=$4)`;
      const base = [
        actor.employeeId,
        query.status ?? null,
        query.from ?? null,
        query.to ?? null,
      ];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM shf_open_shift o WHERE ${where}`,
          base,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<OpenRow>(
        `SELECT ${openColumns} FROM ${openFrom} WHERE ${where}
         ORDER BY o.work_date, o.start_at, o.id LIMIT $5 OFFSET $6`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return shfOpenListSchema.parse({
        items: rows.map((r) => this.openShape(r, scope)),
        total,
        page: query.page,
        limit: query.limit,
        canPost: scope !== "self",
      });
    });
  }
  async openDetail(actor: Principal, id: string): Promise<ShfOpenShiftDetail> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.open(client, actor, id, scope),
    );
  }
  async postOpen(
    actor: Principal,
    input: z.infer<typeof shfOpenCreateSchema>,
    requestId: string,
  ): Promise<ShfOpenShiftDetail> {
    const scope = this.plan(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          "INSERT INTO shf_open_shift(id,tenant_id,entity_id,template_id,work_date) VALUES ($1,$2,$3,$4,$5)",
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.templateId,
            input.workDate,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "shift.open_posted",
          `shf-open:${id}`,
          id,
          1,
          {
            templateId: input.templateId,
            audience: scope === "manage" ? "entity" : "team",
          },
        );
        return this.open(client, actor, id, scope);
      }),
    );
  }
  async withdrawOpen(
    actor: Principal,
    id: string,
    input: z.infer<typeof shfVersionSchema>,
    requestId: string,
  ): Promise<ShfOpenShiftDetail> {
    const scope = this.plan(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.lock(client, "shf-open", id);
        const row = await this.read(
          client,
          "SELECT version, status FROM shf_open_shift WHERE id=$1",
          id,
          input.version,
          "open shift",
        );
        const changed = await client.query(
          "UPDATE shf_open_shift SET status='withdrawn', version=$2 WHERE id=$1",
          [id, row.version + 1],
        );
        if (changed.rowCount !== 1)
          throw new ForbiddenException(
            "Only the poster or HR withdraws an open shift.",
          );
        await this.record(
          client,
          actor,
          requestId,
          "shift.open_withdrawn",
          `shf-open:${id}`,
          id,
          row.version + 1,
          { from: row.status, to: "withdrawn" },
        );
        return this.open(client, actor, id, scope);
      }),
    );
  }
  async claim(
    actor: Principal,
    openShiftId: string,
    requestId: string,
  ): Promise<ShfClaim> {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          "INSERT INTO shf_claim(id,tenant_id,entity_id,open_shift_id,employee_id) VALUES ($1,$2,$3,$4,$5)",
          [id, actor.tenantId, actor.entityId, openShiftId, actor.employeeId],
        );
        await this.record(
          client,
          actor,
          requestId,
          "shift.open_claimed",
          `shf-claim:${id}`,
          id,
          1,
          { openShiftId },
        );
        return this.claimRow(client, actor, id, scope);
      }),
    );
  }
  async listClaims(
    actor: Principal,
    query: z.infer<typeof shfClaimQuerySchema>,
  ): Promise<ShfClaimList> {
    const scope = this.see(actor);
    if (query.view === "approvals" && scope === "self")
      throw new ForbiddenException("Only HR and managers decide claims.");
    return scoped(this.platform.pool, actor, async (client) => {
      const view =
        query.view === "mine" ? "c.employee_id=$1" : "c.employee_id<>$1";
      const where = `$1::uuid IS NOT NULL AND ${view} AND ($2::text IS NULL OR c.status=$2)`;
      const base = [actor.employeeId, query.status ?? null];
      const total = (
        await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM shf_claim c WHERE ${where}`,
          base,
        )
      ).rows[0]!.n;
      const { rows } = await client.query<ClaimRow>(
        `SELECT ${claimColumns} FROM ${claimFrom} WHERE ${where}
         ORDER BY c.created_at DESC, c.id LIMIT $3 OFFSET $4`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return shfClaimListSchema.parse({
        items: rows.map((r) => this.claimShape(r, scope)),
        total,
        page: query.page,
        limit: query.limit,
        view: query.view,
      });
    });
  }
  async claimStep(
    actor: Principal,
    id: string,
    step: ClaimStep,
    input: z.infer<typeof shfDecisionSchema>,
    requestId: string,
  ): Promise<ShfClaim> {
    const scope = this.see(actor);
    const { to, event } = claimSteps[step];
    if (step === "reject" && !input.reason)
      throw new BadRequestException("Give a reason of 3 to 300 characters.");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.lock(client, "shf-claim", id);
        const row = await this.read(
          client,
          "SELECT version, status, open_shift_id FROM shf_claim WHERE id=$1",
          id,
          input.version,
          "claim",
        );
        // Decisions on the same open shift serialise on the lock the guards share.
        await this.lock(client, "shf-open", String(row.open_shift_id));
        await client.query(
          "UPDATE shf_claim SET status=$2, decision_reason=$3, version=$4 WHERE id=$1",
          [id, to, step === "reject" ? input.reason : null, row.version + 1],
        );
        await this.record(
          client,
          actor,
          requestId,
          event,
          `shf-claim:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, openShiftId: row.open_shift_id },
        );
        return this.claimRow(client, actor, id, scope);
      }),
    );
  }
  private async open(
    client: PoolClient,
    actor: Principal,
    id: string,
    scope: Scope,
  ): Promise<ShfOpenShiftDetail> {
    const { rows } = await client.query<OpenRow>(
      `SELECT ${openColumns} FROM ${openFrom} WHERE o.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw unavailable("open shift");
    const claims = await client.query<ClaimRow>(
      `SELECT ${claimColumns} FROM ${claimFrom} WHERE c.open_shift_id=$2 ORDER BY c.created_at, c.id`,
      [actor.employeeId, id],
    );
    return shfOpenShiftDetailSchema.parse({
      openShift: this.openShape(rows[0], scope),
      claims: claims.rows.map((r) => this.claimShape(r, scope)),
    });
  }
  private openShape(row: OpenRow, scope: Scope): ShfOpenShift {
    const { upcoming, posted, eligible, ...rest } = row;
    const open = row.status === "open" && upcoming;
    const decide = open && (scope === "manage" || posted);
    return {
      ...rest,
      canClaim: open && eligible && row.myClaimStatus !== "pending",
      canWithdraw: row.status === "open" && (scope === "manage" || posted),
      canDecide: decide,
    };
  }
  private async claimRow(
    client: PoolClient,
    actor: Principal,
    id: string,
    scope: Scope,
  ): Promise<ShfClaim> {
    const { rows } = await client.query<ClaimRow>(
      `SELECT ${claimColumns} FROM ${claimFrom} WHERE c.id=$2`,
      [actor.employeeId, id],
    );
    if (!rows[0]) throw unavailable("claim");
    return shfClaimSchema.parse(this.claimShape(rows[0], scope));
  }
  private claimShape(row: ClaimRow, scope: Scope): ShfClaim {
    const { openStatus, posted, ...rest } = row;
    const decide =
      row.status === "pending" &&
      !row.mine &&
      openStatus === "open" &&
      (scope === "manage" || (scope === "team" && posted));
    return {
      ...rest,
      canWithdraw: row.mine && row.status === "pending",
      canApprove: decide,
      canReject: decide,
    };
  }

  // ---- Helpers ----
  private async thisMonday(client: PoolClient) {
    return (
      await client.query<{ d: string }>(
        `SELECT ${day("shf_week_of(shf_today())")} AS d`,
      )
    ).rows[0]!.d;
  }
  private range(from: string, to: string) {
    if (dayMs(to) < dayMs(from))
      throw new BadRequestException("The end date is before the start date.");
    if ((dayMs(to) - dayMs(from)) / DAY_MS + 1 > SHF_MAX_RANGE_DAYS)
      throw new BadRequestException(
        `Choose up to ${SHF_MAX_RANGE_DAYS} days at a time.`,
      );
  }
  private monday(weekStart: string) {
    if (!isMonday(weekStart))
      throw new BadRequestException("A roster week starts on a Monday.");
  }
  private async lock(client: PoolClient, key: string, id: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1||':'||$2::text,0))",
      [key, id],
    );
  }
  // No FOR UPDATE: it would apply the update policy and hide rows the caller may only read.
  // Updates set version to the read version + 1, so the guards refuse a concurrent change.
  private async read(
    client: PoolClient,
    sql: string,
    id: string,
    version: number,
    what: string,
  ) {
    const found = await client.query<Locked>(sql, [id]);
    const row = found.rows[0];
    if (!row) throw unavailable(what);
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
            "A referenced template, shift or person is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "42501")
          throw new ForbiddenException(
            "Your current workspace cannot do that.",
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
