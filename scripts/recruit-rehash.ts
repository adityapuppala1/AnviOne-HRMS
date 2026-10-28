import pg from "pg";
import { pathToFileURL } from "node:url";
import { readConfig } from "../apps/api/src/config";
import {
  openValue,
  profileKeys,
  type ProfileKeys,
} from "../apps/api/src/profile.crypto";
import {
  recruitEmailHash,
  recruitHashKeyId,
} from "../apps/api/src/recruit.crypto";

// Moves candidate email hashes to the pinned hash key (RECRUIT_HASH_KEY_ID, default the
// oldest key in the ring) through recruit_rehash_candidate (055), a compare-and-swap that
// changes only the hash. Run it before retiring a key that hashes still use. Reports counts
// by key id only, never values. Anonymised candidates have no hash and are skipped.
// Usage: pnpm recruit:rehash [--dry-run]   (uses MIGRATION_DATABASE_URL, an operations role)
export type RehashReport = {
  mode: "dry-run" | "apply";
  targetKeyId: number;
  before: Record<string, number>;
  needsRehash: number;
  rehashed: number;
  skipped: { unreadable: number; changedMeanwhile: number; collision: number };
};

export async function rehashCandidates(
  db: pg.Pool,
  ring: ProfileKeys,
  targetKeyId: number,
  dryRun: boolean,
  only: string[] | null = null,
): Promise<RehashReport> {
  const rows = await db.query<{
    id: string;
    email_sealed: string;
    email_hash: string;
    hash_key_id: number;
  }>(
    `SELECT id,email_sealed,email_hash,hash_key_id FROM ats_candidate
     WHERE anonymised_at IS NULL AND ($1::uuid[] IS NULL OR id=ANY($1))`,
    [only],
  );
  const report: RehashReport = {
    mode: dryRun ? "dry-run" : "apply",
    targetKeyId,
    before: {},
    needsRehash: 0,
    rehashed: 0,
    skipped: { unreadable: 0, changedMeanwhile: 0, collision: 0 },
  };
  for (const row of rows.rows) {
    const key = String(row.hash_key_id);
    report.before[key] = (report.before[key] ?? 0) + 1;
    if (row.hash_key_id === targetKeyId) continue;
    report.needsRehash += 1;
    if (dryRun) continue;
    let email: string | null;
    try {
      email = openValue(ring, row.id, "recruit.email", row.email_sealed);
    } catch {
      email = null;
    }
    if (!email) {
      report.skipped.unreadable += 1;
      continue;
    }
    try {
      const done = await db.query<{ ok: boolean }>(
        "SELECT recruit_rehash_candidate($1,$2,$3,$4) AS ok",
        [
          row.id,
          row.email_hash,
          recruitEmailHash(ring, targetKeyId, email),
          targetKeyId,
        ],
      );
      if (done.rows[0]?.ok) report.rehashed += 1;
      else report.skipped.changedMeanwhile += 1;
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        report.skipped.collision += 1;
      else throw error;
    }
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--dry-run")) {
    console.error("Usage: pnpm recruit:rehash [--dry-run]");
    process.exit(2);
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const config = readConfig(process.env);
  const ring = profileKeys(config);
  const target = recruitHashKeyId(ring, config.RECRUIT_HASH_KEY_ID);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    console.log(
      JSON.stringify(
        await rehashCandidates(pool, ring, target, args.includes("--dry-run")),
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}
