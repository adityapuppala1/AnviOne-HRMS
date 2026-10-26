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
    set_config('app.attendance_scope',$11,true), set_config('app.document_scope',$12,true)`,
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
