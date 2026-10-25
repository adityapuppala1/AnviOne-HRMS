import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
if (existsSync(".env")) {
  const source = readFileSync(".env", "utf8");
  const values = Object.fromEntries(
    source.split(/\r?\n/).flatMap((line) => {
      const match = /^([A-Z_]+)=(.*)$/.exec(line);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  if (
    values.IDENTITY_OPERATOR_DB_PASSWORD &&
    values.IDENTITY_OPERATOR_DATABASE_URL
  ) {
    console.log(".env already exists; no settings changed.");
    process.exit(0);
  }
  let local;
  try {
    local = new URL(values.MIGRATION_DATABASE_URL);
  } catch {
    /* Validate below without echoing input. */
  }
  if (
    values.NODE_ENV !== "development" ||
    values.AUTH_MODE !== "demo" ||
    local?.hostname !== "127.0.0.1" ||
    local.port !== "55432" ||
    local.pathname !== "/anvione"
  ) {
    throw new Error(
      "Configure dedicated identity operations credentials manually for this existing environment.",
    );
  }
  if (
    values.IDENTITY_OPERATOR_DB_PASSWORD ||
    values.IDENTITY_OPERATOR_DATABASE_URL
  ) {
    throw new Error(
      "Identity operations credentials are partially configured; complete them without replacing existing secrets.",
    );
  }
  const operator = randomBytes(32).toString("hex");
  appendFileSync(
    ".env",
    `\nIDENTITY_OPERATOR_DB_PASSWORD=${operator}\nIDENTITY_OPERATOR_DATABASE_URL=postgresql://anvione_identity_operator:${operator}@127.0.0.1:55432/anvione\n`,
  );
  console.log(
    "Added dedicated random local identity operations credentials; existing settings were preserved.",
  );
  process.exit(0);
}
const admin = randomBytes(32).toString("hex");
const runtime = randomBytes(32).toString("hex");
const worker = randomBytes(32).toString("hex");
const operator = randomBytes(32).toString("hex");
writeFileSync(
  ".env",
  `NODE_ENV=development\nAUTH_MODE=demo\nAPI_HOST=127.0.0.1\nAPI_PORT=4000\nAPP_ORIGIN=http://127.0.0.1:5173\nPOSTGRES_PASSWORD=${admin}\nRUNTIME_DB_PASSWORD=${runtime}\nWORKER_DB_PASSWORD=${worker}\nIDENTITY_OPERATOR_DB_PASSWORD=${operator}\nMIGRATION_DATABASE_URL=postgresql://anvione_migrator:${admin}@127.0.0.1:55432/anvione\nDATABASE_URL=postgresql://anvione_app:${runtime}@127.0.0.1:55432/anvione\nWORKER_DATABASE_URL=postgresql://anvione_worker:${worker}@127.0.0.1:55432/anvione\nIDENTITY_OPERATOR_DATABASE_URL=postgresql://anvione_identity_operator:${operator}@127.0.0.1:55432/anvione\n`,
  { mode: 0o600, flag: "wx" },
);
console.log("Created .env with random local credentials. Do not commit it.");
