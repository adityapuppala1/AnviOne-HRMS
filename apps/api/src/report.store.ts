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
  reportCatalogSchema,
  reportDefinitionSchema,
  reportResultSchema,
  savedReportListSchema,
  savedReportSchema,
  type ReportCatalog,
  type ReportDefinition,
  type ReportFilter,
  type ReportResult,
  type SavedReport,
  type SavedReportList,
} from "@anvi/contracts";
import type { PlatformStore } from "./platform.store";
import {
  datasetByKey,
  datasets,
  operatorsFor,
  type ColumnDef,
  type DatasetDef,
} from "./report.catalog";
import { toCsv } from "./report.csv";

export const REPORT_LIMITS = {
  maxColumns: 20,
  maxFilters: 10,
  runRows: 1000,
  exportRows: 10000,
  savedReports: 50,
  exportsPerMinute: 10,
  runsPerMinute: 60,
} as const;
// The on-screen total stops counting here.
const COUNT_CAP = 10001;

type Scope = "team" | "entity";
type Cell = string | number | null;
interface Compiled {
  dataset: DatasetDef;
  columns: ColumnDef[];
  from: string;
  where: string;
  order: string;
  params: unknown[];
}

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const savedColumns = `id, name, dataset, definition, archived, version, ${stamp("created_at")} AS "createdAt",
  ${stamp("updated_at")} AS "updatedAt"`;

const unavailable = () =>
  new ForbiddenException(
    "This report is not available in your current workspace.",
  );
const badColumn = () =>
  new BadRequestException("This column is not available in this report.");
const badFilter = () =>
  new BadRequestException("This filter is not available for this column.");

// contains: user text is matched literally; %, _ and the escape character are escaped.
export const likePattern = (text: string) =>
  `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const ruleErrors: Record<string, (message: string) => Error> = {
  RP001: (m) => new ConflictException(m),
  RP003: (m) => new ConflictException(m),
  RP005: (m) => new ForbiddenException(m),
};

// Reports: a fixed catalog of whitelisted, parameterized queries. Row authorization is the
// caller's ordinary row-level security; field authorization (sensitive columns, HR-only
// datasets) is checked here before any SQL is built.
export class ReportStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal): Scope {
    this.platform.require(actor, "report.run");
    return scopeFor(actor, "report.run") === "entity" ? "entity" : "team";
  }

  private allowed(actor: Principal, scope: Scope, dataset: DatasetDef) {
    return (
      (!dataset.hrOnly || scope === "entity") &&
      Boolean(scopeFor(actor, dataset.requires))
    );
  }

  requireExport(actor: Principal) {
    this.platform.require(actor, "report.export");
  }

  catalog(actor: Principal): ReportCatalog {
    const scope = this.scope(actor);
    return reportCatalogSchema.parse({
      scope,
      canExport: Boolean(scopeFor(actor, "report.export")),
      limits: REPORT_LIMITS,
      datasets: datasets
        .filter((d) => this.allowed(actor, scope, d))
        .map((d) => ({
          key: d.key,
          label: d.label,
          description: d.description,
          columns: d.columns
            .filter((c) => scope === "entity" || !c.sensitive)
            .map((c) => ({
              key: c.key,
              label: c.label,
              type: c.type,
              sensitive: Boolean(c.sensitive),
              operators: [...operatorsFor(c)],
              ...(c.options ? { options: [...c.options] } : {}),
            })),
        })),
    });
  }

  // Turns a definition into SQL built only from catalog constants and $n parameters.
  compile(actor: Principal, definition: ReportDefinition): Compiled {
    const scope = this.scope(actor);
    const dataset = datasetByKey.get(definition.dataset);
    if (!dataset || !this.allowed(actor, scope, dataset)) throw unavailable();
    const column = (key: string) => {
      const found = dataset.columns.find((c) => c.key === key);
      if (!found) throw badColumn();
      if (found.sensitive && scope !== "entity")
        throw new ForbiddenException("This column is available to HR only.");
      return found;
    };
    const columns = definition.columns.map(column);
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = dataset.where ? [dataset.where] : [];
    for (const filter of definition.filters) {
      const target = column(filter.column);
      if (!operatorsFor(target).includes(filter.op)) throw badFilter();
      conditions.push(this.condition(target, filter, param));
    }
    const sortColumn = definition.sort
      ? column(definition.sort.column)
      : columns[0]!;
    const direction = definition.sort?.direction === "desc" ? "DESC" : "ASC";
    return {
      dataset,
      columns,
      from: dataset.from,
      where: conditions.length
        ? conditions.map((c) => `(${c})`).join(" AND ")
        : "true",
      order: `${sortColumn.value ?? sortColumn.select} ${direction} NULLS LAST, ${dataset.tiebreak}`,
      params,
    };
  }

  private condition(
    column: ColumnDef,
    filter: ReportFilter,
    param: (value: unknown) => string,
  ) {
    const expr = column.value ?? column.select;
    const typed = (value: unknown) => {
      switch (column.type) {
        case "date":
          if (!isDate(value)) throw badFilter();
          return `${param(value)}::date`;
        case "number":
          if (typeof value !== "number") throw badFilter();
          return `${param(value)}::numeric`;
        case "money": {
          // Filters take rupees with at most two decimals; storage is integer paise.
          if (typeof value !== "number") throw badFilter();
          const minor = Math.round(value * 100);
          if (Math.abs(value * 100 - minor) > 1e-6) throw badFilter();
          return `${param(minor)}::bigint`;
        }
        case "enum":
          if (typeof value !== "string" || !column.options?.includes(value))
            throw badFilter();
          return `${param(value)}::text`;
        case "text":
          if (typeof value !== "string") throw badFilter();
          return `${param(value)}::text`;
      }
    };
    switch (filter.op) {
      case "eq":
        return `${expr} = ${typed(filter.value)}`;
      case "gte":
        return `${expr} >= ${typed(filter.value)}`;
      case "lte":
        return `${expr} <= ${typed(filter.value)}`;
      case "between":
        return `${expr} BETWEEN ${typed(filter.from)} AND ${typed(filter.to)}`;
      case "in":
        if (
          column.type === "enum" &&
          filter.values.some((v) => !column.options?.includes(v))
        )
          throw badFilter();
        return `${expr} = ANY(${param(filter.values)}::text[])`;
      case "contains":
        return `${expr} ILIKE ${param(likePattern(filter.value))} ESCAPE '\\'`;
    }
  }

  private async rows(client: PoolClient, query: Compiled, limit: number) {
    const select = query.columns
      .map((c, i) => `${c.select} AS c${i}`)
      .join(", ");
    const result = await client.query<Cell[]>({
      text: `SELECT ${select} FROM ${query.from} WHERE ${query.where}
             ORDER BY ${query.order} LIMIT ${Number(limit)}`,
      values: query.params,
      rowMode: "array",
    });
    return result.rows;
  }

  async run(
    actor: Principal,
    definition: ReportDefinition,
  ): Promise<ReportResult> {
    const query = this.compile(actor, definition);
    const scope = this.scope(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.budget(client);
        const rows = await this.rows(client, query, definition.limit);
        // Rows and count are two statements in one READ COMMITTED transaction, so the
        // total can differ from the rows by concurrent changes; it is a guide, not exact.
        const counted = await client.query<{ total: number }>(
          `SELECT count(*)::int AS total FROM (SELECT 1 FROM ${query.from} WHERE ${query.where}
           LIMIT ${COUNT_CAP}) capped`,
          query.params,
        );
        const total = counted.rows[0]!.total;
        return reportResultSchema.parse({
          dataset: query.dataset.key,
          scope,
          columns: query.columns.map((c) => ({
            key: c.key,
            label: c.label,
            type: c.type,
          })),
          rows,
          total,
          truncated: total > rows.length,
          totalCapped: total >= COUNT_CAP,
        });
      }),
    );
  }

  // Buffered CSV (at most 10,000 rows), recorded with an audit row and an outbox event in
  // the same transaction. The record names the dataset, columns and filter operators only.
  async export(
    actor: Principal,
    definition: ReportDefinition,
    requestId: string,
  ) {
    this.platform.require(actor, "report.export");
    const query = this.compile(actor, definition);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.budget(client);
        const fetched = await this.rows(
          client,
          query,
          REPORT_LIMITS.exportRows + 1,
        );
        const truncated = fetched.length > REPORT_LIMITS.exportRows;
        const rows = truncated
          ? fetched.slice(0, REPORT_LIMITS.exportRows)
          : fetched;
        const exportId = randomUUID();
        await audit(
          client,
          actor,
          "report.exported",
          `report-export:${exportId}`,
          requestId,
          {
            details: {
              dataset: definition.dataset,
              columns: definition.columns,
              filters: definition.filters.map((f) => ({
                column: f.column,
                op: f.op,
              })),
              sort: definition.sort ?? null,
              rowCount: rows.length,
              truncated,
            },
          },
        );
        await this.event(client, actor, exportId, 1, "report.exported.v1");
        const today = (
          await client.query<{ today: string }>(
            "SELECT to_char(leave_entity_today(),'YYYY-MM-DD') AS today",
          )
        ).rows[0]!.today;
        return {
          exportId,
          today,
          dataset: definition.dataset,
          rowCount: rows.length,
          truncated,
          csv: toCsv(query.columns, rows),
        };
      }),
    );
  }

  // Report queries get a tighter budget than the pool's default 5 seconds.
  private async budget(client: PoolClient) {
    await client.query("SET LOCAL statement_timeout = '3s'");
  }

  private runnable(actor: Principal, definition: ReportDefinition) {
    try {
      this.compile(actor, definition);
      return true;
    } catch {
      return false;
    }
  }

  private shape(actor: Principal, row: Record<string, unknown>): SavedReport {
    const parsed = reportDefinitionSchema.safeParse(row.definition);
    const runnable = parsed.success && this.runnable(actor, parsed.data);
    // A definition the caller may not run now is listed by name only: its columns and
    // filter values may describe data outside their current role.
    return savedReportSchema.parse({
      ...row,
      definition: runnable ? parsed.data : null,
      runnable,
    });
  }

  async saved(actor: Principal): Promise<SavedReportList> {
    this.scope(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT ${savedColumns} FROM report_definition WHERE NOT archived ORDER BY updated_at DESC, id`,
      );
      return savedReportListSchema.parse({
        items: rows.map((row) => this.shape(actor, row)),
        limit: REPORT_LIMITS.savedReports,
      });
    });
  }

  create(
    actor: Principal,
    input: { name: string; definition: ReportDefinition },
    requestId: string,
  ) {
    this.compile(actor, input.definition);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO report_definition(id,tenant_id,entity_id,owner_employee_id,name,dataset,definition)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            actor.employeeId,
            input.name,
            input.definition.dataset,
            JSON.stringify(input.definition),
          ],
        );
        await audit(client, actor, "report.saved", `report:${id}`, requestId, {
          details: this.summary(input.definition),
        });
        await this.event(client, actor, id, 1, "report.saved.v1");
        return this.one(client, actor, id);
      }),
    );
  }

  update(
    actor: Principal,
    id: string,
    input: { name: string; definition: ReportDefinition; version: number },
    requestId: string,
  ) {
    this.compile(actor, input.definition);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const version = await this.locked(client, id, input.version);
        await client.query(
          `UPDATE report_definition SET name=$2, dataset=$3, definition=$4, version=version+1 WHERE id=$1`,
          [
            id,
            input.name,
            input.definition.dataset,
            JSON.stringify(input.definition),
          ],
        );
        await audit(
          client,
          actor,
          "report.updated",
          `report:${id}`,
          requestId,
          {
            details: {
              ...this.summary(input.definition),
              version: version + 1,
            },
          },
        );
        await this.event(client, actor, id, version + 1, "report.updated.v1");
        return this.one(client, actor, id);
      }),
    );
  }

  archive(
    actor: Principal,
    id: string,
    input: { version: number },
    requestId: string,
  ) {
    this.scope(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const version = await this.locked(client, id, input.version);
        await client.query(
          "UPDATE report_definition SET archived=true, version=version+1 WHERE id=$1",
          [id],
        );
        await audit(
          client,
          actor,
          "report.archived",
          `report:${id}`,
          requestId,
          {
            details: { version: version + 1 },
          },
        );
        await this.event(client, actor, id, version + 1, "report.archived.v1");
        return this.one(client, actor, id);
      }),
    );
  }

  // Row lock, then the version check: concurrent edits of one report serialize.
  private async locked(client: PoolClient, id: string, version: number) {
    const found = await client.query<{ version: number; archived: boolean }>(
      "SELECT version, archived FROM report_definition WHERE id=$1 FOR UPDATE",
      [id],
    );
    const row = found.rows[0];
    if (!row || row.archived)
      throw new NotFoundException("This saved report is unavailable.");
    if (row.version !== version)
      throw new ConflictException(
        "This saved report changed. Reload it before trying again.",
      );
    return row.version;
  }

  private async one(client: PoolClient, actor: Principal, id: string) {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT ${savedColumns} FROM report_definition WHERE id=$1`,
      [id],
    );
    return this.shape(actor, rows[0]!);
  }

  // Keys only: no filter values, so the audit trail never copies report data.
  private summary(definition: ReportDefinition) {
    return {
      dataset: definition.dataset,
      columns: definition.columns,
      filters: definition.filters.map((f) => ({ column: f.column, op: f.op })),
    };
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
        const code = String(error.code);
        const message =
          "message" in error && typeof error.message === "string"
            ? `${error.message}.`
            : "This change is not allowed.";
        if (code === "57014")
          throw new BadRequestException(
            "This report took too long. Add filters and try again.",
          );
        if (conflictCodes.has(code))
          throw new ConflictException(
            "Someone else changed this at the same time. Try again.",
          );
        if (code === "23505")
          throw new ConflictException(
            "You already have a saved report with this name.",
          );
        if (code === "23514" || code === "23503")
          throw new BadRequestException("Check your input and try again.");
        if (code in ruleErrors) throw ruleErrors[code]!(message);
      }
      throw error;
    }
  }
}
