import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required");
const credentials = [
  ["anvione_app", process.env.RUNTIME_DB_PASSWORD],
  ["anvione_worker", process.env.WORKER_DB_PASSWORD],
  ["anvione_identity_operator", process.env.IDENTITY_OPERATOR_DB_PASSWORD],
  ["anvione_candidate", process.env.CANDIDATE_DB_PASSWORD],
] as const;
if (credentials.some(([, password]) => !password || password.length < 32)) {
  throw new Error(
    "Generated runtime, worker and identity operations database passwords are required before migration; run setup:local for the synthetic environment.",
  );
}
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(804210)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const folder = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(folder))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await client.query("SELECT 1 FROM schema_migration WHERE name = $1", [
          name,
        ])
      ).rowCount
    )
      continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(new URL(name, folder), "utf8"));
      await client.query("INSERT INTO schema_migration(name) VALUES ($1)", [
        name,
      ]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  for (const [role, password] of credentials) {
    // PostgreSQL DDL does not accept bind parameters; format quotes both values server-side.
    const result = await client.query<{ sql: string }>(
      "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql",
      [role, password],
    );
    await client.query(result.rows[0]!.sql);
  }
} finally {
  await client.end();
}
