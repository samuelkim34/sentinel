import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../contracts/constants";
import { atomic, row, rows, run, text } from "./sql";

const MIGRATION_ID = "001_application";

export function migrateApplication(db: DatabaseSync): void {
  atomic(db, () => {
  const metaTable = row(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'");
  const existing = metaTable ? row(db, "SELECT value FROM app_meta WHERE key = 'schema_version'") : undefined;
  if (existing && Number(existing.value) > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${String(existing.value)} is newer than this application (${SCHEMA_VERSION}).`,
    );
  }
  const migrationTable = row(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  const applied = migrationTable ? row(db, "SELECT id FROM schema_migrations WHERE id = ?", [MIGRATION_ID]) : undefined;
  if (!applied) {
    db.exec(loadSchema());
    run(db, "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [MIGRATION_ID, Date.now()]);
  }
  if (!row(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['002_review_fixes'])) {
    if (!rows(db, 'PRAGMA table_info(voice_tool_calls)').some((column) => text(column.name) === 'request_hash')) {
      db.exec('ALTER TABLE voice_tool_calls ADD COLUMN request_hash TEXT');
    }
    // Older versions accidentally shared an owner's category mapping globally.
    db.exec("UPDATE merchant_catalog SET verified_category = 'UNKNOWN' WHERE id IN (SELECT merchant_id FROM merchant_permissions)");
    db.exec("UPDATE voice_sessions SET state = 'ENDED', ended_at = expires_at WHERE state = 'ACTIVE' AND id NOT IN (SELECT id FROM voice_sessions v WHERE v.state = 'ACTIVE' AND v.rowid = (SELECT MAX(v2.rowid) FROM voice_sessions v2 WHERE v2.user_id = v.user_id AND v2.state = 'ACTIVE'))");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS voice_one_active_per_user ON voice_sessions(user_id) WHERE state = 'ACTIVE'");
    run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', ['002_review_fixes', Date.now()]);
  }
  run(db, "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    String(SCHEMA_VERSION),
  ]);
  });
}

function loadSchema(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "schema.sql"), join(process.cwd(), "src/storage/schema.sql")];
  for (const candidate of candidates) {
    try {
      return readFileSync(/*turbopackIgnore: true*/ candidate, "utf8");
    } catch {
      // Try the next location. Next's bundled output and tsx keep different paths.
    }
  }
  throw new Error("Application schema SQL could not be located.");
}
