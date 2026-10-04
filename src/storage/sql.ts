import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { AppError } from "../contracts/errors";

export type SqlRow = Record<string, SQLInputValue | bigint | null | Uint8Array>;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function rows(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): SqlRow[] {
  return db.prepare(sql).all(...params) as SqlRow[];
}

export function row(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): SqlRow | undefined {
  return db.prepare(sql).get(...params) as SqlRow | undefined;
}

export function run(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): number {
  return Number(db.prepare(sql).run(...params).changes);
}

export function atomic<T>(db: DatabaseSync, fn: () => T): T {
  const nested = db.isTransaction;
  const savepoint = `sentinel_${++savepointSequence}`;
  try {
    db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  } catch (error) {
    throw lockError(error);
  }
  try {
    const result = fn();
    if (result && typeof result === 'object' && 'then' in result) throw new Error('SQLite transactions must be synchronous.');
    db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    try {
      if (nested) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else db.exec('ROLLBACK');
    } catch {
      // The original error is the one callers need.
    }
    if (error instanceof AppError) throw error;
    throw lockError(error);
  }
}

let savepointSequence = 0;

function lockError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/database is locked|SQLITE_BUSY|busy/i.test(message)) {
    return new AppError(503, "DATABASE_BUSY", "The financial record is busy. Retry the request.");
  }
  return error;
}

export function text(value: SQLInputValue | bigint | null | Uint8Array | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

export function num(value: SQLInputValue | bigint | null | Uint8Array | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}
