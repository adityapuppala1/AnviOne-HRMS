import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import {
  organizationUnitSchema,
  type OrganizationDirectory,
  type OrganizationUnit,
  type organizationCreateSchema,
  type organizationUpdateSchema,
  type organizationQuerySchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { Principal } from "@anvi/authz";
import type { PlatformStore, SessionActor } from "./platform.store";

const columns = `u.id, u.kind, u.code, u.name, u.active, u.version,
  (SELECT count(*)::int FROM employee e
    WHERE e.tenant_id = u.tenant_id AND e.entity_id = u.entity_id
      AND e.status IN ('active','notice')
      AND CASE WHEN u.kind = 'department' THEN e.department_id = u.id ELSE e.location_id = u.id END
  ) AS "employeeCount"`;

// This module owns the master lifecycle transaction: version check, mutation,
// mandatory reason, audit snapshot and outbox are one commit.
export class OrganizationStore {
  constructor(private readonly platform: PlatformStore) {}

  async list(
    actor: SessionActor,
    query: z.infer<typeof organizationQuerySchema>,
  ): Promise<OrganizationDirectory> {
    this.platform.require(actor, "organization.read");
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const where = `u.kind = $1 AND (u.name ILIKE $2 OR u.code ILIKE $2)`;
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM org_unit u WHERE ${where}`,
        [query.kind, term],
      );
      const total = count.rows[0]!.count;
      const pages = Math.max(1, Math.ceil(total / query.limit));
      const page = Math.min(query.page, pages);
      const { rows } = await client.query(
        `SELECT ${columns} FROM org_unit u WHERE ${where}
         ORDER BY u.active DESC, u.name, u.id LIMIT $3 OFFSET $4`,
        [query.kind, term, query.limit, (page - 1) * query.limit],
      );
      return {
        entityName: actor.entityName,
        items: rows.map((row) => organizationUnitSchema.parse(row)),
        total,
        page,
        pages,
      };
    });
  }

  async create(
    actor: Principal,
    input: z.infer<typeof organizationCreateSchema>,
    requestId: string,
  ): Promise<OrganizationUnit> {
    this.platform.require(actor, "organization.write");
    return this.mapConflict(async () =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name)
         VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.kind,
            input.code,
            input.name,
          ],
        );
        const item = await this.readUnit(client, id);
        await audit(
          client,
          actor,
          "organization.created",
          `organization:${id}:v1`,
          requestId,
          {
            reason: input.reason,
            details: { after: this.snapshot(item) },
          },
        );
        await this.event(client, actor, item, "organization.created.v1");
        return item;
      }),
    );
  }

  async update(
    actor: Principal,
    id: string,
    input: z.infer<typeof organizationUpdateSchema>,
    requestId: string,
  ): Promise<OrganizationUnit> {
    this.platform.require(actor, "organization.write");
    return this.mapConflict(async () =>
      scoped(this.platform.pool, actor, async (client) => {
        const locked = await client.query(
          "SELECT id FROM org_unit WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!locked.rows[0])
          throw new NotFoundException(
            "This organization record is unavailable.",
          );
        const previous = await this.readUnit(client, id);
        if (previous.version !== input.version) {
          throw new ConflictException(
            "This record changed. Reload it before saving again.",
          );
        }
        // A replay with unchanged values creates no second version or domain event.
        if (previous.name === input.name && previous.active === input.active)
          return previous;
        await client.query(
          "UPDATE org_unit SET name=$2, active=$3, version=version+1 WHERE id=$1",
          [id, input.name, input.active],
        );
        const item = await this.readUnit(client, id);
        await audit(
          client,
          actor,
          "organization.updated",
          `organization:${id}:v${item.version}`,
          requestId,
          {
            reason: input.reason,
            details: {
              before: this.snapshot(previous),
              after: this.snapshot(item),
            },
          },
        );
        await this.event(client, actor, item, "organization.updated.v1");
        return item;
      }),
    );
  }

  private async readUnit(
    client: PoolClient,
    id: string,
  ): Promise<OrganizationUnit> {
    const { rows } = await client.query(
      `SELECT ${columns} FROM org_unit u WHERE u.id=$1`,
      [id],
    );
    if (!rows[0])
      throw new NotFoundException("This organization record is unavailable.");
    return organizationUnitSchema.parse(rows[0]);
  }

  private snapshot(item: OrganizationUnit) {
    const { id, kind, code, name, active, version } = item;
    return { id, kind, code, name, active, version };
  }

  private async event(
    client: PoolClient,
    actor: Principal,
    item: OrganizationUnit,
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

  private async mapConflict<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new ConflictException(
          "A record with that code or name already exists in this entity.",
        );
      }
      throw error;
    }
  }
}
