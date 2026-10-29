import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { scopeFor, type Principal } from "@anvi/authz";
export { type PoolClient } from "pg";

export function makePool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
}
export async function transaction<T>(
  pool: pg.Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function setContext(client: PoolClient, actor: Principal) {
  await client.query(
    `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
    set_config('app.employee_id',$3,true), set_config('app.directory_scope',$4,true),
    set_config('app.hr_scope',$5,true), set_config('app.onboarding_scope',$6,true),
    set_config('app.actor_id',$7,true), set_config('app.actor_label',$8,true),
    set_config('app.onboarding_task_scope',$9,true), set_config('app.leave_scope',$10,true),
    set_config('app.attendance_scope',$11,true), set_config('app.document_scope',$12,true),
    set_config('app.asset_scope',$13,true),
    set_config('app.policy_scope',$14,true),
    set_config('app.exit_scope',$15,true),
    set_config('app.expense_scope',$16,true),
    set_config('app.profile_scope',$17,true),
    set_config('app.report_scope',$18,true),
    set_config('app.branding_scope',$19,true),
    set_config('app.project_scope',$20,true),
    set_config('app.recruit_scope',$21,true),
    set_config('app.perf_scope',$22,true),
    set_config('app.helpdesk_scope',$23,true),
    set_config('app.engage_scope',$24,true),
    set_config('app.learn_scope',$25,true),
    set_config('app.shift_scope',$26,true)`,
    [
      actor.tenantId,
      actor.entityId,
      actor.employeeId,
      scopeFor(actor, "directory.read") ?? "none",
      scopeFor(actor, "organization.write")
        ? "write"
        : scopeFor(actor, "organization.read")
          ? "read"
          : "none",
      scopeFor(actor, "onboarding.manage") ? "write" : "none",
      actor.actorId,
      actor.name,
      scopeFor(actor, "onboarding.task.update") ?? "none",
      // Approval scope widens visibility; requesters without it see only themselves.
      scopeFor(actor, "leave.approve") ??
        scopeFor(actor, "leave.request") ??
        "none",
      scopeFor(actor, "attendance.review") ??
        scopeFor(actor, "attendance.self") ??
        "none",
      scopeFor(actor, "document.review") ??
        scopeFor(actor, "document.self") ??
        "none",
      scopeFor(actor, "asset.manage") ??
        scopeFor(actor, "asset.self") ??
        "none",
      scopeFor(actor, "policy.manage") ??
        scopeFor(actor, "policy.self") ??
        "none",
      scopeFor(actor, "exit.manage") ?? scopeFor(actor, "exit.self") ?? "none",
      // Approval scope widens visibility (team or entity); claimants see only themselves.
      scopeFor(actor, "expense.approve") ??
        scopeFor(actor, "expense.self") ??
        "none",
      // HR reads and decides for the entity; everyone else only their own profile.
      scopeFor(actor, "profile.review") ??
        scopeFor(actor, "profile.self") ??
        "none",
      // Saved report definitions only; report rows use each domain's own scope.
      scopeFor(actor, "report.run") ?? "none",
      // Branding history is visible only to roles that may publish branding.
      scopeFor(actor, "branding.write") ?? "none",
      // Owners (team) and HR (entity) manage; members see only their own projects.
      scopeFor(actor, "project.manage") ??
        scopeFor(actor, "project.self") ??
        "none",
      // HR (entity) manages recruiting; hiring managers (team) their own requisitions;
      // interviewers (self) only the interviews they sit on.
      scopeFor(actor, "recruit.manage") ??
        scopeFor(actor, "recruit.request") ??
        scopeFor(actor, "recruit.interview") ??
        "none",
      // HR (entity) sees and finalises every review; managers (team) their direct reports';
      // everyone else (self) only their own goals and review.
      scopeFor(actor, "performance.manage") ??
        scopeFor(actor, "performance.review") ??
        scopeFor(actor, "performance.self") ??
        "none",
      // manage: every case including confidential ones; agent: the non-confidential queue and
      // confidential cases assigned to them; self: only their own cases.
      scopeFor(actor, "helpdesk.manage")
        ? "manage"
        : scopeFor(actor, "helpdesk.agent")
          ? "agent"
          : scopeFor(actor, "helpdesk.self")
            ? "self"
            : "none",
      // manage: values, moderation and surveys (aggregates only); self: recognise, react, answer.
      scopeFor(actor, "engage.manage")
        ? "manage"
        : scopeFor(actor, "engage.self")
          ? "self"
          : "none",
      // manage: catalogue, assignments and records for the entity; team: own + direct reports
      // (read only); self: own.
      scopeFor(actor, "learn.manage")
        ? "manage"
        : scopeFor(actor, "learn.team")
          ? "team"
          : scopeFor(actor, "learn.self")
            ? "self"
            : "none",
      // manage: templates, settings, publishing and every roster in the entity; team: own +
      // current direct reports' rosters; self: own shifts in published weeks.
      scopeFor(actor, "shift.manage")
        ? "manage"
        : scopeFor(actor, "shift.team")
          ? "team"
          : scopeFor(actor, "shift.self")
            ? "self"
            : "none",
    ],
  );
}
export async function scoped<T>(
  pool: pg.Pool,
  actor: Principal,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(pool, async (client) => {
    await setContext(client, actor);
    return work(client);
  });
}
export async function audit(
  client: PoolClient,
  actor: Principal,
  action: string,
  target: string,
  requestId: string,
  metadata?: { reason?: string; details?: Record<string, unknown> },
) {
  await client.query(
    `INSERT INTO audit_event(id,tenant_id,entity_id,actor_id,actor_label,role,action,target,request_id,reason,details)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      actor.tenantId,
      actor.entityId,
      actor.actorId,
      actor.name,
      actor.role,
      action,
      target,
      requestId,
      metadata?.reason ?? null,
      JSON.stringify(metadata?.details ?? {}),
    ],
  );
}
export async function drainOutbox(pool: pg.Pool) {
  return transaction(pool, async (client) => {
    const events = await client.query<{ id: string }>(
      `SELECT id FROM outbox_event WHERE processed_at IS NULL ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
    );
    for (const event of events.rows) {
      // Internal receipt only. No email or external delivery is claimed.
      await client.query(
        "INSERT INTO event_receipt(event_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [event.id],
      );
      await client.query(
        "UPDATE outbox_event SET processed_at = now() WHERE id = $1",
        [event.id],
      );
    }
    return events.rowCount ?? 0;
  });
}
// Sessions the sign-in path would already refuse, and expired sign-in attempts.
export async function purgeStaleSessions(pool: pg.Pool) {
  const { rows } = await pool.query<{ sessions: number; attempts: number }>(
    "SELECT sessions, attempts FROM purge_stale_sessions()",
  );
  return rows[0]!;
}
// Approved profile changes whose effective date has come, across all tenants, through one
// narrow SECURITY DEFINER function (045/048). Bounded per call; idempotent; a failing request
// is skipped (by id) without blocking the rest.
export async function applyDueProfileChanges(pool: pg.Pool, limit = 200) {
  const { rows } = await pool.query<{
    applied: number;
    skipped: number;
    skippedIds: string[];
  }>(
    'SELECT applied, skipped, skipped_ids AS "skippedIds" FROM profile_apply_due_scheduled($1, $2)',
    [limit, randomUUID()],
  );
  return rows[0]!;
}
