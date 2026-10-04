import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomic, openDatabase, row } from '../src/storage/sql';
import { closeDb, getAuthDb, getDb } from '../src/storage/db';
import { resetEnvCache } from '../src/server/env';
import { testEnv } from './support';

test('a prepared auth BEGIN acquires write intent before a competing worker changes the snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-storage-')); const path = join(directory, 'test.sqlite');
  const auth = openDatabase(path); const worker = openDatabase(path);
  try {
    auth.exec('CREATE TABLE facts (value TEXT)'); worker.exec('PRAGMA busy_timeout = 1');
    auth.prepare('begin').run(); auth.prepare('SELECT * FROM facts').all();
    assert.throws(() => worker.prepare("INSERT INTO facts VALUES ('worker')").run(), /locked/);
    auth.prepare("INSERT INTO facts VALUES ('auth')").run(); auth.prepare('commit').run();
    worker.prepare("INSERT INTO facts VALUES ('worker')").run();
    assert.equal(Number(row(worker, 'SELECT COUNT(*) AS c FROM facts')?.c), 2);
  } finally { auth.close(); worker.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('file-backed auth and domain connections cannot share uncommitted data or nested transactions', () => {
  testEnv(); const directory = mkdtempSync(join(tmpdir(), 'sentinel-auth-isolation-'));
  process.env.SENTINEL_DB_PATH = join(directory, 'test.sqlite'); resetEnvCache();
  const domain = getDb(); const auth = getAuthDb();
  try {
    assert.notEqual(auth, domain); domain.exec('PRAGMA busy_timeout = 1'); auth.exec('CREATE TABLE isolation_probe (value TEXT)');
    auth.prepare('BEGIN TRANSACTION').run(); auth.prepare("INSERT INTO isolation_probe VALUES ('uncommitted')").run();
    assert.equal(domain.isTransaction, false); assert.equal(Number(row(domain, 'SELECT COUNT(*) AS c FROM isolation_probe')?.c), 0);
    assert.throws(() => atomic(domain, () => domain.prepare("INSERT INTO isolation_probe VALUES ('domain')").run()), /busy/);
    auth.prepare('ROLLBACK').run();
    atomic(domain, () => domain.prepare("INSERT INTO isolation_probe VALUES ('domain')").run());
    assert.equal(row(auth, 'SELECT value FROM isolation_probe')?.value, 'domain');
  } finally { closeDb(); rmSync(directory, { recursive: true, force: true }); }
});
