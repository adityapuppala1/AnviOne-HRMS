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
  assetDetailSchema,
  assetListSchema,
  assetSchema,
  myAssetsSchema,
  type Asset,
  type AssetDetail,
  type AssetList,
  type MyAssets,
  type assetAcknowledgeSchema,
  type assetCreateSchema,
  type assetIssueSchema,
  type assetQuerySchema,
  type assetReturnSchema,
  type assetStatusChangeSchema,
  type assetUpdateSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const columns = `a.id, a.tag, a.category, a.name, a.serial_number AS "serialNumber", a.condition, a.status,
  a.version, ${stamp("a.updated_at")} AS "updatedAt", a.custodian_id AS "custodianId",
  d.name AS "custodianName", d.initials AS "custodianInitials",
  to_char(s.issued_on,'YYYY-MM-DD') AS "issuedOn", ${stamp("s.acknowledged_at")} AS "acknowledgedAt"`;
const from = `FROM asset a LEFT JOIN employee_directory d ON d.id=a.custodian_id
  LEFT JOIN asset_assignment s ON s.asset_id=a.id AND s.returned_on IS NULL`;
const mineSql = `SELECT s.id AS "assignmentId", s.version, s.asset_tag AS tag, s.asset_category AS category,
    s.asset_name AS name, s.asset_serial AS "serialNumber", to_char(s.issued_on,'YYYY-MM-DD') AS "issuedOn",
    s.issue_condition AS "issueCondition", s.issued_by_label AS "issuedBy",
    ${stamp("s.acknowledged_at")} AS "acknowledgedAt",
    to_char(s.returned_on,'YYYY-MM-DD') AS "returnedOn", s.return_condition AS "returnCondition"
  FROM asset_assignment s WHERE s.employee_id=$1
  ORDER BY (s.returned_on IS NOT NULL), s.issued_on DESC, s.created_at DESC LIMIT 60`;

type Row = Omit<Asset, "custodian"> & {
  custodianId: string | null;
  custodianName: string | null;
  custodianInitials: string | null;
};

const ruleErrors: Record<string, (message: string) => Error> = {
  AS003: (m) => new BadRequestException(m),
  AS004: (m) => new ConflictException(m),
  AS005: (m) => new ForbiddenException(m),
};

// Every rule that matters lives in the database guards (asset and assignment
// transitions, who may act, immutable history). This class sequences the steps,
// checks versions and writes audit and outbox rows in the same transaction.
export class AssetStore {
  constructor(private readonly platform: PlatformStore) {}

  async mine(actor: Principal): Promise<MyAssets> {
    this.platform.require(actor, "asset.self");
    return scoped(this.platform.pool, actor, (client) =>
      this.holdings(client, actor),
    );
  }

  async list(
    actor: Principal,
    query: z.infer<typeof assetQuerySchema>,
  ): Promise<AssetList> {
    this.platform.require(actor, "asset.manage");
    return scoped(this.platform.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const where = `(a.tag ILIKE $1 OR a.name ILIKE $1 OR a.serial_number ILIKE $1 OR d.name ILIKE $1)
        AND ($2='' OR a.status=$2) AND ($3='' OR a.category=$3)`;
      const params = [term, query.status, query.category];
      const total = Number(
        (
          await client.query<{ count: string }>(
            `SELECT count(*) ${from} WHERE ${where}`,
            params,
          )
        ).rows[0]!.count,
      );
      const pages = Math.max(1, Math.ceil(total / query.limit));
      const page = Math.min(query.page, pages);
      const { rows } = await client.query<Row>(
        `SELECT ${columns} ${from} WHERE ${where} ORDER BY a.tag LIMIT $4 OFFSET $5`,
        [...params, query.limit, (page - 1) * query.limit],
      );
      const tally = await client.query<{ status: string; count: number }>(
        "SELECT status, count(*)::int AS count FROM asset GROUP BY status",
      );
      const counts = {
        available: 0,
        assigned: 0,
        in_repair: 0,
        retired: 0,
        lost: 0,
      };
      for (const row of tally.rows)
        counts[row.status as keyof typeof counts] = row.count;
      return assetListSchema.parse({
        items: rows.map((row) => this.present(row)),
        total,
        page,
        pages,
        counts,
      });
    });
  }

  async detail(actor: Principal, id: string): Promise<AssetDetail> {
    this.platform.require(actor, "asset.manage");
    return scoped(this.platform.pool, actor, (client) => this.read(client, id));
  }

  create(
    actor: Principal,
    input: z.infer<typeof assetCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "asset.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO asset(id,tenant_id,entity_id,tag,category,name,serial_number,condition,status,version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'available',1)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.tag,
            input.category,
            input.name,
            input.serialNumber,
            input.condition,
          ],
        );
        const detail = await this.read(client, id);
        await this.record(
          client,
          actor,
          "asset.registered",
          detail.asset,
          requestId,
          { after: this.snapshot(detail.asset) },
        );
        return detail;
      }),
    );
  }

  update(
    actor: Principal,
    id: string,
    input: z.infer<typeof assetUpdateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "asset.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const before = (await this.locked(client, id, input.version)).asset;
        await client.query(
          `UPDATE asset SET name=$2, serial_number=$3, condition=$4, version=version+1 WHERE id=$1`,
          [id, input.name, input.serialNumber, input.condition],
        );
        const detail = await this.read(client, id);
        await this.record(
          client,
          actor,
          "asset.updated",
          detail.asset,
          requestId,
          {
            reason: input.reason,
            before: this.snapshot(before),
            after: this.snapshot(detail.asset),
          },
        );
        return detail;
      }),
    );
  }

  issue(
    actor: Principal,
    id: string,
    input: z.infer<typeof assetIssueSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "asset.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const before = (await this.locked(client, id, input.version)).asset;
        const issuedOn = input.issuedOn ?? (await this.today(client));
        await client.query(
          `INSERT INTO asset_assignment(id,tenant_id,entity_id,asset_id,employee_id,issued_on,issue_condition,issued_by_label,version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)`,
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            id,
            input.employeeId,
            issuedOn,
            before.condition,
            actor.name,
          ],
        );
        await client.query(
          "UPDATE asset SET status='assigned', custodian_id=$2, version=version+1 WHERE id=$1",
          [id, input.employeeId],
        );
        const detail = await this.read(client, id);
        await this.record(
          client,
          actor,
          "asset.issued",
          detail.asset,
          requestId,
          {
            before: this.snapshot(before),
            after: this.snapshot(detail.asset),
          },
        );
        return detail;
      }),
    );
  }

  receive(
    actor: Principal,
    id: string,
    input: z.infer<typeof assetReturnSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "asset.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const before = (await this.locked(client, id, input.version)).asset;
        const today = await this.today(client);
        const closed = await client.query(
          `UPDATE asset_assignment SET returned_on=$2, return_condition=$3, return_note=$4, version=version+1
           WHERE asset_id=$1 AND returned_on IS NULL`,
          [id, today, input.condition, input.note ?? null],
        );
        if (closed.rowCount !== 1)
          throw new ConflictException("This asset is not currently issued.");
        await client.query(
          `UPDATE asset SET status=$2, condition=$3, version=version+1 WHERE id=$1`,
          [
            id,
            input.condition === "damaged" ? "in_repair" : "available",
            input.condition,
          ],
        );
        const detail = await this.read(client, id);
        await this.record(
          client,
          actor,
          "asset.returned",
          detail.asset,
          requestId,
          {
            reason: input.note,
            before: this.snapshot(before),
            after: this.snapshot(detail.asset),
          },
        );
        return detail;
      }),
    );
  }

  changeStatus(
    actor: Principal,
    id: string,
    input: z.infer<typeof assetStatusChangeSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "asset.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const before = (await this.locked(client, id, input.version)).asset;
        // Marking an issued asset lost closes its assignment first; any other
        // change on an issued asset is refused by the database until it is returned.
        if (before.status === "assigned" && input.status === "lost")
          await client.query(
            `UPDATE asset_assignment SET returned_on=$2, return_condition='lost', return_note=$3, version=version+1
             WHERE asset_id=$1 AND returned_on IS NULL`,
            [id, await this.today(client), input.note],
          );
        await client.query(
          "UPDATE asset SET status=$2, version=version+1 WHERE id=$1",
          [id, input.status],
        );
        const detail = await this.read(client, id);
        await this.record(
          client,
          actor,
          "asset.status_changed",
          detail.asset,
          requestId,
          {
            reason: input.note,
            before: this.snapshot(before),
            after: this.snapshot(detail.asset),
          },
        );
        return detail;
      }),
    );
  }

  acknowledge(
    actor: Principal,
    assignmentId: string,
    input: z.infer<typeof assetAcknowledgeSchema>,
    requestId: string,
  ): Promise<MyAssets> {
    this.platform.require(actor, "asset.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<{ version: number; assetId: string }>(
          `SELECT version, asset_id AS "assetId" FROM asset_assignment
           WHERE id=$1 AND employee_id=$2 FOR UPDATE`,
          [assignmentId, actor.employeeId],
        );
        const row = found.rows[0];
        if (!row) throw new NotFoundException("This asset is unavailable.");
        if (row.version !== input.version)
          throw new ConflictException(
            "This asset changed. Reload it before trying again.",
          );
        await client.query(
          "UPDATE asset_assignment SET acknowledged_at=now(), version=version+1 WHERE id=$1",
          [assignmentId],
        );
        await audit(
          client,
          actor,
          "asset.acknowledged",
          `asset:${row.assetId}:assignment:${assignmentId}`,
          requestId,
          { details: { assignmentId, version: row.version + 1 } },
        );
        await this.event(
          client,
          actor,
          assignmentId,
          row.version + 1,
          "asset.acknowledged.v1",
        );
        return this.holdings(client, actor);
      }),
    );
  }

  private async holdings(
    client: PoolClient,
    actor: Principal,
  ): Promise<MyAssets> {
    const { rows } = await client.query(mineSql, [actor.employeeId]);
    return myAssetsSchema.parse({
      current: rows.filter((row) => !row.returnedOn),
      past: rows.filter((row) => row.returnedOn),
    });
  }

  private async today(client: PoolClient) {
    const { rows } = await client.query<{ today: string }>(
      "SELECT to_char(leave_entity_today(),'YYYY-MM-DD') AS today",
    );
    return rows[0]!.today;
  }

  // Lock the asset and refuse a stale version before changing anything.
  private async locked(client: PoolClient, id: string, version: number) {
    const found = await client.query(
      "SELECT id FROM asset WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!found.rows[0])
      throw new NotFoundException("This asset is unavailable.");
    const detail = await this.read(client, id);
    if (detail.asset.version !== version)
      throw new ConflictException(
        "This asset changed. Reload it before trying again.",
      );
    return detail;
  }

  private async read(client: PoolClient, id: string): Promise<AssetDetail> {
    const { rows } = await client.query<Row>(
      `SELECT ${columns} ${from} WHERE a.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This asset is unavailable.");
    const history = await client.query(
      `SELECT s.id, s.employee_id AS "employeeId", coalesce(d.name,'Former colleague') AS "employeeName",
         to_char(s.issued_on,'YYYY-MM-DD') AS "issuedOn", s.issue_condition AS "issueCondition",
         s.issued_by_label AS "issuedBy", ${stamp("s.acknowledged_at")} AS "acknowledgedAt",
         to_char(s.returned_on,'YYYY-MM-DD') AS "returnedOn", s.return_condition AS "returnCondition",
         s.return_note AS "returnNote", s.received_by_label AS "receivedBy"
       FROM asset_assignment s LEFT JOIN employee_directory d ON d.id=s.employee_id
       WHERE s.asset_id=$1 ORDER BY s.issued_on DESC, s.created_at DESC LIMIT 50`,
      [id],
    );
    return assetDetailSchema.parse({
      asset: this.present(rows[0]),
      history: history.rows,
    });
  }

  private present(row: Row): Asset {
    const { custodianId, custodianName, custodianInitials, ...rest } = row;
    return assetSchema.parse({
      ...rest,
      custodian: custodianId
        ? { id: custodianId, name: custodianName, initials: custodianInitials }
        : null,
    });
  }

  private snapshot(asset: Asset) {
    const {
      id,
      tag,
      category,
      name,
      serialNumber,
      condition,
      status,
      version,
    } = asset;
    return {
      id,
      tag,
      category,
      name,
      serialNumber,
      condition,
      status,
      version,
      custodian: asset.custodian?.id ?? null,
    };
  }

  private async record(
    client: PoolClient,
    actor: Principal,
    action: string,
    asset: Asset,
    requestId: string,
    details: Record<string, unknown> & { reason?: string },
  ) {
    const { reason, ...rest } = details;
    await audit(
      client,
      actor,
      action,
      `asset:${asset.id}:v${asset.version}`,
      requestId,
      { reason, details: rest },
    );
    await this.event(client, actor, asset.id, asset.version, `${action}.v1`);
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
          if (constraint === "asset_assignment_open")
            throw new ConflictException("This asset is already issued.");
          if (constraint === "asset_tenant_id_entity_id_tag_key")
            throw new ConflictException("That tag is already in use.");
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
