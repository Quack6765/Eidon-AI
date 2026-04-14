const { spawn } = require("node:child_process");

const isWindows = process.platform === "win32";
const npxCommand = isWindows ? "npx.cmd" : "npx";
const nodeCommand = process.execPath;

const esbuildArgs = [
  "esbuild",
  "lib/ws-handler.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--packages=external",
  "--outfile=ws-handler-compiled.cjs"
];

let watchProcess = null;
let serverProcess = null;
let shuttingDown = false;

function spawnProcess(command, args, extraOptions = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    ...extraOptions
  });
}

function terminate(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminate(serverProcess);
  terminate(watchProcess);
  process.exit(code);
}

function wireExit(child, name) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `${name} exited from signal ${signal}` : `${name} exited with code ${code ?? 0}`;
    console.error(`[dev] ${reason}`);
    shutdown(code ?? 1);
  });
}

async function runInitialBuild() {
  await new Promise((resolve, reject) => {
    const buildProcess = spawnProcess(npxCommand, esbuildArgs);

    buildProcess.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Initial ws-handler build failed with code ${code ?? 1}`));
    });
  });
}

async function main() {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  await runInitialBuild();

  watchProcess = spawnProcess(npxCommand, [...esbuildArgs, "--watch=forever"]);
  wireExit(watchProcess, "esbuild watch");

  serverProcess = spawnProcess(nodeCommand, [
    "--watch-path=server.cjs",
    "--watch-path=ws-handler-compiled.cjs",
    "server.cjs"
  ]);
  wireExit(serverProcess, "dev server");
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
