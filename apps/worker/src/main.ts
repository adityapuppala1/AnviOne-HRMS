import { makePool, drainOutbox, purgeStaleSessions } from "@anvi/database";
if (!process.env.WORKER_DATABASE_URL)
  throw new Error("WORKER_DATABASE_URL is required");
const pool = makePool(process.env.WORKER_DATABASE_URL);
let stopping = false;
let lastPurge = 0;
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
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
await pool.end();
