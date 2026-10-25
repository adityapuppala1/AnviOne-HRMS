import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
const secret = () => randomBytes(32).toString("hex");
const pairs = [
  ["IDENTITY_OPERATOR", "anvione_identity_operator"],
  ["CANDIDATE", "anvione_candidate"],
];
if (existsSync(".env")) {
  const values = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^([A-Z_]+)=(.*)$/.exec(line);
        return match ? [[match[1], match[2]]] : [];
      }),
  );
  if (
    pairs.every(
      ([prefix]) =>
        values[`${prefix}_DB_PASSWORD`] && values[`${prefix}_DATABASE_URL`],
    ) &&
    values.ONBOARDING_PREVIEW_KEY
  ) {
    console.log(".env already exists; no settings changed.");
    process.exit(0);
  }
  let local;
  try {
    local = new URL(values.MIGRATION_DATABASE_URL);
  } catch {
    /* Never echo configuration. */
  }
  if (
    values.NODE_ENV !== "development" ||
    values.AUTH_MODE !== "demo" ||
    local?.hostname !== "127.0.0.1" ||
    local.port !== "55432" ||
    local.pathname !== "/anvione"
  )
    throw new Error(
      "Configure new credentials through controlled operations for this environment.",
    );
  const additions = [];
  for (const [prefix, role] of pairs) {
    if (
      Boolean(values[`${prefix}_DB_PASSWORD`]) !==
      Boolean(values[`${prefix}_DATABASE_URL`])
    )
      throw new Error(
        "A credential pair is partially configured; complete it without replacing existing secrets.",
      );
    if (!values[`${prefix}_DATABASE_URL`]) {
      const value = secret();
      additions.push(
        `${prefix}_DB_PASSWORD=${value}`,
        `${prefix}_DATABASE_URL=postgresql://${role}:${value}@127.0.0.1:55432/anvione`,
      );
    }
  }
  if (!values.ONBOARDING_PREVIEW_KEY)
    additions.push(`ONBOARDING_PREVIEW_KEY=${secret()}`);
  appendFileSync(".env", `\n${additions.join("\n")}\n`);
  console.log(
    "Added missing random local credentials; existing settings were preserved.",
  );
  process.exit(0);
}
const admin = secret(),
  runtime = secret(),
  worker = secret();
const fields = [
  `NODE_ENV=development`,
  `AUTH_MODE=demo`,
  `API_HOST=127.0.0.1`,
  `API_PORT=4000`,
  `APP_ORIGIN=http://127.0.0.1:5173`,
  `POSTGRES_PASSWORD=${admin}`,
  `RUNTIME_DB_PASSWORD=${runtime}`,
  `WORKER_DB_PASSWORD=${worker}`,
  `MIGRATION_DATABASE_URL=postgresql://anvione_migrator:${admin}@127.0.0.1:55432/anvione`,
  `DATABASE_URL=postgresql://anvione_app:${runtime}@127.0.0.1:55432/anvione`,
  `WORKER_DATABASE_URL=postgresql://anvione_worker:${worker}@127.0.0.1:55432/anvione`,
  `ONBOARDING_PREVIEW_KEY=${secret()}`,
];
for (const [prefix, role] of pairs) {
  const value = secret();
  fields.push(
    `${prefix}_DB_PASSWORD=${value}`,
    `${prefix}_DATABASE_URL=postgresql://${role}:${value}@127.0.0.1:55432/anvione`,
  );
}
writeFileSync(".env", fields.join("\n") + "\n", { mode: 0o600, flag: "wx" });
console.log("Created .env with random local credentials. Do not commit it.");
