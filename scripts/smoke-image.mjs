import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";

const env = parseEnv(await readFile(".env", "utf8"));
if (env.NODE_ENV !== "development" || env.AUTH_MODE !== "demo")
  throw new Error("Image smoke tests require the synthetic environment");
const database = new URL(env.DATABASE_URL);
if (database.hostname !== "127.0.0.1" || database.port !== "55432")
  throw new Error("Only the local Compose database can be used");
database.hostname = "postgres";
database.port = "5432";
const id = randomUUID();
const name = `anvione-image-smoke-${id}`;
const envPath = `.scratch/${name}.env`;
await mkdir(".scratch", { recursive: true });
await writeFile(
  envPath,
  `NODE_ENV=development\nAUTH_MODE=demo\nAPI_HOST=127.0.0.1\nAPI_PORT=4000\nAPP_ORIGIN=http://127.0.0.1:5173\nDATABASE_URL=${database.href}\n`,
  { mode: 0o600 },
);
const docker = (...args) =>
  spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
try {
  const start = docker(
    "run",
    "--detach",
    "--name",
    name,
    "--network",
    "anvione-dev_default",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",
    "--env-file",
    envPath,
    process.argv[2] ?? "anvione-api:foundation",
  );
  if (start.status !== 0)
    throw new Error(`Image launch failed: ${start.stderr}`);
  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = docker(
      "exec",
      name,
      "node",
      "-e",
      "fetch('http://127.0.0.1:4000/readyz').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))",
    );
    if (result.status === 0) {
      healthy = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!healthy)
    throw new Error(`Image readiness failed. ${docker("logs", name).stderr}`);
  console.log(
    "API image ready: non-root, read-only filesystem, dropped capabilities, isolated synthetic database.",
  );
} finally {
  docker("rm", "--force", name);
  await rm(envPath, { force: true });
}
