import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { audit, scoped, type PoolClient } from "@anvi/database";
import { scopeFor, type Principal } from "@anvi/authz";
import {
  hdAgentListSchema,
  hdArticleListSchema,
  hdArticleSchema,
  hdArticleStatusSchema,
  hdCaseDetailSchema,
  hdCaseListSchema,
  hdCaseSchema,
  hdCaseStatusSchema,
  hdCategoryListSchema,
  hdCategorySchema,
  hdPrioritySchema,
  hdSlaListSchema,
  hdSuggestionListSchema,
  type HdAgentList,
  type HdArticle,
  type HdArticleList,
  type HdCase,
  type HdCaseDetail,
  type HdCaseList,
  type HdCategoryList,
  type HdSlaList,
  type HdSuggestionList,
  type hdArticleActionSchema,
  type hdArticleCreateSchema,
  type hdArticleLinkSchema,
  type hdArticleQuerySchema,
  type hdArticleUpdateSchema,
  type hdAssignSchema,
  type hdCaseActionSchema,
  type hdCaseCloseSchema,
  type hdCaseCreateSchema,
  type hdCaseQuerySchema,
  type hdCategoryCreateSchema,
  type hdCategoryUpdateSchema,
  type hdCommentCreateSchema,
  type hdConfidentialSetSchema,
  type hdPrioritySetSchema,
  type hdSlaUpdateSchema,
  type hdSuggestQuerySchema,
} from "@anvi/contracts";
import type { z } from "zod";
import type { PlatformStore } from "./platform.store";

const stamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const escapeLike = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// Breach is derived on read, against the wall clock (no business hours, no pause).
const responseBreached = `(coalesce(c.first_responded_at,c.resolved_at,c.cancelled_at,now())>c.first_response_due)`;
const resolveBreached = `(coalesce(c.resolved_at,c.cancelled_at,now())>c.resolve_due)`;
const LIVE = `('open','in_progress','waiting_on_employee')`;
// $1 is always the caller's employee id.
const caseColumns = `c.id, c.code, c.requester_employee_id AS "requesterEmployeeId", c.requester_name AS "requesterName",
  c.category_id AS "categoryId", (SELECT k.name FROM hd_category k WHERE k.id=c.category_id) AS "categoryName",
  c.subject, c.description, c.priority, c.confidential, c.status, c.assignee_employee_id AS "assigneeEmployeeId",
  c.assignee_name AS "assigneeName", ${stamp("c.first_response_due")} AS "firstResponseDue",
  ${stamp("c.resolve_due")} AS "resolveDue", ${stamp("c.first_responded_at")} AS "firstRespondedAt",
  ${responseBreached} AS "responseBreached", ${resolveBreached} AS "resolveBreached",
  ${stamp("c.last_activity_at")} AS "lastActivityAt", ${stamp("c.status_changed_at")} AS "statusChangedAt",
  ${stamp("c.resolved_at")} AS "resolvedAt", c.resolved_by_label AS "resolvedBy",
  ${stamp("(c.resolved_at+interval '7 days')")} AS "reopenUntil",
  (c.status='resolved' AND now()<=c.resolved_at+interval '7 days') AS "inReopenWindow",
  ${stamp("c.closed_at")} AS "closedAt", ${stamp("c.cancelled_at")} AS "cancelledAt", c.reopen_count AS "reopenCount",
  c.satisfaction, (c.requester_employee_id=$1) AS mine, (c.assignee_employee_id IS NOT DISTINCT FROM $1) AS "assignedToMe",
  c.version, ${stamp("c.created_at")} AS "createdAt", ${stamp("c.updated_at")} AS "updatedAt"`;
const articleColumns = `a.id, a.category_id AS "categoryId", (SELECT k.name FROM hd_category k WHERE k.id=a.category_id) AS "categoryName",
  a.title, a.body, a.keywords, a.status, ${stamp("a.published_at")} AS "publishedAt", a.version,
  a.updated_by_label AS "updatedBy", ${stamp("a.updated_at")} AS "updatedAt"`;
const categoryColumns = `k.id, k.name, k.confidential, k.active, k.sort, k.version, k.updated_by_label AS "updatedBy",
  ${stamp("k.updated_at")} AS "updatedAt"`;

const ruleErrors: Record<string, (message: string) => Error> = {
  HD003: (m) => new BadRequestException(m),
  HD004: (m) => new ConflictException(m),
  HD005: (m) => new ForbiddenException(m),
};
const retry = "Someone else changed this at the same time. Try again.";
const conflictCodes = new Set(["40P01", "40001", "55P03"]);
const uniqueMessages: Record<string, string> = {
  hd_category_name_key: "A category with this name already exists.",
  hd_case_article_once_key: "This article is already linked to the case.",
  hd_case_code_key: retry,
  hd_sla_target_pkey: "This service target was just saved. Reload it.",
};
const CASE_STATUSES = hdCaseStatusSchema.options;
const ARTICLE_STATUSES = hdArticleStatusSchema.options;
const DEFAULT_TARGETS: Record<string, [number, number]> = {
  urgent: [1, 8],
  high: [4, 24],
  normal: [8, 72],
  low: [24, 120],
};
const unavailable = "This case is unavailable.";
// Service targets have no row id: a stable id per tenant, entity and priority for the outbox.
const slaAggregate = (tenant: string, entity: string, priority: string) => {
  const h = createHash("sha256")
    .update(`hd-sla:${tenant}:${entity}:${priority}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Flags =
  | "canComment"
  | "canAddInternalNote"
  | "canAssign"
  | "canTake"
  | "canStart"
  | "canWait"
  | "canResume"
  | "canResolve"
  | "canReopen"
  | "canClose"
  | "canCancel"
  | "canChangePriority"
  | "canChangeConfidential"
  | "canLinkArticle"
  | "breached";
type CaseRow = Omit<HdCase, Flags> & { inReopenWindow: boolean };
type Locked = { version: number; [key: string]: unknown };

const caseSteps = {
  start: { from: ["open"], to: "in_progress" },
  wait: { from: ["open", "in_progress"], to: "waiting_on_employee" },
  resume: { from: ["waiting_on_employee"], to: "in_progress" },
  resolve: {
    from: ["open", "in_progress", "waiting_on_employee"],
    to: "resolved",
  },
  reopen: { from: ["resolved"], to: "in_progress" },
  cancel: {
    from: ["open", "in_progress", "waiting_on_employee"],
    to: "cancelled",
  },
} as const;
export type CaseStep = keyof typeof caseSteps;
const articleSteps = { publish: "published", archive: "archived" } as const;
export type ArticleStep = keyof typeof articleSteps;
// Small stop-word list so suggestions match on meaningful words only.
const STOP = new Set(
  "the and for with from that this have has are was were you your our can not how what when where why who about into over under".split(
    " ",
  ),
);

// Who may do what, the state machine, four-eyes, confidentiality, internal-note secrecy and the
// service-target due times all live in the database guards and policies (059); the store shapes
// replies, takes the per-case advisory lock first (same key as the guards) and writes audit and
// outbox rows that carry ids, statuses, kinds and counts but never subjects, descriptions,
// comments, article text, ratings, categories or the confidential flag of a case.
export class HelpdeskStore {
  constructor(private readonly platform: PlatformStore) {}

  private scope(actor: Principal) {
    if (scopeFor(actor, "helpdesk.manage")) return "manage" as const;
    if (scopeFor(actor, "helpdesk.agent")) return "agent" as const;
    if (scopeFor(actor, "helpdesk.self")) return "self" as const;
    return undefined;
  }
  private see(actor: Principal) {
    const scope = this.scope(actor);
    if (!scope)
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
    return scope;
  }
  private manage(actor: Principal) {
    if (this.see(actor) !== "manage")
      throw new ForbiddenException("Only HR manages the helpdesk.");
  }

  // ---- Categories ----
  async categories(actor: Principal): Promise<HdCategoryList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT ${categoryColumns} FROM hd_category k WHERE ($1 OR k.active) ORDER BY k.sort, lower(k.name), k.id`,
        [scope === "manage"],
      );
      return hdCategoryListSchema.parse({
        items: rows,
        canManage: scope === "manage",
      });
    });
  }
  async createCategory(
    actor: Principal,
    input: z.infer<typeof hdCategoryCreateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO hd_category(id,tenant_id,entity_id,name,confidential,sort) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.name,
            input.confidential,
            input.sort,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.category_created",
          `hd-category:${id}`,
          id,
          1,
          { confidential: input.confidential },
        );
        return this.category(client, id);
      }),
    );
  }
  async updateCategory(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdCategoryUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<Locked>(
          "SELECT version, active, confidential FROM hd_category WHERE id=$1 FOR UPDATE",
          [id],
        );
        const row = this.fresh(found.rows[0], input.version, "category");
        await client.query(
          "UPDATE hd_category SET name=$2, confidential=$3, active=$4, sort=$5, version=version+1 WHERE id=$1",
          [id, input.name, input.confidential, input.active, input.sort],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.category_updated",
          `hd-category:${id}`,
          id,
          row.version + 1,
          { active: input.active, confidential: input.confidential },
        );
        return this.category(client, id);
      }),
    );
  }
  private async category(client: PoolClient, id: string) {
    const { rows } = await client.query(
      `SELECT ${categoryColumns} FROM hd_category k WHERE k.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This category is unavailable.");
    return hdCategorySchema.parse(rows[0]);
  }

  // ---- Service targets ----
  async sla(actor: Principal): Promise<HdSlaList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.slaList(client, scope === "manage"),
    );
  }
  private async slaList(client: PoolClient, canManage: boolean) {
    const { rows } = await client.query<{
      priority: string;
      responseHours: number;
      resolveHours: number;
      version: number;
      updatedBy: string;
      updatedAt: string;
    }>(
      `SELECT s.priority, s.response_hours AS "responseHours", s.resolve_hours AS "resolveHours", s.version,
         s.updated_by_label AS "updatedBy", ${stamp("s.updated_at")} AS "updatedAt" FROM hd_sla_target s`,
    );
    return hdSlaListSchema.parse({
      items: [...hdPrioritySchema.options].reverse().map((priority) => {
        const row = rows.find((r) => r.priority === priority);
        const [responseHours, resolveHours] = DEFAULT_TARGETS[priority]!;
        return (
          row ?? {
            priority,
            responseHours,
            resolveHours,
            version: 0,
            updatedBy: null,
            updatedAt: null,
          }
        );
      }),
      canManage,
      basis: "wall_clock_hours",
    });
  }
  async updateSla(
    actor: Principal,
    priority: string,
    input: z.infer<typeof hdSlaUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const found = await client.query<Locked>(
          "SELECT version FROM hd_sla_target WHERE priority=$1 FOR UPDATE",
          [priority],
        );
        const current = found.rows[0]?.version ?? 0;
        if (current !== input.version)
          throw new ConflictException(
            "This service target changed. Reload it before trying again.",
          );
        if (current === 0)
          await client.query(
            `INSERT INTO hd_sla_target(tenant_id,entity_id,priority,response_hours,resolve_hours) VALUES ($1,$2,$3,$4,$5)`,
            [
              actor.tenantId,
              actor.entityId,
              priority,
              input.responseHours,
              input.resolveHours,
            ],
          );
        else
          await client.query(
            "UPDATE hd_sla_target SET response_hours=$2, resolve_hours=$3, version=version+1 WHERE priority=$1",
            [priority, input.responseHours, input.resolveHours],
          );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.sla_updated",
          `hd-sla:${priority}`,
          slaAggregate(actor.tenantId, actor.entityId, priority),
          current + 1,
          { priority },
        );
        return this.slaList(client, true);
      }),
    );
  }

  // ---- Knowledge articles ----
  async listArticles(
    actor: Principal,
    query: z.infer<typeof hdArticleQuerySchema>,
  ): Promise<HdArticleList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($1='%%' OR a.title ILIKE $1 OR array_to_string(a.keywords,' ') ILIKE $1)
        AND ($2::text IS NULL OR a.status=$2) AND ($3::uuid IS NULL OR a.category_id=$3)`;
      const base = [
        escapeLike(query.q),
        query.status ?? null,
        query.categoryId ?? null,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM hd_article a WHERE ${where}`,
        base,
      );
      const { rows } = await client.query<Omit<HdArticle, "canEdit">>(
        `SELECT ${articleColumns} FROM hd_article a WHERE ${where}
         ORDER BY (a.status='published') DESC, lower(a.title), a.id LIMIT $4 OFFSET $5`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      return hdArticleListSchema.parse({
        items: rows.map((r) => ({ ...r, canEdit: scope === "manage" })),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT a.status AS key, count(*)::int AS count FROM hd_article a WHERE ${where} GROUP BY a.status`,
          ARTICLE_STATUSES,
          [base[0], null, base[2]],
        ),
        canManage: scope === "manage",
      });
    });
  }
  async articleDetail(actor: Principal, id: string) {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.article(client, id, scope === "manage"),
    );
  }
  async createArticle(
    actor: Principal,
    input: z.infer<typeof hdArticleCreateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO hd_article(id,tenant_id,entity_id,category_id,title,body,keywords) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.categoryId ?? null,
            input.title,
            input.body,
            input.keywords,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.article_created",
          `hd-article:${id}`,
          id,
          1,
          { keywordCount: input.keywords.length },
        );
        return this.article(client, id, true);
      }),
    );
  }
  async updateArticle(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdArticleUpdateSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockArticle(client, id, input.version);
        await client.query(
          "UPDATE hd_article SET category_id=$2, title=$3, body=$4, keywords=$5, version=version+1 WHERE id=$1",
          [
            id,
            input.categoryId ?? null,
            input.title,
            input.body,
            input.keywords,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.article_updated",
          `hd-article:${id}`,
          id,
          row.version + 1,
          { keywordCount: input.keywords.length },
        );
        return this.article(client, id, true);
      }),
    );
  }
  async articleStep(
    actor: Principal,
    id: string,
    step: ArticleStep,
    input: z.infer<typeof hdArticleActionSchema>,
    requestId: string,
  ) {
    this.manage(actor);
    const to = articleSteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockArticle(client, id, input.version);
        if (row.status === to)
          throw new ConflictException(`This article is already ${to}.`);
        await client.query(
          "UPDATE hd_article SET status=$2, version=version+1 WHERE id=$1",
          [id, to],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.article_status_changed",
          `hd-article:${id}`,
          id,
          row.version + 1,
          { from: row.status, to },
        );
        return this.article(client, id, true);
      }),
    );
  }
  // Rule-based keyword matching (no AI): published articles in the category or uncategorised,
  // ranked by how many words of the text match an article's keywords or title words.
  async suggest(
    actor: Principal,
    query: z.infer<typeof hdSuggestQuerySchema>,
  ): Promise<HdSuggestionList> {
    this.see(actor);
    const words = [
      ...new Set(
        query.q
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 3 && !STOP.has(w)),
      ),
    ].slice(0, 20);
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT id, title, "categoryName", matched AS "matchedWords" FROM (
           SELECT a.id, a.title, k.name AS "categoryName", a.published_at, (a.category_id IS NOT DISTINCT FROM $1) AS same,
             (SELECT count(*)::int FROM unnest($2::text[]) w
              WHERE w=ANY(a.keywords) OR w=ANY(regexp_split_to_array(lower(a.title),'[^[:alnum:]]+'))) AS matched
           FROM hd_article a LEFT JOIN hd_category k ON k.id=a.category_id
           WHERE a.status='published' AND ($1::uuid IS NULL OR a.category_id=$1 OR a.category_id IS NULL)) s
         WHERE matched>0 OR (cardinality($2::text[])=0 AND $1::uuid IS NOT NULL AND same)
         ORDER BY matched DESC, same DESC, published_at DESC, id LIMIT 5`,
        [query.categoryId ?? null, words],
      );
      return hdSuggestionListSchema.parse({
        items: rows,
        method: "keyword_match",
      });
    });
  }
  private async article(client: PoolClient, id: string, canEdit: boolean) {
    const { rows } = await client.query<Omit<HdArticle, "canEdit">>(
      `SELECT ${articleColumns} FROM hd_article a WHERE a.id=$1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException("This article is unavailable.");
    return hdArticleSchema.parse({ ...rows[0], canEdit });
  }
  private async lockArticle(client: PoolClient, id: string, version: number) {
    const found = await client.query<Locked>(
      "SELECT status, version FROM hd_article WHERE id=$1 FOR UPDATE",
      [id],
    );
    return this.fresh(found.rows[0], version, "article");
  }

  // ---- Agents ----
  async agents(actor: Principal): Promise<HdAgentList> {
    const scope = this.see(actor);
    if (scope === "self")
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
    return scoped(this.platform.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT employee_id AS "employeeId", name FROM hd_agents()`,
      );
      return hdAgentListSchema.parse({ items: rows });
    });
  }

  // ---- Cases ----
  async listCases(
    actor: Principal,
    query: z.infer<typeof hdCaseQuerySchema>,
  ): Promise<HdCaseList> {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, async (client) => {
      const where = `($2='%%' OR c.subject ILIKE $2 OR c.code ILIKE $2 OR c.requester_name ILIKE $2)
        AND ($3::text IS NULL OR c.status=$3) AND ($4::text IS NULL OR c.priority=$4)
        AND ($5::uuid IS NULL OR c.category_id=$5)
        AND ($6::boolean IS NULL OR (${responseBreached} OR ${resolveBreached})=$6)
        AND ($7='all' OR ($7='mine' AND c.requester_employee_id=$1) OR ($7='assigned' AND c.assignee_employee_id=$1)
          OR ($7='unassigned' AND c.assignee_employee_id IS NULL AND c.status IN ${LIVE}))`;
      const base = [
        actor.employeeId,
        escapeLike(query.q),
        query.status ?? null,
        query.priority ?? null,
        query.categoryId ?? null,
        query.breached === undefined ? null : query.breached === "true",
        query.view,
      ];
      const total = await this.count(
        client,
        `SELECT count(*)::int AS count FROM hd_case c WHERE ${where}`,
        base,
      );
      const { rows } = await client.query<CaseRow>(
        `SELECT ${caseColumns} FROM hd_case c WHERE ${where}
         ORDER BY (c.status IN ${LIVE}) DESC, CASE WHEN c.status IN ${LIVE} THEN c.resolve_due END, c.created_at DESC, c.id
         LIMIT $8 OFFSET $9`,
        [...base, query.limit, (query.page - 1) * query.limit],
      );
      const statusless = [...base];
      statusless[2] = null;
      return hdCaseListSchema.parse({
        items: rows.map((row) => this.caseFlags(scope, row)),
        total,
        page: query.page,
        limit: query.limit,
        counts: await this.counts(
          client,
          `SELECT c.status AS key, count(*)::int AS count FROM hd_case c WHERE ${where} GROUP BY c.status`,
          CASE_STATUSES,
          statusless,
        ),
        canWork: scope !== "self",
      });
    });
  }
  async caseDetail(actor: Principal, id: string) {
    const scope = this.see(actor);
    return scoped(this.platform.pool, actor, (client) =>
      this.detail(client, actor, scope, id),
    );
  }
  async createCase(
    actor: Principal,
    input: z.infer<typeof hdCaseCreateSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO hd_case(id,tenant_id,entity_id,category_id,subject,description,priority,confidential)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            actor.tenantId,
            actor.entityId,
            input.categoryId,
            input.subject,
            input.description,
            input.priority,
            input.confidential,
          ],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.case_created",
          `hd-case:${id}`,
          id,
          1,
          { status: "open", priority: input.priority },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async addComment(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdCommentCreateSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.visibleCase(client, id);
        // Each comment is its own outbox aggregate (the case version does not change). Internal
        // notes have their own event type so no consumer can mistake one for requester-facing
        // activity (061).
        const commentId = await this.comment(
          client,
          actor,
          id,
          input.kind,
          input.body,
        );
        await this.record(
          client,
          actor,
          requestId,
          input.kind === "internal"
            ? "helpdesk.internal_note_added"
            : "helpdesk.comment_added",
          `hd-case:${id}`,
          commentId,
          1,
          { kind: input.kind },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async assign(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdAssignSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCase(client, id, input.version);
        await client.query(
          "UPDATE hd_case SET assignee_employee_id=$2, version=version+1 WHERE id=$1",
          [id, input.assigneeEmployeeId],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.case_assigned",
          `hd-case:${id}`,
          id,
          row.version + 1,
          {
            assigneeEmployeeId: input.assigneeEmployeeId,
            reassigned: row.assigneeEmployeeId !== null,
          },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async setPriority(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdPrioritySetSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCase(client, id, input.version);
        await client.query(
          "UPDATE hd_case SET priority=$2, version=version+1 WHERE id=$1",
          [id, input.priority],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.case_priority_changed",
          `hd-case:${id}`,
          id,
          row.version + 1,
          { from: row.priority, to: input.priority },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async setConfidential(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdConfidentialSetSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCase(client, id, input.version);
        // An agent without helpdesk.manage would lose sight of a case they have not taken
        // (the guard refuses it too, 061).
        if (
          scope === "agent" &&
          input.confidential &&
          row.assigneeEmployeeId !== actor.employeeId
        )
          throw new ConflictException(
            "Take the case before marking it confidential.",
          );
        await client.query(
          "UPDATE hd_case SET confidential=$2, version=version+1 WHERE id=$1",
          [id, input.confidential],
        );
        // The flag itself is not recorded: an audit reader learns only that it changed.
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.case_confidentiality_changed",
          `hd-case:${id}`,
          id,
          row.version + 1,
          {},
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async caseStep(
    actor: Principal,
    id: string,
    step: CaseStep,
    input: z.infer<typeof hdCaseActionSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    const { from, to } = caseSteps[step];
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCase(client, id, input.version);
        if (!(from as readonly string[]).includes(String(row.status)))
          throw new ConflictException(
            `A ${String(row.status).replaceAll("_", " ")} case cannot ${step}.`,
          );
        if (input.note)
          await this.comment(client, actor, id, "comment", input.note);
        await client.query(
          "UPDATE hd_case SET status=$2, version=version+1 WHERE id=$1",
          [id, to],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.case_status_changed",
          `hd-case:${id}`,
          id,
          row.version + 1,
          { from: row.status, to, noteGiven: Boolean(input.note) },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async closeCase(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdCaseCloseSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        const row = await this.lockCase(client, id, input.version);
        await client.query(
          "UPDATE hd_case SET status='closed', satisfaction=$2, version=version+1 WHERE id=$1",
          [id, input.satisfaction ?? null],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.case_status_changed",
          `hd-case:${id}`,
          id,
          row.version + 1,
          {
            from: row.status,
            to: "closed",
            rated: input.satisfaction !== undefined,
          },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }
  async linkArticle(
    actor: Principal,
    id: string,
    input: z.infer<typeof hdArticleLinkSchema>,
    requestId: string,
  ) {
    const scope = this.see(actor);
    return this.rules(() =>
      scoped(this.platform.pool, actor, async (client) => {
        await this.visibleCase(client, id);
        const linkId = randomUUID();
        await client.query(
          `INSERT INTO hd_case_article(id,tenant_id,entity_id,case_id,article_id) VALUES ($1,$2,$3,$4,$5)`,
          [linkId, actor.tenantId, actor.entityId, id, input.articleId],
        );
        await this.record(
          client,
          actor,
          requestId,
          "helpdesk.article_linked",
          `hd-case:${id}`,
          linkId,
          1,
          { articleId: input.articleId },
        );
        return this.detail(client, actor, scope, id);
      }),
    );
  }

  private async comment(
    client: PoolClient,
    actor: Principal,
    caseId: string,
    kind: "comment" | "internal",
    body: string,
  ) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO hd_case_comment(id,tenant_id,entity_id,case_id,kind,body) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, actor.tenantId, actor.entityId, caseId, kind, body],
    );
    return id;
  }
  private caseFlags(scope: "self" | "agent" | "manage", row: CaseRow): HdCase {
    const { inReopenWindow, ...rest } = row;
    const agent = scope !== "self" && !row.mine;
    const live = ["open", "in_progress", "waiting_on_employee"].includes(
      row.status,
    );
    const final = row.status === "closed" || row.status === "cancelled";
    const assigned = row.assigneeEmployeeId !== null;
    return hdCaseSchema.parse({
      ...rest,
      breached: row.responseBreached || row.resolveBreached,
      canComment: !final && (row.mine || agent),
      canAddInternalNote: !final && agent,
      canAssign: live && agent && scope === "manage",
      canTake:
        live && agent && !row.assignedToMe && (scope === "manage" || !assigned),
      canStart: agent && row.status === "open" && assigned,
      canWait: agent && (row.status === "open" || row.status === "in_progress"),
      canResume: agent && row.status === "waiting_on_employee",
      canResolve:
        live && agent && assigned && (row.assignedToMe || scope === "manage"),
      canReopen: row.mine && inReopenWindow,
      canClose:
        row.status === "resolved" && (row.mine || (agent && !inReopenWindow)),
      canCancel: live && (row.mine || (agent && scope === "manage")),
      canChangePriority: live && agent,
      canChangeConfidential:
        live && agent && (scope === "manage" || !row.confidential),
      canLinkArticle: !final && agent,
    });
  }
  private async detail(
    client: PoolClient,
    actor: Principal,
    scope: "self" | "agent" | "manage",
    id: string,
  ): Promise<HdCaseDetail> {
    const found = await client.query<CaseRow>(
      `SELECT ${caseColumns} FROM hd_case c WHERE c.id=$2`,
      [actor.employeeId, id],
    );
    if (!found.rows[0]) throw new NotFoundException(unavailable);
    const comments = await client.query(
      `SELECT x.id, x.kind, x.body, x.author_role AS "authorRole", x.author_label AS "authorLabel",
         (x.author_employee_id=$1) AS mine, ${stamp("x.at")} AS at
       FROM hd_case_comment x WHERE x.case_id=$2 ORDER BY x.seq LIMIT 600`,
      [actor.employeeId, id],
    );
    const history = await client.query(
      `SELECT h.id, h.from_status AS "fromStatus", h.to_status AS "toStatus", h.assignee_name AS "assigneeName",
         h.assignee_changed AS "assigneeChanged", h.priority, h.priority_changed AS "priorityChanged",
         h.confidential, h.confidential_changed AS "confidentialChanged", h.by_label AS "byLabel", ${stamp("h.at")} AS at
       FROM (SELECT * FROM hd_case_history WHERE case_id=$1 ORDER BY seq DESC LIMIT 500) h ORDER BY h.seq`,
      [id],
    );
    const articles = await client.query(
      `SELECT l.article_id AS "articleId", a.title, l.by_label AS "linkedBy", ${stamp("l.at")} AS at
       FROM hd_case_article l LEFT JOIN hd_article a ON a.id=l.article_id WHERE l.case_id=$1 ORDER BY l.at, l.id`,
      [id],
    );
    return hdCaseDetailSchema.parse({
      case: this.caseFlags(scope, found.rows[0]),
      comments: comments.rows,
      history: history.rows,
      articles: articles.rows,
    });
  }
  // ---- Locks: the advisory lock first (same key as the guards), then the row ----
  private async caseLock(client: PoolClient, id: string) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('hd-case:'||$1::text,0))",
      [id],
    );
  }
  // A case the caller cannot see answers exactly like one that does not exist.
  private async visibleCase(client: PoolClient, id: string) {
    await this.caseLock(client, id);
    const found = await client.query<Locked>(
      "SELECT status, version FROM hd_case WHERE id=$1",
      [id],
    );
    if (!found.rows[0]) throw new NotFoundException(unavailable);
    return found.rows[0];
  }
  private async lockCase(client: PoolClient, id: string, version: number) {
    await this.caseLock(client, id);
    const found = await client.query<Locked>(
      `SELECT status, priority, assignee_employee_id AS "assigneeEmployeeId", version FROM hd_case WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!found.rows[0]) throw new NotFoundException(unavailable);
    return this.fresh(found.rows[0], version, "case");
  }
  private fresh(row: Locked | undefined, version: number, what: string) {
    if (!row) throw new NotFoundException(`This ${what} is unavailable.`);
    if (row.version !== version)
      throw new ConflictException(
        `This ${what} changed. Reload it before trying again.`,
      );
    return row;
  }
  private async count(client: PoolClient, sql: string, params: unknown[]) {
    const { rows } = await client.query<{ count: number }>(sql, params);
    return rows[0]?.count ?? 0;
  }
  private async counts(
    client: PoolClient,
    sql: string,
    keys: readonly string[],
    params: unknown[] = [],
  ) {
    const counts: Record<string, number> = Object.fromEntries(
      keys.map((k) => [k, 0]),
    );
    for (const row of (
      await client.query<{ key: string; count: number }>(sql, params)
    ).rows)
      counts[row.key] = row.count;
    return counts;
  }
  private async record(
    client: PoolClient,
    actor: Principal,
    requestId: string,
    action: string,
    target: string,
    aggregateId: string,
    version: number,
    details: Record<string, unknown>,
  ) {
    await audit(client, actor, action, target, requestId, { details });
    await client.query(
      `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        actor.tenantId,
        actor.entityId,
        `${action}.v1`,
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
        if (typeof code === "string" && conflictCodes.has(code))
          throw new ConflictException(retry);
        if (code === "23503")
          throw new BadRequestException(
            "A referenced category, article or person is unavailable.",
          );
        if (code === "23514")
          throw new BadRequestException(
            "That value is outside what is allowed.",
          );
        if (code === "23505") {
          const constraint =
            "constraint" in error ? String(error.constraint) : "";
          throw new ConflictException(
            uniqueMessages[constraint] ?? "This already exists.",
          );
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
