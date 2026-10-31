// Loaded before each integration file: rate-limit counters now live in the shared
// local Valkey, so one suite's calls must not spend the next suite's budget.
import { createClient } from "redis";

const url = process.env.RATE_LIMIT_URL;
if (url) {
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.port !== "56379")
    throw new Error("Integration tests require the local Compose Valkey");
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
