import {
  applyDueProfileChanges,
  makePool,
} from "../packages/database/src/index";

// Applies approved profile changes whose effective date has come, for every tenant and
// entity, in batches of up to 200, through the worker's narrow database function (045).
// Same work the worker does on PROFILE_APPLY_DUE_INTERVAL_MS. Safe to run repeatedly.
const url = process.env.WORKER_DATABASE_URL;
if (!url) throw new Error("WORKER_DATABASE_URL is required");
const pool = makePool(url);
try {
  let total = 0;
  const skipped = new Set<string>();
  // Stops when a batch applies nothing (skipped rows stay approved and would repeat).
  for (let batch = 0; batch < 50; batch += 1) {
    const result = await applyDueProfileChanges(pool);
    total += result.applied;
    for (const id of result.skippedIds) skipped.add(id);
    if (result.applied === 0) break;
  }
  console.log(
    JSON.stringify({
      event: "profile.applied_due",
      applied: total,
      skipped: skipped.size,
      skippedIds: [...skipped],
    }),
  );
} finally {
  await pool.end();
}
