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
  myProfileSchema,
  profileApplyDueResultSchema,
  profileChangeRequestSchema,
  profileEmployeeSchema,
  profileHistorySchema,
  profileRequestListSchema,
  type MyProfile,
  type ProfileApplyDueResult,
  type ProfileChangeRequest,
  type ProfileDetails,
  type ProfileEmployee,
  type ProfileField,
  type ProfileHistory,
  type ProfileHistoryEntry,
  type ProfileRequestList,
  type profileApproveSchema,
  type profileCancelSchema,
  type profileRejectSchema,
  type profileRequestQuerySchema,
  type profileSubmitSchema,
  type profileWithdrawSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";
import { openValue, profileKey, sealValue } from "./profile.crypto";

// API field -> database column. The database only ever holds sealed values.
const columns: Record<ProfileField, string> = {
  personalPhone: "personal_phone",
  personalEmail: "personal_email",
  emergencyName: "emergency_name",
  emergencyPhone: "emergency_phone",
  emergencyRelationship: "emergency_relationship",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "address_city",
  postalCode: "address_postal_code",
};
const fieldOf = Object.fromEntries(
  Object.entries(columns).map(([field, column]) => [column, field]),
) as Record<string, ProfileField>;

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const requestColumns = `r.id, r.employee_id AS "employeeId", coalesce(d.name,'Former employee') AS "employeeName",
  coalesce(d.code,'') AS "employeeCode", r.changes, r.reason, to_char(r.effective_on,'YYYY-MM-DD') AS "effectiveOn",
  r.status, r.decision_note AS "decisionNote", ${stamp("r.decided_at")} AS "decidedAt",
  r.decided_by_label AS "decidedBy", ${stamp("r.applied_at")} AS "appliedAt",
  ${stamp("r.withdrawn_at")} AS "withdrawnAt", r.withdrawn_by_label AS "withdrawnBy",
  r.submitted_by_label AS "submittedBy", (r.effective_on>leave_entity_today()) AS "notDue",
  ${stamp("r.created_at")} AS "createdAt", r.version`;
const requestFrom = `FROM profile_change_request r LEFT JOIN employee_directory d ON d.id=r.employee_id`;
const historyColumns = `h.id, h.request_id AS "requestId", h.employee_id AS "employeeId", h.field,
  h.old_value AS "oldValue", h.new_value AS "newValue", to_char(h.effective_on,'YYYY-MM-DD') AS "effectiveOn",
  ${stamp("h.applied_at")} AS "appliedAt", h.approved_by_label AS "approvedBy"`;

const ruleErrors: Record<string, (message: string) => Error> = {
  PF003: (m) => new BadRequestException(m),
  PF004: (m) => new ConflictException(m),
  PF005: (m) => new ForbiddenException(m),
};
const conflictCodes: Record<string, string> = {
  "40P01": "Someone else changed this at the same time. Try again.",
  "40001": "Someone else changed this at the same time. Try again.",
  "55P03": "Someone else changed this at the same time. Try again.",
};
const uniqueMessages: Record<string, string> = {
  profile_change_request_open_idx:
    "You already have a profile change waiting. Withdraw it or wait until it is applied.",
};

type Sealed = { field: string; value: string | null };
type RequestRow = Omit<
  ProfileChangeRequest,
  "fields" | "changes" | "canDecide" | "canWithdraw" | "canCancel"
> & { changes: Sealed[]; notDue: boolean };
type HistoryRow = Omit<ProfileHistoryEntry, "field"> & {
  field: string;
  employeeId: string;
};
type Locked = {
  employeeId: string;
  status: string;
  version: number;
  changes: Sealed[];
  effectiveOn: string;
};

// Who may submit, decide, withdraw or apply, the effective-date window and the single writer
// of the profile and its history all live in the database (034); this store seals values,
// shapes replies and records audit and outbox rows that name fields but never values.
export class ProfileStore {
  constructor(private readonly platform: PlatformStore) {}

  private get key() {
    return profileKey(this.platform.config);
  }

  // Reading your own profile also applies your approved change once its date has come.
  mine(actor: Principal, requestId: string): Promise<MyProfile> {
    this.platform.require(actor, "profile.self");
    const key = this.key;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.applyDue(client, actor, requestId, actor.employeeId, "read");
        return this.own(client, actor, key);
      }),
    );
  }

  history(actor: Principal): Promise<ProfileHistory> {
    this.platform.require(actor, "profile.self");
    const key = this.key;
    return scoped(this.platform.pool, actor, async (client) =>
      profileHistorySchema.parse({
        items: await this.historyFor(client, key, actor.employeeId, 200),
      }),
    );
  }

  submit(
    actor: Principal,
    input: z.infer<typeof profileSubmitSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "profile.self");
    const key = this.key;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        const sealed = input.changes.map((change) => {
          const column = columns[change.field];
          return {
            field: column,
            value:
              change.value === null
                ? null
                : sealValue(key, actor.employeeId, column, change.value),
          };
        });
        await client.query(
          `INSERT INTO profile_change_request(id,tenant_id,entity_id,employee_id,changes,reason,effective_on)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            JSON.stringify(sealed),
            input.reason,
            input.effectiveOn,
          ],
        );
        await audit(
          client,
          actor,
          "profile.change_submitted",
          `profile-change:${id}`,
          requestId,
          {
            details: {
              employeeId: actor.employeeId,
              fields: input.changes.map((c) => c.field),
              effectiveOn: input.effectiveOn,
            },
          },
        );
        await this.event(client, actor, id, 1, "profile.change_submitted.v1");
        return this.own(client, actor, key);
      }),
    );
  }

  withdraw(
    actor: Principal,
    id: string,
    input: z.infer<typeof profileWithdrawSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "profile.self");
    const key = this.key;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, input.version);
        if (row.employeeId !== actor.employeeId)
          throw new NotFoundException("This profile change is unavailable.");
        await client.query(
          "UPDATE profile_change_request SET status='withdrawn', version=version+1 WHERE id=$1",
          [id],
        );
        await this.record(
          client,
          actor,
          id,
          row,
          requestId,
          "withdrawn",
          row.version + 1,
        );
        return this.own(client, actor, key);
      }),
    );
  }

  // HR list: names, fields and dates only; values are never in list payloads.
  async list(
    actor: Principal,
    query: z.infer<typeof profileRequestQuerySchema>,
  ): Promise<ProfileRequestList> {
    this.platform.require(actor, "profile.review");
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await client.query<RequestRow>(
        `SELECT ${requestColumns} ${requestFrom}
         WHERE ($1='%%' OR d.name ILIKE $1 OR d.code ILIKE $1) AND ($2::text IS NULL OR r.status=$2)
         ORDER BY (r.status IN ('submitted','approved')) DESC, r.created_at DESC LIMIT 200`,
        [term, query.status ?? null],
      );
      const counts = {
        submitted: 0,
        approved: 0,
        rejected: 0,
        withdrawn: 0,
        applied: 0,
      };
      for (const row of (
        await client.query<{ status: keyof typeof counts; count: number }>(
          "SELECT status, count(*)::int AS count FROM profile_change_request GROUP BY status",
        )
      ).rows)
        counts[row.status] = row.count;
      return profileRequestListSchema.parse({
        items: rows.map((row) => this.shape(actor, row, null)),
        counts,
      });
    });
  }

  // HR detail shows the requested values, so the read itself is audited.
  detail(
    actor: Principal,
    id: string,
    requestId: string,
  ): Promise<ProfileChangeRequest> {
    this.platform.require(actor, "profile.review");
    const key = this.key;
    return scoped(this.platform.pool, actor, async (client) => {
      const row = await this.readRequest(client, id);
      await audit(
        client,
        actor,
        "profile.change_viewed",
        `profile-change:${id}`,
        requestId,
        {
          details: {
            employeeId: row.employeeId,
            fields: this.fields(row.changes),
          },
        },
      );
      return this.shape(actor, row, key);
    });
  }

  approve(
    actor: Principal,
    id: string,
    input: z.infer<typeof profileApproveSchema>,
    requestId: string,
  ) {
    return this.decide(
      actor,
      id,
      input.version,
      "approved",
      input.note ?? null,
      requestId,
    );
  }

  reject(
    actor: Principal,
    id: string,
    input: z.infer<typeof profileRejectSchema>,
    requestId: string,
  ) {
    return this.decide(
      actor,
      id,
      input.version,
      "rejected",
      input.note,
      requestId,
    );
  }

  // HR cancels an approved change before it is due (the request ends as withdrawn).
  cancel(
    actor: Principal,
    id: string,
    input: z.infer<typeof profileCancelSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "profile.review");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, input.version);
        await client.query(
          "UPDATE profile_change_request SET status='withdrawn', decision_note=$2, version=version+1 WHERE id=$1",
          [id, input.note],
        );
        await this.record(
          client,
          actor,
          id,
          row,
          requestId,
          "cancelled",
          row.version + 1,
        );
        return this.shape(actor, await this.readRequest(client, id), null);
      }),
    );
  }

  // Idempotent: applies every approved change whose date has come; a second run finds none.
  applyDueAll(
    actor: Principal,
    requestId: string,
  ): Promise<ProfileApplyDueResult> {
    this.platform.require(actor, "profile.review");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) =>
        profileApplyDueResultSchema.parse({
          applied: await this.applyDue(
            client,
            actor,
            requestId,
            null,
            "apply-due",
          ),
        }),
      ),
    );
  }

  // HR reads one employee's personal details: audited, and due changes apply first.
  employee(
    actor: Principal,
    employeeId: string,
    requestId: string,
  ): Promise<ProfileEmployee> {
    this.platform.require(actor, "profile.review");
    const key = this.key;
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<{
          id: string;
          name: string;
          code: string;
        }>("SELECT id, name, code FROM employee_directory WHERE id=$1", [
          employeeId,
        ]);
        const person = found.rows[0];
        if (!person)
          throw new NotFoundException("This employee is unavailable.");
        await this.applyDue(client, actor, requestId, employeeId, "read");
        const open = await this.openFor(client, employeeId);
        await audit(
          client,
          actor,
          "profile.viewed",
          `employee:${employeeId}`,
          requestId,
          { details: { employeeId } },
        );
        return profileEmployeeSchema.parse({
          employee: person,
          profile: await this.profileFor(client, key, employeeId),
          open: open ? this.shape(actor, open, key) : null,
          history: await this.historyFor(client, key, employeeId, 50),
        });
      }),
    );
  }

  private decide(
    actor: Principal,
    id: string,
    version: number,
    status: "approved" | "rejected",
    note: string | null,
    requestId: string,
  ) {
    this.platform.require(actor, "profile.review");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, id, version);
        const updated = await client.query<{ status: string }>(
          `UPDATE profile_change_request SET status=$2, decision_note=coalesce($3,decision_note),
             version=version+1 WHERE id=$1 RETURNING status`,
          [id, status, note],
        );
        await this.record(
          client,
          actor,
          id,
          row,
          requestId,
          status,
          row.version + 1,
        );
        // A change due today applies in the same transaction (the guard moves it to applied).
        if (updated.rows[0]?.status === "applied")
          await this.record(
            client,
            actor,
            id,
            row,
            requestId,
            "applied",
            row.version + 1,
          );
        // The reply leaves values out; HR reads them through the audited detail view.
        return this.shape(actor, await this.readRequest(client, id), null);
      }),
    );
  }

  // Apply approved changes that are due. Same lock order everywhere: the employee's advisory
  // lock, then the request row; a request someone else already applied is skipped.
  private async applyDue(
    client: PoolClient,
    actor: Principal,
    requestId: string,
    employeeId: string | null,
    via: "read" | "apply-due",
  ) {
    const due = await client.query<{ id: string; employeeId: string }>(
      `SELECT id, employee_id AS "employeeId" FROM profile_change_request
       WHERE status='approved' AND effective_on<=leave_entity_today() AND ($1::uuid IS NULL OR employee_id=$1)
       ORDER BY employee_id, effective_on, created_at LIMIT 200`,
      [employeeId],
    );
    let applied = 0;
    for (const item of due.rows) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('profile:'||$1::text,0))",
        [item.employeeId],
      );
      const found = await client.query<Locked>(
        `SELECT employee_id AS "employeeId", status, version, changes, to_char(effective_on,'YYYY-MM-DD') AS "effectiveOn"
         FROM profile_change_request WHERE id=$1 FOR UPDATE`,
        [item.id],
      );
      const row = found.rows[0];
      if (!row || row.status !== "approved") continue;
      const result = await client.query(
        "UPDATE profile_change_request SET status='applied', version=version+1 WHERE id=$1 AND version=$2",
        [item.id, row.version],
      );
      if (!result.rowCount) continue;
      await this.record(
        client,
        actor,
        item.id,
        row,
        requestId,
        "applied",
        row.version + 1,
        via,
      );
      applied += 1;
    }
    return applied;
  }

  private async record(
    client: PoolClient,
    actor: Principal,
    id: string,
    row: Locked,
    requestId: string,
    status: "approved" | "rejected" | "withdrawn" | "cancelled" | "applied",
    version: number,
    via?: "read" | "apply-due",
  ) {
    // Field names and dates only: never values, reasons or notes (they may hold personal data).
    await audit(
      client,
      actor,
      `profile.change_${status}`,
      `profile-change:${id}`,
      requestId,
      {
        details: {
          employeeId: row.employeeId,
          from: row.status,
          fields: this.fields(row.changes),
          effectiveOn: row.effectiveOn,
          ...(via ? { via } : {}),
        },
      },
    );
    await this.event(client, actor, id, version, `profile.change_${status}.v1`);
  }

  private async locked(
    client: PoolClient,
    id: string,
    version: number,
  ): Promise<Locked> {
    const owner = await client.query<{ employeeId: string }>(
      `SELECT employee_id AS "employeeId" FROM profile_change_request WHERE id=$1`,
      [id],
    );
    if (!owner.rows[0])
      throw new NotFoundException("This profile change is unavailable.");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('profile:'||$1::text,0))",
      [owner.rows[0].employeeId],
    );
    const found = await client.query<Locked>(
      `SELECT employee_id AS "employeeId", status, version, changes, to_char(effective_on,'YYYY-MM-DD') AS "effectiveOn"
       FROM profile_change_request WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0];
    if (!row)
      throw new NotFoundException("This profile change is unavailable.");
    if (row.version !== version)
      throw new ConflictException(
        "This profile change changed. Reload it before trying again.",
      );
    return row;
  }

  private fields(changes: Sealed[]): ProfileField[] {
    return changes.map((change) => fieldOf[change.field]!);
  }

  // key=null masks values, the reason and the decision note (list-style payloads).
  private shape(
    actor: Principal,
    row: RequestRow,
    key: Buffer | null,
  ): ProfileChangeRequest {
    const own = row.employeeId === actor.employeeId;
    const { notDue, ...rest } = row;
    const pending = row.status === "approved" && notDue;
    return profileChangeRequestSchema.parse({
      ...rest,
      reason: key ? row.reason : null,
      decisionNote: key ? row.decisionNote : null,
      fields: this.fields(row.changes),
      changes: key
        ? row.changes.map((change) => {
            const opened = this.open(
              key,
              row.employeeId,
              change.field,
              change.value,
              `profile-change:${row.id}`,
            );
            return {
              field: fieldOf[change.field],
              value: opened.value,
              unavailable: opened.unavailable,
            };
          })
        : null,
      canDecide:
        row.status === "submitted" &&
        !own &&
        Boolean(scopeFor(actor, "profile.review")),
      canWithdraw:
        (row.status === "submitted" || pending) &&
        own &&
        Boolean(scopeFor(actor, "profile.self")),
      canCancel: pending && !own && Boolean(scopeFor(actor, "profile.review")),
    });
  }

  // A value that cannot be opened (wrong key, tampering) is reported as unavailable instead of
  // failing the whole page; only the record and field are logged, never the value.
  private open(
    key: Buffer,
    employeeId: string,
    column: string,
    sealed: string | null,
    record: string,
  ): { value: string | null; unavailable: boolean } {
    try {
      return {
        value: openValue(key, employeeId, column, sealed),
        unavailable: false,
      };
    } catch {
      console.warn(
        JSON.stringify({
          event: "profile.value_unavailable",
          record,
          field: fieldOf[column] ?? "unknown",
        }),
      );
      return { value: null, unavailable: true };
    }
  }

  private async readRequest(client: PoolClient, id: string) {
    const found = await client.query<RequestRow>(
      `SELECT ${requestColumns} ${requestFrom} WHERE r.id=$1`,
      [id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This profile change is unavailable.");
    return found.rows[0];
  }

  private async openFor(client: PoolClient, employeeId: string) {
    const found = await client.query<RequestRow>(
      `SELECT ${requestColumns} ${requestFrom}
       WHERE r.employee_id=$1 AND r.status IN ('submitted','approved') LIMIT 1`,
      [employeeId],
    );
    return found.rows[0] ?? null;
  }

  private async profileFor(
    client: PoolClient,
    key: Buffer,
    employeeId: string,
  ): Promise<ProfileDetails> {
    const found = await client.query<Record<string, string | number | null>>(
      `SELECT ${Object.values(columns).join(",")}, version, ${stamp("updated_at")} AS "updatedAt",
         updated_by_label AS "updatedBy"
       FROM employee_profile WHERE employee_id=$1`,
      [employeeId],
    );
    const row = found.rows[0];
    const details: Record<string, unknown> = {
      employeeId,
      version: row ? row.version : 0,
      updatedAt: row ? row.updatedAt : null,
      updatedBy: row ? row.updatedBy : null,
    };
    const unavailable: ProfileField[] = [];
    for (const [field, column] of Object.entries(columns)) {
      const opened = row
        ? this.open(
            key,
            employeeId,
            column,
            row[column] as string | null,
            `profile:${employeeId}`,
          )
        : { value: null, unavailable: false };
      details[field] = opened.value;
      if (opened.unavailable) unavailable.push(field as ProfileField);
    }
    details.unavailable = unavailable;
    return details as ProfileDetails;
  }

  private async historyFor(
    client: PoolClient,
    key: Buffer,
    employeeId: string,
    limit: number,
  ): Promise<ProfileHistoryEntry[]> {
    const { rows } = await client.query<HistoryRow>(
      `SELECT ${historyColumns} FROM profile_change_history h WHERE h.employee_id=$1
       ORDER BY h.applied_at DESC, h.field LIMIT $2`,
      [employeeId, limit],
    );
    return rows.map((row) => {
      const record = `profile-history:${row.id}`;
      const before = this.open(
        key,
        row.employeeId,
        row.field,
        row.oldValue,
        record,
      );
      const after = this.open(
        key,
        row.employeeId,
        row.field,
        row.newValue,
        record,
      );
      return {
        id: row.id,
        requestId: row.requestId,
        field: fieldOf[row.field]!,
        oldValue: before.value,
        newValue: after.value,
        effectiveOn: row.effectiveOn,
        appliedAt: row.appliedAt,
        approvedBy: row.approvedBy,
        unavailable: before.unavailable || after.unavailable,
      };
    });
  }

  private async own(
    client: PoolClient,
    actor: Principal,
    key: Buffer,
  ): Promise<MyProfile> {
    const open = await this.openFor(client, actor.employeeId);
    const requests = await client.query<RequestRow>(
      `SELECT ${requestColumns} ${requestFrom} WHERE r.employee_id=$1 ORDER BY r.created_at DESC LIMIT 20`,
      [actor.employeeId],
    );
    return myProfileSchema.parse({
      profile: await this.profileFor(client, key, actor.employeeId),
      open: open ? this.shape(actor, open, key) : null,
      requests: requests.rows.map((row) => this.shape(actor, row, key)),
      history: await this.historyFor(client, key, actor.employeeId, 20),
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
        if (typeof code === "string" && code in conflictCodes)
          throw new ConflictException(conflictCodes[code]);
        // Constraint and reference failures come from bad input, not server faults.
        if (code === "23514" || code === "23503")
          throw new BadRequestException(
            "This profile change does not meet the rules.",
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
