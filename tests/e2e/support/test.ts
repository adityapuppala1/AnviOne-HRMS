import { test as base } from "@playwright/test";
import { createClient } from "redis";

export * from "@playwright/test";

// The API limits sign-ins to a handful per minute and counts them in the shared
// local Valkey, so a long run exhausts the budget and later logins show "Too many
// sign-in requests". Clearing the counters is safe only against the local Compose
// Valkey (127.0.0.1:56379); anything else is left alone.
export async function resetRateLimits() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* No local .env: nothing to reset. */
  }
  const url = process.env.RATE_LIMIT_URL;
  if (!url) return;
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.port !== "56379") return;
  const client = createClient({ url });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: "anvione:rl:*",
      COUNT: 200,
    }))
      if (keys.length) await client.del(keys);
  } finally {
    await client.quit();
  }
}

// Every spec imports `test` from here, so each test starts with a fresh budget.
export const test = base.extend<{ freshRateLimits: void }>({
  freshRateLimits: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
    async ({}, use) => {
      await resetRateLimits();
      await use();
    },
    { auto: true },
  ],
});
