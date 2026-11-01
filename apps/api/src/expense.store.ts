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
  expenseCategoryListSchema,
  expenseCategorySchema,
  expenseClaimSchema,
  expenseListSchema,
  myExpensesSchema,
  type ExpenseCategory,
  type ExpenseCategoryList,
  type ExpenseClaim,
  type ExpenseList,
  type MyExpenses,
  type expenseApproveSchema,
  type expenseCancelSchema,
  type expenseCategoryCreateSchema,
  type expenseCategoryUpdateSchema,
  type expensePaySchema,
  type expenseQuerySchema,
  type expenseRejectSchema,
  type expenseSubmitSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const claimColumns = `c.id, c.employee_id AS "employeeId", coalesce(d.name,'Former employee') AS "employeeName",
  coalesce(d.code,'') AS "employeeCode", d.department, c.kind, c.title, c.category_id AS "categoryId",
  c.category_code AS "categoryCode", c.category_name AS "categoryName", c.amount_minor::float8 AS "amountMinor",
  c.currency, to_char(c.expense_date,'YYYY-MM-DD') AS "expenseDate", c.trip_destination AS "tripDestination",
  c.description, c.receipt_reference AS "receiptReference", c.status, c.decision_note AS "decisionNote",
  ${stamp("c.decided_at")} AS "decidedAt", c.decided_by_label AS "decidedBy",
  to_char(c.paid_on,'YYYY-MM-DD') AS "paidOn", c.payment_reference AS "paymentReference",
  ${stamp("c.paid_at")} AS "paidAt", c.paid_by_label AS "paidBy", ${stamp("c.cancelled_at")} AS "cancelledAt",
  c.version, c.submitted_by_label AS "submittedBy", ${stamp("c.created_at")} AS "createdAt"`;
const claimFrom = `FROM expense_claim c LEFT JOIN employee_directory d ON d.id=c.employee_id`;
const categoryColumns = `id, code, name, per_claim_limit_minor::float8 AS "perClaimLimitMinor",
  requires_receipt_over_minor::float8 AS "requiresReceiptOverMinor", active, version`;

const ruleErrors: Record<string, (message: string) => Error> = {
  EP003: (m) => new BadRequestException(m),
  EP004: (m) => new ConflictException(m),
  EP005: (m) => new ForbiddenException(m),
};
// Lock contention and serialization failures are retryable conflicts, not server errors.
const conflictCodes: Record<string, string> = {
  "40P01": "Someone else changed this at the same time. Try again.",
  "40001": "Someone else changed this at the same time. Try again.",
  "55P03": "Someone else changed this at the same time. Try again.",
};
const uniqueMessages: Record<string, string> = {
  expense_category_tenant_id_entity_id_code_key:
    "A category with this code already exists.",
};

type Row = Omit<ExpenseClaim, "canDecide" | "canPay" | "canCancel">;
type Locked = { employeeId: string; status: string; version: number };
type Status = "approved" | "rejected" | "paid" | "cancelled";

// Who may move a claim, the order of steps, the limits and the receipt rule all live in
// the database guards; the store only shapes requests and replies.
export class ExpenseStore {
  constructor(private readonly platform: PlatformStore) {}

  async mine(actor: Principal): Promise<MyExpenses> {
    this.platform.require(actor, "expense.self");
    return scoped(this.platform.pool, actor, (client) =>
      this.own(client, actor),
    );
  }

  submit(
    actor: Principal,
    input: z.infer<typeof expenseSubmitSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "expense.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO expense_claim(id,tenant_id,entity_id,employee_id,kind,title,category_id,amount_minor,
             expense_date,trip_destination,description,receipt_reference)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            input.kind,
            input.title,
            input.categoryId,
            input.amountMinor,
            input.expenseDate,
            input.tripDestination,
            input.description,
            input.receiptReference,
          ],
        );
        await audit(
          client,
          actor,
          "expense.submitted",
          `expense:${id}`,
          requestId,
          {
            details: {
              kind: input.kind,
              categoryId: input.categoryId,
              amountMinor: input.amountMinor,
            },
          },
        );
        await this.event(client, actor, id, 1, "expense.submitted.v1");
        return this.own(client, actor);
      }),
    );
  }

  cancelMine(
    actor: Principal,
    id: string,
    input: z.infer<typeof expenseCancelSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "expense.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, input.version);
        if (row.employeeId !== actor.employeeId)
          throw new NotFoundException("This expense claim is unavailable.");
        await this.move(client, actor, id, row, requestId, "cancelled", {});
        return this.own(client, actor);
      }),
    );
  }

  async categories(actor: Principal): Promise<ExpenseCategoryList> {
    const manage = Boolean(scopeFor(actor, "expense.manage"));
    // Any expense permission may read the categories.
    if (!manage && !scopeFor(actor, "expense.approve"))
      this.platform.require(actor, "expense.self");
    return scoped(this.platform.pool, actor, async (client) => {
      // Claimants and approvers see active categories; HR also sees retired ones.
      const { rows } = await client.query(
        `SELECT ${categoryColumns} FROM expense_category WHERE ($1 OR active) ORDER BY active DESC, name`,
        [manage],
      );
      return expenseCategoryListSchema.parse({ items: rows });
    });
  }

  createCategory(
    actor: Principal,
    input: z.infer<typeof expenseCategoryCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "expense.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO expense_category(id,tenant_id,entity_id,code,name,per_claim_limit_minor,requires_receipt_over_minor,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.code,
            input.name,
            input.perClaimLimitMinor,
            input.requiresReceiptOverMinor,
            input.active,
          ],
        );
        await audit(
          client,
          actor,
          "expense.category_created",
          `expense-category:${id}`,
          requestId,
          { details: { ...input } },
        );
        await this.event(client, actor, id, 1, "expense.category_created.v1");
        return this.category(client, id);
      }),
    );
  }

  updateCategory(
    actor: Principal,
    id: string,
    input: z.infer<typeof expenseCategoryUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "expense.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        // Same lock order as a submission (advisory lock, then the row), so the two never deadlock.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('expense-category:'||$1::text,0))",
          [id],
        );
        const found = await client.query<{ version: number }>(
          "SELECT version FROM expense_category WHERE id=$1 FOR UPDATE",
          [id],
        );
        const row = found.rows[0];
        if (!row)
          throw new NotFoundException("This expense category is unavailable.");
        if (row.version !== input.version)
          throw new ConflictException(
            "This category changed. Reload it before trying again.",
          );
        await client.query(
          `UPDATE expense_category SET name=$2, per_claim_limit_minor=$3, requires_receipt_over_minor=$4,
             active=$5, version=version+1 WHERE id=$1`,
          [
            id,
            input.name,
            input.perClaimLimitMinor,
            input.requiresReceiptOverMinor,
            input.active,
          ],
        );
        const details = { ...input, version: row.version + 1 };
        await audit(
          client,
          actor,
          "expense.category_updated",
          `expense-category:${id}`,
          requestId,
          { details },
        );
        await this.event(
          client,
          actor,
          id,
          row.version + 1,
          "expense.category_updated.v1",
        );
        return this.category(client, id);
      }),
    );
  }

  async list(
    actor: Principal,
    query: z.infer<typeof expenseQuerySchema>,
  ): Promise<ExpenseList> {
    this.platform.require(actor, "expense.approve");
    // A manager's own claims belong on their own page, not in their approval list;
    // row security limits a manager to their current reports.
    const team = scopeFor(actor, "expense.approve") === "team";
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await client.query<Row>(
        `SELECT ${claimColumns} ${claimFrom}
         WHERE ($1='%%' OR d.name ILIKE $1 OR d.code ILIKE $1 OR c.title ILIKE $1 OR c.category_name ILIKE $1)
           AND ($2::text IS NULL OR c.status=$2) AND (NOT $3 OR c.employee_id<>$4)
         ORDER BY (c.status IN ('submitted','approved')) DESC, c.created_at DESC LIMIT 200`,
        [term, query.status ?? null, team, actor.employeeId],
      );
      const counts = {
        submitted: 0,
        approved: 0,
        rejected: 0,
        paid: 0,
        cancelled: 0,
      };
      const totals = { submitted: 0, approved: 0 };
      for (const row of (
        await client.query<{
          status: keyof typeof counts;
          count: number;
          amount: number;
        }>(
          `SELECT status, count(*)::int AS count, sum(amount_minor)::float8 AS amount
           FROM expense_claim WHERE (NOT $1 OR employee_id<>$2) GROUP BY status`,
          [team, actor.employeeId],
        )
      ).rows) {
        counts[row.status] = row.count;
        if (row.status === "submitted" || row.status === "approved")
          totals[row.status] = row.amount;
      }
      return expenseListSchema.parse({
        items: rows.map((row) => this.flags(actor, row)),
        counts,
        awaitingDecisionMinor: totals.submitted,
        awaitingPaymentMinor: totals.approved,
      });
    });
  }

  async detail(actor: Principal, id: string): Promise<ExpenseClaim> {
    this.platform.require(actor, "expense.approve");
    return scoped(this.platform.pool, actor, (client) =>
      this.read(client, actor, id),
    );
  }

  approve(
    actor: Principal,
    id: string,
    input: z.infer<typeof expenseApproveSchema>,
    requestId: string,
  ) {
    return this.decide(actor, "expense.approve", id, input.version, requestId, {
      status: "approved",
      note: input.note ?? null,
    });
  }

  reject(
    actor: Principal,
    id: string,
    input: z.infer<typeof expenseRejectSchema>,
    requestId: string,
  ) {
    return this.decide(actor, "expense.approve", id, input.version, requestId, {
      status: "rejected",
      note: input.note,
    });
  }

  pay(
    actor: Principal,
    id: string,
    input: z.infer<typeof expensePaySchema>,
    requestId: string,
  ) {
    return this.decide(actor, "expense.manage", id, input.version, requestId, {
      status: "paid",
      paidOn: input.paidOn,
      paymentReference: input.paymentReference,
    });
  }

  private decide(
    actor: Principal,
    permission: "expense.approve" | "expense.manage",
    id: string,
    version: number,
    requestId: string,
    change: Change,
  ) {
    this.platform.require(actor, permission);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, version);
        await this.move(
          client,
          actor,
          id,
          row,
          requestId,
          change.status,
          change,
        );
        return this.read(client, actor, id);
      }),
    );
  }

  private async move(
    client: PoolClient,
    actor: Principal,
    id: string,
    row: Locked,
    requestId: string,
    status: Status,
    change: Partial<Change>,
  ) {
    await client.query(
      `UPDATE expense_claim SET status=$2, decision_note=coalesce($3,decision_note), paid_on=$4,
         payment_reference=$5, version=version+1 WHERE id=$1`,
      [
        id,
        status,
        change.note ?? null,
        change.paidOn ?? null,
        change.paymentReference ?? null,
      ],
    );
    await audit(
      client,
      actor,
      `expense.${status}`,
      `expense:${id}`,
      requestId,
      {
        reason: change.note ?? undefined,
        details: {
          employeeId: row.employeeId,
          from: row.status,
          ...(change.paidOn
            ? {
                paidOn: change.paidOn,
                paymentReference: change.paymentReference,
              }
            : {}),
        },
      },
    );
    await this.event(
      client,
      actor,
      id,
      row.version + 1,
      `expense.${status}.v1`,
    );
  }

  // Lock one claim and refuse a stale action before changing anything.
  private async locked(
    client: PoolClient,
    id: string,
    version: number,
  ): Promise<Locked> {
    const found = await client.query<Locked>(
      `SELECT employee_id AS "employeeId", status, version FROM expense_claim WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundException("This expense claim is unavailable.");
    if (row.version !== version)
      throw new ConflictException(
        "This expense claim changed. Reload it before trying again.",
      );
    return row;
  }

  private flags(actor: Principal, row: Row): ExpenseClaim {
    const own = row.employeeId === actor.employeeId;
    return expenseClaimSchema.parse({
      ...row,
      canDecide:
        row.status === "submitted" &&
        !own &&
        Boolean(scopeFor(actor, "expense.approve")),
      canPay:
        row.status === "approved" &&
        !own &&
        Boolean(scopeFor(actor, "expense.manage")),
      canCancel:
        row.status === "submitted" &&
        own &&
        Boolean(scopeFor(actor, "expense.self")),
    });
  }

  private async own(client: PoolClient, actor: Principal): Promise<MyExpenses> {
    const { rows } = await client.query<Row>(
      `SELECT ${claimColumns} ${claimFrom} WHERE c.employee_id=$1
       ORDER BY c.expense_date DESC, c.created_at DESC LIMIT 200`,
      [actor.employeeId],
    );
    const summary = Object.fromEntries(
      ["submitted", "approved", "paid", "rejected", "cancelled"].map((s) => [
        s,
        { count: 0, amountMinor: 0 },
      ]),
    ) as MyExpenses["summary"];
    for (const row of (
      await client.query<{
        status: keyof MyExpenses["summary"];
        count: number;
        amount: number;
      }>(
        `SELECT status, count(*)::int AS count, sum(amount_minor)::float8 AS amount
         FROM expense_claim WHERE employee_id=$1 GROUP BY status`,
        [actor.employeeId],
      )
    ).rows)
      summary[row.status] = { count: row.count, amountMinor: row.amount };
    const months = await client.query(
      `SELECT to_char(m,'YYYY-MM') AS month, count(c.id)::int AS count,
         coalesce(sum(c.amount_minor),0)::float8 AS "amountMinor"
       FROM generate_series(date_trunc('month',leave_entity_today()) - interval '11 months',
         date_trunc('month',leave_entity_today()), interval '1 month') m
       LEFT JOIN expense_claim c ON c.employee_id=$1 AND date_trunc('month',c.expense_date)=m
         AND c.status IN ('submitted','approved','paid')
       GROUP BY m ORDER BY m`,
      [actor.employeeId],
    );
    return myExpensesSchema.parse({
      items: rows.map((row) => this.flags(actor, row)),
      summary,
      months: months.rows,
    });
  }

  private async read(
    client: PoolClient,
    actor: Principal,
    id: string,
  ): Promise<ExpenseClaim> {
    const found = await client.query<Row>(
      `SELECT ${claimColumns} ${claimFrom} WHERE c.id=$1`,
      [id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This expense claim is unavailable.");
    return this.flags(actor, found.rows[0]);
  }

  private async category(
    client: PoolClient,
    id: string,
  ): Promise<ExpenseCategory> {
    const found = await client.query(
      `SELECT ${categoryColumns} FROM expense_category WHERE id=$1`,
      [id],
    );
    return expenseCategorySchema.parse(found.rows[0]);
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
        if (typeof code === "string" && code in conflictCodes)
          throw new ConflictException(conflictCodes[code]);
        if (code === "23503")
          throw new BadRequestException(
            "This expense category is unavailable.",
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

type Change = {
  status: Status;
  note?: string | null;
  paidOn?: string;
  paymentReference?: string;
};
