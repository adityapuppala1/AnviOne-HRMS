import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import { scopeFor, type Principal } from "@anvi/authz";
import {
  holidaySchema,
  type Calendar,
  type Holiday,
  type PersonalCalendar,
  type holidayCreateSchema,
  type holidayUpdateSchema,
  type workWeekUpdateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const holidayColumns = `h.id, to_char(h.holiday_date,'YYYY-MM-DD') AS date, h.name,
  h.location_id AS "locationId", l.name AS "locationName", h.active, h.version`;
const holidayFrom = `FROM holiday h LEFT JOIN org_unit l
  ON l.tenant_id=h.tenant_id AND l.entity_id=h.entity_id AND l.kind='location' AND l.id=h.location_id`;
// Entity-wide holidays and those for the actor's own work location.
const appliesToMe = `(h.location_id IS NULL OR h.location_id=(
  SELECT e.location_id FROM employee e WHERE e.id=nullif(current_setting('app.employee_id',true),'')::uuid))`;

// The work week and holidays that apply to the current actor between two dates.
// Leave and attendance read this inside their own scoped transaction.
export async function personalCalendar(
  client: PoolClient,
  from: string,
  to: string,
): Promise<PersonalCalendar> {
  const week = await client.query<{ days: number[] }>(
    "SELECT days FROM work_week",
  );
  const holidays = await client.query<{ date: string; name: string }>(
    `SELECT to_char(h.holiday_date,'YYYY-MM-DD') AS date, h.name FROM holiday h
     WHERE h.active AND h.holiday_date BETWEEN $1 AND $2 AND ${appliesToMe}
     ORDER BY h.holiday_date`,
    [from, to],
  );
  return {
    workDays: week.rows[0]?.days ?? [1, 2, 3, 4, 5],
    holidays: holidays.rows,
  };
}

// HR maintains the calendar through the organization write scope; every
// workspace reads its own entity's calendar.
export class CalendarStore {
  constructor(private readonly platform: PlatformStore) {}

  async view(actor: Principal, requestedYear?: number): Promise<Calendar> {
    return scoped(this.platform.pool, actor, async (client) => {
      const today = (
        await client.query<{ today: string }>(
          "SELECT to_char(leave_entity_today(),'YYYY-MM-DD') AS today",
        )
      ).rows[0]!.today;
      const year = requestedYear ?? Number(today.slice(0, 4));
      const canManage = Boolean(scopeFor(actor, "organization.write"));
      const week = await client.query<{ days: number[]; version: number }>(
        "SELECT days, version FROM work_week",
      );
      const holidays = await client.query<Holiday>(
        `SELECT ${holidayColumns} ${holidayFrom}
         WHERE date_part('year',h.holiday_date)=$1 AND (h.active OR $2)
         ORDER BY h.holiday_date, l.name NULLS FIRST`,
        [year, canManage],
      );
      const next = await client.query<Holiday>(
        `SELECT ${holidayColumns} ${holidayFrom}
         WHERE h.active AND h.holiday_date>=$1 AND ${appliesToMe}
         ORDER BY h.holiday_date LIMIT 1`,
        [today],
      );
      const locations = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM org_unit WHERE kind='location' AND active ORDER BY name",
      );
      return {
        year,
        today,
        workWeek: week.rows[0] ?? { days: [1, 2, 3, 4, 5], version: 1 },
        holidays: holidays.rows.map((h) => holidaySchema.parse(h)),
        locations: locations.rows,
        next: next.rows[0] ? holidaySchema.parse(next.rows[0]) : null,
        canManage,
      };
    });
  }

  async createHoliday(
    actor: Principal,
    input: z.infer<typeof holidayCreateSchema>,
    requestId: string,
  ): Promise<Holiday> {
    this.platform.require(actor, "organization.write");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO holiday(id,tenant_id,entity_id,location_id,holiday_date,name)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.locationId,
            input.date,
            input.name,
          ],
        );
        const item = await this.read(client, id);
        await audit(
          client,
          actor,
          "calendar.holiday_created",
          `holiday:${id}:v1`,
          requestId,
          { reason: input.reason, details: { after: item } },
        );
        await this.event(client, actor, id, 1, "calendar.holiday_created.v1");
        return item;
      }),
    );
  }

  async updateHoliday(
    actor: Principal,
    id: string,
    input: z.infer<typeof holidayUpdateSchema>,
    requestId: string,
  ): Promise<Holiday> {
    this.platform.require(actor, "organization.write");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const locked = await client.query(
          "SELECT id FROM holiday WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!locked.rows[0])
          throw new NotFoundException("This holiday is unavailable.");
        const previous = await this.read(client, id);
        if (previous.version !== input.version)
          throw new ConflictException(
            "This holiday changed. Reload it before saving again.",
          );
        if (previous.name === input.name && previous.active === input.active)
          return previous;
        await client.query(
          "UPDATE holiday SET name=$2, active=$3, version=version+1 WHERE id=$1",
          [id, input.name, input.active],
        );
        const item = await this.read(client, id);
        await audit(
          client,
          actor,
          "calendar.holiday_updated",
          `holiday:${id}:v${item.version}`,
          requestId,
          { reason: input.reason, details: { before: previous, after: item } },
        );
        await this.event(
          client,
          actor,
          id,
          item.version,
          "calendar.holiday_updated.v1",
        );
        return item;
      }),
    );
  }

  async updateWorkWeek(
    actor: Principal,
    input: z.infer<typeof workWeekUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "organization.write");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const previous = await client.query<{
          days: number[];
          version: number;
        }>("SELECT days, version FROM work_week FOR UPDATE");
        const before = previous.rows[0];
        if (!before)
          throw new NotFoundException("The work week is unavailable.");
        if (before.version !== input.version)
          throw new ConflictException(
            "The work week changed. Reload it before saving again.",
          );
        const updated = await client.query<{ days: number[]; version: number }>(
          "UPDATE work_week SET days=$1::smallint[], version=version+1 RETURNING days, version",
          [input.days],
        );
        const after = updated.rows[0]!;
        await audit(
          client,
          actor,
          "calendar.work_week_updated",
          `work-week:${actor.entityId}:v${after.version}`,
          requestId,
          { reason: input.reason, details: { before, after } },
        );
        await this.event(
          client,
          actor,
          actor.entityId,
          after.version,
          "calendar.work_week_updated.v1",
        );
        return after;
      }),
    );
  }

  private async read(client: PoolClient, id: string) {
    const { rows } = await client.query<Holiday>(
      `SELECT ${holidayColumns} ${holidayFrom} WHERE h.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This holiday is unavailable.");
    return holidaySchema.parse(rows[0]);
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
            "There is already an active holiday on that date for this location.",
          );
        if (error.code === "23503")
          throw new BadRequestException("Choose an existing work location.");
        if (error.code === "CL003")
          throw new BadRequestException("Choose an active work location.");
        if (
          error.code === "CL004" &&
          "message" in error &&
          typeof error.message === "string"
        )
          throw new ConflictException(`${error.message}.`);
      }
      throw error;
    }
  }
}
