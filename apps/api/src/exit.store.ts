import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import type { Principal } from "@anvi/authz";
import {
  exitCaseSchema,
  exitClearanceItemSchema,
  exitClearanceSchema,
  exitDetailSchema,
  exitListSchema,
  myExitSchema,
  type ExitCase,
  type ExitDetail,
  type ExitList,
  type MyExit,
  type exitAcceptSchema,
  type exitClearanceUpdateSchema,
  type exitCompleteSchema,
  type exitQuerySchema,
  type exitRejectSchema,
  type exitStartSchema,
  type exitSubmitSchema,
  type exitWithdrawSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const caseColumns = `c.id, c.employee_id AS "employeeId", coalesce(d.name,'Former employee') AS "employeeName",
  coalesce(d.code,'') AS "employeeCode", d.department, c.kind, c.reason,
  to_char(c.notice_given_on,'YYYY-MM-DD') AS "noticeGivenOn", to_char(c.last_working_day,'YYYY-MM-DD') AS "lastWorkingDay",
  c.status, c.decision_note AS "decisionNote", c.version, c.submitted_by_label AS "submittedBy",
  ${stamp("c.created_at")} AS "createdAt", ${stamp("c.decided_at")} AS "decidedAt", c.decided_by_label AS "decidedBy",
  ${stamp("c.closed_at")} AS "closedAt", c.closed_by_label AS "closedBy"`;
const caseFrom = `FROM exit_case c LEFT JOIN employee_directory d ON d.id=c.employee_id`;

const ruleErrors: Record<string, (message: string) => Error> = {
  EX003: (m) => new BadRequestException(m),
  EX004: (m) => new ConflictException(m),
  EX005: (m) => new ForbiddenException(m),
};
const uniqueMessages: Record<string, string> = {
  exit_case_one_open: "This person already has an open exit case.",
  exit_clearance_case_id_item_key: "This case already has its clearances.",
};

type Locked = { employeeId: string; status: string; version: number };

// Who may move a case, the order of steps, the clearance rules and the employee's
// status all live in the database guards; the store only shapes requests and replies.
export class ExitStore {
  constructor(private readonly platform: PlatformStore) {}

  async mine(actor: Principal): Promise<MyExit> {
    this.platform.require(actor, "exit.self");
    return scoped(this.platform.pool, actor, (client) =>
      this.own(client, actor),
    );
  }

  submit(
    actor: Principal,
    input: z.infer<typeof exitSubmitSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "exit.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = await this.insert(client, actor, {
          employeeId: actor.employeeId,
          kind: "resignation",
          reason: input.reason,
          noticeGivenOn: null,
        });
        await audit(client, actor, "exit.submitted", `exit:${id}`, requestId, {
          details: { kind: "resignation" },
        });
        await this.event(client, actor, id, 1, "exit.submitted.v1");
        return this.own(client, actor);
      }),
    );
  }

  withdrawMine(
    actor: Principal,
    id: string,
    input: z.infer<typeof exitWithdrawSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "exit.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, input.version);
        if (row.employeeId !== actor.employeeId)
          throw new NotFoundException("This exit case is unavailable.");
        await this.move(client, actor, id, row, requestId, "withdrawn", {
          note: input.note ?? null,
        });
        return this.own(client, actor);
      }),
    );
  }

  async list(
    actor: Principal,
    query: z.infer<typeof exitQuerySchema>,
  ): Promise<ExitList> {
    this.platform.require(actor, "exit.manage");
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await client.query(
        `SELECT ${caseColumns} ${caseFrom}
         WHERE ($1='%%' OR d.name ILIKE $1 OR d.code ILIKE $1 OR c.reason ILIKE $1)
           AND ($2::text IS NULL OR c.status=$2)
         ORDER BY (c.status IN ('submitted','accepted')) DESC, c.created_at DESC LIMIT 200`,
        [term, query.status ?? null],
      );
      const counts = {
        submitted: 0,
        accepted: 0,
        completed: 0,
        withdrawn: 0,
        rejected: 0,
      };
      for (const row of (
        await client.query<{ status: keyof typeof counts; count: number }>(
          "SELECT status, count(*)::int AS count FROM exit_case GROUP BY status",
        )
      ).rows)
        counts[row.status] = row.count;
      return exitListSchema.parse({ items: rows, counts });
    });
  }

  async detail(actor: Principal, id: string): Promise<ExitDetail> {
    this.platform.require(actor, "exit.manage");
    return scoped(this.platform.pool, actor, (client) => this.read(client, id));
  }

  start(
    actor: Principal,
    input: z.infer<typeof exitStartSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "exit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = await this.insert(client, actor, input);
        await audit(client, actor, "exit.submitted", `exit:${id}`, requestId, {
          details: { kind: input.kind, employeeId: input.employeeId },
        });
        await this.event(client, actor, id, 1, "exit.submitted.v1");
        return this.read(client, id);
      }),
    );
  }

  accept(
    actor: Principal,
    id: string,
    input: z.infer<typeof exitAcceptSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "exit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, input.version);
        await this.move(client, actor, id, row, requestId, "accepted", {
          note: input.note ?? null,
          lastWorkingDay: input.lastWorkingDay,
        });
        // The checklist is created with the decision, in the same transaction.
        for (const item of exitClearanceItemSchema.options)
          await client.query(
            `INSERT INTO exit_clearance(id,tenant_id,entity_id,case_id,item) VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), actor.tenantId, actor.entityId, id, item],
          );
        return this.read(client, id);
      }),
    );
  }

  reject(
    actor: Principal,
    id: string,
    input: z.infer<typeof exitRejectSchema>,
    requestId: string,
  ) {
    return this.decide(actor, id, input.version, requestId, "rejected", {
      note: input.note,
    });
  }

  withdraw(
    actor: Principal,
    id: string,
    input: z.infer<typeof exitWithdrawSchema>,
    requestId: string,
  ) {
    return this.decide(actor, id, input.version, requestId, "withdrawn", {
      note: input.note ?? null,
    });
  }

  complete(
    actor: Principal,
    id: string,
    input: z.infer<typeof exitCompleteSchema>,
    requestId: string,
  ) {
    return this.decide(actor, id, input.version, requestId, "completed", {
      note: input.earlyRelease ? (input.note ?? null) : null,
      earlyRelease: input.earlyRelease === true,
    });
  }

  updateClearance(
    actor: Principal,
    id: string,
    clearanceId: string,
    input: z.infer<typeof exitClearanceUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "exit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<{ item: string; version: number }>(
          `SELECT item, version FROM exit_clearance WHERE id=$1 AND case_id=$2 FOR UPDATE`,
          [clearanceId, id],
        );
        const row = found.rows[0];
        if (!row) throw new NotFoundException("This clearance is unavailable.");
        if (row.version !== input.version)
          throw new ConflictException(
            "This clearance changed. Reload it before trying again.",
          );
        await client.query(
          "UPDATE exit_clearance SET status=$2, note=$3, version=version+1 WHERE id=$1",
          [clearanceId, input.status, input.note],
        );
        await audit(
          client,
          actor,
          "exit.clearance_updated",
          `exit:${id}`,
          requestId,
          {
            reason: input.note ?? undefined,
            details: { clearanceId, item: row.item, status: input.status },
          },
        );
        await this.event(
          client,
          actor,
          clearanceId,
          row.version + 1,
          "exit.clearance_updated.v1",
        );
        return this.read(client, id);
      }),
    );
  }

  private decide(
    actor: Principal,
    id: string,
    version: number,
    requestId: string,
    status: "rejected" | "withdrawn" | "completed",
    change: { note?: string | null; earlyRelease?: boolean },
  ) {
    this.platform.require(actor, "exit.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, version);
        // Read by the database guard; only HR reaches this path and the guard.
        if (change.earlyRelease)
          await client.query(
            "SELECT set_config('app.exit_early_release','on',true)",
          );
        await this.move(client, actor, id, row, requestId, status, change);
        return this.read(client, id);
      }),
    );
  }

  private async move(
    client: PoolClient,
    actor: Principal,
    id: string,
    row: Locked,
    requestId: string,
    status: "accepted" | "rejected" | "withdrawn" | "completed",
    change: {
      note?: string | null;
      lastWorkingDay?: string;
      earlyRelease?: boolean;
    },
  ) {
    await client.query(
      `UPDATE exit_case SET status=$2, decision_note=$3,
         last_working_day=coalesce($4::date,last_working_day), version=version+1 WHERE id=$1`,
      [id, status, change.note ?? null, change.lastWorkingDay ?? null],
    );
    await audit(client, actor, `exit.${status}`, `exit:${id}`, requestId, {
      reason: change.note ?? undefined,
      details: {
        employeeId: row.employeeId,
        from: row.status,
        ...(change.earlyRelease ? { earlyRelease: true } : {}),
        ...(change.lastWorkingDay
          ? { lastWorkingDay: change.lastWorkingDay }
          : {}),
      },
    });
    await this.event(client, actor, id, row.version + 1, `exit.${status}.v1`);
  }

  private async insert(
    client: PoolClient,
    actor: Principal,
    input: {
      employeeId: string;
      kind: string;
      reason: string;
      noticeGivenOn: string | null;
    },
  ) {
    const id = randomUUID();
    // An employee's notice date is set by the database to today.
    await client.query(
      `INSERT INTO exit_case(id,tenant_id,entity_id,employee_id,kind,reason,notice_given_on)
       VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date,leave_entity_today()))`,
      [
        id,
        actor.tenantId,
        actor.entityId,
        input.employeeId,
        input.kind,
        input.reason,
        input.noticeGivenOn,
      ],
    );
    return id;
  }

  // Lock one case and refuse a stale action before changing anything.
  private async locked(
    client: PoolClient,
    id: string,
    version: number,
  ): Promise<Locked> {
    const found = await client.query<Locked>(
      `SELECT employee_id AS "employeeId", status, version FROM exit_case WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundException("This exit case is unavailable.");
    if (row.version !== version)
      throw new ConflictException(
        "This exit case changed. Reload it before trying again.",
      );
    return row;
  }

  private async own(client: PoolClient, actor: Principal): Promise<MyExit> {
    const { rows } = await client.query<ExitCase>(
      `SELECT ${caseColumns} ${caseFrom} WHERE c.employee_id=$1 ORDER BY c.created_at DESC LIMIT 50`,
      [actor.employeeId],
    );
    const open = rows.find((r) => ["submitted", "accepted"].includes(r.status));
    return myExitSchema.parse({
      current: open ? await this.read(client, open.id) : null,
      history: rows.filter((r) => r !== open),
    });
  }

  private async read(client: PoolClient, id: string): Promise<ExitDetail> {
    const found = await client.query(
      `SELECT ${caseColumns} ${caseFrom} WHERE c.id=$1`,
      [id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This exit case is unavailable.");
    const exitCase = exitCaseSchema.parse(found.rows[0]);
    const clearances = await client.query(
      `SELECT id, item, status, note, cleared_by_label AS "clearedBy", ${stamp("cleared_at")} AS "clearedAt", version
       FROM exit_clearance WHERE case_id=$1
       ORDER BY array_position(ARRAY['assets','finance','it_access','manager_handover','hr_documents'], item)`,
      [id],
    );
    const assets = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM asset_assignment WHERE employee_id=$1 AND returned_on IS NULL`,
      [exitCase.employeeId],
    );
    return exitDetailSchema.parse({
      case: exitCase,
      clearances: clearances.rows.map((row) => exitClearanceSchema.parse(row)),
      openAssets: assets.rows[0]!.n,
    });
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
        const code = error.code;
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
