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
    set_config('app.employee_id',$3,true), set_config('app.directory_scope',$4,true)`,
    [
      actor.tenantId,
      actor.entityId,
      actor.employeeId,
      scopeFor(actor, "directory.read") ?? "none",
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
) {
  await client.query(
    `INSERT INTO audit_event(id,tenant_id,entity_id,actor_id,actor_label,role,action,target,request_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
