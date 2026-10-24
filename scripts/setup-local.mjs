import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".env")) {
  console.log(".env already exists; no settings changed.");
  process.exit(0);
}
const admin = randomBytes(32).toString("hex");
const runtime = randomBytes(32).toString("hex");
const worker = randomBytes(32).toString("hex");
writeFileSync(
  ".env",
  `NODE_ENV=development\nAUTH_MODE=demo\nAPI_HOST=127.0.0.1\nAPI_PORT=4000\nAPP_ORIGIN=http://127.0.0.1:5173\nPOSTGRES_PASSWORD=${admin}\nRUNTIME_DB_PASSWORD=${runtime}\nWORKER_DB_PASSWORD=${worker}\nMIGRATION_DATABASE_URL=postgresql://anvione_migrator:${admin}@127.0.0.1:55432/anvione\nDATABASE_URL=postgresql://anvione_app:${runtime}@127.0.0.1:55432/anvione\nWORKER_DATABASE_URL=postgresql://anvione_worker:${worker}@127.0.0.1:55432/anvione\n`,
  { mode: 0o600, flag: "wx" },
);
console.log("Created .env with random local credentials. Do not commit it.");
