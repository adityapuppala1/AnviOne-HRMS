import {
  makePool,
  drainOutbox,
  purgeStaleSessions,
  applyDueProfileChanges,
} from "@anvi/database";
if (!process.env.WORKER_DATABASE_URL)
  throw new Error("WORKER_DATABASE_URL is required");
const pool = makePool(process.env.WORKER_DATABASE_URL);
let stopping = false;
let lastPurge = 0;
// Scheduled application of due profile changes: hourly by default, 0 disables; off under
// NODE_ENV=test unless set explicitly. Each run applies at most 200 changes.
const rawInterval = process.env.PROFILE_APPLY_DUE_INTERVAL_MS;
const applyDueEvery =
  rawInterval !== undefined && rawInterval !== ""
    ? Number(rawInterval)
    : process.env.NODE_ENV === "test"
      ? 0
      : 3_600_000;
if (!Number.isInteger(applyDueEvery) || applyDueEvery < 0)
  throw new Error("PROFILE_APPLY_DUE_INTERVAL_MS must be a whole number of ms");
let lastApplyDue = 0;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
while (!stopping) {
  try {
    const processed = await drainOutbox(pool);
    if (processed)
      console.log(
        JSON.stringify({ event: "outbox.receipted", count: processed }),
      );
  } catch {
    console.error(
      JSON.stringify({
        event: "outbox.retry",
        detail: "Database work failed; retrying without acknowledging events",
      }),
    );
  }
  if (Date.now() - lastPurge >= 60000) {
    lastPurge = Date.now();
    try {
      const purged = await purgeStaleSessions(pool);
      if (purged.sessions || purged.attempts)
        console.log(JSON.stringify({ event: "sessions.purged", ...purged }));
    } catch {
      console.error(
        JSON.stringify({
          event: "sessions.purge_failed",
          detail: "Session cleanup failed; it will run again next minute",
        }),
      );
    }
  }
  if (applyDueEvery > 0 && Date.now() - lastApplyDue >= applyDueEvery) {
    lastApplyDue = Date.now();
    try {
      const { applied, skipped, skippedIds } =
        await applyDueProfileChanges(pool);
      if (applied || skipped)
        console.log(
          JSON.stringify({
            event: "profile.applied_due",
            applied,
            skipped,
            skippedIds,
          }),
        );
    } catch {
      console.error(
        JSON.stringify({
          event: "profile.apply_due_failed",
          detail: "Applying due profile changes failed; it will run again",
        }),
      );
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
await pool.end();
