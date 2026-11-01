import { createApp } from "./app";
import { readConfig } from "./config";
const config = readConfig(process.env);
const { app, store } = await createApp(config);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void store.pool.end();
  });
await app.listen(config.API_PORT, config.API_HOST);
console.log(
  JSON.stringify({
    event: "api.ready",
    port: config.API_PORT,
    mode: config.AUTH_MODE,
  }),
);
