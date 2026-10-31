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
  myPoliciesSchema,
  myPolicyDetailSchema,
  policyDetailSchema,
  policyListSchema,
  policyVersionDetailSchema,
  policyVersionSchema,
  type MyPolicies,
  type MyPolicyDetail,
  type PolicyDetail,
  type PolicyList,
  type PolicyVersion,
  type policyCreateSchema,
  type policyDraftSchema,
  type policyPublishSchema,
  type policyWithdrawSchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const versionColumns = `v.id, v.policy_id AS "policyId", p.code, p.category, v.version_number AS "versionNumber",
  v.status, v.title, v.summary, to_char(v.effective_on,'YYYY-MM-DD') AS "effectiveOn",
  v.requires_acknowledgement AS "requiresAcknowledgement", v.audience_department_id AS "audienceDepartmentId",
  o.name AS "audienceDepartmentName", v.version, v.created_by_label AS "createdBy",
  ${stamp("v.created_at")} AS "createdAt", ${stamp("v.published_at")} AS "publishedAt",
  v.published_by_label AS "publishedBy"`;
const versionFrom = `FROM policy_version v JOIN policy p ON p.id=v.policy_id
  LEFT JOIN org_unit o ON o.id=v.audience_department_id`;
const audienceSql = `(SELECT count(*)::int FROM employee_directory d WHERE d.status IN ('active','notice')
  AND (v.audience_department_id IS NULL OR d.department_id=v.audience_department_id))`;

type VersionRow = Omit<PolicyVersion, "audienceDepartment"> & {
  audienceDepartmentId: string | null;
  audienceDepartmentName: string | null;
};

const ruleErrors: Record<string, (message: string) => Error> = {
  PL003: (m) => new BadRequestException(m),
  PL004: (m) => new ConflictException(m),
  PL005: (m) => new ForbiddenException(m),
};
const uniqueMessages: Record<string, string> = {
  policy_tenant_id_entity_id_code_key: "That policy code is already in use.",
  policy_one_draft: "This policy already has a draft.",
  policy_one_published: "Another version of this policy is already published.",
  policy_acknowledgement_policy_version_id_employee_id_key:
    "You have already acknowledged this version.",
};

// Wording, versions and the rules about who may change what live in the database
// guards: published text is immutable, one published and one draft version per
// policy, and acknowledgements can only be added, by the person they describe.
export class PolicyStore {
  constructor(private readonly platform: PlatformStore) {}

  async mine(actor: Principal): Promise<MyPolicies> {
    this.platform.require(actor, "policy.self");
    return scoped(this.platform.pool, actor, (client) =>
      this.holdings(client, actor),
    );
  }

  async readMine(actor: Principal, versionId: string): Promise<MyPolicyDetail> {
    this.platform.require(actor, "policy.self");
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `${this.mineSql("v.body")} AND v.id=$2`,
        [actor.employeeId, versionId],
      );
      if (!rows[0]) throw new NotFoundException("This policy is unavailable.");
      return myPolicyDetailSchema.parse(rows[0]);
    });
  }

  acknowledge(actor: Principal, versionId: string, requestId: string) {
    this.platform.require(actor, "policy.self");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<{
          policyId: string;
          versionNumber: number;
        }>(
          `SELECT v.policy_id AS "policyId", v.version_number AS "versionNumber"
           FROM policy_version v WHERE v.id=$1 AND v.status='published'`,
          [versionId],
        );
        const row = found.rows[0];
        if (!row) throw new NotFoundException("This policy is unavailable.");
        await client.query(
          `INSERT INTO policy_acknowledgement(id,tenant_id,entity_id,policy_version_id,employee_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            versionId,
            actor.employeeId,
          ],
        );
        await audit(
          client,
          actor,
          "policy.acknowledged",
          `policy:${row.policyId}:v${row.versionNumber}`,
          requestId,
          { details: { versionId } },
        );
        await this.event(client, actor, versionId, 1, "policy.acknowledged.v1");
        return this.holdings(client, actor);
      }),
    );
  }

  async list(actor: Principal): Promise<PolicyList> {
    this.platform.require(actor, "policy.manage");
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query<VersionRow>(
        `SELECT ${versionColumns} ${versionFrom} ORDER BY p.code, v.version_number DESC LIMIT 500`,
      );
      const stats = new Map(
        (
          await client.query<{
            id: string;
            audience: number;
            acknowledged: number;
          }>(
            `SELECT v.id, ${audienceSql} AS audience,
               (SELECT count(*)::int FROM policy_acknowledgement a WHERE a.policy_version_id=v.id) AS acknowledged
             FROM policy_version v WHERE v.status='published' AND v.requires_acknowledgement`,
          )
        ).rows.map((row) => [row.id, row]),
      );
      const byPolicy = new Map<string, VersionRow[]>();
      for (const row of rows)
        byPolicy.set(row.policyId, [
          ...(byPolicy.get(row.policyId) ?? []),
          row,
        ]);
      let published = 0;
      let drafts = 0;
      let outstanding = 0;
      const items = [...byPolicy.values()].map((versions) => {
        const current = versions.find((v) => v.status === "published") ?? null;
        const draft = versions.find((v) => v.status === "draft") ?? null;
        const latest = versions[0]!;
        const stat = current ? stats.get(current.id) : undefined;
        if (current) published++;
        if (draft) drafts++;
        if (stat) outstanding += stat.audience - stat.acknowledged;
        return {
          id: latest.policyId,
          code: latest.code,
          category: latest.category,
          title: (current ?? draft ?? latest).title,
          current: current ? this.present(current) : null,
          draft: draft ? this.present(draft) : null,
          stats: stat
            ? { audience: stat.audience, acknowledged: stat.acknowledged }
            : null,
        };
      });
      return policyListSchema.parse({
        items,
        counts: { published, drafts, outstanding },
      });
    });
  }

  async detail(actor: Principal, policyId: string): Promise<PolicyDetail> {
    this.platform.require(actor, "policy.manage");
    return scoped(this.platform.pool, actor, (client) =>
      this.read(client, policyId),
    );
  }

  create(
    actor: Principal,
    input: z.infer<typeof policyCreateSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "policy.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const policyId = randomUUID();
        const versionId = randomUUID();
        await client.query(
          "INSERT INTO policy(id,tenant_id,entity_id,code,category) VALUES ($1,$2,$3,$4,$5)",
          [
            policyId,
            actor.tenantId,
            actor.entityId,
            input.code,
            input.category,
          ],
        );
        await this.insertVersion(client, actor, policyId, versionId, input);
        await audit(
          client,
          actor,
          "policy.created",
          `policy:${policyId}:v1`,
          requestId,
          {
            details: {
              code: input.code,
              category: input.category,
              title: input.title,
            },
          },
        );
        await this.event(client, actor, versionId, 1, "policy.created.v1");
        return this.read(client, policyId);
      }),
    );
  }

  newDraft(actor: Principal, policyId: string, requestId: string) {
    this.platform.require(actor, "policy.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const { rows } = await client.query(
          `SELECT v.title, v.summary, v.body, to_char(v.effective_on,'YYYY-MM-DD') AS "effectiveOn",
             v.requires_acknowledgement AS "requiresAcknowledgement", v.audience_department_id AS "audienceDepartmentId"
           FROM policy_version v WHERE v.policy_id=$1 AND v.status IN ('published','superseded','withdrawn')
           ORDER BY (v.status='published') DESC, v.version_number DESC LIMIT 1`,
          [policyId],
        );
        if (!rows[0])
          throw new NotFoundException("This policy is unavailable.");
        const versionId = randomUUID();
        await this.insertVersion(client, actor, policyId, versionId, rows[0]);
        const detail = await this.read(client, policyId);
        const draft = detail.versions.find((v) => v.id === versionId)!;
        await audit(
          client,
          actor,
          "policy.draft_updated",
          `policy:${policyId}:v${draft.versionNumber}`,
          requestId,
          { details: { startedFrom: "current wording" } },
        );
        await this.event(
          client,
          actor,
          versionId,
          1,
          "policy.draft_updated.v1",
        );
        return detail;
      }),
    );
  }

  updateDraft(
    actor: Principal,
    versionId: string,
    input: z.infer<typeof policyDraftSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "policy.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, versionId, input.version);
        await client.query(
          `UPDATE policy_version SET title=$2, summary=$3, body=$4, effective_on=$5,
             requires_acknowledgement=$6, audience_department_id=$7, version=version+1 WHERE id=$1`,
          [
            versionId,
            input.title,
            input.summary,
            input.body,
            input.effectiveOn,
            input.requiresAcknowledgement,
            input.audienceDepartmentId,
          ],
        );
        await audit(
          client,
          actor,
          "policy.draft_updated",
          `policy:${row.policyId}:v${row.versionNumber}`,
          requestId,
          { details: { versionId, title: input.title } },
        );
        await this.event(
          client,
          actor,
          versionId,
          row.version + 1,
          "policy.draft_updated.v1",
        );
        return this.read(client, row.policyId);
      }),
    );
  }

  publish(
    actor: Principal,
    versionId: string,
    input: z.infer<typeof policyPublishSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "policy.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, versionId, input.version);
        // The previous version stops being current in the same transaction.
        const replaced = await client.query<{ id: string }>(
          `UPDATE policy_version SET status='superseded', version=version+1
           WHERE policy_id=$1 AND status='published' RETURNING id`,
          [row.policyId],
        );
        await client.query(
          "UPDATE policy_version SET status='published', version=version+1 WHERE id=$1",
          [versionId],
        );
        await audit(
          client,
          actor,
          "policy.published",
          `policy:${row.policyId}:v${row.versionNumber}`,
          requestId,
          { details: { versionId, replaced: replaced.rows.map((r) => r.id) } },
        );
        await this.event(
          client,
          actor,
          versionId,
          row.version + 1,
          "policy.published.v1",
        );
        return this.read(client, row.policyId);
      }),
    );
  }

  withdraw(
    actor: Principal,
    versionId: string,
    input: z.infer<typeof policyWithdrawSchema>,
    requestId: string,
  ) {
    this.platform.require(actor, "policy.manage");
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.locked(client, versionId, input.version);
        await client.query(
          "UPDATE policy_version SET status='withdrawn', version=version+1 WHERE id=$1",
          [versionId],
        );
        await audit(
          client,
          actor,
          "policy.withdrawn",
          `policy:${row.policyId}:v${row.versionNumber}`,
          requestId,
          { reason: input.note, details: { versionId } },
        );
        await this.event(
          client,
          actor,
          versionId,
          row.version + 1,
          "policy.withdrawn.v1",
        );
        return this.read(client, row.policyId);
      }),
    );
  }

  private mineSql(extra = "NULL::text") {
    return `SELECT v.id AS "versionId", v.policy_id AS "policyId", p.code, p.category, v.title, v.summary,
        v.version_number AS "versionNumber", to_char(v.effective_on,'YYYY-MM-DD') AS "effectiveOn",
        v.requires_acknowledgement AS "requiresAcknowledgement", ${stamp("v.published_at")} AS "publishedAt",
        ${stamp("a.acknowledged_at")} AS "acknowledgedAt", ${extra} AS body
      FROM policy_version v JOIN policy p ON p.id=v.policy_id
      LEFT JOIN policy_acknowledgement a ON a.policy_version_id=v.id AND a.employee_id=$1
      WHERE v.status='published'`;
  }

  private async holdings(
    client: PoolClient,
    actor: Principal,
  ): Promise<MyPolicies> {
    const { rows } = await client.query(
      `${this.mineSql()} ORDER BY (a.acknowledged_at IS NULL AND v.requires_acknowledgement) DESC,
         v.effective_on DESC, p.code`,
      [actor.employeeId],
    );
    const items = rows.map(({ body: _body, ...rest }) => rest);
    return myPoliciesSchema.parse({
      items,
      outstanding: items.filter(
        (item) => item.requiresAcknowledgement && !item.acknowledgedAt,
      ).length,
    });
  }

  private async insertVersion(
    client: PoolClient,
    actor: Principal,
    policyId: string,
    versionId: string,
    content: {
      title: string;
      summary: string;
      body: string;
      effectiveOn: string;
      requiresAcknowledgement: boolean;
      audienceDepartmentId: string | null;
    },
  ) {
    await client.query(
      `INSERT INTO policy_version(id,tenant_id,entity_id,policy_id,version_number,title,summary,body,effective_on,
         requires_acknowledgement,audience_department_id,status,version,created_by_label)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,'draft',1,$11)`,
      [
        versionId,
        actor.tenantId,
        actor.entityId,
        policyId,
        content.title,
        content.summary,
        content.body,
        content.effectiveOn,
        content.requiresAcknowledgement,
        content.audienceDepartmentId,
        actor.name,
      ],
    );
  }

  // Lock one version and refuse a stale edit before changing anything.
  private async locked(client: PoolClient, versionId: string, version: number) {
    const found = await client.query<{
      policyId: string;
      versionNumber: number;
      version: number;
    }>(
      `SELECT policy_id AS "policyId", version_number AS "versionNumber", version
       FROM policy_version WHERE id=$1 FOR UPDATE`,
      [versionId],
    );
    const row = found.rows[0];
    if (!row) throw new NotFoundException("This policy is unavailable.");
    if (row.version !== version)
      throw new ConflictException(
        "This policy changed. Reload it before trying again.",
      );
    return row;
  }

  private async read(
    client: PoolClient,
    policyId: string,
  ): Promise<PolicyDetail> {
    const policy = await client.query<{
      id: string;
      code: string;
      category: string;
    }>("SELECT id, code, category FROM policy WHERE id=$1", [policyId]);
    if (!policy.rows[0])
      throw new NotFoundException("This policy is unavailable.");
    const { rows } = await client.query<VersionRow & { body: string }>(
      `SELECT ${versionColumns}, v.body ${versionFrom} WHERE v.policy_id=$1 ORDER BY v.version_number DESC`,
      [policyId],
    );
    const versions = rows.map(({ body, ...meta }) =>
      policyVersionDetailSchema.parse({ ...this.present(meta), body }),
    );
    const published = rows.find(
      (row) => row.status === "published" && row.requiresAcknowledgement,
    );
    let compliance = null;
    if (published) {
      const totals = await client.query<{
        audience: number;
        acknowledged: number;
      }>(
        `SELECT count(*)::int AS audience, count(a.id)::int AS acknowledged
         FROM employee_directory d
         LEFT JOIN policy_acknowledgement a ON a.employee_id=d.id AND a.policy_version_id=$1
         WHERE d.status IN ('active','notice') AND ($2::uuid IS NULL OR d.department_id=$2)`,
        [published.id, published.audienceDepartmentId],
      );
      const people = await client.query(
        `SELECT d.id AS "employeeId", d.name, d.initials, d.department,
           ${stamp("a.acknowledged_at")} AS "acknowledgedAt"
         FROM employee_directory d
         LEFT JOIN policy_acknowledgement a ON a.employee_id=d.id AND a.policy_version_id=$1
         WHERE d.status IN ('active','notice') AND ($2::uuid IS NULL OR d.department_id=$2)
         ORDER BY (a.acknowledged_at IS NOT NULL), d.name LIMIT 500`,
        [published.id, published.audienceDepartmentId],
      );
      compliance = {
        versionId: published.id,
        stats: {
          audience: totals.rows[0]!.audience,
          acknowledged: totals.rows[0]!.acknowledged,
        },
        people: people.rows,
      };
    }
    return policyDetailSchema.parse({
      policy: policy.rows[0],
      versions,
      compliance,
    });
  }

  private present(row: VersionRow): PolicyVersion {
    const { audienceDepartmentId, audienceDepartmentName, ...rest } = row;
    return policyVersionSchema.parse({
      ...rest,
      audienceDepartment: audienceDepartmentId
        ? { id: audienceDepartmentId, name: audienceDepartmentName }
        : null,
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
