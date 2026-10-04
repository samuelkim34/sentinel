import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getEnv } from "../server/env";
import { migrateApplication } from "./migrate";
import { openDatabase } from "./sql";

const globalForDb = globalThis as unknown as { sentinelDb?: DatabaseSync; sentinelDbPath?: string; sentinelAuthDb?: DatabaseSync; sentinelAuthDbPath?: string };

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
  globalForDb.sentinelAuthDb?.close();
  globalForDb.sentinelAuthDb = undefined;
  globalForDb.sentinelAuthDbPath = undefined;
  globalForDb.sentinelDb?.close();
  globalForDb.sentinelDb = undefined;
  globalForDb.sentinelDbPath = undefined;
}

export function getAuthDb(): DatabaseSync {
  const path = getEnv().SENTINEL_DB_PATH;
  // An in-memory database is intentionally shared by isolated unit tests.
  // File-backed deployments use a separate connection to the same database:
  // synchronous domain savepoints must never join an async auth transaction.
  if (path === ':memory:') return getDb();
  if (globalForDb.sentinelAuthDb && globalForDb.sentinelAuthDbPath === path) return globalForDb.sentinelAuthDb;
  getDb();
  const db = openDatabase(path);
  globalForDb.sentinelAuthDb = db;
  globalForDb.sentinelAuthDbPath = path;
  return db;
}
