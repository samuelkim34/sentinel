import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../contracts/constants";
import { atomic, row, rows, run, text } from "./sql";

const MIGRATION_ID = "001_application";

export function migrateApplication(db: DatabaseSync): void {
  if (db.isTransaction) throw new Error('Run application migrations outside an existing transaction.');
  // The v3 connection CHECK constraint needs a table rebuild. Foreign-key
  // enforcement is restored even on failure; all relationships are checked
  // before the migration commits. No network work occurs in this transaction.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
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
    // Older versions accidentally shared an owner's category mapping globally.
    db.exec("UPDATE merchant_catalog SET verified_category = 'UNKNOWN' WHERE id IN (SELECT merchant_id FROM merchant_permissions)");
    run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', ['002_review_fixes', Date.now()]);
  }
  if (!row(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['003_onsite_agents'])) {
    const connectionSql = text(row(db, "SELECT sql FROM sqlite_master WHERE name = 'connections'")?.sql);
    if (!connectionSql.includes("'INTERNAL'")) {
      db.exec(`CREATE TABLE connections_v3 (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, registration_id TEXT NOT NULL,
        user_id TEXT NOT NULL, resource_uri TEXT NOT NULL UNIQUE,
        auth_mode TEXT NOT NULL CHECK (auth_mode IN ('OAUTH','PERSONAL_TOKEN','INTERNAL')),
        token_hash TEXT, state TEXT NOT NULL CHECK (state IN ('PENDING','ACTIVE','REVOKED')),
        scopes TEXT NOT NULL, tools_verified_at INTEGER, last_seen_at INTEGER, created_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id, registration_id) REFERENCES registrations(workspace_id, id)
      );
      INSERT INTO connections_v3 SELECT * FROM connections;
      DROP TABLE connections;
      ALTER TABLE connections_v3 RENAME TO connections;
      CREATE INDEX connections_active ON connections(registration_id, state);`);
    }
    db.exec(loadSchema('agent-schema.sql'));
    run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', ['003_onsite_agents', Date.now()]);
  }
  if (!row(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['004_sandbox_ledger'])) {
    db.exec(`ALTER TABLE payment_operations ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'BANK_RECEIPT';
      CREATE TABLE sandbox_ledgers (
        wallet_id TEXT PRIMARY KEY REFERENCES wallets(id),
        initial_local_cents INTEGER NOT NULL,
        initial_observed_cents INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );`);
    run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', ['004_sandbox_ledger', Date.now()]);
  }
  if (!row(db, 'SELECT id FROM schema_migrations WHERE id = ?', ['005_remove_voice'])) {
    // Remove obsolete feature storage on upgrade; preserve financial records,
    // chat, tasks and historical instruction text with an explicit legacy source.
    db.exec(`DROP TABLE IF EXISTS voice_messages;
      DROP TABLE IF EXISTS voice_tool_calls;
      DROP TABLE IF EXISTS voice_sessions;
      DROP TABLE IF EXISTS authority_drafts;
      DROP TABLE IF EXISTS user_preferences;
      DROP TABLE IF EXISTS rate_events;`);
    const instructionSql = text(row(db, "SELECT sql FROM sqlite_master WHERE name = 'instructions'")?.sql);
    if (instructionSql.includes("'VOICE'")) {
      db.exec(instructionSql.replace(/CREATE TABLE(?: IF NOT EXISTS)? ["`]?instructions["`]?/i, 'CREATE TABLE instructions_v5').replace("'VOICE'", "'LEGACY'"));
      db.exec(`INSERT INTO instructions_v5 SELECT id, task_id, registration_id, workspace_id, authored_by,
        CASE WHEN source = 'VOICE' THEN 'LEGACY' ELSE source END,
        text, state, revision, created_at, acknowledged_at, applied_at, reported_outcome FROM instructions;
        DROP TABLE instructions;
        ALTER TABLE instructions_v5 RENAME TO instructions;`);
    }
    run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', ['005_remove_voice', Date.now()]);
  }
  run(db, "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    String(SCHEMA_VERSION),
  ]);
  if (rows(db, 'PRAGMA foreign_key_check').length) throw new Error('Migration would break database relationships.');
  });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function loadSchema(filename = 'schema.sql'): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, filename), join(process.cwd(), 'src/storage', filename)];
  for (const candidate of candidates) {
    try {
      return readFileSync(/*turbopackIgnore: true*/ candidate, "utf8");
    } catch {
      // Try the next location. Next's bundled output and tsx keep different paths.
    }
  }
  throw new Error("Application schema SQL could not be located.");
}
