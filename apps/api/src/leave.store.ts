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
  leaveRequestSchema,
  type LeaveApprovals,
  type LeaveOverview,
  type LeaveRequest,
  type leaveCancelSchema,
  type leaveDecisionSchema,
  type leaveRequestCreateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const requestColumns = `r.id, r.employee_id AS "employeeId", d.name AS "employeeName",
  d.initials, d.department, t.code AS "typeCode", t.name AS "typeName",
  to_char(r.start_date,'YYYY-MM-DD') AS "startDate", to_char(r.end_date,'YYYY-MM-DD') AS "endDate",
  r.days::float8 AS days, r.reason, r.state, r.approver, r.manager_id AS "managerId", r.version,
  to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
  to_char(r.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt",
  r.decided_by_label AS "decidedBy", r.decision_note AS "decisionNote"`;
const requestFrom = `FROM leave_request r
  JOIN employee_directory d ON d.id=r.employee_id
  JOIN leave_type t ON t.tenant_id=r.tenant_id AND t.entity_id=r.entity_id AND t.id=r.leave_type_id`;

type RequestRow = Omit<
  LeaveRequest,
  "leaveType" | "canDecide" | "canCancel"
> & { typeCode: string; typeName: string; managerId: string | null };

// Database guards own the leave rules (self-only requests, routing, overlap,
// balance, transitions, ledger). This store maps their outcomes to HTTP and
// commits audit and outbox records in the same transaction.
const ruleErrors: Record<string, (message: string) => Error> = {
  LV001: (m) => new ConflictException(m),
  LV002: (m) => new ConflictException(m),
  LV003: (m) => new BadRequestException(m),
  LV004: (m) => new ConflictException(m),
  LV005: (m) => new ForbiddenException(m),
  LV006: (m) => new ForbiddenException(m),
  LV007: (m) => new ConflictException(m),
};

export class LeaveStore {
  constructor(private readonly platform: PlatformStore) {}

  async overview(actor: Principal): Promise<LeaveOverview> {
    this.platform.require(actor, "leave.request");
    return scoped(this.platform.pool, actor, async (client) => {
      const today = await this.today(client);
      const year = Number(today.slice(0, 4));
      const balances = await client.query<{
        id: string;
        code: string;
        name: string;
        paid: boolean;
        annualDays: number | null;
        used: number;
        pending: number;
      }>(
        `SELECT t.id, t.code, t.name, t.paid, t.annual_days::float8 AS "annualDays",
          coalesce((SELECT sum(CASE WHEN l.kind='debit' THEN l.days ELSE -l.days END)
            FROM leave_ledger l WHERE l.employee_id=$1 AND l.leave_type_id=t.id
              AND l.leave_year=$2),0)::float8 AS used,
          coalesce((SELECT sum(r.days) FROM leave_request r
            WHERE r.employee_id=$1 AND r.leave_type_id=t.id AND r.state='pending'
              AND date_part('year',r.start_date)=$2),0)::float8 AS pending
        FROM leave_type t WHERE t.active
        ORDER BY t.annual_days IS NULL, t.annual_days DESC, t.code`,
        [actor.employeeId, year],
      );
      const requests = await client.query<RequestRow>(
        `SELECT ${requestColumns} ${requestFrom}
         WHERE r.employee_id=$1 ORDER BY r.start_date DESC, r.created_at DESC LIMIT 50`,
        [actor.employeeId],
      );
      return {
        year,
        today,
        balances: balances.rows.map((b) => ({
          ...b,
          available:
            b.annualDays === null ? null : b.annualDays - b.used - b.pending,
        })),
        requests: requests.rows.map((row) => this.present(actor, row, today)),
      };
    });
  }

  async approvals(actor: Principal): Promise<LeaveApprovals> {
    this.platform.require(actor, "leave.approve");
    return scoped(this.platform.pool, actor, async (client) => {
      const today = await this.today(client);
      const pending = await client.query<RequestRow>(
        `SELECT ${requestColumns} ${requestFrom}
         WHERE r.state='pending' AND r.employee_id<>$1
         ORDER BY r.start_date, r.created_at LIMIT 100`,
        [actor.employeeId],
      );
      const decided = await client.query<RequestRow>(
        `SELECT ${requestColumns} ${requestFrom}
         WHERE r.state<>'pending' AND r.employee_id<>$1
         ORDER BY r.decided_at DESC LIMIT 20`,
        [actor.employeeId],
      );
      return {
        pending: pending.rows.map((row) => this.present(actor, row, today)),
        decided: decided.rows.map((row) => this.present(actor, row, today)),
      };
    });
  }

  async create(
    actor: Principal,
    input: z.infer<typeof leaveRequestCreateSchema>,
    requestId: string,
  ): Promise<LeaveRequest> {
    this.platform.require(actor, "leave.request");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        // The guard derives days, routing, state and version; placeholders are overwritten.
        await client.query(
          `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,
            start_date,end_date,reason,days,state,approver,version,requested_by_actor)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,'pending','hr',1,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            input.leaveTypeId,
            input.startDate,
            input.endDate,
            input.reason,
            actor.actorId,
          ],
        );
        const item = await this.read(client, actor, id);
        await audit(
          client,
          actor,
          "leave.requested",
          `leave:${id}:v1`,
          requestId,
          { details: { after: this.snapshot(item) } },
        );
        await this.event(client, actor, item, "leave.requested.v1");
        return item;
      }),
    );
  }

  async cancel(
    actor: Principal,
    id: string,
    input: z.infer<typeof leaveCancelSchema>,
    requestId: string,
  ): Promise<LeaveRequest> {
    this.platform.require(actor, "leave.request");
    return this.transition(actor, id, input.version, requestId, {
      state: "cancelled",
      note: null,
      action: "leave.cancelled",
      event: "leave.cancelled.v1",
    });
  }

  async decide(
    actor: Principal,
    id: string,
    input: z.infer<typeof leaveDecisionSchema>,
    requestId: string,
  ): Promise<LeaveRequest> {
    this.platform.require(actor, "leave.approve");
    const approved = input.decision === "approve";
    return this.transition(actor, id, input.version, requestId, {
      state: approved ? "approved" : "rejected",
      note: input.note,
      action: approved ? "leave.approved" : "leave.rejected",
      event: approved ? "leave.approved.v1" : "leave.rejected.v1",
    });
  }

  private transition(
    actor: Principal,
    id: string,
    version: number,
    requestId: string,
    change: {
      state: string;
      note: string | null;
      action: string;
      event: string;
    },
  ) {
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const locked = await client.query(
          "SELECT id FROM leave_request WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!locked.rows[0])
          throw new NotFoundException("This leave request is unavailable.");
        const previous = await this.read(client, actor, id);
        if (previous.version !== version)
          throw new ConflictException(
            "This request changed. Reload it before trying again.",
          );
        await client.query(
          "UPDATE leave_request SET state=$2, version=version+1, decision_note=$3 WHERE id=$1",
          [id, change.state, change.note],
        );
        const item = await this.read(client, actor, id);
        await audit(
          client,
          actor,
          change.action,
          `leave:${id}:v${item.version}`,
          requestId,
          {
            reason: change.note ?? undefined,
            details: {
              before: this.snapshot(previous),
              after: this.snapshot(item),
            },
          },
        );
        await this.event(client, actor, item, change.event);
        return item;
      }),
    );
  }

  private async today(client: PoolClient) {
    const { rows } = await client.query<{ today: string }>(
      "SELECT to_char(leave_entity_today(),'YYYY-MM-DD') AS today",
    );
    return rows[0]!.today;
  }

  private async read(client: PoolClient, actor: Principal, id: string) {
    const { rows } = await client.query<RequestRow>(
      `SELECT ${requestColumns} ${requestFrom} WHERE r.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This leave request is unavailable.");
    return this.present(actor, rows[0], await this.today(client));
  }

  private present(
    actor: Principal,
    row: RequestRow,
    today: string,
  ): LeaveRequest {
    const { typeCode, typeName, managerId, ...rest } = row;
    const mine = row.employeeId === actor.employeeId;
    const approve = scopeFor(actor, "leave.approve");
    return leaveRequestSchema.parse({
      ...rest,
      leaveType: { code: typeCode, name: typeName },
      canCancel:
        mine &&
        Boolean(scopeFor(actor, "leave.request")) &&
        (row.state === "pending" ||
          (row.state === "approved" && row.startDate > today)),
      canDecide:
        !mine &&
        row.state === "pending" &&
        ((row.approver === "manager" &&
          approve === "team" &&
          managerId === actor.employeeId) ||
          (row.approver === "hr" && approve === "entity")),
    });
  }

  private snapshot(item: LeaveRequest) {
    const { id, employeeId, leaveType, startDate, endDate, days, state } = item;
    return {
      id,
      employeeId,
      type: leaveType.code,
      startDate,
      endDate,
      days,
      state,
      version: item.version,
    };
  }

  private async event(
    client: PoolClient,
    actor: Principal,
    item: LeaveRequest,
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
        item.id,
        item.version,
      ],
    );
  }

  private async rules<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code in ruleErrors &&
        "message" in error &&
        typeof error.message === "string"
      ) {
        throw ruleErrors[error.code]!(`${error.message}.`);
      }
      throw error;
    }
  }
}
