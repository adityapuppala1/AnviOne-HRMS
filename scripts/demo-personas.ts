// Binds the synthetic demo personas to employees the demo seed already created.
// Demo mode only, idempotent: reruns reset each persona's roles and reactivate it.
import pg from "pg";
import {
  DEMO_ISSUER,
  demoPersonas,
  demoEmployeeId,
  demoBindingId,
} from "../apps/api/src/demo-personas";

if (process.env.AUTH_MODE !== "demo" || process.env.NODE_ENV === "production")
  throw new Error("Demo personas are available in demo mode only.");
const tenant = "10000000-0000-4000-8000-000000000001";
const entity = "20000000-0000-4000-8000-000000000001";
const client = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(804212)");
  for (const persona of demoPersonas) {
    const employeeId = demoEmployeeId(persona.employee);
    const seeded = await client.query<{ name: string }>(
      `SELECT p.name FROM employee e JOIN person p ON p.id=e.person_id AND p.tenant_id=e.tenant_id
       WHERE e.tenant_id=$1 AND e.entity_id=$2 AND e.id=$3`,
      [tenant, entity, employeeId],
    );
    if (seeded.rows[0]?.name !== persona.name)
      throw new Error(
        `Seeded employee for persona "${persona.key}" is missing. Run pnpm db:seed first.`,
      );
    // Maya's binding belongs to the seed; leave her roles exactly as seeded.
    if (persona.key === "maya") {
      const maya = await client.query(
        "SELECT 1 FROM identity_binding WHERE issuer=$1 AND subject=$2 AND active",
        [DEMO_ISSUER, persona.subject],
      );
      if (!maya.rowCount)
        throw new Error("Maya's demo binding is missing. Run pnpm db:seed.");
      continue;
    }
    const other = await client.query(
      "SELECT 1 FROM identity_binding WHERE employee_id=$1 AND active AND NOT (issuer=$2 AND subject=$3)",
      [employeeId, DEMO_ISSUER, persona.subject],
    );
    if (other.rowCount)
      throw new Error(
        `${persona.name} already has another active sign-in; persona "${persona.key}" was not bound.`,
      );
    await client.query(
      `INSERT INTO identity_binding(id,tenant_id,entity_id,employee_id,issuer,subject,active,roles)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7)
       ON CONFLICT (issuer,subject) DO UPDATE SET active=true, roles=EXCLUDED.roles
       WHERE identity_binding.employee_id=EXCLUDED.employee_id`,
      [
        demoBindingId(persona.employee),
        tenant,
        entity,
        employeeId,
        DEMO_ISSUER,
        persona.subject,
        persona.roles,
      ],
    );
  }
  await client.query("COMMIT");
  for (const p of demoPersonas)
    console.log(`${p.key.padEnd(9)} ${p.name.padEnd(12)} ${p.roles.join(",")}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
