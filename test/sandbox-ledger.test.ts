import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, fixture, banking, receipt } from './support';
import { setBankingAdapterForTests } from '../src/banking/adapter';
import { resetEnvCache } from '../src/server/env';
import { submitPayment, reconcilePayment } from '../src/domain/settlement';
import { applyObservation, establishBaseline } from '../src/domain/accounts';
import { row, num } from '../src/storage/sql';
import { migrateApplication } from '../src/storage/migrate';
import { NessieClient } from '../src/banking/nessie-client';
beforeEach(() => { testEnv(); process.env.NESSIE_SIMULATE_COMPLETION = 'true'; resetEnvCache(); });
afterEach(() => { delete process.env.NESSIE_SIMULATE_COMPLETION; resetEnvCache(); setBankingAdapterForTests(null); });
test('local sandbox ledger debits exactly once and unchanged provider refresh does not refill or quarantine', async () => {
  const f = fixture(); let writes = 0;
  try {
    setBankingAdapterForTests(banking(async input => { writes++; assert.equal(input.simulateCompletion, true); return receipt('COMPLETED', input.sentinelReference); }));
    const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
    await submitPayment(f.db, p.proposal.id, f.now + 1);
    await reconcilePayment(f.db, p.proposal.id, f.now + 2);
    const summary = applyObservation(f.db, f.workspace.id, 'wallet', 10000, f.now + 3, null, null);
    assert.equal(writes, 1); assert.equal(summary.policyBalanceCents, 8500);
    assert.equal(summary.observedBalanceCents, 10000); assert.equal(summary.state, 'ACTIVE');
    assert.equal(summary.localSandboxLedger, true); assert.equal(summary.reservedCents, 0);
    assert.equal(row(f.db, 'SELECT settlement_mode FROM payment_operations')?.settlement_mode, 'LOCAL_SANDBOX');
    assert.throws(() => establishBaseline(f.db, f.owner, 'wallet', f.now + 4));
    migrateApplication(f.db);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM sandbox_ledgers')?.n), 1);
    assert.equal(row(f.db, 'SELECT policy_balance_cents FROM wallets')?.policy_balance_cents, 8500);
  } finally { f.db.close(); }
});
test('a changed provider balance pauses the account without a second local debit', async () => {
  const f = fixture();
  try {
    setBankingAdapterForTests(banking(async input => receipt('COMPLETED', input.sentinelReference)));
    const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
    const summary = applyObservation(f.db, f.workspace.id, 'wallet', 8500, f.now + 1, null, null);
    assert.equal(summary.state, 'QUARANTINED'); assert.equal(summary.policyBalanceCents, 8500);
    assert.match(summary.quarantineReason!, /not been deducted again/);
  } finally { f.db.close(); }
});
test('enabling simulation does not convert or resubmit an existing pending operation', async () => {
  const f = fixture(); let writes = 0;
  try {
    process.env.NESSIE_SIMULATE_COMPLETION = 'false'; resetEnvCache();
    let ref = '';
    setBankingAdapterForTests(banking(async input => { writes++; ref = input.sentinelReference; return receipt('PENDING', ref); }, async () => receipt('PENDING', ref)));
    const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
    process.env.NESSIE_SIMULATE_COMPLETION = 'true'; resetEnvCache();
    await submitPayment(f.db, p.proposal.id, f.now + 1);
    await reconcilePayment(f.db, p.proposal.id, f.now + 2);
    assert.equal(writes, 1); assert.equal(row(f.db, 'SELECT state FROM proposals')?.state, 'SUBMITTED_PENDING');
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM sandbox_ledgers')?.n), 0);
    assert.equal(row(f.db, 'SELECT settlement_mode FROM payment_operations')?.settlement_mode, 'BANK_RECEIPT');
  } finally { f.db.close(); }
});
test('simulation requires separate receipt readback and uses singular purchase route', async () => {
  const requests: string[] = []; let stored: Record<string, unknown> = {};
  const client = new NessieClient({ baseUrl: 'https://fixture.invalid', apiKey: 'fixture', fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    requests.push(`${init?.method} ${path}`);
    if (init?.method === 'POST') {
      stored = { ...JSON.parse(String(init.body)), _id: 'record', payer_id: 'account' };
      assert.equal(stored.status, 'completed');
      return Response.json({ objectCreated: stored });
    }
    assert.equal(path, '/purchase/record');
    return Response.json(stored);
  } });
  const r = await client.createPurchase({ accountId: 'account', merchantId: 'merchant', amountCents: 400, description: 'unique-ref', simulateCompletion: true });
  assert.equal(r.state, 'COMPLETED'); assert.equal(r.amountCents, 400);
  assert.deepEqual(requests, ['POST /accounts/account/purchases', 'GET /purchase/record']);
});
test('failed completed-record readback never blindly accepts the POST receipt', async () => {
  let posts = 0;
  const client = new NessieClient({ baseUrl: 'https://fixture.invalid', apiKey: 'fixture', fetchImpl: async (_url, init) => {
    if (init?.method === 'POST') { posts++; return Response.json({ objectCreated: { _id: 'record', amount: 4, status: 'completed' } }); }
    return Response.json({ message: 'not available' }, { status: 403 });
  } });
  await assert.rejects(client.createPurchase({ accountId: 'account', merchantId: 'merchant', amountCents: 400, description: 'ref', simulateCompletion: true }));
  assert.equal(posts, 1);
});

test('version 3 upgrade preserves pending operations and does not enroll old accounts automatically', async () => {
  const f = fixture();
  try {
    process.env.NESSIE_SIMULATE_COMPLETION = 'false'; resetEnvCache();
    setBankingAdapterForTests(banking(async input => receipt('PENDING', input.sentinelReference)));
    const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
    f.db.exec("DROP TABLE sandbox_ledgers; ALTER TABLE payment_operations DROP COLUMN settlement_mode; DELETE FROM schema_migrations WHERE id = '004_sandbox_ledger'; UPDATE app_meta SET value = '3' WHERE key = 'schema_version';");
    migrateApplication(f.db); migrateApplication(f.db);
    assert.equal(row(f.db, 'SELECT settlement_mode FROM payment_operations')?.settlement_mode, 'BANK_RECEIPT');
    assert.equal(row(f.db, 'SELECT state FROM payment_operations')?.state, 'SUBMITTED_PENDING');
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM sandbox_ledgers')?.n), 0);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 1);
  } finally { f.db.close(); }
});
