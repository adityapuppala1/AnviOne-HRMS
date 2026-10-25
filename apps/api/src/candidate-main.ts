import { readConfig } from "./config";
import { createCandidateApp } from "./candidate-app";
const { app, store } = await createCandidateApp(readConfig(process.env));
await app.listen(4001, "127.0.0.1");
console.log(JSON.stringify({ event: "candidate.preview_ready", port: 4001 }));
process.once("SIGTERM", () => {
  void app.close().finally(() => store.pool.end());
});
