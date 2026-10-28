import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import {
  organizationChartNodeSchema,
  orgChartNodeLiteSchema,
  type OrgChartNeighborhood,
  type OrgChartNodeLite,
  type OrgChartSearch,
  type orgChartSearchQuerySchema,
  organizationUnitSchema,
  type OrganizationChart,
  type OrganizationDetail,
  type OrganizationDirectory,
  type OrganizationMergeResult,
  employeeClassificationSchema,
  type EmployeeClassification,
  type employeeClassificationUpdateSchema,
  type OrganizationUnit,
  type organizationChartQuerySchema,
  type organizationCreateSchema,
  type organizationMergeSchema,
  type organizationUpdateSchema,
  type organizationQuerySchema,
} from "@anvi/contracts";
import { scopeFor, type Principal } from "@anvi/authz";
import type { z } from "zod";
import type { PlatformStore, SessionActor } from "./platform.store";

// One definition of "in effect", evaluated in the entity's business date. The same
// org_entity_today() the database guards and classify_employee() use.
const entityToday = `org_entity_today(nullif(current_setting('app.tenant_id',true),'')::uuid, nullif(current_setting('app.entity_id',true),'')::uuid)`;
const status = `CASE WHEN NOT u.active OR u.merged_into_id IS NOT NULL THEN 'inactive'
  WHEN u.effective_from > ${entityToday} THEN 'scheduled'
  WHEN u.effective_to < ${entityToday} THEN 'ended'
  ELSE 'in_effect' END`;
export const organizationUnitColumns = `u.id, u.kind, u.code, u.name, u.active, u.version,
  (SELECT count(*)::int FROM employee e
    WHERE e.tenant_id = u.tenant_id AND e.entity_id = u.entity_id
      AND e.status IN ('active','notice')
      AND CASE u.kind WHEN 'department' THEN e.department_id = u.id
        WHEN 'location' THEN e.location_id = u.id
        WHEN 'designation' THEN e.designation_id = u.id
        WHEN 'grade' THEN e.grade_id = u.id
        WHEN 'cost_center' THEN e.cost_center_id = u.id ELSE false END
  ) AS "employeeCount",
  to_char(u.effective_from,'YYYY-MM-DD') AS "effectiveFrom",
  to_char(u.effective_to,'YYYY-MM-DD') AS "effectiveTo",
  (${status}) = 'in_effect' AS "inEffect", ${status} AS status,
  u.merged_into_id AS "mergedIntoId"`;
const columns = organizationUnitColumns;

const ruleErrors: Record<string, (message: string) => Error> = {
  OG001: (m) => new ConflictException(m),
  OG002: (m) => new BadRequestException(m),
  OG003: (m) => new NotFoundException(m),
  OG004: (m) => new ConflictException(m),
  OG005: (m) => new ForbiddenException(m),
};
const busy = "Someone else changed this at the same time. Try again.";
const conflictCodes: Record<string, string> = {
  "40P01": busy,
  "40001": busy,
  "55P03": busy,
};
const CHART_NODE_CAP = 2000;
// Direct reports returned with one neighbourhood; reportCount still gives the total.
export const NEIGHBORHOOD_REPORT_CAP = 200;
interface LiteRow {
  id: string;
  name: string;
  initials: string;
  title: string;
  department: string | null;
  managerId: string | null;
  directReportCount: number;
}
// The database refuses (42501) a session without a valid directory context.
async function structure<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string }).code === "42501")
      throw new ForbiddenException(
        "The organization chart is not available to you.",
      );
    throw error;
  }
}
const liteColumns = `id, name, initials, title, department,
  manager_id AS "managerId", direct_report_count AS "directReportCount"`;
const lite = (row: LiteRow): OrgChartNodeLite =>
  orgChartNodeLiteSchema.parse({
    id: row.id,
    name: row.name,
    initials: row.initials,
    title: row.title,
    department: row.department,
    managerId: row.managerId,
    directReportCount: row.directReportCount,
  });

interface ClassificationRef {
  id: string;
  code: string;
  name: string;
}
export interface ClassificationRefs {
  designation: ClassificationRef | null;
  grade: ClassificationRef | null;
  costCenter: ClassificationRef | null;
  version: number;
}
// Designation, grade and cost centre of one employee the caller can already see
// (employee RLS). Ended or merged units stay readable once assigned.
export async function readClassification(
  client: PoolClient,
  employeeId: string,
): Promise<ClassificationRefs> {
  const { rows } = await client.query<Partial<ClassificationRefs>>(
    `SELECT
       (SELECT json_build_object('id',u.id,'code',u.code,'name',u.name) FROM org_unit u
         WHERE u.tenant_id=e.tenant_id AND u.entity_id=e.entity_id AND u.id=e.designation_id) AS designation,
       (SELECT json_build_object('id',u.id,'code',u.code,'name',u.name) FROM org_unit u
         WHERE u.tenant_id=e.tenant_id AND u.entity_id=e.entity_id AND u.id=e.grade_id) AS grade,
       (SELECT json_build_object('id',u.id,'code',u.code,'name',u.name) FROM org_unit u
         WHERE u.tenant_id=e.tenant_id AND u.entity_id=e.entity_id AND u.id=e.cost_center_id) AS "costCenter",
       e.classification_version AS version
     FROM employee e WHERE e.id=$1`,
    [employeeId],
  );
  const row = rows[0];
  return {
    designation: row?.designation ?? null,
    grade: row?.grade ?? null,
    costCenter: row?.costCenter ?? null,
    version: row?.version ?? 0,
  };
}

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

  async detail(actor: Principal, id: string): Promise<OrganizationDetail> {
    this.platform.require(actor, "organization.read");
    return scoped(this.platform.pool, actor, async (client) => {
      const item = await this.readUnit(client, id);
      const ref = `u.id, u.code, u.name,
        CASE WHEN u.merged_at IS NULL THEN NULL
          ELSE to_char(u.merged_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "mergedAt"`;
      const into = item.mergedIntoId
        ? await client.query(
            `SELECT u.id, u.code, u.name,
               (SELECT to_char(s.merged_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                FROM org_unit s WHERE s.id=$2) AS "mergedAt"
             FROM org_unit u WHERE u.id=$1`,
            [item.mergedIntoId, id],
          )
        : null;
      const from = await client.query(
        `SELECT ${ref} FROM org_unit u WHERE u.merged_into_id=$1
         ORDER BY u.merged_at DESC, u.id LIMIT 200`,
        [id],
      );
      return {
        item,
        mergedInto: into?.rows[0] ?? null,
        mergedFrom: from.rows,
      };
    });
  }

  async create(
    actor: Principal,
    input: z.infer<typeof organizationCreateSchema>,
    requestId: string,
  ): Promise<OrganizationUnit> {
    this.platform.require(actor, "organization.write");
    return this.rules(async () =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name,effective_from,effective_to)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.kind,
            input.code,
            input.name,
            input.effectiveFrom ?? null,
            input.effectiveTo ?? null,
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
    return this.rules(async () =>
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
        if (previous.mergedIntoId)
          throw new ConflictException(
            "This record was merged into another and can no longer change.",
          );
        const effectiveFrom = input.effectiveFrom ?? previous.effectiveFrom;
        const effectiveTo =
          input.effectiveTo === undefined
            ? previous.effectiveTo
            : input.effectiveTo;
        if (effectiveTo !== null && effectiveTo < effectiveFrom)
          throw new BadRequestException(
            "The end date cannot be before the start date.",
          );
        // Moving a still-used, active unit out of effect by dates would strand its
        // people and offers; a merge is the safe way to retire it.
        const classification = ["designation", "grade", "cost_center"].includes(
          previous.kind,
        );
        const reclassify = `This record is still assigned to ${previous.employeeCount} employee(s). Reclassify them first, then end or deactivate it.`;
        // Deactivating a designation, grade or cost centre still in use is refused too;
        // departments and locations keep the ORG-01 behaviour.
        if (
          classification &&
          previous.active &&
          !input.active &&
          previous.employeeCount > 0
        )
          throw new ConflictException(reclassify);
        if (previous.active && input.active) {
          const check = await client.query<{
            inEffect: boolean;
            candidates: number;
          }>(
            `SELECT ($1::date <= ${entityToday}
                AND ($2::date IS NULL OR $2::date >= ${entityToday})) AS "inEffect",
              (SELECT count(*)::int FROM candidate_case c
                WHERE (c.department_id=$3 OR c.location_id=$3)
                  AND c.state NOT IN ('approved','cancelled')) AS candidates`,
            [effectiveFrom, effectiveTo, id],
          );
          const row = check.rows[0]!;
          if (
            !row.inEffect &&
            previous.inEffect &&
            (previous.employeeCount > 0 || row.candidates > 0)
          )
            throw new ConflictException(
              classification
                ? reclassify
                : `This record still has ${previous.employeeCount} employee(s) and ${row.candidates} open candidate(s). Merge it into another record instead of ending it by date.`,
            );
        }
        // A replay with unchanged values creates no second version or domain event.
        if (
          previous.name === input.name &&
          previous.active === input.active &&
          previous.effectiveFrom === effectiveFrom &&
          previous.effectiveTo === effectiveTo
        )
          return previous;
        await client.query(
          `UPDATE org_unit SET name=$2, active=$3, effective_from=$4, effective_to=$5,
           version=version+1 WHERE id=$1`,
          [id, input.name, input.active, effectiveFrom, effectiveTo],
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

  // The database function owns the moves and the closing of the source; this
  // transaction adds the single audit row and domain event around it.
  async merge(
    actor: Principal,
    id: string,
    input: z.infer<typeof organizationMergeSchema>,
    requestId: string,
  ): Promise<OrganizationMergeResult> {
    this.platform.require(actor, "organization.write");
    return this.rules(
      async () =>
        scoped(this.platform.pool, actor, async (client) => {
          const { rows } = await client.query<{
            result: {
              moved: number;
              movedActive: number;
              movedInactive: number;
              movedCandidates: number;
              kind: string;
              version: number;
            };
          }>("SELECT merge_org_units($1,$2,$3,$4) AS result", [
            id,
            input.targetId,
            input.version,
            input.targetVersion,
          ]);
          const result = rows[0]!.result;
          const source = await this.readUnit(client, id);
          const target = await this.readUnit(client, input.targetId);
          await audit(
            client,
            actor,
            "organization.merged",
            `organization:${id}:v${source.version}`,
            requestId,
            {
              reason: input.reason,
              details: {
                kind: result.kind,
                sourceId: source.id,
                sourceCode: source.code,
                targetId: target.id,
                targetCode: target.code,
                movedEmployees: result.moved,
                movedActive: result.movedActive,
                movedInactive: result.movedInactive,
                movedCandidates: result.movedCandidates,
                after: this.snapshot(source),
              },
            },
          );
          await this.event(client, actor, source, "organization.merged.v1");
          return {
            source,
            target,
            movedEmployees: result.moved,
            movedActive: result.movedActive,
            movedInactive: result.movedInactive,
            movedCandidates: result.movedCandidates,
          };
        }),
      true,
    );
  }

  requireWrite(actor: Principal) {
    this.platform.require(actor, "organization.write");
  }

  // classify_employee() owns the checks, locks and the change; this transaction adds
  // the audit row (ids and codes only, never names) and the domain event.
  async classify(
    actor: Principal,
    employeeId: string,
    input: z.infer<typeof employeeClassificationUpdateSchema>,
    requestId: string,
  ): Promise<EmployeeClassification> {
    this.platform.require(actor, "organization.write");
    return this.rules(
      async () =>
        scoped(this.platform.pool, actor, async (client) => {
          const { rows } = await client.query<{
            result: {
              changed: boolean;
              version: number;
              before: {
                designationId: string | null;
                gradeId: string | null;
                costCenterId: string | null;
              };
            };
          }>("SELECT classify_employee($1,$2,$3,$4,$5) AS result", [
            employeeId,
            input.designationId,
            input.gradeId,
            input.costCenterId,
            input.version,
          ]);
          const result = rows[0]!.result;
          const after = await readClassification(client, employeeId);
          if (result.changed) {
            const codes = await client.query<{ id: string; code: string }>(
              "SELECT id, code FROM org_unit WHERE id = ANY($1::uuid[])",
              [Object.values(result.before).filter(Boolean)],
            );
            const code = (id: string | null) =>
              id ? (codes.rows.find((r) => r.id === id)?.code ?? null) : null;
            const ref = (unit: { id: string; code: string } | null) =>
              unit ? { id: unit.id, code: unit.code } : null;
            await audit(
              client,
              actor,
              "employee.classified",
              `employee:${employeeId}:classification:v${result.version}`,
              requestId,
              {
                reason: input.reason,
                details: {
                  employeeId,
                  before: {
                    designation: result.before.designationId
                      ? {
                          id: result.before.designationId,
                          code: code(result.before.designationId),
                        }
                      : null,
                    grade: result.before.gradeId
                      ? {
                          id: result.before.gradeId,
                          code: code(result.before.gradeId),
                        }
                      : null,
                    costCenter: result.before.costCenterId
                      ? {
                          id: result.before.costCenterId,
                          code: code(result.before.costCenterId),
                        }
                      : null,
                  },
                  after: {
                    designation: ref(after.designation),
                    grade: ref(after.grade),
                    costCenter: ref(after.costCenter),
                  },
                },
              },
            );
            await client.query(
              `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
             VALUES ($1,$2,$3,'employee.classified.v1',$4,$5)`,
              [
                randomUUID(),
                actor.tenantId,
                actor.entityId,
                employeeId,
                result.version,
              ],
            );
          }
          return employeeClassificationSchema.parse({
            employeeId,
            ...after,
            version: result.version,
            changed: result.changed,
          });
        }),
      true,
    );
  }

  // Reporting lines drawn only from rows the caller's directory scope already
  // returns (employee RLS): HR the entity, a manager self plus direct reports,
  // an employee only self. Managers outside that set are never named.
  async chart(
    actor: Principal,
    query: z.infer<typeof organizationChartQuerySchema>,
  ): Promise<OrganizationChart> {
    this.platform.require(actor, "directory.read");
    const scope = scopeFor(actor, "directory.read")!;
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<{
        id: string;
        name: string;
        initials: string;
        title: string;
        department: string;
        status: "active" | "notice";
        managerId: string | null;
      }>(
        `SELECT id, name, initials, title, department, status, manager_id AS "managerId"
         FROM employee_directory WHERE status IN ('active','notice')
         ORDER BY name, id LIMIT $1`,
        [CHART_NODE_CAP + 1],
      );
      let truncated = rows.length > CHART_NODE_CAP;
      const people = rows.slice(0, CHART_NODE_CAP);
      const byId = new Map(people.map((p) => [p.id, p]));
      const reports = new Map<string, string[]>();
      for (const p of people) {
        if (p.managerId && byId.has(p.managerId)) {
          const list = reports.get(p.managerId) ?? [];
          list.push(p.id);
          reports.set(p.managerId, list);
        }
      }
      let roots: string[];
      if (query.rootId) {
        if (!byId.has(query.rootId))
          throw new NotFoundException("This person is not in your view.");
        roots = [query.rootId];
      } else {
        roots = people
          .filter((p) => !p.managerId || !byId.has(p.managerId))
          .map((p) => p.id);
      }
      const depthOf = new Map<string, number>();
      const walk = (start: string[]) => {
        const queue: [string, number][] = start.map((id) => [id, 0]);
        for (const [id] of queue) depthOf.set(id, 0);
        for (let i = 0; i < queue.length; i++) {
          const [id, depth] = queue[i]!;
          for (const child of reports.get(id) ?? []) {
            if (depthOf.has(child)) continue;
            if (depth + 1 >= query.depth) {
              truncated = true;
              continue;
            }
            depthOf.set(child, depth + 1);
            queue.push([child, depth + 1]);
          }
        }
      };
      walk(roots);
      if (!query.rootId) {
        // People reachable from no root sit on a reporting loop: break it at the
        // first by name so everyone visible is still drawn exactly once.
        for (const p of people) {
          if (depthOf.has(p.id)) continue;
          truncated = true;
          roots.push(p.id);
          walk([p.id]);
        }
      }
      const rootSet = new Set(roots);
      const nodes = people
        .filter((p) => depthOf.has(p.id))
        .map((p) =>
          organizationChartNodeSchema.parse({
            ...p,
            managerId:
              rootSet.has(p.id) || !p.managerId || !byId.has(p.managerId)
                ? null
                : p.managerId,
            directReportCount: reports.get(p.id)?.length ?? 0,
            depth: depthOf.get(p.id)!,
          }),
        )
        .sort((a, b) => a.depth - b.depth);
      return { scope, rootIds: roots, nodes, total: nodes.length, truncated };
    });
  }

  // Entity-wide structure lookups for anyone with directory.read at any scope. Rows
  // come only from the org_chart_* SECURITY DEFINER functions (migration 041), which
  // expose id, name, initials, title, department, manager id and report count of
  // active/notice people in the caller's own tenant and entity. Not audited (structure,
  // not personal records) and the search text is never logged or stored.
  requireStructure(actor: Principal) {
    this.platform.require(actor, "directory.read");
    // Without an employee context there is no person to budget or scope by.
    if (!actor.employeeId || !actor.tenantId || !actor.entityId)
      throw new ForbiddenException(
        "The organization chart is not available to you.",
      );
  }

  async search(
    actor: Principal,
    query: z.infer<typeof orgChartSearchQuerySchema>,
  ): Promise<OrgChartSearch> {
    this.requireStructure(actor);
    return structure(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const { rows } = await client.query<LiteRow>(
          `SELECT ${liteColumns} FROM org_chart_search($1, $2)`,
          [query.q, query.limit],
        );
        return { items: rows.map(lite) };
      }),
    );
  }

  async neighborhood(
    actor: Principal,
    employeeId: string,
  ): Promise<OrgChartNeighborhood> {
    this.requireStructure(actor);
    return structure(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const { rows } = await client.query<LiteRow & { relation: string }>(
          `SELECT relation, ${liteColumns} FROM org_chart_neighborhood($1, $2)`,
          [employeeId, NEIGHBORHOOD_REPORT_CAP + 1],
        );
        const focus = rows.find((r) => r.relation === "focus");
        // Unknown, inactive and other-entity people all answer the same way.
        if (!focus) throw new NotFoundException("This person is unavailable.");
        const managerRow = rows.find((r) => r.relation === "manager");
        const reports = rows.filter((r) => r.relation === "report");
        const manager = managerRow ? lite(managerRow) : null;
        return {
          focus: lite(focus),
          manager,
          reports: reports.slice(0, NEIGHBORHOOD_REPORT_CAP).map(lite),
          reportCount: focus.directReportCount,
          truncated: reports.length > NEIGHBORHOOD_REPORT_CAP,
          skipLevelHint: { managerHasManager: Boolean(manager?.managerId) },
        };
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
    const {
      id,
      kind,
      code,
      name,
      active,
      version,
      effectiveFrom,
      effectiveTo,
      mergedIntoId,
    } = item;
    return {
      id,
      kind,
      code,
      name,
      active,
      version,
      effectiveFrom,
      effectiveTo,
      mergedIntoId,
    };
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

  // passGuardMessage: the merge path surfaces the specific guard text for 23514.
  private async rules<T>(
    work: () => Promise<T>,
    passGuardMessage = false,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (code === "23505")
          throw new ConflictException(
            "A record with that code or name already exists in this entity.",
          );
        if (typeof code === "string" && code in conflictCodes)
          throw new ConflictException(conflictCodes[code]);
        if (
          passGuardMessage &&
          code === "23514" &&
          "message" in error &&
          typeof error.message === "string"
        )
          throw new BadRequestException(`${error.message}.`);
        if (code === "23514" || code === "23503")
          throw new BadRequestException(
            "This organization change does not meet the rules.",
          );
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
