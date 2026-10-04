import assert from "node:assert/strict";
import { it } from "node:test";
import { fixture, testEnv } from "./support";
import { migrateApplication } from "../src/storage/migrate";
import { row, rows, run, text } from "../src/storage/sql";
import { publicConfig } from "../src/server/env";

it("fresh installations expose no retired feature configuration or storage", () => {
  testEnv();
  const f = fixture();
  try {
    assert.equal(rows(f.db, "SELECT name FROM sqlite_master WHERE name LIKE 'voice_%' OR name IN ('user_preferences', 'authority_drafts', 'rate_events')").length, 0);
    assert(!JSON.stringify(publicConfig()).toLowerCase().includes("voice"));
  } finally { f.db.close(); }
});

it("v4 upgrade deletes retired transcripts and sessions but preserves instructions and payment holds", () => {
  testEnv();
  const f = fixture();
  try {
    const purchase = f.purchase();
    const paymentBefore = row(f.db, "SELECT * FROM proposals WHERE id = ?", [purchase.proposal.id]);
    const reservationsBefore = rows(f.db, "SELECT * FROM reservations");
    const registrationsBefore = rows(f.db, "SELECT * FROM registrations");
    f.db.exec("PRAGMA foreign_keys = OFF");
    const sql = text(row(f.db, "SELECT sql FROM sqlite_master WHERE name = 'instructions'")?.sql);
    f.db.exec("DROP TABLE instructions");
    f.db.exec(sql.replace("'LEGACY'", "'VOICE'"));
    run(f.db, "INSERT INTO instructions (id, task_id, workspace_id, authored_by, source, text, state, revision, created_at) VALUES ('old-instruction', ?, ?, 'owner', 'VOICE', 'Keep the existing spending limit', 'APPLIED', 1, ?)", [purchase.task.id, f.workspace.id, f.now]);
    f.db.exec(`CREATE TABLE voice_sessions (id TEXT PRIMARY KEY);
      CREATE TABLE voice_messages (session_id TEXT REFERENCES voice_sessions(id), text TEXT);
      CREATE TABLE voice_tool_calls (session_id TEXT REFERENCES voice_sessions(id));
      CREATE TABLE user_preferences (user_id TEXT);
      CREATE TABLE authority_drafts (id TEXT);
      CREATE TABLE rate_events (id TEXT);
      INSERT INTO voice_sessions VALUES ('old-session');
      INSERT INTO voice_messages VALUES ('old-session', 'Stored transcript to remove');
      DELETE FROM schema_migrations WHERE id = '005_remove_voice';
      UPDATE app_meta SET value = '4' WHERE key = 'schema_version';`);
    f.db.exec("PRAGMA foreign_keys = ON");
    migrateApplication(f.db);
    migrateApplication(f.db);
    assert.equal(rows(f.db, "SELECT name FROM sqlite_master WHERE name LIKE 'voice_%' OR name IN ('user_preferences', 'authority_drafts', 'rate_events')").length, 0);
    assert.equal(row(f.db, "SELECT source FROM instructions WHERE id = 'old-instruction'")?.source, "LEGACY");
    assert.equal(row(f.db, "SELECT text FROM instructions WHERE id = 'old-instruction'")?.text, "Keep the existing spending limit");
    assert.deepEqual(row(f.db, "SELECT * FROM proposals WHERE id = ?", [purchase.proposal.id]), paymentBefore);
    assert.deepEqual(rows(f.db, "SELECT * FROM reservations"), reservationsBefore);
    assert.deepEqual(rows(f.db, "SELECT * FROM registrations"), registrationsBefore);
    assert.equal(rows(f.db, "PRAGMA foreign_key_check").length, 0);
    assert.equal(row(f.db, "PRAGMA foreign_keys")?.foreign_keys, 1);
  } finally { f.db.close(); }
});
