import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, fixture, banking, receipt } from './support';
import { setBankingAdapterForTests } from '../src/banking/adapter';
import { submitPayment, reconcilePayment } from '../src/domain/settlement';
import { row, num } from '../src/storage/sql';
beforeEach(testEnv);
afterEach(() => setBankingAdapterForTests(null));

test('failed direct GET falls back to account reference lookup and applies one verified completion', async () => {
  const f = fixture(); let writes = 0; let lists = 0; let ref = '';
  try {
    const adapter = banking(async input => { writes++; ref = input.sentinelReference; return receipt('PENDING', ref); }, async () => { throw new Error('403 Missing Authentication Token'); });
    adapter.findPurchaseByReference = async (account, reference) => { lists++; assert.equal(account, 'account'); assert.equal(reference, ref); return { supported: true, definitive: false, receipt: receipt('COMPLETED', ref) }; };
    setBankingAdapterForTests(adapter);
    const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
    await reconcilePayment(f.db, p.proposal.id, f.now + 1000);
    await reconcilePayment(f.db, p.proposal.id, f.now + 2000);
    assert.equal(row(f.db, 'SELECT state FROM proposals')?.state, 'COMPLETED');
    assert.equal(row(f.db, 'SELECT policy_balance_cents FROM wallets')?.policy_balance_cents, 8500);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 0);
    assert.equal(writes, 1); assert.equal(lists, 1);
  } finally { f.db.close(); }
});

test('fallback receipt cannot change a known transaction ID, account, merchant, reference or amount', async () => {
  for (const mismatch of [{ externalId: 'other' }, { accountExternalId: 'other' }, { merchantExternalId: 'other' }, { reference: 'other' }, { amountCents: 1400 }]) {
    const f = fixture(); let ref = '';
    try {
      const adapter = banking(async input => { ref = input.sentinelReference; return receipt('PENDING', ref); }, async () => null);
      adapter.findPurchaseByReference = async () => ({ supported: true, definitive: false, receipt: { ...receipt('COMPLETED', ref), ...mismatch } });
      setBankingAdapterForTests(adapter);
      const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
      await reconcilePayment(f.db, p.proposal.id, f.now + 1000);
      assert.equal(row(f.db, 'SELECT state FROM proposals')?.state, 'RECONCILE_REQUIRED');
      assert.equal(row(f.db, 'SELECT receipt_applied FROM payment_operations')?.receipt_applied, 0);
      assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 1);
    } finally { f.db.close(); }
  }
});

test('failed or empty fallback is a read diagnostic, never a rejection or another submission', async () => {
  for (const throws of [false, true]) {
    const f = fixture();
    try {
      const adapter = banking(async input => receipt('PENDING', input.sentinelReference), async () => { throw new Error('403'); });
      adapter.findPurchaseByReference = async () => { if (throws) throw new Error('offline'); return { supported: true, definitive: false, receipt: null }; };
      setBankingAdapterForTests(adapter);
      const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
      await reconcilePayment(f.db, p.proposal.id, f.now + 1000);
      const op = row(f.db, 'SELECT * FROM payment_operations')!;
      assert.match(String(op.detail), /BANK_READ_/); assert.equal(op.submission_count, 1);
      assert.equal(op.state, 'SUBMITTED_PENDING'); assert.equal(op.receipt_applied, 0);
    } finally { f.db.close(); }
  }
});

test('a current pending account-list receipt is reported honestly as pending', async () => {
  const f = fixture(); let ref = '';
  try {
    const adapter = banking(async input => { ref = input.sentinelReference; return receipt('PENDING', ref); }, async () => { throw new Error('403'); });
    adapter.findPurchaseByReference = async () => ({ supported: true, definitive: false, receipt: receipt('PENDING', ref) });
    setBankingAdapterForTests(adapter);
    const p = f.purchase(); await submitPayment(f.db, p.proposal.id, f.now);
    await reconcilePayment(f.db, p.proposal.id, f.now + 1000);
    assert.equal(row(f.db, 'SELECT state FROM proposals')?.state, 'SUBMITTED_PENDING');
    assert.match(String(row(f.db, 'SELECT detail FROM payment_operations')?.detail), /BANK_PENDING_CONFIRMED/);
  } finally { f.db.close(); }
});
