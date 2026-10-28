import pg from "pg";
import { pathToFileURL } from "node:url";
import { readConfig } from "../apps/api/src/config";
import {
  openValue,
  profileKeys,
  sealValue,
  sealedKeyId,
  type ProfileKeys,
} from "../apps/api/src/profile.crypto";

// Re-seals current profile values and open (submitted/approved) request values with the
// newest profile key, through the compare-and-swap functions of migration 046 so every
// profile guard still applies. Immutable history is never rewritten: its rows keep the key
// that sealed them, so retired keys must stay in PROFILE_DATA_KEYS / PROFILE_DATA_KEY while
// the report still counts them. Reports counts by key id only, never values.
// Usage: pnpm profile:rekey [--dry-run]   (uses MIGRATION_DATABASE_URL, an operations role)
const columns = [
  "personal_phone",
  "personal_email",
  "emergency_name",
  "emergency_phone",
  "emergency_relationship",
  "address_line1",
  "address_line2",
  "address_city",
  "address_postal_code",
] as const;

type Counts = Record<string, number>;
export type RekeyReport = {
  mode: "dry-run" | "apply";
  currentKeyId: number;
  before: { current: Counts; openRequests: Counts; history: Counts };
  after?: { current: Counts; openRequests: Counts; history: Counts };
  resealed: { profiles: number; openRequests: number };
  needsReseal: { profiles: number; openRequests: number };
  skipped: { unreadable: number; changedMeanwhile: number };
};

const bump = (counts: Counts, sealed: string | null) => {
  if (sealed === null) return;
  const id = String(sealedKeyId(sealed));
  counts[id] = (counts[id] ?? 0) + 1;
};
// Current only when it is the v2 format under the newest key id.
const isCurrent = (ring: ProfileKeys, sealed: string) => {
  const bytes = Buffer.from(sealed, "base64url");
  return bytes[0] === 2 && bytes[1] === ring.current.id;
};

type ProfileRow = Record<(typeof columns)[number], string | null> & {
  tenant_id: string;
  entity_id: string;
  employee_id: string;
};
type RequestRow = {
  id: string;
  employee_id: string;
  changes: { field: string; value: string | null }[];
};

// `only` narrows the run to some employees (tests); operations leave it out.
async function inventory(db: pg.Pool, only: string[] | null) {
  const profiles = await db.query<ProfileRow>(
    `SELECT tenant_id,entity_id,employee_id,${columns.join(",")} FROM employee_profile
     WHERE $1::uuid[] IS NULL OR employee_id=ANY($1)`,
    [only],
  );
  const requests = await db.query<RequestRow>(
    `SELECT id,employee_id,changes FROM profile_change_request
     WHERE status IN ('submitted','approved') AND ($1::uuid[] IS NULL OR employee_id=ANY($1))`,
    [only],
  );
  const history = await db.query<{
    old_value: string | null;
    new_value: string | null;
  }>(
    "SELECT old_value,new_value FROM profile_change_history WHERE $1::uuid[] IS NULL OR employee_id=ANY($1)",
    [only],
  );
  const counts = {
    current: {} as Counts,
    openRequests: {} as Counts,
    history: {} as Counts,
  };
  for (const row of profiles.rows)
    for (const c of columns) bump(counts.current, row[c]);
  for (const row of requests.rows)
    for (const change of row.changes) bump(counts.openRequests, change.value);
  for (const row of history.rows) {
    bump(counts.history, row.old_value);
    bump(counts.history, row.new_value);
  }
  return { profiles: profiles.rows, requests: requests.rows, counts };
}

export async function rekeyProfiles(
  pool: pg.Pool,
  ring: ProfileKeys,
  dryRun: boolean,
  only: string[] | null = null,
): Promise<RekeyReport> {
  // Profile tables force row-level security, so a role that cannot bypass it would read an
  // empty inventory and report "nothing to do". Refuse instead.
  const role = await pool.query<{ ok: boolean }>(
    "SELECT rolsuper OR rolbypassrls AS ok FROM pg_roles WHERE rolname=current_user",
  );
  if (!role.rows[0]?.ok)
    throw new Error(
      "profile:rekey must run as a superuser or a role with BYPASSRLS (MIGRATION_DATABASE_URL)",
    );
  const { profiles, requests, counts } = await inventory(pool, only);
  if (only === null) {
    const estimate = await pool.query<{ table: string; rows: number }>(
      `SELECT relname AS table, reltuples::float8 AS rows FROM pg_class
       WHERE relname IN ('employee_profile','profile_change_history')`,
    );
    const seen: Record<string, number> = {
      employee_profile: profiles.length,
      profile_change_history: Object.values(counts.history).reduce(
        (a, b) => a + b,
        0,
      ),
    };
    for (const { table, rows } of estimate.rows)
      if (rows > 0 && seen[table] === 0)
        throw new Error(
          `profile:rekey cannot see rows in ${table}; check the role's row-level security access`,
        );
  }
  const report: RekeyReport = {
    mode: dryRun ? "dry-run" : "apply",
    currentKeyId: ring.current.id,
    before: counts,
    resealed: { profiles: 0, openRequests: 0 },
    needsReseal: { profiles: 0, openRequests: 0 },
    skipped: { unreadable: 0, changedMeanwhile: 0 },
  };
  for (const row of profiles) {
    const before: Record<string, string> = {},
      after: Record<string, string> = {};
    let unreadable = false;
    for (const column of columns) {
      const sealed = row[column];
      if (sealed === null || isCurrent(ring, sealed)) continue;
      try {
        const plain = openValue(ring, row.employee_id, column, sealed)!;
        before[column] = sealed;
        after[column] = sealValue(ring, row.employee_id, column, plain);
      } catch {
        unreadable = true;
      }
    }
    if (unreadable) report.skipped.unreadable += 1;
    if (!Object.keys(before).length) continue;
    report.needsReseal.profiles += 1;
    if (dryRun) continue;
    const { rows } = await pool.query<{ ok: boolean }>(
      "SELECT profile_reseal_current($1,$2,$3,$4,$5) AS ok",
      [row.tenant_id, row.entity_id, row.employee_id, before, after],
    );
    if (rows[0]!.ok) report.resealed.profiles += 1;
    else report.skipped.changedMeanwhile += 1;
  }
  for (const row of requests) {
    if (row.changes.every((c) => c.value === null || isCurrent(ring, c.value)))
      continue;
    let next: RequestRow["changes"];
    try {
      next = row.changes.map((c) => ({
        field: c.field,
        value:
          c.value === null || isCurrent(ring, c.value)
            ? c.value
            : sealValue(
                ring,
                row.employee_id,
                c.field,
                openValue(ring, row.employee_id, c.field, c.value)!,
              ),
      }));
    } catch {
      report.skipped.unreadable += 1;
      continue;
    }
    report.needsReseal.openRequests += 1;
    if (dryRun) continue;
    const { rows } = await pool.query<{ ok: boolean }>(
      "SELECT profile_reseal_request($1,$2,$3) AS ok",
      [row.id, JSON.stringify(row.changes), JSON.stringify(next)],
    );
    if (rows[0]!.ok) report.resealed.openRequests += 1;
    else report.skipped.changedMeanwhile += 1;
  }
  if (!dryRun) report.after = (await inventory(pool, only)).counts;
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--dry-run")) {
    console.error("Usage: pnpm profile:rekey [--dry-run]");
    process.exit(2);
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const ring = profileKeys(readConfig(process.env));
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    console.log(
      JSON.stringify(
        await rekeyProfiles(pool, ring, args.includes("--dry-run")),
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}
