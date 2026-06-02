import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { env } from "@/lib/env";
import { migrate, backfillVisionMcpServers } from "@/lib/db-migrations";

export { migrate, backfillVisionMcpServers } from "@/lib/db-migrations";

let database: Database.Database | null = null;

function getDatabasePath() {
  const dir = path.resolve(env.EIDON_DATA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "eidon.db");
}

export function getDb() {
  if (!database) {
    database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    migrate(database);
  }

  return database;
}

export function resetDbForTests() {
  if (database) {
    database.close();
    database = null;
  }
}
