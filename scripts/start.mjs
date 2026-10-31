// One command to get AnviOne running locally: checks prerequisites, installs
// dependencies when missing, writes local secrets once, starts the database,
// applies migrations, then starts the API and portal. It never kills a process
// it did not start; if a port is taken, it stops and says what holds it.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

const API_PORT = 4000;
const PORTAL_PORT = 5173;

// One command line per call: on Windows pnpm is a .cmd shim, so it needs the
// shell, and passing arguments separately through a shell is deprecated.
function run(commandLine) {
  const result = spawnSync(commandLine, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\n"${commandLine}" failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

function has(commandLine) {
  return spawnSync(commandLine, { stdio: "ignore", shell: true }).status === 0;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`Node 22 or newer is needed; this is ${process.version}.`);
  process.exit(1);
}

if (!has("pnpm --version")) {
  console.log("pnpm not found; enabling it with corepack.");
  run("corepack enable");
}

if (!has("docker info")) {
  console.error(
    "Docker is not running. Start Docker Desktop, then run this command again.",
  );
  process.exit(1);
}

for (const port of [API_PORT, PORTAL_PORT]) {
  if (await portInUse(port)) {
    console.error(
      `Port ${port} is already in use. Another copy of AnviOne (or another app) is running.\n` +
        `Stop it first, then run this command again. Nothing was started.`,
    );
    process.exit(1);
  }
}

if (!existsSync("node_modules")) {
  console.log("Installing dependencies.");
  run("pnpm install");
}

run("pnpm setup:local");
run("pnpm db:up");
run("pnpm db:migrate");

console.log(
  `\nStarting AnviOne. Portal: http://127.0.0.1:${PORTAL_PORT}  API: http://127.0.0.1:${API_PORT}\n` +
    `Press Ctrl+C to stop the servers. Run "pnpm db:down" to stop the database.\n`,
);
const dev = spawn("pnpm dev", { stdio: "inherit", shell: true });

// Stop the whole tree, not just the shell, so no server is left behind.
function stop() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(dev.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    dev.kill("SIGTERM");
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
dev.on("exit", (code) => process.exit(code ?? 0));
