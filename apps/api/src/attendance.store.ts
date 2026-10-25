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
  attendanceCorrectionSchema,
  attendanceRecordSchema,
  type AttendanceCorrection,
  type AttendanceDay,
  type AttendanceOverview,
  type AttendanceRecord,
  type AttendanceTeam,
  type attendanceCorrectionCreateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const correctionColumns = `c.id, c.employee_id AS "employeeId", d.name AS "employeeName",
  d.initials, d.department, to_char(c.work_date,'YYYY-MM-DD') AS "workDate",
  to_char(c.check_in,'HH24:MI') AS "checkIn", to_char(c.check_out,'HH24:MI') AS "checkOut",
  c.reason, c.state, c.approver, c.manager_id AS "managerId", c.version,
  to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
  to_char(c.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt",
  c.decided_by_label AS "decidedBy", c.decision_note AS "decisionNote"`;
const correctionFrom = `FROM attendance_correction c
  JOIN employee_directory d ON d.id=c.employee_id`;
const recordColumns = `r.id, to_char(r.work_date,'YYYY-MM-DD') AS "workDate",
  to_char(r.check_in,'HH24:MI') AS "checkIn", to_char(r.check_out,'HH24:MI') AS "checkOut", r.version`;

type CorrectionRow = Omit<AttendanceCorrection, "canDecide" | "canCancel"> & {
  managerId: string | null;
};
type CorrectionState = "approved" | "rejected" | "cancelled";

// Database guards own punch stamping, correction routing and application.
// This store derives day status on read and commits audit and outbox records.
const ruleErrors: Record<string, (message: string) => Error> = {
  AT001: (m) => new ConflictException(m),
  AT003: (m) => new BadRequestException(m),
  AT004: (m) => new ConflictException(m),
  AT005: (m) => new ForbiddenException(m),
  AT006: (m) => new ForbiddenException(m),
  AT007: (m) => new ConflictException(m),
};

export class AttendanceStore {
  constructor(private readonly platform: PlatformStore) {}

  async overview(actor: Principal): Promise<AttendanceOverview> {
    this.platform.require(actor, "attendance.self");
    return scoped(this.platform.pool, actor, async (client) => {
      const { today, now } = await this.clock(client);
      const record = await this.todayRecord(client, actor, today);
      const days = await client.query<{
        date: string;
        dow: number;
        checkIn: string | null;
        checkOut: string | null;
        minutes: number | null;
        source: "web" | "correction" | null;
        leaveType: string | null;
        correctionPending: boolean;
      }>(
        `WITH days AS (
           SELECT d::date AS day FROM generate_series($2::date-29,$2::date,interval '1 day') d)
         SELECT to_char(days.day,'YYYY-MM-DD') AS date, extract(isodow FROM days.day)::int AS dow,
           to_char(r.check_in,'HH24:MI') AS "checkIn", to_char(r.check_out,'HH24:MI') AS "checkOut",
           CASE WHEN r.check_out IS NOT NULL
             THEN (extract(epoch FROM r.check_out-r.check_in)/60)::int END AS minutes,
           r.source,
           (SELECT t.name FROM leave_request l JOIN leave_type t ON t.id=l.leave_type_id
             WHERE l.employee_id=$1 AND l.state='approved'
               AND days.day BETWEEN l.start_date AND l.end_date LIMIT 1) AS "leaveType",
           EXISTS(SELECT 1 FROM attendance_correction c WHERE c.employee_id=$1
             AND c.work_date=days.day AND c.state='pending') AS "correctionPending"
         FROM days LEFT JOIN attendance_record r ON r.employee_id=$1 AND r.work_date=days.day
         ORDER BY days.day DESC`,
        [actor.employeeId, today],
      );
      const corrections = await client.query<CorrectionRow>(
        `SELECT ${correctionColumns} ${correctionFrom}
         WHERE c.employee_id=$1 ORDER BY c.created_at DESC LIMIT 30`,
        [actor.employeeId],
      );
      return {
        today,
        now,
        record,
        days: days.rows.map(({ dow, ...day }) => ({
          ...day,
          status: this.status(day, dow, today),
        })),
        corrections: corrections.rows.map((row) => this.present(actor, row)),
      };
    });
  }

  async team(actor: Principal): Promise<AttendanceTeam> {
    this.platform.require(actor, "attendance.review");
    return scoped(this.platform.pool, actor, async (client) => {
      const { today } = await this.clock(client);
      const weekend = [0, 6].includes(
        new Date(`${today}T00:00:00Z`).getUTCDay(),
      );
      const people = await client.query<{
        employeeId: string;
        name: string;
        initials: string;
        department: string;
        checkIn: string | null;
        checkOut: string | null;
        onLeave: boolean;
      }>(
        `SELECT d.id AS "employeeId", d.name, d.initials, d.department,
           to_char(r.check_in,'HH24:MI') AS "checkIn", to_char(r.check_out,'HH24:MI') AS "checkOut",
           EXISTS(SELECT 1 FROM leave_request l WHERE l.employee_id=d.id AND l.state='approved'
             AND $2::date BETWEEN l.start_date AND l.end_date) AS "onLeave"
         FROM employee_directory d
         LEFT JOIN attendance_record r ON r.employee_id=d.id AND r.work_date=$2
         WHERE d.id<>$1 AND d.status IN ('active','notice')
         ORDER BY d.name, d.id`,
        [actor.employeeId, today],
      );
      const pending = await client.query<CorrectionRow>(
        `SELECT ${correctionColumns} ${correctionFrom}
         WHERE c.state='pending' AND c.employee_id<>$1
         ORDER BY c.work_date, c.created_at LIMIT 100`,
        [actor.employeeId],
      );
      const decided = await client.query<CorrectionRow>(
        `SELECT ${correctionColumns} ${correctionFrom}
         WHERE c.state<>'pending' AND c.employee_id<>$1
         ORDER BY c.decided_at DESC LIMIT 20`,
        [actor.employeeId],
      );
      return {
        date: today,
        people: people.rows.map(({ onLeave, ...person }) => ({
          ...person,
          status: this.presence(person, onLeave, weekend),
        })),
        pending: pending.rows.map((row) => this.present(actor, row)),
        decided: decided.rows.map((row) => this.present(actor, row)),
      };
    });
  }

  async checkIn(
    actor: Principal,
    requestId: string,
  ): Promise<AttendanceRecord> {
    this.platform.require(actor, "attendance.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        // The guard stamps date and time from the server clock; placeholders are overwritten.
        await client.query(
          `INSERT INTO attendance_record(id,tenant_id,entity_id,employee_id,work_date,check_in,source,version)
           VALUES ($1,$2,$3,$4,CURRENT_DATE,'00:00','web',1)`,
          [id, actor.tenantId, actor.entityId, actor.employeeId],
        );
        const record = await this.readRecord(client, id);
        await audit(
          client,
          actor,
          "attendance.checked_in",
          `attendance:${id}:v1`,
          requestId,
          { details: { after: record } },
        );
        await this.event(client, actor, id, 1, "attendance.checked_in.v1");
        return record;
      }),
    );
  }

  async checkOut(
    actor: Principal,
    version: number,
    requestId: string,
  ): Promise<AttendanceRecord> {
    this.platform.require(actor, "attendance.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const { today } = await this.clock(client);
        const locked = await client.query<{ id: string; version: number }>(
          `SELECT id, version FROM attendance_record
           WHERE employee_id=$1 AND work_date=$2 FOR UPDATE`,
          [actor.employeeId, today],
        );
        const row = locked.rows[0];
        if (!row) throw new NotFoundException("Check in before checking out.");
        if (row.version !== version)
          throw new ConflictException(
            "Your attendance changed. Reload before trying again.",
          );
        const previous = await this.readRecord(client, row.id);
        await client.query(
          "UPDATE attendance_record SET check_out=check_in, version=version+1 WHERE id=$1",
          [row.id],
        );
        const record = await this.readRecord(client, row.id);
        await audit(
          client,
          actor,
          "attendance.checked_out",
          `attendance:${row.id}:v${record.version}`,
          requestId,
          { details: { before: previous, after: record } },
        );
        await this.event(
          client,
          actor,
          row.id,
          record.version,
          "attendance.checked_out.v1",
        );
        return record;
      }),
    );
  }

  async requestCorrection(
    actor: Principal,
    input: z.infer<typeof attendanceCorrectionCreateSchema>,
    requestId: string,
  ): Promise<AttendanceCorrection> {
    this.platform.require(actor, "attendance.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO attendance_correction(id,tenant_id,entity_id,employee_id,work_date,
             check_in,check_out,reason,state,approver,version,requested_by_actor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','hr',1,$9)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            input.workDate,
            input.checkIn,
            input.checkOut,
            input.reason,
            actor.actorId,
          ],
        );
        const item = await this.readCorrection(client, actor, id);
        await audit(
          client,
          actor,
          "attendance.correction_requested",
          `attendance-correction:${id}:v1`,
          requestId,
          { details: { after: this.snapshot(item) } },
        );
        await this.event(
          client,
          actor,
          id,
          1,
          "attendance.correction_requested.v1",
        );
        return item;
      }),
    );
  }

  cancelCorrection(
    actor: Principal,
    id: string,
    version: number,
    requestId: string,
  ) {
    this.platform.require(actor, "attendance.self");
    return this.transition(actor, id, version, requestId, "cancelled", null);
  }

  decideCorrection(
    actor: Principal,
    id: string,
    input: {
      version: number;
      decision: "approve" | "reject";
      note: string | null;
    },
    requestId: string,
  ) {
    this.platform.require(actor, "attendance.review");
    return this.transition(
      actor,
      id,
      input.version,
      requestId,
      input.decision === "approve" ? "approved" : "rejected",
      input.note,
    );
  }

  private transition(
    actor: Principal,
    id: string,
    version: number,
    requestId: string,
    state: CorrectionState,
    note: string | null,
  ): Promise<AttendanceCorrection> {
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const locked = await client.query(
          "SELECT id FROM attendance_correction WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!locked.rows[0])
          throw new NotFoundException("This correction is unavailable.");
        const previous = await this.readCorrection(client, actor, id);
        if (previous.version !== version)
          throw new ConflictException(
            "This correction changed. Reload it before trying again.",
          );
        await client.query(
          "UPDATE attendance_correction SET state=$2, version=version+1, decision_note=$3 WHERE id=$1",
          [id, state, note],
        );
        const item = await this.readCorrection(client, actor, id);
        await audit(
          client,
          actor,
          `attendance.correction_${state}`,
          `attendance-correction:${id}:v${item.version}`,
          requestId,
          {
            reason: note ?? undefined,
            details: {
              before: this.snapshot(previous),
              after: this.snapshot(item),
            },
          },
        );
        await this.event(
          client,
          actor,
          id,
          item.version,
          `attendance.correction_${state}.v1`,
        );
        return item;
      }),
    );
  }

  private status(
    day: {
      date: string;
      checkIn: string | null;
      checkOut: string | null;
      leaveType: string | null;
    },
    dow: number,
    today: string,
  ): AttendanceDay["status"] {
    if (day.checkOut) return "present";
    if (day.checkIn) return day.date === today ? "in_progress" : "incomplete";
    if (day.leaveType) return "leave";
    if (dow >= 6) return "weekend";
    return day.date === today ? "not_started" : "unaccounted";
  }

  private presence(
    person: { checkIn: string | null; checkOut: string | null },
    onLeave: boolean,
    weekend: boolean,
  ): AttendanceTeam["people"][number]["status"] {
    if (person.checkOut) return "done";
    if (person.checkIn) return "in";
    if (onLeave) return "leave";
    return weekend ? "weekend" : "not_in";
  }

  private async clock(client: PoolClient) {
    const { rows } = await client.query<{ today: string; now: string }>(
      `SELECT to_char(attendance_entity_now(),'YYYY-MM-DD') AS today,
         to_char(attendance_entity_now(),'HH24:MI') AS now`,
    );
    return rows[0]!;
  }

  private async todayRecord(
    client: PoolClient,
    actor: Principal,
    today: string,
  ) {
    const { rows } = await client.query(
      `SELECT ${recordColumns} FROM attendance_record r WHERE r.employee_id=$1 AND r.work_date=$2`,
      [actor.employeeId, today],
    );
    return rows[0] ? attendanceRecordSchema.parse(rows[0]) : null;
  }

  private async readRecord(client: PoolClient, id: string) {
    const { rows } = await client.query(
      `SELECT ${recordColumns} FROM attendance_record r WHERE r.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This attendance record is unavailable.");
    return attendanceRecordSchema.parse(rows[0]);
  }

  private async readCorrection(
    client: PoolClient,
    actor: Principal,
    id: string,
  ) {
    const { rows } = await client.query<CorrectionRow>(
      `SELECT ${correctionColumns} ${correctionFrom} WHERE c.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This correction is unavailable.");
    return this.present(actor, rows[0]);
  }

  private present(actor: Principal, row: CorrectionRow): AttendanceCorrection {
    const { managerId, ...rest } = row;
    const mine = row.employeeId === actor.employeeId;
    const review = scopeFor(actor, "attendance.review");
    return attendanceCorrectionSchema.parse({
      ...rest,
      canCancel:
        mine &&
        row.state === "pending" &&
        Boolean(scopeFor(actor, "attendance.self")),
      canDecide:
        !mine &&
        row.state === "pending" &&
        ((row.approver === "manager" &&
          review === "team" &&
          managerId === actor.employeeId) ||
          (row.approver === "hr" && review === "entity")),
    });
  }

  private snapshot(item: AttendanceCorrection) {
    const { id, employeeId, workDate, checkIn, checkOut, state, version } =
      item;
    return { id, employeeId, workDate, checkIn, checkOut, state, version };
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
        if (error.code === "23505")
          throw new ConflictException(
            "constraint" in error &&
              error.constraint === "attendance_correction_pending_key"
              ? "A correction for this day is already awaiting a decision."
              : "You have already checked in today.",
          );
        if (
          typeof error.code === "string" &&
          error.code in ruleErrors &&
          "message" in error &&
          typeof error.message === "string"
        )
          throw ruleErrors[error.code]!(`${error.message}.`);
      }
      throw error;
    }
  }
}
