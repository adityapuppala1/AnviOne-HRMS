import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  ForbiddenException,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from "@nestjs/common";
import {
  makePool,
  scoped,
  audit,
  transaction,
  setContext,
} from "@anvi/database";
import {
  permissionMatrix,
  permissionsFor,
  scopeFor,
  type Principal,
  type Permission,
} from "@anvi/authz";
import {
  brandingSchema,
  employeeSchema,
  employeeDetailSchema,
  type Role,
  type Branding,
  type BrandingUpdate,
  type BrandingHistory,
  type PermissionMatrix,
  type IntegrationReadiness,
  roleLabels,
  roleSchema,
  brandingHistorySchema,
  type Directory,
  type Dashboard,
  type Me,
  type directoryQuerySchema,
} from "@anvi/contracts";
import type { z } from "zod";
import { readClassification } from "./organization.store";
import type { Config } from "./config";

export const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const opaque = () => randomBytes(32).toString("base64url");
export type SessionActor = Principal & {
  csrfToken: string;
  entityName: string;
};
const employeeColumns = `id, code, name, title, department, location, email, joined_on::text AS "joinedOn", status, initials`;
// History trigger/guard SQLSTATEs map to generic messages; trigger text is never returned.
const brandingError = (error: unknown): never => {
  const code = (error as { code?: string }).code;
  if (code === "BR001" || code === "BR002")
    throw new ConflictException(
      "Workspace settings changed. Reload before saving again.",
    );
  throw error;
};
const brandingColumns = `platform_name AS "platformName", employee_name AS "employeeName", organization_name AS "organizationName", theme, version`;
export class PlatformStore {
  readonly pool;
  constructor(readonly config: Config) {
    this.pool = makePool(config.DATABASE_URL);
    // An idle pool connection may fail during a database restart. Report metadata
    // without credentials and allow the next connection attempt to recover.
    this.pool.on("error", () => {
      console.error(JSON.stringify({ event: "database.connection_lost" }));
    });
  }
  async verifyRuntimeRole() {
    const { rows } = await this.pool.query<{ unsafe: boolean }>(
      `SELECT r.rolsuper OR r.rolbypassrls OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'employee' AND tableowner = current_user) AS unsafe FROM pg_roles r WHERE rolname = current_user`,
    );
    if (rows[0]?.unsafe !== false)
      throw new Error(
        "Database runtime identity must not own tables or bypass row isolation",
      );
  }
  async resolveIdentity(issuer: string, subject: string): Promise<Principal> {
    const { rows } = await this.pool.query<{
      actor: Omit<Principal, "role"> | null;
    }>("SELECT resolve_identity($1,$2) AS actor", [issuer, subject]);
    const actor = rows[0]?.actor;
    if (!actor || !actor.roles[0])
      throw new UnauthorizedException(
        "Access is not available. Contact your HR team.",
      );
    return { ...actor, role: actor.roles[0] };
  }
  async createSession(
    actor: Principal,
    requestId: string,
    oldToken?: string,
    action = "session.started",
  ) {
    const token = opaque();
    await scoped(this.pool, actor, async (client) => {
      if (oldToken)
        await client.query("DELETE FROM app_session WHERE token_hash = $1", [
          hash(oldToken),
        ]);
      await client.query(
        `INSERT INTO app_session(token_hash,actor_id,role,csrf_token,expires_at)
        VALUES ($1,$2,$3,$4,now() + interval '8 hours')`,
        [hash(token), actor.actorId, actor.role, opaque()],
      );
      await audit(client, actor, action, actor.actorId, requestId);
    });
    return token;
  }
  // Idle limits per role. These mirror resolve_session() in the database, which
  // enforces them; the portal only needs the number to warn before sign-out.
  idleLimitSeconds(role: SessionActor["role"]) {
    return role === "employee" || role === "manager" ? 1800 : 900;
  }
  // Background polling validates the session but must not count as activity,
  // otherwise a forgotten open tab would never reach its idle limit.
  async session(
    token: unknown,
    options: { touch?: boolean } = {},
  ): Promise<SessionActor> {
    if (typeof token !== "string" || token.length !== 43)
      throw new UnauthorizedException("Sign in to continue.");
    const { rows } = await this.pool.query<{ actor: SessionActor | null }>(
      "SELECT resolve_session($1) AS actor",
      [hash(token)],
    );
    const actor = rows[0]?.actor;
    if (!actor)
      throw new UnauthorizedException("Your session has ended. Sign in again.");
    if (options.touch !== false)
      await this.pool.query(
        "UPDATE app_session SET last_seen_at = now() WHERE token_hash = $1",
        [hash(token)],
      );
    return actor;
  }
  me(actor: SessionActor): Me {
    return {
      actorId: actor.actorId,
      employeeId: actor.employeeId,
      name: actor.name,
      role: actor.role,
      roles: actor.roles,
      csrfToken: actor.csrfToken,
      entityName: actor.entityName,
      demo: this.config.AUTH_MODE === "demo",
      permissions: permissionsFor(actor),
      idleLimitSeconds: this.idleLimitSeconds(actor.role),
    };
  }
  require(actor: Principal, permission: Permission) {
    if (!scopeFor(actor, permission))
      throw new ForbiddenException(
        "Your current workspace does not have access.",
      );
  }
  async switchRole(
    actor: SessionActor,
    role: Role,
    token: string,
    requestId: string,
  ) {
    if (!actor.roles.includes(role))
      throw new ForbiddenException("This role is not assigned to you.");
    // Keep the original absolute expiry: switching roles cannot extend a session.
    return transaction(this.pool, async (client) => {
      await setContext(client, actor);
      const old = await client.query<{ expires_at: Date; created_at: Date }>(
        "DELETE FROM app_session WHERE token_hash = $1 AND actor_id = $2 RETURNING expires_at, created_at",
        [hash(token), actor.actorId],
      );
      if (!old.rows[0])
        throw new UnauthorizedException("Your session has ended.");
      const nextToken = opaque();
      await client.query(
        "INSERT INTO app_session(token_hash,actor_id,role,csrf_token,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          hash(nextToken),
          actor.actorId,
          role,
          opaque(),
          old.rows[0].expires_at,
          old.rows[0].created_at,
        ],
      );
      await audit(
        client,
        { ...actor, role },
        "session.role_changed",
        `${actor.role} → ${role}`,
        requestId,
      );
      return nextToken;
    });
  }
  async logout(actor: Principal, token: string, requestId: string) {
    await scoped(this.pool, actor, async (client) => {
      await client.query("DELETE FROM app_session WHERE token_hash = $1", [
        hash(token),
      ]);
      await audit(client, actor, "session.ended", actor.actorId, requestId);
    });
  }
  async directory(
    actor: Principal,
    query: z.infer<typeof directoryQuerySchema>,
  ): Promise<Directory> {
    this.require(actor, "directory.read");
    return scoped(this.pool, actor, async (client) => {
      const term = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const where = `status IN ('active','notice') AND (name ILIKE $1 OR code ILIKE $1 OR title ILIKE $1 OR department ILIKE $1) AND ($2 = '' OR department = $2) AND ($3 = '' OR location = $3)`;
      const params = [term, query.department, query.location];
      const count = await client.query<{ count: string }>(
        `SELECT count(*) FROM employee_directory WHERE ${where}`,
        params,
      );
      const total = Number(count.rows[0]!.count);
      const pages = Math.max(1, Math.ceil(total / query.limit));
      const page = Math.min(query.page, pages);
      const result = await client.query(
        `SELECT ${employeeColumns} FROM employee_directory WHERE ${where} ORDER BY name,id LIMIT $4 OFFSET $5`,
        [...params, query.limit, (page - 1) * query.limit],
      );
      const facets = await client.query<{
        departments: string[];
        locations: string[];
      }>(
        `SELECT array_agg(DISTINCT department ORDER BY department) AS departments, array_agg(DISTINCT location ORDER BY location) AS locations FROM employee_directory WHERE status IN ('active','notice')`,
      );
      return {
        items: result.rows.map((row) => employeeSchema.parse(row)),
        total,
        page,
        pages,
        departments: facets.rows[0]?.departments ?? [],
        locations: facets.rows[0]?.locations ?? [],
      };
    });
  }
  async employee(actor: Principal, id: string) {
    this.require(actor, "directory.read");
    return scoped(this.pool, actor, async (client) => {
      const result = await client.query(
        `SELECT ${employeeColumns} FROM employee_directory WHERE id = $1 AND status IN ('active','notice')`,
        [id],
      );
      if (!result.rows[0])
        throw new NotFoundException("This profile is unavailable.");
      // Grade and cost centre are HR or self only; designation is a directory field.
      const classification = await readClassification(client, id);
      const restricted =
        actor.employeeId !== id && !scopeFor(actor, "organization.read");
      return employeeDetailSchema.parse({
        ...employeeSchema.parse(result.rows[0]),
        ...classification,
        grade: restricted ? null : classification.grade,
        costCenter: restricted ? null : classification.costCenter,
        classificationRestricted: restricted,
      });
    });
  }
  async dashboard(actor: Principal): Promise<Dashboard> {
    this.require(actor, "directory.read");
    return scoped(this.pool, actor, async (client) => {
      const total = await client.query<{ count: string }>(
        `SELECT count(*) FROM employee_directory WHERE status IN ('active','notice')`,
      );
      const departments = await client.query<{ name: string; count: number }>(
        `SELECT department AS name, count(*)::int AS count FROM employee_directory WHERE status IN ('active','notice') GROUP BY department ORDER BY count DESC,department`,
      );
      const locations = await client.query<{ name: string; count: number }>(
        `SELECT location AS name,count(*)::int AS count FROM employee_directory WHERE status IN ('active','notice') GROUP BY location ORDER BY location`,
      );
      const recent = await client.query(
        `SELECT ${employeeColumns} FROM employee_directory WHERE status IN ('active','notice') ORDER BY joined_on DESC,id LIMIT 4`,
      );
      return {
        total: Number(total.rows[0]!.count),
        departments: departments.rows,
        locations: locations.rows,
        recent: recent.rows.map((row) => employeeSchema.parse(row)),
        asOf: new Date().toISOString(),
      };
    });
  }
  async branding(actor: Principal): Promise<Branding> {
    return scoped(this.pool, actor, async (client) => {
      const result = await client.query(
        `SELECT ${brandingColumns} FROM branding`,
      );
      if (!result.rows[0])
        throw new NotFoundException("Workspace branding is not configured.");
      return brandingSchema.parse(result.rows[0]);
    });
  }
  async updateBranding(
    actor: Principal,
    input: BrandingUpdate,
    requestId: string,
  ) {
    this.require(actor, "branding.write");
    return scoped(this.pool, actor, async (client) => {
      // Read by the branding history trigger; transaction-local.
      await client.query(
        `SELECT set_config('app.branding_source','edit',true), set_config('app.branding_reason',$1,true), set_config('app.branding_restored_version','',true)`,
        [input.reason ?? ""],
      );
      const result = await client.query(
        `UPDATE branding SET platform_name=$1, employee_name=$2, organization_name=$3, theme=$4, version=version+1 WHERE version=$5 RETURNING ${brandingColumns}`,
        [
          input.platformName,
          input.employeeName,
          input.organizationName,
          input.theme,
          input.version,
        ],
      );
      if (!result.rows[0])
        throw new ConflictException(
          "Workspace settings changed. Reload before saving again.",
        );
      const updated = brandingSchema.parse(result.rows[0]);
      await audit(
        client,
        actor,
        "branding.published",
        `branding:v${updated.version}`,
        requestId,
        input.reason ? { reason: input.reason } : undefined,
      );
      await client.query(
        `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES ($1,$2,$3,'branding.published.v1',$3,$4)`,
        [randomUUID(), actor.tenantId, actor.entityId, updated.version],
      );
      return updated;
    }).catch(brandingError);
  }
  async brandingHistory(
    actor: Principal,
    query: { limit: number; beforeVersion?: number },
  ): Promise<BrandingHistory> {
    this.require(actor, "branding.write");
    return scoped(this.pool, actor, async (client) => {
      const { rows } = await client.query(
        `SELECT version, platform_name AS "platformName", employee_name AS "employeeName",
          organization_name AS "organizationName", theme, source, restored_version AS "restoredVersion",
          changed_by AS "changedBy", reason, occurred_at AS "occurredAt"
        FROM branding_history WHERE ($1::int IS NULL OR version < $1) AND tenant_id=$3 AND entity_id=$4
        ORDER BY version DESC LIMIT $2`,
        [
          query.beforeVersion ?? null,
          query.limit + 1,
          actor.tenantId,
          actor.entityId,
        ],
      );
      const items = rows.slice(0, query.limit).map((row) => ({
        ...row,
        occurredAt: new Date(row.occurredAt).toISOString(),
      }));
      return brandingHistorySchema.parse({
        items,
        nextBeforeVersion:
          rows.length > query.limit ? items[items.length - 1]!.version : null,
      });
    });
  }
  async rollbackBranding(
    actor: Principal,
    input: { toVersion: number; version: number; reason: string },
    requestId: string,
  ): Promise<Branding> {
    this.require(actor, "branding.write");
    return scoped(this.pool, actor, async (client) => {
      const current = (
        await client.query(
          `SELECT ${brandingColumns} FROM branding WHERE tenant_id=$1 AND entity_id=$2 FOR UPDATE`,
          [actor.tenantId, actor.entityId],
        )
      ).rows[0] as Branding | undefined;
      if (!current)
        throw new NotFoundException("Workspace branding is not configured.");
      if (current.version !== input.version)
        throw new ConflictException(
          "Workspace settings changed. Reload before rolling back.",
        );
      if (input.toVersion === current.version)
        throw new ConflictException("That version is already current.");
      const target = (
        await client.query(
          `SELECT platform_name AS "platformName", employee_name AS "employeeName", organization_name AS "organizationName", theme FROM branding_history WHERE version=$1 AND tenant_id=$2 AND entity_id=$3`,
          [input.toVersion, actor.tenantId, actor.entityId],
        )
      ).rows[0] as Omit<Branding, "version"> | undefined;
      if (!target)
        throw new NotFoundException("That branding version is not recorded.");
      const fields = (
        ["platformName", "employeeName", "organizationName", "theme"] as const
      ).filter((field) => target[field] !== current[field]);
      if (!fields.length)
        throw new ConflictException(
          "That version matches the current branding.",
        );
      await client.query(
        `SELECT set_config('app.branding_source','rollback',true), set_config('app.branding_reason',$1,true), set_config('app.branding_restored_version',$2,true)`,
        [input.reason, String(input.toVersion)],
      );
      const result = await client.query(
        `UPDATE branding SET platform_name=$1, employee_name=$2, organization_name=$3, theme=$4, version=version+1 WHERE version=$5 RETURNING ${brandingColumns}`,
        [
          target.platformName,
          target.employeeName,
          target.organizationName,
          target.theme,
          current.version,
        ],
      );
      if (!result.rows[0])
        throw new ConflictException(
          "Workspace settings changed. Reload before rolling back.",
        );
      const updated = brandingSchema.parse(result.rows[0]);
      await audit(
        client,
        actor,
        "branding.rolled_back",
        `branding:v${updated.version}`,
        requestId,
        {
          reason: input.reason,
          details: {
            fromVersion: current.version,
            toVersion: input.toVersion,
            newVersion: updated.version,
            fields,
          },
        },
      );
      await client.query(
        `INSERT INTO outbox_event(id,tenant_id,entity_id,event_type,aggregate_id,aggregate_version) VALUES ($1,$2,$3,'branding.rolled_back.v1',$3,$4)`,
        [randomUUID(), actor.tenantId, actor.entityId, updated.version],
      );
      return updated;
    }).catch(brandingError);
  }
  permissionMatrix(actor: Principal): PermissionMatrix {
    this.require(actor, "admin.read");
    return {
      source: "code",
      note: "Roles and permissions are defined in code and change only through a reviewed deploy; they cannot be edited at runtime.",
      roles: roleSchema.options.map((role) => ({
        role,
        label: roleLabels[role],
      })),
      permissions: permissionMatrix(),
    };
  }
  integrations(actor: Principal): IntegrationReadiness {
    this.require(actor, "admin.read");
    // Derived from configuration presence only: never secrets, URLs, key ids or key material.
    const c = this.config;
    const demo = c.AUTH_MODE === "demo";
    const keyCount =
      (c.PROFILE_DATA_KEYS?.length ?? 0) + (c.PROFILE_DATA_KEY ? 1 : 0);
    const interval = c.PROFILE_APPLY_DUE_INTERVAL_MS;
    return {
      asOf: new Date().toISOString(),
      items: [
        {
          key: "oidc",
          name: "Corporate sign-in (OIDC)",
          status: demo ? "demo" : "configured",
          note: demo
            ? "Loopback demo sign-in with synthetic people; corporate sign-in is not in use."
            : "Corporate sign-in is configured for a tenant-specific HTTPS issuer.",
          detail: { requiredAuthContext: Boolean(c.OIDC_REQUIRED_ACR) },
        },
        {
          key: "rate_limit_store",
          name: "Rate-limit store (Valkey)",
          status: c.RATE_LIMIT_URL ? "configured" : "not_configured",
          note: c.RATE_LIMIT_URL
            ? "Rate-limit counters are shared across API replicas."
            : "Counters are kept in this process only; replicas would each grant a full budget.",
          detail: { tls: Boolean(c.RATE_LIMIT_URL?.startsWith("rediss:")) },
        },
        {
          key: "document_scanning",
          name: "Document storage and malware scanning",
          status: "not_configured",
          note: "Documents are stored in the database after type and size checks; no malware scanner is connected.",
          detail: {},
        },
        {
          key: "notifications",
          name: "Notification dispatch",
          status: "not_configured",
          note: "Events are recorded in the outbox and receipted by the worker; no email, chat or push delivery is connected.",
          detail: {},
        },
        {
          key: "profile_data_keys",
          name: "Profile data keys",
          status: keyCount ? "configured" : "not_configured",
          note: keyCount
            ? "Personal contact details are sealed at rest; the newest key seals and older keys still open."
            : "No key is configured; personal contact details are not sealed.",
          detail: { keyCount },
        },
        {
          key: "worker_schedules",
          name: "Worker schedules",
          status: interval ? "configured" : "not_configured",
          note:
            interval === undefined
              ? "The API does not see the worker's schedule setting; the worker defaults to hourly application of due profile changes."
              : interval > 0
                ? "Due profile changes are applied on a schedule."
                : "Scheduled application of due profile changes is turned off.",
          detail: interval
            ? { profileApplyDueIntervalMinutes: Math.round(interval / 60000) }
            : {},
        },
        {
          key: "ai_helper",
          name: "AI helper",
          status: "not_configured",
          note: "The AI helper is gated off; workspace suggestions are rule-based.",
          detail: {},
        },
      ],
    };
  }
  async auditEvents(actor: Principal) {
    this.require(actor, "audit.read");
    return scoped(
      this.pool,
      actor,
      async (client) =>
        (
          await client.query(
            `SELECT id, action, actor_label AS actor, role, target, occurred_at AS "occurredAt", request_id AS "requestId", reason FROM audit_event ORDER BY occurred_at DESC,id LIMIT 50`,
          )
        ).rows,
    );
  }
}
