import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getEnv } from "../server/env";
import { migrateApplication } from "./migrate";
import { openDatabase } from "./sql";

const globalForDb = globalThis as unknown as { sentinelDb?: DatabaseSync; sentinelDbPath?: string };

export function getDb(): DatabaseSync {
  const path = getEnv().SENTINEL_DB_PATH;
  if (globalForDb.sentinelDb && globalForDb.sentinelDbPath === path) return globalForDb.sentinelDb;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  migrateApplication(db);
  globalForDb.sentinelDb = db;
  globalForDb.sentinelDbPath = path;
  return db;
}

export function closeDb(): void {
  globalForDb.sentinelDb?.close();
  globalForDb.sentinelDb = undefined;
  globalForDb.sentinelDbPath = undefined;
}
