import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const scriptSource = fs.readFileSync(path.join(process.cwd(), "scripts/setup-worktree.sh"), "utf8");

const tempDirs: string[] = [];

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function createSqliteDatabase(dbPath: string, label: string) {
  run(
    "sqlite3",
    [dbPath, `CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('${label}');`],
    path.dirname(dbPath)
  );
}

function readSqliteLabel(dbPath: string) {
  return run("sqlite3", [dbPath, "SELECT label FROM marker;"], path.dirname(dbPath)).trim();
}

function createWorktreeFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-setup-worktree-"));
  tempDirs.push(tempDir);

  const mainDir = path.join(tempDir, "main");
  const worktreeDir = path.join(tempDir, "worktree");
  fs.mkdirSync(path.join(mainDir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(mainDir, "scripts/setup-worktree.sh"), scriptSource, { mode: 0o755 });
  fs.writeFileSync(path.join(mainDir, "package.json"), '{"scripts":{}}\n');

  run("git", ["init", "-b", "main"], mainDir);
  run("git", ["config", "user.email", "test@example.com"], mainDir);
  run("git", ["config", "user.name", "Test User"], mainDir);
  run("git", ["add", "scripts/setup-worktree.sh", "package.json"], mainDir);
  run("git", ["commit", "-m", "initial"], mainDir);

  fs.writeFileSync(path.join(mainDir, ".env"), "EIDON_DATA_DIR=.data\n");
  fs.mkdirSync(path.join(mainDir, ".data"));
  createSqliteDatabase(path.join(mainDir, ".data/eidon.db"), "source");
  fs.writeFileSync(path.join(mainDir, ".data/eidon.db-wal"), "live wal");
  fs.writeFileSync(path.join(mainDir, ".data/eidon.db-shm"), "live shm");
  fs.mkdirSync(path.join(mainDir, ".data/attachments"), { recursive: true });
  fs.writeFileSync(path.join(mainDir, ".data/attachments/source.txt"), "source attachment");
  fs.writeFileSync(path.join(mainDir, ".data/source-only.txt"), "source only");

  run("git", ["worktree", "add", "-b", "feature", worktreeDir], mainDir);
  fs.mkdirSync(path.join(worktreeDir, "node_modules"));

  return { mainDir, worktreeDir };
}

function createSourceCheckoutFixture(tempDir: string) {
  const sourceDir = path.join(tempDir, "source");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, ".env"), "EIDON_DATA_DIR=.data\nSOURCE_CHECKOUT=true\n");
  fs.mkdirSync(path.join(sourceDir, ".data", "attachments"), { recursive: true });
  createSqliteDatabase(path.join(sourceDir, ".data/eidon.db"), "source-checkout");
  fs.writeFileSync(path.join(sourceDir, ".data/attachments/source-checkout.txt"), "source checkout");

  return sourceDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("scripts/setup-worktree.sh", () => {
  it("overwrites an existing destination env file with the main env file", () => {
    const { worktreeDir } = createWorktreeFixture();
    fs.writeFileSync(path.join(worktreeDir, ".env"), "EIDON_DATA_DIR=stale\nSTALE=true\n");

    run("./scripts/setup-worktree.sh", [], worktreeDir);

    expect(fs.readFileSync(path.join(worktreeDir, ".env"), "utf8")).toBe("EIDON_DATA_DIR=.data\n");
  });

  it("initializes a missing destination data directory with a full copy from main", () => {
    const { worktreeDir } = createWorktreeFixture();

    run("./scripts/setup-worktree.sh", [], worktreeDir);

    expect(fs.readFileSync(path.join(worktreeDir, ".env"), "utf8")).toBe("EIDON_DATA_DIR=.data\n");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/eidon.db-wal"), "utf8")).toBe("live wal");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/eidon.db-shm"), "utf8")).toBe("live shm");
    expect(readSqliteLabel(path.join(worktreeDir, ".data/eidon.db"))).toBe("source");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/attachments/source.txt"), "utf8")).toBe(
      "source attachment"
    );
    expect(fs.readFileSync(path.join(worktreeDir, ".data/source-only.txt"), "utf8")).toBe("source only");
  });

  it("replaces an existing destination data directory with a full copy from main", () => {
    const { worktreeDir } = createWorktreeFixture();
    fs.mkdirSync(path.join(worktreeDir, ".data/attachments"), { recursive: true });
    createSqliteDatabase(path.join(worktreeDir, ".data/eidon.db"), "destination");
    fs.writeFileSync(path.join(worktreeDir, ".data/eidon.db-wal"), "stale wal");
    fs.writeFileSync(path.join(worktreeDir, ".data/eidon.db-shm"), "stale shm");
    fs.writeFileSync(path.join(worktreeDir, ".data/attachments/destination.txt"), "destination attachment");
    fs.writeFileSync(path.join(worktreeDir, ".data/destination-only.txt"), "destination only");

    run("./scripts/setup-worktree.sh", [], worktreeDir);

    expect(fs.readFileSync(path.join(worktreeDir, ".data/eidon.db-wal"), "utf8")).toBe("live wal");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/eidon.db-shm"), "utf8")).toBe("live shm");
    expect(readSqliteLabel(path.join(worktreeDir, ".data/eidon.db"))).toBe("source");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/attachments/source.txt"), "utf8")).toBe(
      "source attachment"
    );
    expect(fs.readFileSync(path.join(worktreeDir, ".data/source-only.txt"), "utf8")).toBe("source only");
    expect(fs.existsSync(path.join(worktreeDir, ".data/attachments/destination.txt"))).toBe(false);
    expect(fs.existsSync(path.join(worktreeDir, ".data/destination-only.txt"))).toBe(false);
  });

  it("copies env from EIDON_SETUP_SOURCE_DIR but data always from main", () => {
    const { worktreeDir } = createWorktreeFixture();
    const sourceDir = createSourceCheckoutFixture(path.dirname(worktreeDir));

    run("./scripts/setup-worktree.sh", [], worktreeDir, { EIDON_SETUP_SOURCE_DIR: sourceDir });

    expect(fs.readFileSync(path.join(worktreeDir, ".env"), "utf8")).toBe(
      "EIDON_DATA_DIR=.data\nSOURCE_CHECKOUT=true\n"
    );
    expect(readSqliteLabel(path.join(worktreeDir, ".data/eidon.db"))).toBe("source");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/attachments/source.txt"), "utf8")).toBe(
      "source attachment"
    );
  });

  it("succeeds when main has no .data directory", () => {
    const { mainDir, worktreeDir } = createWorktreeFixture();
    fs.rmSync(path.join(mainDir, ".data"), { recursive: true, force: true });

    run("./scripts/setup-worktree.sh", [], worktreeDir);

    expect(fs.existsSync(path.join(worktreeDir, ".data"))).toBe(false);
  });

  it("does not delete source data when main and worktree .data are the same", () => {
    const { mainDir, worktreeDir } = createWorktreeFixture();
    fs.writeFileSync(path.join(worktreeDir, ".env"), "EIDON_DATA_DIR=.data\n");
    fs.mkdirSync(path.join(worktreeDir, ".data", "attachments"), { recursive: true });
    createSqliteDatabase(path.join(worktreeDir, ".data/eidon.db"), "same-source");
    fs.writeFileSync(path.join(worktreeDir, ".data/attachments/source.txt"), "same source");
    fs.rmSync(path.join(mainDir, ".data"), { recursive: true, force: true });
    fs.symlinkSync(path.join(worktreeDir, ".data"), path.join(mainDir, ".data"));

    const output = run("./scripts/setup-worktree.sh", [], worktreeDir);

    expect(output).toContain("source and destination data directories are the same");
    expect(readSqliteLabel(path.join(worktreeDir, ".data/eidon.db"))).toBe("same-source");
    expect(fs.readFileSync(path.join(worktreeDir, ".data/attachments/source.txt"), "utf8")).toBe("same source");
  });
});
