const { spawn } = require("node:child_process");
const fs = require("node:fs");

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
let restartingServer = false;
let restartTimer = null;
const fileWatchers = [];

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
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  for (const watcher of fileWatchers) {
    watcher.close();
  }
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

  const startServer = () => {
    serverProcess = spawnProcess(nodeCommand, ["server.cjs"]);
    serverProcess.on("exit", (code, signal) => {
      if (shuttingDown) return;

      if (restartingServer) {
        restartingServer = false;
        startServer();
        return;
      }

      const reason = signal
        ? `dev server exited from signal ${signal}`
        : `dev server exited with code ${code ?? 0}`;
      console.error(`[dev] ${reason}`);
      shutdown(code ?? 1);
    });
  };

  const scheduleRestart = () => {
    if (shuttingDown || restartingServer) return;

    if (restartTimer) {
      clearTimeout(restartTimer);
    }

    restartTimer = setTimeout(() => {
      restartTimer = null;

      if (!serverProcess) {
        startServer();
        return;
      }

      restartingServer = true;
      terminate(serverProcess);
    }, 150);
  };

  fileWatchers.push(fs.watch("server.cjs", scheduleRestart));
  fileWatchers.push(fs.watch("ws-handler-compiled.cjs", scheduleRestart));

  startServer();
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
